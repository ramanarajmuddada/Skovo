-- Admin-authored readiness tasks.
-- Points a task paid stay on the ledger, at the value it had then, even after
-- the task is expired or edited. Expiring only stops new payments.
--
-- Repeats: a task can be a repeat of another (same_as_id), e.g. the same work
-- posted again for a batch. A task and its repeats form one group that pays a
-- student once. same_as_id always points at the group's first task (the root),
-- never at another repeat, so the group is the root plus every row naming it.

DELIMITER $$

DROP PROCEDURE IF EXISTS `sp_score_task_upsert`$$
CREATE PROCEDURE `sp_score_task_upsert`(
    IN p_id CHAR(36), IN p_label VARCHAR(160), IN p_points INT,
    IN p_scope VARCHAR(12), IN p_user CHAR(36),
    IN p_class VARCHAR(30), IN p_degree VARCHAR(100), IN p_same CHAR(36),
    IN p_status VARCHAR(12), IN p_admin CHAR(36)
)
BEGIN
    DECLARE v_root CHAR(36) DEFAULT NULL;

    -- Point at the root, so a repeat of a repeat joins the same group.
    IF p_same IS NOT NULL AND p_same <> '' THEN
        SELECT IFNULL(same_as_id, id) INTO v_root
          FROM `score_tasks` WHERE id = p_same LIMIT 1;
        IF v_root = p_id THEN SET v_root = NULL; END IF;
    END IF;

    IF EXISTS (SELECT 1 FROM `score_tasks` WHERE id = p_id) THEN
        UPDATE `score_tasks`
           SET label = p_label,
               points = p_points,
               education_category = IF(scope = 'batch', p_class, NULL),
               degree_type = IF(scope = 'batch', p_degree, NULL),
               same_as_id = v_root,
               status = IFNULL(p_status, status),
               is_active = IF(IFNULL(p_status, status) = 'active', 1, 0),
               updated_at = UTC_TIMESTAMP()
         WHERE id = p_id;
    ELSE
        INSERT INTO `score_tasks`
            (id, label, points, scope, user_id, education_category, degree_type,
             same_as_id, status, is_active, created_by, created_at, updated_at)
        VALUES
            (p_id, p_label, p_points, p_scope,
             IF(p_scope = 'student', p_user, NULL),
             IF(p_scope = 'batch', p_class, NULL),
             IF(p_scope = 'batch', p_degree, NULL),
             v_root, IFNULL(p_status, 'active'),
             IF(IFNULL(p_status, 'active') = 'active', 1, 0),
             p_admin, UTC_TIMESTAMP(), UTC_TIMESTAMP());
    END IF;
    SELECT id, label, points, scope, user_id, education_category, degree_type,
           same_as_id, status, is_active
      FROM `score_tasks` WHERE id = p_id;
END$$

DROP PROCEDURE IF EXISTS `sp_score_task_list`$$
CREATE PROCEDURE `sp_score_task_list`()
BEGIN
    SELECT t.id, t.label, t.points, t.scope, t.user_id, t.education_category, t.degree_type,
           t.same_as_id, t.status, t.is_active, t.created_at,
           -- batch_id is what the admin route files each task under its batch;
           -- without it every batch listed empty.
           t.batch_id, t.action_route, t.state,
           t.target_degrees, t.target_branches, t.target_streams,
           u.full_name AS student_name, u.email AS student_email,
           (SELECT COUNT(*) FROM `score_events` e
             WHERE e.event_type = 'admin_task' AND e.ref_id = t.id AND e.points > 0) AS paid_count,
           (SELECT COUNT(*) FROM `score_task_submissions` s
             WHERE s.task_id = t.id AND s.status = 'submitted') AS claimed_count
      FROM `score_tasks` t
      LEFT JOIN `users` u ON u.id = t.user_id
     ORDER BY t.is_active DESC, t.created_at DESC;
END$$

DROP PROCEDURE IF EXISTS `sp_score_task_complete`$$
CREATE PROCEDURE `sp_score_task_complete`(
    IN p_event CHAR(36), IN p_task CHAR(36), IN p_user CHAR(36)
)
proc: BEGIN
    DECLARE v_points DECIMAL(5,2);
    DECLARE v_status VARCHAR(12);
    DECLARE v_scope VARCHAR(12);
    DECLARE v_owner CHAR(36);
    DECLARE v_class VARCHAR(30);
    DECLARE v_degree VARCHAR(100);
    DECLARE v_same CHAR(36);
    DECLARE v_label VARCHAR(160);
    DECLARE v_expires DATETIME;
    DECLARE v_root CHAR(36);

    -- Two clicks at once both pass the 'already' check below; the ledger's
    -- unique key (event_type, ref_id, user_id) stops the second insert.
    -- Answer it as 'already' rather than letting it surface as a 500.
    DECLARE EXIT HANDLER FOR 1062
    BEGIN
        SELECT 'already' AS result;
    END;

    SELECT points, status, scope, user_id, education_category, degree_type, same_as_id, label,
           expires_at
      INTO v_points, v_status, v_scope, v_owner, v_class, v_degree, v_same, v_label,
           v_expires
      FROM `score_tasks` WHERE id = p_task LIMIT 1;

    IF v_points IS NULL THEN
        SELECT 'unknown' AS result;
        LEAVE proc;
    END IF;
    -- A deadline that has passed and a task switched off answer the same way.
    -- Deliberately: the front end already handles 'expired', and a student does
    -- not need to know which of the two reasons closed it.
    IF IFNULL(v_status, 'active') <> 'active'
       OR (v_expires IS NOT NULL AND UTC_TIMESTAMP() > v_expires) THEN
        SELECT 'expired' AS result;
        LEAVE proc;
    END IF;
    IF v_scope = 'student' AND NOT (v_owner <=> p_user) THEN
        SELECT 'wrong' AS result;
        LEAVE proc;
    END IF;
    IF v_scope = 'batch' AND NOT EXISTS (
        SELECT 1 FROM `user_profiles` p
         WHERE p.user_id = p_user
           AND (v_class IS NULL OR v_class = '' OR p.education_category = v_class)
           AND (v_degree IS NULL OR v_degree = '' OR p.degree_type = v_degree)
           AND ( (v_class IS NOT NULL AND v_class <> '') OR (v_degree IS NOT NULL AND v_degree <> '') )
    ) THEN
        SELECT 'nomatch' AS result;
        LEAVE proc;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM `users` WHERE id = p_user AND deleted_at IS NULL AND status = 'active') THEN
        SELECT 'unknown' AS result;
        LEAVE proc;
    END IF;
    IF EXISTS (
        SELECT 1 FROM `score_events`
         WHERE user_id = p_user AND event_type = 'admin_task' AND ref_id = p_task AND points > 0
    ) THEN
        SELECT 'already' AS result;
        LEAVE proc;
    END IF;
    -- Any other task in this task's group, in either direction: the root when
    -- this is a repeat, or a repeat when this is the root.
    SET v_root = IFNULL(v_same, p_task);
    IF EXISTS (
        SELECT 1 FROM `score_events` e
          JOIN `score_tasks` g ON g.id = e.ref_id
         WHERE e.user_id = p_user AND e.event_type = 'admin_task' AND e.points > 0
           AND e.ref_id <> p_task
           AND (g.id = v_root OR g.same_as_id = v_root)
    ) THEN
        SELECT 'repeat' AS result;
        LEAVE proc;
    END IF;

    INSERT INTO `score_events` (id, user_id, event_type, points, ref_id, meta)
    VALUES (p_event, p_user, 'admin_task', v_points, p_task, v_label);
    SELECT 'done' AS result, v_points AS points;
END$$

-- Saving a task used to rebuild the score of everyone it had paid. Points on
-- the ledger never change when a task does, so that rebuild changed nothing.
DROP PROCEDURE IF EXISTS `sp_score_task_paid_users`$$

-- Tasks a student can see. done is true when any task in the group paid them.
-- An expired task they never finished stays visible, as Expired, for 14 days
-- after it expired, then drops off their page. A draft is never shown -- not
-- even in that 14-day window -- so tasks loaded for review stay admin-only.
-- score_tasks.state (master_indian_state value) limits a task to one state.
DROP PROCEDURE IF EXISTS `sp_score_tasks_for_student`$$
CREATE PROCEDURE `sp_score_tasks_for_student`(IN p_user CHAR(36))
BEGIN
    SELECT x.id, x.label, x.points, x.scope, x.status, x.done, x.auto_verified
      FROM (
        SELECT t.id, t.label, t.points, t.scope, t.status, t.updated_at, t.created_at,
               -- Can this task settle itself? The screen says "points arrive on
               -- their own" only when it can, rather than promising automation
               -- for a task that still needs a human to look.
               (t.verify_metric IS NOT NULL AND t.verify_metric <> '') AS auto_verified,
               EXISTS (
                   SELECT 1 FROM `score_events` e
                     JOIN `score_tasks` g ON g.id = e.ref_id
                    WHERE e.user_id = p_user AND e.event_type = 'admin_task' AND e.points > 0
                      AND (g.id = IFNULL(t.same_as_id, t.id)
                           OR g.same_as_id = IFNULL(t.same_as_id, t.id))
               ) AS done
          FROM `score_tasks` t
          LEFT JOIN `user_profiles` p ON p.user_id = p_user
         WHERE (
                t.scope = 'all'
             OR (t.scope = 'student' AND t.user_id = p_user)
             OR (
                  t.scope = 'batch'
                  AND ((t.education_category IS NOT NULL AND t.education_category <> '')
                       OR (t.degree_type IS NOT NULL AND t.degree_type <> ''))
                  AND (t.education_category IS NULL OR t.education_category = '' OR p.education_category = t.education_category)
                  AND (t.degree_type IS NULL OR t.degree_type = '' OR p.degree_type = t.degree_type)
                  AND (t.state IS NULL OR t.state = '' OR p.state = t.state)
                  -- Course targeting: comma lists of course_catalogue degree /
                  -- branch labels and streams.canonical, as stored on the profile.
                  -- Empty = no restriction.
                  AND (t.target_degrees IS NULL OR t.target_degrees = ''
                       OR FIND_IN_SET(p.degree_type, t.target_degrees) > 0)
                  AND (t.target_branches IS NULL OR t.target_branches = ''
                       OR FIND_IN_SET(p.branch, t.target_branches) > 0)
                  AND (t.target_streams IS NULL OR t.target_streams = ''
                       OR FIND_IN_SET(p.stream, t.target_streams) > 0)
                )
             OR EXISTS (
                  SELECT 1 FROM `score_events` e
                   WHERE e.user_id = p_user AND e.event_type = 'admin_task'
                     AND e.ref_id = t.id AND e.points > 0
                )
           )
      ) x
     WHERE x.status = 'active'
        OR x.done
        OR (x.status <> 'draft' AND x.updated_at >= UTC_TIMESTAMP() - INTERVAL 14 DAY)
     ORDER BY x.done ASC, x.created_at DESC;
END$$

DROP PROCEDURE IF EXISTS `sp_score_student_find`$$
CREATE PROCEDURE `sp_score_student_find`(IN p_q VARCHAR(160))
BEGIN
    SELECT id, full_name, email
      FROM `users`
     WHERE deleted_at IS NULL AND status = 'active'
       AND (
            email LIKE CONCAT('%', p_q, '%')
         OR full_name LIKE CONCAT('%', p_q, '%')
       )
     ORDER BY full_name ASC
     LIMIT 8;
END$$

DROP PROCEDURE IF EXISTS `sp_score_recalc`$$
CREATE PROCEDURE `sp_score_recalc`(IN p_user CHAR(36))
BEGIN
      DECLARE v_base DECIMAL(7,1) DEFAULT 0;
      DECLARE v_decay INT DEFAULT 0;
      DECLARE v_score INT DEFAULT 0;
      DECLARE v_level VARCHAR(40);
      -- Levels are rows in readiness_levels, not literals in here.
      --
      -- They were hardcoded in this procedure and in eight other places
      -- (helpers.py, bhaai.py, Dashboard, Profile, the shared ui kit...), so
      -- renaming one meant finding all nine. It also fixed the count at three
      -- and named the top one "Achiever" -- which is already the mentor role,
      -- so a student reaching the gate was given the same title as the people
      -- mentoring them.
      DECLARE v_cohorts INT DEFAULT 0;
      DECLARE v_tasks INT DEFAULT 0;

      -- Caps were applied at write time, so the ledger simply sums. Switching a
      -- rule off retroactively stops its events counting. Expiring an admin
      -- task does not: what it paid stays paid.
      -- LEFT JOIN, not INNER: a direct credit -- a ticked task, a manual
      -- adjustment, a referral reward -- has no rule row an admin manages,
      -- and an inner join silently dropped all three from the total.
      SELECT IFNULL(SUM(e.points), 0) INTO v_base
        FROM score_events e
        LEFT JOIN score_event_rules r ON r.event_type = e.event_type
       WHERE e.user_id = p_user
         AND (e.event_type IN ('admin_task', 'admin_adjustment', 'referral_bonus')
              OR r.is_active = 1);

      SELECT IFNULL(decay_points,0) INTO v_decay
        FROM readiness_scores WHERE user_id = p_user;

      SET v_score = GREATEST(0, LEAST(100, FLOOR(v_base - IFNULL(v_decay,0))));

      -- The highest level the score has reached. Any number of levels works;
      -- add a row and it takes effect on the next recalc.
      SELECT label INTO v_level
        FROM readiness_levels
       WHERE is_active = 1 AND min_score <= v_score
       ORDER BY min_score DESC
       LIMIT 1;

      -- No levels configured at all must not blank the column.
      IF v_level IS NULL OR v_level = '' THEN
          SELECT `level` INTO v_level FROM readiness_scores WHERE user_id = p_user;
          SET v_level = IFNULL(v_level, '');
      END IF;

      SELECT COUNT(*) INTO v_cohorts FROM cohort_enrollments
       WHERE user_id = p_user AND payment_status IN ('paid','free');
      SELECT COUNT(*) INTO v_tasks FROM task_submissions
       WHERE user_id = p_user AND status = 'approved';

      INSERT INTO readiness_scores
          (id, user_id, score, level, base_points, cohorts_completed, tasks_completed)
      VALUES (UUID(), p_user, v_score, v_level, v_base, v_cohorts, v_tasks)
      ON DUPLICATE KEY UPDATE
          score = v_score, level = v_level, base_points = v_base,
          cohorts_completed = v_cohorts, tasks_completed = v_tasks;

      SELECT v_score AS score, v_level AS level, v_base AS base_points,
             IFNULL(v_decay,0) AS decay_points,
             v_cohorts AS cohorts_completed, v_tasks AS tasks_completed;
END$$

DELIMITER ;

-- Who does this task apply to, and who has been credited?
--
-- WHY
--     Tasks are verified by hand -- an admin decides, because a free-text task
--     ("attend the Hyderabad workshop") has no signal the product can read. That
--     is fine for five students and unusable for a hundred: crediting them meant
--     opening a hundred student panels one at a time.
--
--     This is the other half of sp_score_tasks_for_student. That one answers
--     "which tasks does this student see"; this answers "which students see this
--     task". The reach rules are duplicated deliberately and must stay in step --
--     if they drift, an admin credits somebody the task never showed to.
--
--     Already-credited students stay listed even if they stop matching the
--     batch, so editing a batch cannot hide a payment that already happened.

DROP PROCEDURE IF EXISTS `sp_score_task_roster`$$
CREATE PROCEDURE `sp_score_task_roster`(
    IN p_task_id CHAR(36),
    IN p_q       VARCHAR(160),
    IN p_state   VARCHAR(10),
    IN p_limit   INT,
    IN p_offset  INT
)
BEGIN
    DECLARE v_scope  VARCHAR(20);
    DECLARE v_user   CHAR(36);
    DECLARE v_cat    VARCHAR(80);
    DECLARE v_degree VARCHAR(80);
    DECLARE v_group  CHAR(36);
    DECLARE v_q      VARCHAR(160);

    IF p_limit IS NULL OR p_limit <= 0 OR p_limit > 500 THEN SET p_limit = 100; END IF;
    IF p_offset IS NULL OR p_offset < 0 THEN SET p_offset = 0; END IF;
    SET v_q = CONCAT('%', TRIM(IFNULL(p_q, '')), '%');

    SELECT scope, user_id, education_category, degree_type, IFNULL(same_as_id, id)
      INTO v_scope, v_user, v_cat, v_degree, v_group
      FROM `score_tasks` WHERE id = p_task_id;

    IF v_scope IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'TASK_NOT_FOUND';
    END IF;

    -- Same reach rules as sp_score_tasks_for_student, read the other way round:
    -- that one asks "which tasks does this student see", this asks "which
    -- students see this task". They must agree, or an admin credits somebody
    -- the task never showed to.
    SELECT SQL_CALC_FOUND_ROWS
           u.id, u.full_name, u.email,
           p.education_category, p.degree_type,
           d.done,
           d.done_at
      FROM `users` u
      LEFT JOIN `user_profiles` p ON p.user_id = u.id
      JOIN (
        SELECT u2.id AS uid,
               EXISTS (
                 SELECT 1 FROM `score_events` e
                   JOIN `score_tasks` g ON g.id = e.ref_id
                  WHERE e.user_id = u2.id AND e.event_type = 'admin_task' AND e.points > 0
                    AND (g.id = v_group OR g.same_as_id = v_group)
               ) AS done,
               (SELECT MAX(e2.occurred_at) FROM `score_events` e2
                  JOIN `score_tasks` g2 ON g2.id = e2.ref_id
                 WHERE e2.user_id = u2.id AND e2.event_type = 'admin_task' AND e2.points > 0
                   AND (g2.id = v_group OR g2.same_as_id = v_group)) AS done_at
          FROM `users` u2
      ) d ON d.uid = u.id
     WHERE u.deleted_at IS NULL
       AND (
            v_scope = 'all'
         OR (v_scope = 'student' AND u.id = v_user)
         OR (v_scope = 'batch'
             AND (v_cat IS NULL OR v_cat = '' OR p.education_category = v_cat)
             AND (v_degree IS NULL OR v_degree = '' OR p.degree_type = v_degree))
         -- Somebody already credited stays listed even if they no longer match,
         -- so a batch change cannot hide a payment that already happened.
         OR d.done = 1
       )
       AND (TRIM(IFNULL(p_q,'')) = '' OR u.full_name LIKE v_q OR u.email LIKE v_q)
       AND (p_state IS NULL OR p_state = '' OR p_state = 'all'
            OR (p_state = 'pending' AND d.done = 0)
            OR (p_state = 'done'    AND d.done = 1))
     ORDER BY d.done ASC, u.full_name
     LIMIT p_limit OFFSET p_offset;

    SELECT FOUND_ROWS() AS total;
END$$
