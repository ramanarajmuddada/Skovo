-- SKOVO — score procedures.
--
-- Exported from the live schema by export_missing_procedures.py. These were
-- applied to the database by hand and never written back to source, so a
-- rebuild from this repo produced a database missing them.
--
-- Edit here, not in the database.

DELIMITER $$

DROP PROCEDURE IF EXISTS `sp_score_adjust`$$
CREATE PROCEDURE `sp_score_adjust`(IN `p_id` char(36), IN `p_user` char(36), IN `p_admin` char(36), IN `p_delta` int, IN `p_reason` text)
BEGIN
      INSERT INTO score_adjustments (id, user_id, admin_id, delta, reason)
      VALUES (p_id, p_user, p_admin, p_delta, p_reason);

      INSERT INTO score_events (id, user_id, event_type, points, ref_id, meta)
      VALUES (UUID(), p_user, 'admin_adjustment', p_delta, p_id,
              CONCAT('admin adjustment: ', LEFT(p_reason, 200)));

      INSERT INTO readiness_scores (id, user_id, score, level, last_event_at)
      VALUES (UUID(), p_user, 0, 'Explorer', UTC_TIMESTAMP())
      ON DUPLICATE KEY UPDATE last_event_at = last_event_at;

      SELECT 1 AS ok, p_delta AS delta;
    END$$

DROP PROCEDURE IF EXISTS `sp_score_adjustments_list`$$
CREATE PROCEDURE `sp_score_adjustments_list`(IN `p_user` char(36), IN `p_limit` int)
BEGIN
      -- Joined to users and admins so the list can name the people involved.
      -- It returned bare ids, and the screen printed them: a row read
      -- "+12 · Manual credit · fd6e8b6f-0603-4033-a1a0-74af12694c34". This list
      -- exists so a score change is traceable to a person, and it named
      -- everything except the person.
      SELECT a.id, a.user_id, a.admin_id, a.delta, a.reason, a.created_at,
             u.full_name  AS student_name,
             u.email      AS student_email,
             ad.full_name AS admin_name
        FROM score_adjustments a
        LEFT JOIN users  u  ON u.id  = a.user_id
        LEFT JOIN admins ad ON ad.id = a.admin_id
       WHERE (p_user IS NULL OR a.user_id = p_user)
       ORDER BY a.created_at DESC LIMIT p_limit;
END$$

DROP PROCEDURE IF EXISTS `sp_score_autopause_recent`$$
CREATE PROCEDURE `sp_score_autopause_recent`(IN `p_minutes` int)
BEGIN
              SELECT t.user_id, t.ends_at, u.full_name, u.email
                FROM score_pause_tokens t
                JOIN users u ON u.id = t.user_id
               WHERE t.is_auto = 1
                 AND t.starts_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL p_minutes MINUTE);
            END$$

DROP PROCEDURE IF EXISTS `sp_score_autopause_run`$$
CREATE PROCEDURE `sp_score_autopause_run`()
BEGIN
              DECLARE v_grace INT DEFAULT 7;
              DECLARE v_max   INT DEFAULT 2;
              DECLARE v_days  INT DEFAULT 21;
              DECLARE v_on    TINYINT(1) DEFAULT 1;
              DECLARE v_floor INT DEFAULT 10;
              DECLARE v_hit   INT DEFAULT 0;

              SELECT IFNULL(decay_grace_days,7), IFNULL(pause_tokens_per_year,2),
                     IFNULL(pause_days,21), IFNULL(autopause_enabled,1),
                     IFNULL(autopause_min_points,10)
                INTO v_grace, v_max, v_days, v_on, v_floor
                FROM readiness_rules ORDER BY created_at ASC LIMIT 1;

              IF v_on = 0 THEN
                SELECT 0 AS paused;
              ELSE
                -- One row per student who is about to start decaying, still has
                -- a token this calendar year, and has points worth protecting.
                INSERT INTO score_pause_tokens (id, user_id, starts_at, ends_at, is_auto)
                SELECT UUID(), rs.user_id, UTC_TIMESTAMP(),
                       DATE_ADD(UTC_TIMESTAMP(), INTERVAL v_days DAY), 1
                  FROM readiness_scores rs
                 WHERE rs.last_event_at IS NOT NULL
                   AND rs.last_event_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL v_grace DAY)
                   AND rs.base_points >= v_floor
                   AND rs.decay_points = 0            -- not already eroding
                   AND NOT EXISTS (
                         SELECT 1 FROM score_pause_tokens p
                          WHERE p.user_id = rs.user_id
                            AND UTC_TIMESTAMP() BETWEEN p.starts_at AND p.ends_at)
                   AND (SELECT COUNT(*) FROM score_pause_tokens p2
                         WHERE p2.user_id = rs.user_id
                           AND YEAR(p2.starts_at) = YEAR(UTC_TIMESTAMP())) < v_max;

                SET v_hit = ROW_COUNT();
                SELECT v_hit AS paused;
              END IF;
            END$$

DROP PROCEDURE IF EXISTS `sp_score_award`$$
CREATE PROCEDURE `sp_score_award`(IN `p_id` char(36), IN `p_user` char(36), IN `p_type` varchar(50), IN `p_ref` varchar(64), IN `p_meta` text)
proc: BEGIN
      DECLARE v_points DECIMAL(5,1) DEFAULT 0;
      DECLARE v_active TINYINT DEFAULT 0;
      DECLARE v_cap_type VARCHAR(12) DEFAULT 'none';
      DECLARE v_cap_value INT DEFAULT NULL;
      DECLARE v_used INT DEFAULT 0;
      DECLARE v_dupe INT DEFAULT 0;
      DECLARE v_award DECIMAL(5,1) DEFAULT 0;
      DECLARE v_capped TINYINT DEFAULT 0;
      DECLARE v_user INT DEFAULT 0;

      -- score_events has no FK to users, so this guard is the only thing
      -- between a stale/wrong id and an orphan ledger row that the analytics
      -- counts and the nightly decay job would both read as a real student.
      SELECT COUNT(*) INTO v_user
        FROM users WHERE id = p_user AND deleted_at IS NULL;

      IF v_user = 0 THEN
        SELECT 0 AS awarded, 'unknown_user' AS result;
        LEAVE proc;
      END IF;

      SELECT points, is_active, cap_type, cap_value
        INTO v_points, v_active, v_cap_type, v_cap_value
        FROM score_event_rules WHERE event_type = p_type;

      IF v_active = 0 THEN
        SELECT 0 AS awarded, 'unknown_or_inactive' AS result;
      ELSE
        -- per_item caps ride on ref_id: one award per cohort / application /
        -- document. The unique key makes this idempotent under retries.
        IF p_ref IS NOT NULL THEN
          SELECT COUNT(*) INTO v_dupe FROM score_events
           WHERE user_id = p_user AND event_type = p_type AND ref_id = p_ref;
        END IF;

        IF v_dupe > 0 THEN
          SELECT 0 AS awarded, 'duplicate' AS result;
        ELSE
          -- How many awards already landed inside this cap's window?
          -- Capped rows (meta='capped') do not consume the allowance.
          IF v_cap_type = 'daily' THEN
            SELECT COUNT(*) INTO v_used FROM score_events
             WHERE user_id = p_user AND event_type = p_type
               AND (meta IS NULL OR meta <> 'capped')
               AND occurred_at >= UTC_DATE();
          ELSEIF v_cap_type = 'weekly' THEN
            SELECT COUNT(*) INTO v_used FROM score_events
             WHERE user_id = p_user AND event_type = p_type
               AND (meta IS NULL OR meta <> 'capped')
               AND YEARWEEK(occurred_at, 1) = YEARWEEK(UTC_TIMESTAMP(), 1);
          ELSEIF v_cap_type = 'monthly' THEN
            SELECT COUNT(*) INTO v_used FROM score_events
             WHERE user_id = p_user AND event_type = p_type
               AND (meta IS NULL OR meta <> 'capped')
               AND YEAR(occurred_at) = YEAR(UTC_TIMESTAMP())
               AND MONTH(occurred_at) = MONTH(UTC_TIMESTAMP());
          ELSEIF v_cap_type IN ('lifetime', 'once') THEN
            SELECT COUNT(*) INTO v_used FROM score_events
             WHERE user_id = p_user AND event_type = p_type
               AND (meta IS NULL OR meta <> 'capped');
          ELSE
            SET v_used = 0;
          END IF;

          IF v_cap_value IS NOT NULL AND v_used >= v_cap_value THEN
            SET v_award = 0; SET v_capped = 1;
          ELSE
            SET v_award = v_points;
          END IF;

          -- Playbook §9.1(5): a capped action is still logged, with delta 0, so
          -- we keep visibility into what the student actually did.
          INSERT INTO score_events (id, user_id, event_type, points, ref_id, meta)
          VALUES (p_id, p_user, p_type, v_award, p_ref,
                  IF(v_capped = 1, 'capped', p_meta));

          INSERT INTO readiness_scores (id, user_id, score, level, last_event_at)
          VALUES (UUID(), p_user, 0, 'Explorer', UTC_TIMESTAMP())
          ON DUPLICATE KEY UPDATE last_event_at = UTC_TIMESTAMP();

          SELECT v_award AS awarded, IF(v_capped = 1, 'capped', 'awarded') AS result;
        END IF;
      END IF;
    END$$

DROP PROCEDURE IF EXISTS `sp_score_cohort_week_count`$$
CREATE PROCEDURE `sp_score_cohort_week_count`(IN `p_user` char(36), IN `p_cohort` varchar(64))
BEGIN
      -- Cohorts this student has already been paid for attending inside the
      -- current ISO week, excluding the one being checked in to right now.
      -- Anything above zero makes the check-in a repeat, which is what the
      -- cohort_repeat_week rule pays for. Excluding p_cohort means the answer
      -- does not depend on whether the new cohort_attended row is in yet.
      SELECT COUNT(*) AS prior_this_week,
             YEARWEEK(UTC_TIMESTAMP(), 1) AS week_key
        FROM score_events
       WHERE user_id = p_user
         AND event_type = 'cohort_attended'
         AND (p_cohort IS NULL OR ref_id IS NULL OR ref_id <> p_cohort)
         AND YEARWEEK(occurred_at, 1) = YEARWEEK(UTC_TIMESTAMP(), 1);
    END$$

DROP PROCEDURE IF EXISTS `sp_score_breakdown`$$
CREATE PROCEDURE `sp_score_breakdown`(IN `p_user` char(36))
BEGIN
      -- metric_key/rule_test/threshold let the student screens describe a rule
      -- an admin built. Without them every metric rule was dropped from "ways
      -- to earn points", having no hardcoded key to match on.
      SELECT r.event_type, r.label, r.points AS points_each,
             r.cap_type, r.cap_value,
             r.metric_key, r.rule_test, r.threshold,
             IFNULL(SUM(e.points), 0) AS earned,
             COUNT(e.id) AS times
        FROM score_event_rules r
        LEFT JOIN score_events e ON e.event_type = r.event_type AND e.user_id = p_user
       WHERE r.is_active = 1
       GROUP BY r.event_type, r.label, r.points, r.cap_type, r.cap_value,
                r.metric_key, r.rule_test, r.threshold

  UNION ALL

  -- Credits that have no rule row: managed elsewhere, so a join to
  -- score_event_rules drops them and the panel omits the points the student
  -- actually holds.
  SELECT e.event_type,
         CASE e.event_type
           WHEN 'admin_task'       THEN 'Tasks from Skovo'
           WHEN 'admin_adjustment' THEN 'Adjustments by Skovo'
           WHEN 'referral_bonus'   THEN 'Referral rewards'
           ELSE e.event_type END AS label,
         0 AS points_each, 'none' AS cap_type, NULL AS cap_value,
         NULL AS metric_key, NULL AS rule_test, NULL AS threshold,
         SUM(e.points) AS earned, COUNT(*) AS times
    FROM score_events e
   WHERE e.user_id = p_user
     AND e.event_type IN ('admin_task', 'admin_adjustment', 'referral_bonus')
     AND NOT EXISTS (SELECT 1 FROM score_event_rules r2 WHERE r2.event_type = e.event_type)
   GROUP BY e.event_type

       ORDER BY earned DESC, points_each DESC;
    END$$

DROP PROCEDURE IF EXISTS `sp_score_decay_run`$$
CREATE PROCEDURE `sp_score_decay_run`()
BEGIN
      DECLARE v_grace INT DEFAULT 7;
      DECLARE v_per INT DEFAULT 1;
      DECLARE v_hit INT DEFAULT 0;

      SELECT IFNULL(decay_grace_days,7), IFNULL(decay_per_day,1)
        INTO v_grace, v_per
        FROM readiness_rules ORDER BY created_at ASC LIMIT 1;

      UPDATE readiness_scores rs
         SET rs.decay_points = rs.decay_points + v_per,
             rs.last_decay_on = CURDATE()
       WHERE (rs.last_decay_on IS NULL OR rs.last_decay_on < CURDATE())
         AND rs.last_event_at IS NOT NULL
         AND rs.last_event_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL v_grace DAY)
         AND rs.decay_points < rs.base_points
         AND NOT EXISTS (
               SELECT 1 FROM score_pause_tokens p
                WHERE p.user_id = rs.user_id
                  AND UTC_TIMESTAMP() BETWEEN p.starts_at AND p.ends_at);

      SET v_hit = ROW_COUNT();

      UPDATE readiness_scores
         SET score = GREATEST(0, LEAST(100, FLOOR(base_points - decay_points))),
             `level` = IFNULL((SELECT l.label FROM readiness_levels l
                                WHERE l.is_active = 1
                                  AND l.min_score <= GREATEST(0, LEAST(100, FLOOR(base_points - decay_points)))
                                ORDER BY l.min_score DESC LIMIT 1), `level`)
       WHERE decay_points > 0;

      SELECT v_hit AS decayed;
    END$$

DROP PROCEDURE IF EXISTS `sp_score_events_list`$$
CREATE PROCEDURE `sp_score_events_list`(IN `p_user` char(36), IN `p_limit` int, IN `p_offset` int)
BEGIN
      SELECT e.id, e.event_type, e.points, e.ref_id, e.occurred_at, e.meta,
             COALESCE(
               r.label,
               CASE e.event_type
                 WHEN 'admin_adjustment' THEN 'Adjustment by Skovo'
                 WHEN 'admin_task'       THEN 'Task from Skovo'
                 WHEN 'referral_bonus'   THEN 'Referral reward'
               END,
               -- No rule and no name: spell the key as words rather than show
               -- a student raw snake_case.
               CONCAT(UPPER(LEFT(REPLACE(e.event_type, '_', ' '), 1)),
                      SUBSTRING(REPLACE(e.event_type, '_', ' '), 2))
             ) AS label
        FROM score_events e
        LEFT JOIN score_event_rules r ON r.event_type = e.event_type
       WHERE e.user_id = p_user
       ORDER BY e.seq DESC
       LIMIT p_limit OFFSET p_offset;
    END$$

DROP PROCEDURE IF EXISTS `sp_score_pause_start`$$
CREATE PROCEDURE `sp_score_pause_start`(IN `p_id` char(36), IN `p_user` char(36))
BEGIN
      DECLARE v_max INT DEFAULT 2;
      DECLARE v_days INT DEFAULT 21;
      DECLARE v_used INT DEFAULT 0;
      DECLARE v_active INT DEFAULT 0;

      SELECT IFNULL(pause_tokens_per_year,2), IFNULL(pause_days,21) INTO v_max, v_days
        FROM readiness_rules ORDER BY created_at ASC LIMIT 1;

      SELECT COUNT(*) INTO v_used FROM score_pause_tokens
       WHERE user_id = p_user AND YEAR(starts_at) = YEAR(UTC_TIMESTAMP());

      SELECT COUNT(*) INTO v_active FROM score_pause_tokens
       WHERE user_id = p_user AND UTC_TIMESTAMP() BETWEEN starts_at AND ends_at;

      IF v_active > 0 THEN
        SELECT 0 AS ok, 'Your score is already paused.' AS message,
               v_used AS used, v_max AS max_tokens;
      ELSEIF v_used >= v_max THEN
        SELECT 0 AS ok,
               CONCAT('You have used all ', v_max, ' score pauses for this year.') AS message,
               v_used AS used, v_max AS max_tokens;
      ELSE
        INSERT INTO score_pause_tokens (id, user_id, starts_at, ends_at)
        VALUES (p_id, p_user, UTC_TIMESTAMP(), DATE_ADD(UTC_TIMESTAMP(), INTERVAL v_days DAY));
        SELECT 1 AS ok,
               CONCAT('Score paused for ', v_days, ' days.') AS message,
               v_used + 1 AS used, v_max AS max_tokens;
      END IF;
    END$$

DROP PROCEDURE IF EXISTS `sp_score_pause_status`$$
CREATE PROCEDURE `sp_score_pause_status`(IN `p_user` char(36))
BEGIN
      DECLARE v_max INT DEFAULT 2;
      DECLARE v_days INT DEFAULT 21;
      SELECT IFNULL(pause_tokens_per_year,2), IFNULL(pause_days,21) INTO v_max, v_days
        FROM readiness_rules ORDER BY created_at ASC LIMIT 1;

      SELECT v_max AS max_tokens, v_days AS pause_days,
             (SELECT COUNT(*) FROM score_pause_tokens
               WHERE user_id = p_user AND YEAR(starts_at) = YEAR(UTC_TIMESTAMP())) AS used_this_year,
             (SELECT ends_at FROM score_pause_tokens
               WHERE user_id = p_user AND UTC_TIMESTAMP() BETWEEN starts_at AND ends_at
               ORDER BY ends_at DESC LIMIT 1) AS active_until;
    END$$

DROP PROCEDURE IF EXISTS `sp_score_recalc`$$
CREATE PROCEDURE `sp_score_recalc`(IN `p_user` char(36))
BEGIN
      DECLARE v_base DECIMAL(7,1) DEFAULT 0;
      DECLARE v_decay INT DEFAULT 0;
      DECLARE v_score INT DEFAULT 0;
      DECLARE v_level VARCHAR(40);
      DECLARE v_cohorts INT DEFAULT 0;
      DECLARE v_tasks INT DEFAULT 0;

      -- Caps were applied at write time, so the ledger simply sums. Switching a
      -- rule off retroactively stops its events counting.
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

      SELECT label INTO v_level
        FROM readiness_levels
       WHERE is_active = 1 AND min_score <= v_score
       ORDER BY min_score DESC LIMIT 1;
      IF v_level IS NULL OR v_level = '' THEN
          SELECT `level` INTO v_level FROM readiness_scores WHERE user_id = p_user;
      END IF;
      SET v_level = IFNULL(v_level, '');

      -- legacy counters the dashboards still read
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

DROP PROCEDURE IF EXISTS `sp_score_rule_update`$$
CREATE PROCEDURE `sp_score_rule_update`(IN `p_type` varchar(50), IN `p_label` varchar(160), IN `p_points` decimal(5,1), IN `p_cap_type` varchar(12), IN `p_cap_value` int, IN `p_is_active` tinyint)
BEGIN
      UPDATE score_event_rules SET
        label = COALESCE(p_label, label),
        points = COALESCE(p_points, points),
        cap_type = COALESCE(p_cap_type, cap_type),
        cap_value = p_cap_value,
        is_active = COALESCE(p_is_active, is_active)
      WHERE event_type = p_type;
      SELECT * FROM score_event_rules WHERE event_type = p_type;
    END$$

DROP PROCEDURE IF EXISTS `sp_score_rules_list`$$
CREATE PROCEDURE `sp_score_rules_list`(IN `p_active_only` tinyint)
BEGIN
      SELECT * FROM score_event_rules
       WHERE (p_active_only = 0 OR is_active = 1)
       ORDER BY is_active DESC, points DESC, event_type ASC;
    END$$

DROP PROCEDURE IF EXISTS `sp_score_set_assessment`$$
CREATE PROCEDURE `sp_score_set_assessment`(IN `p_user` char(36), IN `p_points` int)
BEGIN
      -- Re-graded on every step save, so this is the one correcting write in an
      -- otherwise append-only log.
      DELETE FROM score_events
       WHERE user_id = p_user AND event_type = 'assessment_completed';

      IF IFNULL(p_points, 0) > 0 THEN
        INSERT INTO score_events (id, user_id, event_type, points, ref_id, meta)
        VALUES (UUID(), p_user, 'assessment_completed', p_points, 'assessment',
                'graded readiness assessment total');
      END IF;

      INSERT INTO readiness_scores (id, user_id, score, level, last_event_at)
      VALUES (UUID(), p_user, 0, 'Explorer', UTC_TIMESTAMP())
      ON DUPLICATE KEY UPDATE last_event_at = UTC_TIMESTAMP();

      SELECT IFNULL(p_points, 0) AS points;
    END$$

DROP PROCEDURE IF EXISTS `sp_score_unlocks`$$
CREATE PROCEDURE `sp_score_unlocks`(IN `p_user` char(36))
BEGIN
      DECLARE v_score INT DEFAULT 0;
      SELECT IFNULL(score,0) INTO v_score FROM readiness_scores WHERE user_id = p_user;
      SELECT v_score AS score,
             IFNULL(opportunity_unlock_score,60) AS opportunity_unlock_score
        FROM readiness_rules ORDER BY created_at ASC LIMIT 1;
    END$$

DELIMITER ;

DROP PROCEDURE IF EXISTS `sp_score_event_rule_upsert`$$
CREATE PROCEDURE `sp_score_event_rule_upsert`(
    IN p_event_type VARCHAR(50),
    IN p_label      VARCHAR(160),
    IN p_points     DECIMAL(5,1),
    IN p_cap_type   VARCHAR(12),
    IN p_cap_value  INT,
    IN p_is_active  TINYINT(1)
)
BEGIN
    INSERT INTO `score_event_rules`
        (event_type, label, points, cap_type, cap_value, is_active, updated_at)
    VALUES
        (p_event_type, p_label, p_points, IFNULL(p_cap_type,'none'), p_cap_value,
         IFNULL(p_is_active,1), UTC_TIMESTAMP())
    ON DUPLICATE KEY UPDATE
        label      = VALUES(label),
        points     = VALUES(points),
        cap_type   = VALUES(cap_type),
        cap_value  = VALUES(cap_value),
        is_active  = VALUES(is_active),
        updated_at = UTC_TIMESTAMP();

    SELECT * FROM `score_event_rules` WHERE event_type = p_event_type;
END$$

DROP PROCEDURE IF EXISTS `sp_score_event_rule_delete`$$
CREATE PROCEDURE `sp_score_event_rule_delete`(IN p_event_type VARCHAR(50))
BEGIN
    DECLARE v_used INT DEFAULT 0;

    -- Deleting a rule that has already paid somebody would silently rewrite
    -- history: sp_score_recalc sums score_events JOINed to score_event_rules,
    -- so with the rule gone those points stop counting and every affected
    -- student's score drops with no record of why. Switch it off instead --
    -- that is what is_active is for, and the ledger stays intact.
    SELECT COUNT(*) INTO v_used FROM `score_events` WHERE event_type = p_event_type;
    IF v_used > 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'RULE_IN_USE';
    END IF;

    DELETE FROM `score_event_rules` WHERE event_type = p_event_type;
    SELECT ROW_COUNT() AS deleted;
END$$
