-- ============================================================================
-- SKOVO — achiever lifecycle
--
--     PENDING -> PROBATION -> ACTIVE -> SUSPENDED -> BANNED
--                               ^__________|         (terminal)
--
-- Capability follows approved evidence. No procedure here takes a "level" as
-- an argument, because the previous design did and that is how an achiever
-- reached tier 2 with no documents on file.
--
-- Every transition writes achiever_state_events. A suspension nobody can
-- explain six months later is a suspension that cannot be defended.
-- ============================================================================

DELIMITER $$

-- ---------------------------------------------------------------------------
-- The single way state changes. Everything else calls this.
--
-- Centralised so the audit row cannot be forgotten: an UPDATE written by hand
-- somewhere else would change the state and leave no trace of who or why.
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_achiever_set_state`$$
CREATE PROCEDURE `sp_achiever_set_state`(
    IN p_achiever_id CHAR(36),
    IN p_to_state    VARCHAR(20),
    IN p_reason      TEXT,
    IN p_until       DATETIME,
    IN p_actor_id    CHAR(36),
    IN p_actor_role  VARCHAR(20)
)
BEGIN
    DECLARE v_from VARCHAR(20);

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    IF p_to_state NOT IN ('pending','probation','active','suspended','banned') THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'INVALID_STATE';
    END IF;

    START TRANSACTION;

    SELECT state INTO v_from FROM `achievers` WHERE id = p_achiever_id FOR UPDATE;

    IF v_from IS NULL THEN
        ROLLBACK;
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ACHIEVER_NOT_FOUND';
    END IF;

    -- A ban is terminal. Reversing it is a deliberate act with its own
    -- procedure, not something an ordinary state change can do by accident.
    IF v_from = 'banned' AND p_to_state <> 'banned' THEN
        ROLLBACK;
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'BANNED_IS_TERMINAL';
    END IF;

    UPDATE `achievers`
       SET state            = p_to_state,
           state_reason     = p_reason,
           state_changed_at = UTC_TIMESTAMP(),
           state_changed_by = p_actor_id,
           suspended_until  = IF(p_to_state = 'suspended', p_until, NULL),
           -- is_active is deliberately NOT written here any more.
           --
           -- It was set to 0 for any state outside active/probation, to keep
           -- unmigrated screens from showing a banned achiever as bookable. The
           -- directory has since moved to filtering on `state` directly, so that
           -- reason is gone -- but the login still reads is_active, and 'pending'
           -- is outside that list. The effect was that an achiever waiting for
           -- review could not sign in to the portal they were waiting in, and the
           -- login told them their password was wrong.
           --
           -- The two flags mean different things and now stay that way: `state`
           -- is where they are in the lifecycle, `is_active` is whether the
           -- account has been soft-deleted by an admin.
           updated_at       = UTC_TIMESTAMP()
     WHERE id = p_achiever_id;

    INSERT INTO `achiever_state_events`
        (id, achiever_id, from_state, to_state, reason, suspended_until,
         actor_id, actor_role, created_at)
    VALUES
        (UUID(), p_achiever_id, v_from, p_to_state, p_reason, p_until,
         p_actor_id, p_actor_role, UTC_TIMESTAMP());

    COMMIT;

    SELECT p_achiever_id AS achiever_id, v_from AS from_state, p_to_state AS to_state;
END$$


-- ---------------------------------------------------------------------------
-- Lift a ban: BANNED -> the state the ban interrupted.
--
-- The one procedure sp_achiever_set_state points at when it refuses to leave
-- 'banned'. A ban stays terminal for every ordinary state change; undoing one
-- has to be asked for by name, which is what this is.
--
-- It restores the prior state rather than landing everyone on PENDING. Pending
-- looked like the cautious choice and was not: a lifted ban then cost the
-- achiever their place, since an approved achiever came back an applicant and
-- had to be approved again -- and that second approval was what reset their
-- demo target. A lift is a reversal. If the account should still be looked at,
-- that is a suspension, which this platform already has.
--
-- Only an account with no recorded ban event falls back to PENDING, because
-- there is then nothing to restore.
--
-- The reason is required by the route, and the audit row is written here for
-- the same purpose as everywhere else: an unban is exactly the decision someone
-- will ask about later.
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_achiever_unban`$$
CREATE PROCEDURE `sp_achiever_unban`(
    IN p_achiever_id CHAR(36),
    IN p_reason      TEXT,
    IN p_actor_id    CHAR(36),
    IN p_actor_role  VARCHAR(20)
)
BEGIN
    DECLARE v_from  VARCHAR(20);
    DECLARE v_to    VARCHAR(20);
    DECLARE v_until DATETIME DEFAULT NULL;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    START TRANSACTION;

    SELECT state INTO v_from FROM `achievers` WHERE id = p_achiever_id FOR UPDATE;

    IF v_from IS NULL THEN
        ROLLBACK;
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ACHIEVER_NOT_FOUND';
    END IF;

    -- Only a ban can be lifted here. Anything else has its own route, and
    -- letting this one double as a general reset would put the terminal guard
    -- back where it started.
    IF v_from <> 'banned' THEN
        ROLLBACK;
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'NOT_BANNED';
    END IF;

    -- Lifting a ban puts them back where the ban found them, not at the start.
    --
    -- This used to land everyone on 'pending'. That read as the safe choice,
    -- but it made a lifted ban cost the achiever their place: an approved
    -- achiever on probation came back as an applicant and had to be approved a
    -- second time, and that second approval is what reset their demo target.
    -- The state they held is already recorded - the ban itself wrote it as the
    -- `from_state` of its own event - so it is read back rather than guessed.
    SELECT from_state INTO v_to
      FROM `achiever_state_events`
     WHERE achiever_id = p_achiever_id
       AND to_state    = 'banned'
       AND from_state <> 'banned'
     ORDER BY created_at DESC, id DESC
     LIMIT 1;

    -- Nothing recorded means nothing to restore: an account banned before this
    -- history existed, or seeded straight into the state. Review is the only
    -- honest answer there.
    IF v_to IS NULL THEN
        SET v_to = 'pending';
    END IF;

    -- They were suspended when the ban landed, so that is what they go back to.
    -- The end date comes back with it only if it has not already passed -
    -- restoring an expired one would leave a suspension the nightly job lifts
    -- the same night, which is not a suspension at all. An expired or missing
    -- date means indefinite, and an admin lifts it by hand.
    IF v_to = 'suspended' THEN
        SELECT suspended_until INTO v_until
          FROM `achiever_state_events`
         WHERE achiever_id = p_achiever_id
           AND to_state    = 'suspended'
         ORDER BY created_at DESC, id DESC
         LIMIT 1;

        IF v_until IS NOT NULL AND v_until <= UTC_TIMESTAMP() THEN
            SET v_until = NULL;
        END IF;
    END IF;

    UPDATE `achievers`
       SET state            = v_to,
           state_reason     = p_reason,
           state_changed_at = UTC_TIMESTAMP(),
           state_changed_by = p_actor_id,
           suspended_until  = v_until,
           updated_at       = UTC_TIMESTAMP()
     WHERE id = p_achiever_id;

    INSERT INTO `achiever_state_events`
        (id, achiever_id, from_state, to_state, reason, suspended_until,
         actor_id, actor_role, created_at)
    VALUES
        (UUID(), p_achiever_id, v_from, v_to, p_reason, v_until,
         p_actor_id, p_actor_role, UTC_TIMESTAMP());

    COMMIT;

    SELECT p_achiever_id AS achiever_id, v_from AS from_state, v_to AS to_state,
           v_until AS suspended_until;
END$$


-- ---------------------------------------------------------------------------
-- Approve an application: PENDING -> PROBATION.
--
-- Refuses unless every document marked is_required has been approved. This is
-- the check the old design lacked — an admin could pick a tier from a dropdown
-- and the evidence was nobody's problem.
-- ---------------------------------------------------------------------------
-- ------------------------------------------------------------
-- Change an achiever's per-cohort seat allocation after approval.
--
-- Separate from the approval procedure because the number is not frozen at
-- approval: an achiever who fills every cohort is the one you want to give
-- more room to, and that should not require sending them back through the
-- queue.
--
-- Passing NULL clears the cap, which restores the pre-allocation behaviour of
-- an unlimited cohort. That is a real thing an admin may want, so it is
-- allowed rather than rejected -- but it is an explicit NULL, not an omission.
-- ------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_achiever_set_cohort_seats`$$
CREATE PROCEDURE `sp_achiever_set_cohort_seats`(
    IN p_achiever_id  CHAR(36),
    IN p_cohort_seats INT,
    IN p_actor_id     CHAR(36)
)
BEGIN
    DECLARE v_exists INT DEFAULT 0;

    SELECT COUNT(*) INTO v_exists FROM `achievers` WHERE id = p_achiever_id;
    IF v_exists = 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ACHIEVER_NOT_FOUND';
    END IF;

    IF p_cohort_seats IS NOT NULL AND p_cohort_seats < 1 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'SEATS_MUST_BE_POSITIVE';
    END IF;

    UPDATE `achievers`
       SET cohort_seat_allocation = p_cohort_seats,
           updated_by = p_actor_id
     WHERE id = p_achiever_id;

    SELECT 1 AS ok, p_cohort_seats AS cohort_seat_allocation;
END$$

DROP PROCEDURE IF EXISTS `sp_achiever_approve_application`$$
CREATE PROCEDURE `sp_achiever_approve_application`(
    IN p_achiever_id  CHAR(36),
    IN p_actor_id     CHAR(36),
    IN p_cohort_seats INT
)
BEGIN
    DECLARE v_state   VARCHAR(20);
    DECLARE v_missing INT DEFAULT 0;
    DECLARE v_demos   INT DEFAULT 3;

    SELECT state INTO v_state FROM `achievers` WHERE id = p_achiever_id;

    IF v_state IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ACHIEVER_NOT_FOUND';
    END IF;

    IF v_state <> 'pending' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'NOT_PENDING';
    END IF;

    -- Required doc types with no accepted document for this achiever.
    --
    -- Both spellings are matched on purpose: sp_achiever_document_review has
    -- always written 'accepted', and checking only for 'approved' would make
    -- this count every document as missing and refuse every application
    -- forever — a failure that looks like a data problem, not a typo.
    SELECT COUNT(*) INTO v_missing
      FROM `master_achiever_doc_type` t
     WHERE t.is_required = 1
       AND t.is_active = 1
       AND NOT EXISTS (
             SELECT 1 FROM `achiever_documents` d
              WHERE d.achiever_id = p_achiever_id
                AND d.doc_type = t.value COLLATE utf8mb4_unicode_ci
                AND d.status IN ('accepted', 'approved')
           );

    IF v_missing > 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'DOCUMENTS_INCOMPLETE';
    END IF;

    -- Three is the starting point for someone who has never been approved.
    -- It is NOT re-imposed on someone who already has a target.
    --
    -- It used to be assigned flat, and that quietly undid admin decisions. A
    -- lifted ban returns the achiever to 'pending', so approval is asked for a
    -- second time - and that second approval reset a target an admin had set
    -- by hand on the Set demo target control. Someone put on 1 demo came back
    -- owing 3, with nothing on screen saying why it changed.
    --
    -- COALESCE, so the column decides: NULL means nobody has ever set one.
    --
    -- The seat allocation lands here too. Approval is the moment the admin
    -- decides how big this person's cohorts may be, and setting it now rather
    -- than at the probation gate means the free demo cohorts they run during
    -- probation are capped as well -- otherwise there is a window where a
    -- cohort is unlimited.
    --
    -- Assigned, not COALESCEd.
    --
    -- This used COALESCE so passing NULL kept whatever was already on the
    -- row. That was right when NULL meant "not supplied". It is wrong now:
    -- the approve dialog makes the admin choose between a number and
    -- Unlimited, and Unlimited IS NULL. Under COALESCE, choosing Unlimited
    -- for someone who had been given a cap earlier would keep the old cap
    -- while telling the admin it was unlimited.
    --
    -- The route guarantees a choice was made: it rejects a request with no
    -- cohort_seats key at all. Whatever arrives here is a decision.
    UPDATE `achievers`
       SET demo_sessions_required = COALESCE(demo_sessions_required, 3),
           cohort_seat_allocation = p_cohort_seats
     WHERE id = p_achiever_id;

    SELECT demo_sessions_required INTO v_demos
      FROM `achievers` WHERE id = p_achiever_id;

    -- The reason says the number that actually applies. It read "three demo
    -- sessions required" unconditionally, so the permanent record disagreed
    -- with the account the moment the target was anything but three.
    CALL sp_achiever_set_state(p_achiever_id, 'probation',
                               CONCAT('Application approved - ', v_demos,
                                      ' demo session', IF(v_demos = 1, '', 's'),
                                      ' required'),
                               NULL, p_actor_id, 'admin');
END$$


-- ---------------------------------------------------------------------------
-- Count a completed demo session and submit for review at three.
--
-- Called when a demo session is marked completed. Counts from the sessions
-- table rather than incrementing a counter, so a double call or a replayed
-- webhook cannot inflate the total.
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_achiever_demo_complete`$$
CREATE PROCEDURE `sp_achiever_demo_complete`(
    IN p_achiever_id CHAR(36)
)
BEGIN
    DECLARE v_done   INT DEFAULT 0;
    DECLARE v_needed INT DEFAULT 3;
    DECLARE v_state  VARCHAR(20);

    SELECT state, IFNULL(demo_sessions_required, 3)
      INTO v_state, v_needed
      FROM `achievers` WHERE id = p_achiever_id;

    -- Sessions AND cohorts. Counting only `achiever_sessions` was wrong: a
    -- probation achiever cannot charge, so the demo they actually run is a
    -- FREE COHORT, and that is what the spec describes ("Free Saturday 6:00
    -- demo. Priya enrols. End. 1/3"). Mahesh ran exactly that, ended it, and
    -- his counter stayed at 0/3 — leaving him stuck on probation with no way
    -- to reach `active`, which is what unlocks charging.
    --
    -- A cohort counts when it is the achiever's own, a DEMO (free, made on
    -- probation: cohorts.is_demo), `completed`, and
    -- **had at least one enrolment**. The enrolment guard is the point: without
    -- it an achiever creates three empty free cohorts, ends them immediately,
    -- and promotes themselves. A demo nobody attended is not a demo.
    --
    -- Still a COUNT over rows rather than an increment, for the original
    -- reason: a double call or replayed webhook cannot inflate the total.
    SELECT
        (SELECT COUNT(*)
           FROM `achiever_sessions`
          WHERE mentor_id = p_achiever_id
            AND is_demo = 1
            AND status = 'completed'
            AND IFNULL(no_show, 0) = 0)
      + (SELECT COUNT(*)
           FROM `cohorts` c
          WHERE c.achiever_id = p_achiever_id
            AND c.status = 'completed'
            AND c.is_demo = 1
            AND EXISTS (SELECT 1 FROM `cohort_enrollments` ce
                         WHERE ce.cohort_id = c.id))
      INTO v_done;

    UPDATE `achievers`
       SET demo_sessions_done = v_done,
           demo_submitted_at  = IF(v_done >= v_needed AND demo_submitted_at IS NULL,
                                   UTC_TIMESTAMP(), demo_submitted_at),
           updated_at = UTC_TIMESTAMP()
     WHERE id = p_achiever_id;

    SELECT v_done AS demos_done,
           v_needed AS demos_needed,
           (v_done >= v_needed AND v_state = 'probation') AS ready_for_review;
END$$


-- ---------------------------------------------------------------------------
-- Everything an admin needs to judge a probation, in one call: the achiever,
-- their three demos, and the student's own words about each.
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_achiever_probation_review`$$
CREATE PROCEDURE `sp_achiever_probation_review`(
    IN p_achiever_id CHAR(36)
)
BEGIN
    -- Sessions AND cohorts, in that order, because the counter counts both.
    --
    -- This returned 1-on-1 sessions only, while `sp_achiever_demo_complete`
    -- was widened to count free cohorts as demos. The dossier then showed
    -- "2 of 3 demo sessions done" directly above "No demo sessions yet" —
    -- one screen, two sources, disagreeing. Worse than either being wrong on
    -- its own: an admin approving from that screen is clicking yes on an empty
    -- case file.
    --
    -- The cohort half must use the SAME definition as the counter — own,
    -- free, at least one enrolment — or the list and the number drift again.
    -- `demo_kind` lets the UI label a row rather than guess from a null.
    SELECT * FROM (
        SELECT 'session'      AS demo_kind,
               s.id            AS session_id,
               NULL            AS cohort_title,
               s.student_id,
               u.full_name     AS student_name,
               s.status,
               s.no_show,
               s.created_at    AS booked_at,
               s.updated_at    AS completed_at,
               r.rating,
               r.review_text,
               r.created_at    AS reviewed_at
          FROM `achiever_sessions` s
          LEFT JOIN `users` u ON u.id = s.student_id
          LEFT JOIN `achiever_reviews` r
                 -- Match on context_id as well as session_id. The rating
                 -- endpoint records a session review as
                 -- (context_type='session', context_id=<session id>) and
                 -- leaves session_id NULL, so joining on session_id alone
                 -- found nothing: the student's rating existed and the admin
                 -- deciding on probation saw "no feedback".
                 ON r.is_active = 1
                AND (r.session_id = s.id
                     OR (r.context_type = 'session' AND r.context_id = s.id))
         WHERE s.mentor_id = p_achiever_id
           AND s.is_demo = 1

        UNION ALL

        -- One row per ENROLMENT, not per cohort: a demo cohort with three
        -- students is three pieces of evidence, and each of them may have left
        -- their own rating. Collapsing to one row per cohort would throw away
        -- two of the three reviews the admin is there to read.
        SELECT 'cohort'        AS demo_kind,
               c.id            AS session_id,
               c.title         AS cohort_title,
               ce.user_id      AS student_id,
               u.full_name     AS student_name,
               c.status,
               0               AS no_show,
               ce.enrolled_at  AS booked_at,
               c.updated_at    AS completed_at,
               r.rating,
               r.review_text,
               r.created_at    AS reviewed_at
          FROM `cohorts` c
          JOIN `cohort_enrollments` ce ON ce.cohort_id = c.id
          LEFT JOIN `users` u ON u.id = ce.user_id
          -- Cohort feedback is recorded as (context_type='cohort',
          -- context_id=<cohort id>) and is per STUDENT, so the rating must be
          -- matched on the student too — otherwise every row in a three-student
          -- cohort shows the same review.
          LEFT JOIN `achiever_reviews` r
                 ON r.is_active = 1
                AND r.context_type = 'cohort'
                AND r.context_id = c.id
                AND r.user_id = ce.user_id
         WHERE c.achiever_id = p_achiever_id
           AND c.status = 'completed'
           AND c.is_demo = 1
    ) AS demos
     ORDER BY booked_at;
END$$


-- ---------------------------------------------------------------------------
-- Lift suspensions whose end date has passed. Nightly.
--
-- The auto-lift is what makes admins willing to suspend at all: without it,
-- every suspension is a reminder someone has to remember, so in practice they
-- reach for a permanent ban or do nothing.
--
-- Indefinite suspensions (suspended_until IS NULL) are never touched.
--
-- RESTORES THE STATE THEY WERE SUSPENDED FROM. This used to set 'active'
-- unconditionally, which turned suspension into a promotion: the Suspend
-- button is offered on every achiever regardless of state, so suspending a
-- PENDING applicant -- documents unreviewed, no demo sessions, no student
-- reviews, no commission set -- made them a fully approved, chargeable
-- achiever the night the suspension expired. A probation achiever skipped
-- their demo review the same way. Nothing in the state machine stopped it:
-- the only transition it refuses is leaving 'banned'.
--
-- The prior state is read from achiever_state_events, which sp_achiever_set_state
-- writes on every transition, so the most recent row with to_state='suspended'
-- carries where they came from.
--
-- The fallback is 'pending', not 'active', and that direction is deliberate.
-- A wrongly demoted achiever is one click for an admin to put back. A wrongly
-- promoted one is an unvetted person taking students' money. When the record
-- cannot answer the question, the answer has to be the harmless one.
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_achiever_lift_suspensions`$$
CREATE PROCEDURE `sp_achiever_lift_suspensions`()
BEGIN
    DECLARE v_lifted INT DEFAULT 0;

    -- The restore target, as one expression used by both statements below.
    -- No temp table on purpose: that would need CREATE TEMPORARY TABLES on the
    -- application's database user, a privilege this procedure should not
    -- depend on to run its nightly job.
    --
    -- Order matters. The event INSERT runs first, while the rows are still
    -- 'suspended' and the UPDATE has not moved them. The rows it writes carry
    -- to_state = the restored state, never 'suspended', so they cannot be
    -- picked up by the subquery's `e.to_state = 'suspended'` filter and the
    -- second evaluation sees exactly what the first one did.

    INSERT INTO `achiever_state_events`
        (id, achiever_id, from_state, to_state, reason, actor_id, actor_role, created_at)
    SELECT UUID(), a.id, 'suspended',
           COALESCE((
               SELECT e.from_state
                 FROM `achiever_state_events` e
                WHERE e.achiever_id = a.id
                  AND e.to_state = 'suspended'
                  AND e.from_state IN ('pending', 'probation', 'active')
                ORDER BY e.created_at DESC
                LIMIT 1
           ), 'pending'),
           'Suspension period ended - reinstated automatically',
           NULL, 'system', UTC_TIMESTAMP()
      FROM `achievers` a
     WHERE a.state = 'suspended'
       AND a.suspended_until IS NOT NULL
       AND a.suspended_until <= UTC_TIMESTAMP();

    -- is_active follows the restored state. Putting a pending applicant back
    -- on the site because their suspension expired is the same bug in a
    -- different column.
    UPDATE `achievers` a
       SET a.state = COALESCE((
               SELECT e.from_state
                 FROM `achiever_state_events` e
                WHERE e.achiever_id = a.id
                  AND e.to_state = 'suspended'
                  AND e.from_state IN ('pending', 'probation', 'active')
                ORDER BY e.created_at DESC
                LIMIT 1
           ), 'pending'),
           a.state_reason = 'Suspension period ended - reinstated automatically',
           a.state_changed_at = UTC_TIMESTAMP(),
           a.suspended_until = NULL,
           a.is_active = (COALESCE((
               SELECT e.from_state
                 FROM `achiever_state_events` e
                WHERE e.achiever_id = a.id
                  AND e.to_state = 'suspended'
                  AND e.from_state IN ('pending', 'probation', 'active')
                ORDER BY e.created_at DESC
                LIMIT 1
           ), 'pending') = 'active'),
           a.updated_at = UTC_TIMESTAMP()
     WHERE a.state = 'suspended'
       AND a.suspended_until IS NOT NULL
       AND a.suspended_until <= UTC_TIMESTAMP();

    SET v_lifted = ROW_COUNT();
    SELECT v_lifted AS reinstated;
END$$


-- ---------------------------------------------------------------------------
-- Where a suspended achiever came from. Manual Reinstate uses this instead of
-- always writing 'active' — the same restore the nightly lift already does.
-- Fallback is pending: a missing event must not skip document review and demos.
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_achiever_pre_suspension_state`$$
CREATE PROCEDURE `sp_achiever_pre_suspension_state`(IN p_achiever_id CHAR(36))
BEGIN
    SELECT COALESCE((
        SELECT e.from_state
          FROM `achiever_state_events` e
         WHERE e.achiever_id = p_achiever_id
           AND e.to_state = 'suspended'
           AND e.from_state IN ('pending', 'probation', 'active')
         ORDER BY e.created_at DESC
         LIMIT 1
    ), 'pending') AS prior_state;
END$$


-- ---------------------------------------------------------------------------
-- Recompute standing. Nightly, for ACTIVE achievers only.
--
-- Standing is earned and can fall. It is never set by an admin — that is the
-- whole point of separating it from state, which is.
--
-- The readiness-score component is what no competitor can copy: it measures
-- whether a student actually improved, not whether they enjoyed the call. A
-- five-star rating and a flat readiness score is a pleasant hour that changed
-- nothing.
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_achiever_recompute_standing`$$
CREATE PROCEDURE `sp_achiever_recompute_standing`()
BEGIN
    UPDATE `achievers` a
      LEFT JOIN (
            SELECT mentor_id,
                   COUNT(*)                                  AS sessions_done,
                   AVG(IFNULL(no_show, 0)) * 100             AS no_show_pct
              FROM `achiever_sessions`
             WHERE status = 'completed'
               AND is_demo = 0
             GROUP BY mentor_id
      ) s ON s.mentor_id = a.id
      LEFT JOIN (
            SELECT achiever_id, AVG(rating) AS avg_rating, COUNT(*) AS review_count
              FROM `achiever_reviews`
             WHERE is_active = 1
             GROUP BY achiever_id
      ) r ON r.achiever_id = a.id
      LEFT JOIN (
            -- A student booking the same achiever again is the most honest
            -- signal there is; it costs them money to express it.
            SELECT mentor_id,
                   (COUNT(*) - COUNT(DISTINCT student_id)) / NULLIF(COUNT(*), 0) * 100
                       AS rebook_pct
              FROM `achiever_sessions`
             WHERE status = 'completed' AND is_demo = 0
             GROUP BY mentor_id
      ) rb ON rb.mentor_id = a.id
       SET a.standing_score = ROUND(
               IFNULL(r.avg_rating, 0) * 10                  -- 0..50
             + LEAST(IFNULL(s.sessions_done, 0), 50)         -- 0..50, capped
             + IFNULL(rb.rebook_pct, 0) * 0.5                -- 0..50
             - IFNULL(s.no_show_pct, 0) * 2                  -- penalty
           , 2),
           a.standing = CASE
               WHEN IFNULL(s.sessions_done, 0) < 5 THEN 'new'
               WHEN IFNULL(r.avg_rating, 0) >= 4.5
                    AND IFNULL(s.sessions_done, 0) >= 20
                    AND IFNULL(s.no_show_pct, 0) < 5 THEN 'spotlight'
               WHEN IFNULL(r.avg_rating, 0) < 3.5
                    AND IFNULL(r.review_count, 0) >= 5 THEN 'at_risk'
               ELSE 'established'
           END,
           a.standing_updated_at = UTC_TIMESTAMP()
     WHERE a.state = 'active';

    SELECT
        SUM(standing = 'spotlight')   AS spotlight,
        SUM(standing = 'established') AS established,
        SUM(standing = 'new')         AS new_achievers,
        SUM(standing = 'at_risk')     AS at_risk
      FROM `achievers`
     WHERE state = 'active';
END$$


-- ---------------------------------------------------------------------------
-- Who is bookable, and how. Replaces the trust-tier capability lookup.
--
-- One row of booleans the app can act on without re-deriving the rules in
-- Python, where they would drift from what the browse query believes.
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_achiever_capabilities`$$
CREATE PROCEDURE `sp_achiever_capabilities`(
    IN p_achiever_id CHAR(36)
)
BEGIN
    SELECT
        state,
        standing,
        payout_ready,
        suspended_until,
        demo_sessions_done,
        (state IN ('active','probation'))            AS can_be_listed,
        (state = 'active')                           AS can_charge,
        (state = 'probation')                        AS demo_only,
        (state IN ('active','probation'))            AS can_take_bookings,
        (state IN ('active','suspended','banned'))   AS can_withdraw,
        (state = 'active')                           AS can_publish_content
      FROM `achievers`
     WHERE id = p_achiever_id;
END$$

DELIMITER ;

DELIMITER $$

-- ---------------------------------------------------------------------------
-- Which required documents this achiever still owes.
--
-- Deliberately the same query sp_achiever_approve_application uses to decide
-- whether to refuse, so the screen and the guard can never disagree. Showing
-- "ready to approve" on a form the procedure then rejects is worse than not
-- showing anything.
--
-- The COLLATE is not decoration: master_achiever_doc_type and
-- achiever_documents differ in collation, and without it this comparison
-- raises "Illegal mix of collations" on the RDS server default.
-- ---------------------------------------------------------------------------
-- ---------------------------------------------------------------------------
-- Set the demo target absolutely, and put them back on demos to meet it.
--
-- The flow had no answer to its commonest case. An achiever clears three demos,
-- goes active, runs ten cohorts, and the reviews turn bad. Nothing could ask
-- them to run demo classes again:
--
--   * the route's `extend` decision computes needed_now + extra, so a target
--     could only ever go up. An achiever sitting on 13 because someone pressed
--     the button four times had no way back to 3.
--   * `extend` never writes `state` either, so on an ACTIVE achiever it would
--     raise the target and leave them active and still charging, which is worse
--     than refusing outright.
--
-- One procedure covers both: assign the target, clear the submission stamp so
-- the counter re-arms, and move them to probation when they are not already
-- there.
--
-- Deliberately NOT a cascade. Suspension already means "stop everything now"
-- and carries the refund logic; ban is final. This means "prove yourself
-- again": probation drops can_charge, so no NEW paid cohort or booking can be
-- created, while the cohorts and confirmed sessions students have already paid
-- for run to completion. Reviewers punish the achiever, not the students.
--
-- Banned is refused rather than silently reinstated -- it is the one state
-- sp_achiever_set_state also refuses to leave.
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_achiever_set_demo_target`$$
CREATE PROCEDURE `sp_achiever_set_demo_target`(
    IN p_achiever_id CHAR(36),
    IN p_target      INT,
    IN p_reason      VARCHAR(255),
    IN p_actor_id    CHAR(36)
)
BEGIN
    DECLARE v_state VARCHAR(20);
    DECLARE v_done  INT DEFAULT 0;

    SELECT state, IFNULL(demo_sessions_done, 0)
      INTO v_state, v_done
      FROM `achievers` WHERE id = p_achiever_id;

    IF v_state IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ACHIEVER_NOT_FOUND';
    END IF;

    IF p_target IS NULL OR p_target < 1 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'TARGET_MUST_BE_POSITIVE';
    END IF;

    IF v_state = 'banned' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ACHIEVER_BANNED';
    END IF;

    UPDATE `achievers`
       SET demo_sessions_required = p_target,
           demo_submitted_at      = NULL,
           updated_at             = UTC_TIMESTAMP(),
           updated_by             = p_actor_id
     WHERE id = p_achiever_id;

    IF v_state <> 'probation' THEN
        CALL sp_achiever_set_state(p_achiever_id, 'probation', p_reason,
                                   NULL, p_actor_id, 'admin');
    ELSE
        -- Already in probation, so sp_achiever_set_state is not called and
        -- nothing was recorded: History showed the target as 2 with no trace of
        -- who moved it from 3, when, or why -- even though the form makes the
        -- reason mandatory. This is the gate on when someone may start earning,
        -- so the change is audited in its own right. from_state = to_state
        -- marks it as a change WITHIN probation rather than a transition.
        INSERT INTO `achiever_state_events`
            (id, achiever_id, from_state, to_state, reason, actor_id, actor_role, created_at)
        VALUES
            (UUID(), p_achiever_id, 'probation', 'probation',
             CONCAT('Demo target set to ', p_target, ' - ', IFNULL(p_reason, '')),
             p_actor_id, 'admin', UTC_TIMESTAMP());
    END IF;

    SELECT v_state    AS from_state,
           'probation' AS state,
           v_done     AS demos_done,
           p_target   AS demos_required;
END$$

DROP PROCEDURE IF EXISTS `sp_achiever_missing_documents`$$
CREATE PROCEDURE `sp_achiever_missing_documents`(
    IN p_achiever_id CHAR(36)
)
BEGIN
    SELECT t.value, t.label
      FROM `master_achiever_doc_type` t
     WHERE t.is_required = 1
       AND t.is_active = 1
       AND NOT EXISTS (
             SELECT 1 FROM `achiever_documents` d
              WHERE d.achiever_id = p_achiever_id
                AND d.doc_type = t.value COLLATE utf8mb4_unicode_ci
                AND d.status IN ('accepted', 'approved')
           )
     ORDER BY t.sort_order, t.label;
END$$

DELIMITER ;

-- ---------------------------------------------------------------------------
-- Every state this achiever has been in, newest first.
--
-- achiever_state_events has recorded each transition since the lifecycle was
-- built -- from, to, reason, who and when -- and nothing ever read it back.
-- The admin screens showed `achievers.state_reason`, a single column that is
-- overwritten on every change, so an achiever suspended three times displayed
-- only the third reason and the pattern was invisible.
--
-- The actor is resolved here rather than by the caller. An id in a list of
-- decisions answers "who decided this" with another question.
--
-- LEFT JOIN both tables: a super admin and an admin can each act on an
-- achiever, and the overnight lift job acts as nobody at all -- actor_id is
-- NULL there, which is why actor_role ('system') has to come back too.
--
-- Bounded at 100. An achiever with more transitions than that has a problem no
-- list is going to explain.
-- ---------------------------------------------------------------------------
DELIMITER $$

DROP PROCEDURE IF EXISTS `sp_achiever_state_history`$$
CREATE PROCEDURE `sp_achiever_state_history`(
    IN p_achiever_id CHAR(36)
)
BEGIN
    SELECT e.id,
           e.from_state,
           e.to_state,
           e.reason,
           e.suspended_until,
           e.actor_role,
           e.created_at,
           COALESCE(sa.full_name, ad.full_name) AS actor_name
      FROM `achiever_state_events` e
      LEFT JOIN `super_admins` sa ON sa.id = e.actor_id
      LEFT JOIN `admins`       ad ON ad.id = e.actor_id
     WHERE e.achiever_id = p_achiever_id
     ORDER BY e.created_at DESC, e.id DESC
     LIMIT 100;
END$$

DELIMITER ;
