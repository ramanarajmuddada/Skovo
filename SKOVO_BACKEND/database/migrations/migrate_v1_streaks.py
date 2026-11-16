"""Career streaks: two counters, admin rules, freezes, exam windows, buddies.

WHY
    feature-updates.md §3. The old streak (user_streaks, POST /gamification/
    my-streak) was a manual check-in button: login alone kept it alive. The
    career streak counts only actions admin has switched on, and has two
    counters:
        lifetime  never resets on promotion (profile, home, widget)
        stage     resets to 0 on promotion; ranks the leaderboard

WHAT CHANGES (all new, nothing existing altered)
    streak_settings      singleton; enabled = 0 (OFF until admin turns it on)
    streak_actions       catalogue of actions that MAY count; every row
                         counts = 0 (inactive) until admin switches it on
    career_streaks       one row per student: both counters, freezes, restore
    streak_days          one row per kept day: action / freeze / exam / restore
    streak_action_log    today's qualifying actions (min-per-day check)
    streak_exam_windows  admin-entered exam dates (no break, no freeze used)
    buddy_streaks        two students, one joint streak
    score_event_rules    + streak_7 / streak_30 / streak_100 / streak_365 /
                           buddy_streak_7 -- 0 points, inactive. Admin prices and
                           activates them in Score rules, like any other rule.
    sp_streak_*          see PROCS

Day boundary is midnight IST; the caller passes the IST date.

Additive, idempotent. From SKOVO_BACKEND:
    python database/migrations/migrate_v1_streaks.py
"""
from sqlalchemy import text

import _bootstrap  # noqa: F401
from portal import InitApp
from portal.models import db

app = InitApp().app()

TABLES = [
"""CREATE TABLE IF NOT EXISTS `streak_settings` (
  `id`                    TINYINT     NOT NULL DEFAULT 1,
  `enabled`               TINYINT(1)  NOT NULL DEFAULT 0,
  `freeze_every_days`     INT         NOT NULL DEFAULT 7,
  `freeze_max`            INT         NOT NULL DEFAULT 2,
  `freeze_max_pro`        INT         NOT NULL DEFAULT 3,
  `restore_per_month`     INT         NOT NULL DEFAULT 1,
  `restore_window_hours`  INT         NOT NULL DEFAULT 24,
  `risk_reminder_hour`    INT         NOT NULL DEFAULT 20,
  `buddy_max`             INT         NOT NULL DEFAULT 5,
  `updated_at`            DATETIME    NULL ON UPDATE CURRENT_TIMESTAMP,
  `updated_by`            CHAR(36)    NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci""",

"""CREATE TABLE IF NOT EXISTS `streak_actions` (
  `action_key`     VARCHAR(50)  NOT NULL,
  `label`          VARCHAR(120) NOT NULL,
  `counts`         TINYINT(1)   NOT NULL DEFAULT 0,
  `min_per_day`    INT          NOT NULL DEFAULT 1,
  `segment_stage`  VARCHAR(255) NULL,
  `segment_branch` VARCHAR(255) NULL,
  `segment_state`  VARCHAR(255) NULL,
  `sort_order`     INT          NOT NULL DEFAULT 0,
  `updated_at`     DATETIME     NULL ON UPDATE CURRENT_TIMESTAMP,
  `updated_by`     CHAR(36)     NULL,
  PRIMARY KEY (`action_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci""",

"""CREATE TABLE IF NOT EXISTS `career_streaks` (
  `user_id`              CHAR(36)   NOT NULL,
  `lifetime_current`     INT        NOT NULL DEFAULT 0,
  `lifetime_best`        INT        NOT NULL DEFAULT 0,
  `stage_id`             CHAR(36)   NULL,
  `stage_current`        INT        NOT NULL DEFAULT 0,
  `stage_best`           INT        NOT NULL DEFAULT 0,
  `covered_through`      DATE       NULL,
  `run_started_on`       DATE       NULL,
  `freezes_held`         INT        NOT NULL DEFAULT 0,
  `broken_on`            DATE       NULL,
  `broken_lifetime`      INT        NULL,
  `broken_stage`         INT        NULL,
  `broken_run_started`   DATE       NULL,
  `restore_used_month`   CHAR(7)    NULL,
  `restores_this_month`  INT        NOT NULL DEFAULT 0,
  `last_reminded_on`     DATE       NULL,
  `updated_at`           DATETIME   NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`),
  KEY `ix_cs_covered` (`covered_through`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci""",

"""CREATE TABLE IF NOT EXISTS `streak_days` (
  `user_id`  CHAR(36)    NOT NULL,
  `day`      DATE        NOT NULL,
  `kind`     VARCHAR(10) NOT NULL,
  `actions`  INT         NOT NULL DEFAULT 0,
  PRIMARY KEY (`user_id`, `day`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci""",

"""CREATE TABLE IF NOT EXISTS `streak_action_log` (
  `user_id`    CHAR(36)    NOT NULL,
  `day`        DATE        NOT NULL,
  `action_key` VARCHAR(50) NOT NULL,
  `count`      INT         NOT NULL DEFAULT 0,
  PRIMARY KEY (`user_id`, `day`, `action_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci""",

"""CREATE TABLE IF NOT EXISTS `streak_exam_windows` (
  `id`          CHAR(36)     NOT NULL,
  `label`       VARCHAR(120) NOT NULL,
  `stage_group` VARCHAR(20)  NULL,
  `state`       VARCHAR(100) NULL,
  `start_date`  DATE         NOT NULL,
  `end_date`    DATE         NOT NULL,
  `is_active`   TINYINT(1)   NOT NULL DEFAULT 1,
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `created_by`  CHAR(36)     NULL,
  PRIMARY KEY (`id`),
  KEY `ix_sew_dates` (`start_date`, `end_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci""",

"""CREATE TABLE IF NOT EXISTS `buddy_streaks` (
  `id`              CHAR(36)    NOT NULL,
  `user_a`          CHAR(36)    NOT NULL,
  `user_b`          CHAR(36)    NULL,
  `invite_code`     VARCHAR(12) NOT NULL,
  `status`          VARCHAR(10) NOT NULL DEFAULT 'pending',
  `current`         INT         NOT NULL DEFAULT 0,
  `best`            INT         NOT NULL DEFAULT 0,
  `covered_through` DATE        NULL,
  `run_started_on`  DATE        NULL,
  `created_at`      DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `ended_at`        DATETIME    NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_buddy_code` (`invite_code`),
  KEY `ix_buddy_a` (`user_a`, `status`),
  KEY `ix_buddy_b` (`user_b`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci""",
]

# Every action that MAY keep a streak alive. All inactive: admin decides.
ACTIONS = [
    ('quiz_submitted', 'Submit a quiz', 1),
    ('session_attended', 'Attend a live session', 4),
    ('task_submitted', 'Submit a cohort task', 5),
    ('daily_goal_met', 'Meet the daily goal', 6),
    ('mistakes_cleared', 'Clear a My Mistakes set', 7),
    ('speed_round', 'Play a speed practice round', 8),
    ('mentor_session_done', 'Complete a 1-on-1 mentor session', 12),
    ('career_tool_used', 'Apply to an opportunity', 13),
    ('answer_solved', 'Answer marked Solved in Assemble', 14),
]
# v1 (17 Oct 2026): mock test, course lesson, learning-path level, current
# affairs quiz and coding problem were removed — their features are hidden or
# not built in v1. Resume / SOP left the career-tool label for the same reason.

MILESTONE_RULES = [
    ('streak_7', '7-day career streak'),
    ('streak_30', '30-day career streak'),
    ('streak_100', '100-day career streak'),
    ('streak_365', '365-day career streak'),
    ('buddy_streak_7', '7-day buddy streak'),
]

PROCS = {
'sp_streak_settings_get': """
CREATE PROCEDURE `sp_streak_settings_get`()
BEGIN
  INSERT IGNORE INTO streak_settings (id) VALUES (1);
  SELECT * FROM streak_settings WHERE id = 1;
END""",

'sp_streak_settings_set': """
CREATE PROCEDURE `sp_streak_settings_set`(
  IN p_enabled TINYINT, IN p_every INT, IN p_max INT, IN p_max_pro INT,
  IN p_restores INT, IN p_window INT, IN p_hour INT, IN p_buddy_max INT, IN p_admin CHAR(36))
BEGIN
  INSERT IGNORE INTO streak_settings (id) VALUES (1);
  UPDATE streak_settings
     SET enabled = IFNULL(p_enabled, enabled),
         -- 0 = freezes off (17 Oct 2026); was floored at 1.
         freeze_every_days = GREATEST(0, IFNULL(p_every, freeze_every_days)),
         freeze_max = GREATEST(0, IFNULL(p_max, freeze_max)),
         freeze_max_pro = GREATEST(0, IFNULL(p_max_pro, freeze_max_pro)),
         restore_per_month = GREATEST(0, IFNULL(p_restores, restore_per_month)),
         restore_window_hours = GREATEST(1, IFNULL(p_window, restore_window_hours)),
         risk_reminder_hour = LEAST(23, GREATEST(0, IFNULL(p_hour, risk_reminder_hour))),
         buddy_max = GREATEST(0, IFNULL(p_buddy_max, buddy_max)),
         updated_by = p_admin
   WHERE id = 1;
  SELECT * FROM streak_settings WHERE id = 1;
END""",

'sp_streak_actions_list': """
CREATE PROCEDURE `sp_streak_actions_list`()
BEGIN
  SELECT * FROM streak_actions ORDER BY sort_order, label;
END""",

'sp_streak_action_set': """
CREATE PROCEDURE `sp_streak_action_set`(
  IN p_key VARCHAR(50), IN p_counts TINYINT, IN p_min INT,
  IN p_stage VARCHAR(255), IN p_branch VARCHAR(255), IN p_state VARCHAR(255), IN p_admin CHAR(36))
BEGIN
  UPDATE streak_actions
     SET counts = IFNULL(p_counts, counts),
         min_per_day = GREATEST(1, IFNULL(p_min, min_per_day)),
         segment_stage = NULLIF(p_stage, ''), segment_branch = NULLIF(p_branch, ''),
         segment_state = NULLIF(p_state, ''), updated_by = p_admin
   WHERE action_key = p_key;
  SELECT * FROM streak_actions WHERE action_key = p_key;
END""",

'sp_streak_get': """
CREATE PROCEDURE `sp_streak_get`(IN p_user CHAR(36))
BEGIN
  INSERT IGNORE INTO career_streaks (user_id) VALUES (p_user);
  SELECT * FROM career_streaks WHERE user_id = p_user;
END""",

'sp_streak_days': """
CREATE PROCEDURE `sp_streak_days`(IN p_user CHAR(36), IN p_from DATE, IN p_to DATE)
BEGIN
  SELECT day, kind, actions FROM streak_days
   WHERE user_id = p_user AND day BETWEEN p_from AND p_to ORDER BY day;
END""",

'sp_streak_log_action': """
CREATE PROCEDURE `sp_streak_log_action`(IN p_user CHAR(36), IN p_day DATE, IN p_key VARCHAR(50))
BEGIN
  -- Today's count for this action, after this one.
  INSERT INTO streak_action_log (user_id, day, action_key, count)
  VALUES (p_user, p_day, p_key, 1)
  ON DUPLICATE KEY UPDATE count = count + 1;
  SELECT count FROM streak_action_log WHERE user_id = p_user AND day = p_day AND action_key = p_key;
END""",

'sp_streak_keep_day': """
CREATE PROCEDURE `sp_streak_keep_day`(
  IN p_user CHAR(36), IN p_day DATE, IN p_kind VARCHAR(10), IN p_stage CHAR(36),
  IN p_freeze_every INT, IN p_freeze_max INT)
proc: BEGIN
  -- Count p_day as kept. Idempotent: a day already kept changes nothing.
  DECLARE v_cov DATE DEFAULT NULL;
  DECLARE v_life INT DEFAULT 0;
  DECLARE v_stage INT DEFAULT 0;
  DECLARE v_stage_id CHAR(36) DEFAULT NULL;
  DECLARE v_start DATE DEFAULT NULL;
  DECLARE v_freezes INT DEFAULT 0;
  DECLARE v_earned INT DEFAULT 0;

  INSERT IGNORE INTO career_streaks (user_id) VALUES (p_user);
  SELECT covered_through, lifetime_current, stage_current, stage_id, run_started_on, freezes_held
    INTO v_cov, v_life, v_stage, v_stage_id, v_start, v_freezes
    FROM career_streaks WHERE user_id = p_user FOR UPDATE;

  IF v_cov IS NOT NULL AND v_cov >= p_day THEN
    INSERT INTO streak_days (user_id, day, kind, actions) VALUES (p_user, p_day, p_kind, 1)
      ON DUPLICATE KEY UPDATE actions = actions + IF(p_kind = 'action', 1, 0);
    SELECT 'already' AS result, v_life AS lifetime_current, v_stage AS stage_current, 0 AS freeze_earned;
    LEAVE proc;
  END IF;

  -- A new stage resets the stage counter (lifetime carries on).
  IF IFNULL(v_stage_id, '') <> IFNULL(p_stage, '') THEN
    SET v_stage = 0;
  END IF;

  IF v_cov IS NOT NULL AND v_cov = DATE_SUB(p_day, INTERVAL 1 DAY) THEN
    SET v_life = v_life + 1;
    SET v_stage = v_stage + 1;
  ELSE
    SET v_life = 1;
    SET v_stage = 1;
    SET v_start = p_day;
  END IF;

  -- Only real action days earn freezes, every p_freeze_every days of the run.
  IF p_kind = 'action' AND p_freeze_every > 0 AND MOD(v_life, p_freeze_every) = 0
     AND v_freezes < p_freeze_max THEN
    SET v_freezes = v_freezes + 1;
    SET v_earned = 1;
  END IF;

  UPDATE career_streaks
     SET lifetime_current = v_life, lifetime_best = GREATEST(lifetime_best, v_life),
         stage_id = p_stage, stage_current = v_stage,
         stage_best = IF(IFNULL(stage_id, '') = IFNULL(p_stage, ''), GREATEST(stage_best, v_stage), v_stage),
         covered_through = p_day, run_started_on = v_start, freezes_held = v_freezes,
         broken_on = NULL
   WHERE user_id = p_user;

  INSERT INTO streak_days (user_id, day, kind, actions) VALUES (p_user, p_day, p_kind, IF(p_kind = 'action', 1, 0))
    ON DUPLICATE KEY UPDATE kind = p_kind;

  SELECT 'kept' AS result, v_life AS lifetime_current, v_stage AS stage_current,
         v_earned AS freeze_earned, v_start AS run_started_on;
END""",

'sp_streak_nightly_candidates': """
CREATE PROCEDURE `sp_streak_nightly_candidates`(IN p_day DATE)
BEGIN
  -- Students with a live streak who did not keep p_day.
  SELECT cs.user_id, cs.freezes_held, cs.lifetime_current, cs.stage_current,
         st.stage_group, p.state, st.id AS stage_id
    FROM career_streaks cs
    LEFT JOIN student_stages st ON st.user_id = cs.user_id AND st.status = 'active'
    LEFT JOIN user_profiles p ON p.user_id = cs.user_id
   WHERE cs.lifetime_current > 0
     AND cs.covered_through < p_day;
END""",

'sp_streak_in_exam_window': """
CREATE PROCEDURE `sp_streak_in_exam_window`(IN p_day DATE, IN p_group VARCHAR(20), IN p_state VARCHAR(100))
BEGIN
  SELECT COUNT(*) AS n FROM streak_exam_windows
   WHERE is_active = 1 AND p_day BETWEEN start_date AND end_date
     AND (stage_group IS NULL OR stage_group = '' OR stage_group = p_group)
     AND (state IS NULL OR state = '' OR state = p_state);
END""",

'sp_streak_use_freeze': """
CREATE PROCEDURE `sp_streak_use_freeze`(IN p_user CHAR(36), IN p_day DATE)
BEGIN
  UPDATE career_streaks
     SET freezes_held = freezes_held - 1, covered_through = p_day
   WHERE user_id = p_user AND freezes_held > 0 AND covered_through < p_day;
  INSERT IGNORE INTO streak_days (user_id, day, kind, actions) VALUES (p_user, p_day, 'freeze', 0);
  SELECT ROW_COUNT() AS used;
END""",

'sp_streak_cover_exam': """
CREATE PROCEDURE `sp_streak_cover_exam`(IN p_user CHAR(36), IN p_day DATE)
BEGIN
  UPDATE career_streaks SET covered_through = p_day
   WHERE user_id = p_user AND covered_through < p_day;
  INSERT IGNORE INTO streak_days (user_id, day, kind, actions) VALUES (p_user, p_day, 'exam', 0);
  SELECT 1 AS ok;
END""",

'sp_streak_break': """
CREATE PROCEDURE `sp_streak_break`(IN p_user CHAR(36), IN p_day DATE)
BEGIN
  -- Keep what was lost, so a restore can bring it back.
  UPDATE career_streaks
     SET broken_on = p_day, broken_lifetime = lifetime_current, broken_stage = stage_current,
         broken_run_started = run_started_on,
         lifetime_current = 0, stage_current = 0, run_started_on = NULL
   WHERE user_id = p_user AND lifetime_current > 0;
  SELECT ROW_COUNT() AS broken;
END""",

'sp_streak_restore': """
CREATE PROCEDURE `sp_streak_restore`(
  IN p_user CHAR(36), IN p_today DATE, IN p_month CHAR(7), IN p_per_month INT)
proc: BEGIN
  DECLARE v_broken DATE DEFAULT NULL;
  DECLARE v_month CHAR(7) DEFAULT NULL;
  DECLARE v_used INT DEFAULT 0;

  SELECT broken_on, restore_used_month, restores_this_month INTO v_broken, v_month, v_used
    FROM career_streaks WHERE user_id = p_user FOR UPDATE;

  IF v_broken IS NULL OR v_broken < DATE_SUB(p_today, INTERVAL 1 DAY) THEN
    SELECT 0 AS ok, 'nothing_to_restore' AS result; LEAVE proc;
  END IF;
  IF IFNULL(v_month, '') = p_month AND v_used >= p_per_month THEN
    SELECT 0 AS ok, 'limit_reached' AS result; LEAVE proc;
  END IF;

  UPDATE career_streaks
     SET lifetime_current = broken_lifetime, stage_current = broken_stage,
         lifetime_best = GREATEST(lifetime_best, broken_lifetime),
         run_started_on = broken_run_started, covered_through = broken_on,
         broken_on = NULL,
         restores_this_month = IF(IFNULL(restore_used_month, '') = p_month, restores_this_month + 1, 1),
         restore_used_month = p_month
   WHERE user_id = p_user;
  INSERT IGNORE INTO streak_days (user_id, day, kind, actions) VALUES (p_user, v_broken, 'restore', 0);
  SELECT 1 AS ok, 'restored' AS result;
END""",

'sp_streak_add_freeze': """
CREATE PROCEDURE `sp_streak_add_freeze`(IN p_user CHAR(36), IN p_max INT)
BEGIN
  INSERT IGNORE INTO career_streaks (user_id) VALUES (p_user);
  UPDATE career_streaks SET freezes_held = freezes_held + 1
   WHERE user_id = p_user AND freezes_held < p_max;
  SELECT ROW_COUNT() AS added;
END""",

'sp_streak_stage_closed': """
CREATE PROCEDURE `sp_streak_stage_closed`(IN p_user CHAR(36), IN p_closed_stage CHAR(36), IN p_new_stage CHAR(36))
BEGIN
  -- Promotion: the closed stage keeps its best stage streak; the stage counter
  -- starts again. Lifetime is untouched.
  UPDATE student_stages st
    JOIN career_streaks cs ON cs.user_id = st.user_id
     SET st.stage_best_streak = cs.stage_best
   WHERE st.id = p_closed_stage;
  UPDATE career_streaks SET stage_id = p_new_stage, stage_current = 0, stage_best = 0
   WHERE user_id = p_user;
  SELECT 1 AS ok;
END""",

'sp_streak_stage_reopened': """
CREATE PROCEDURE `sp_streak_stage_reopened`(IN p_user CHAR(36), IN p_stage CHAR(36))
BEGIN
  -- A promotion was rolled back: the old stage is active again, so the stage
  -- counter follows it and keeps the best it had reached.
  UPDATE career_streaks cs
    LEFT JOIN student_stages st ON st.id = p_stage
     SET cs.stage_id = p_stage,
         cs.stage_best = GREATEST(cs.stage_best, IFNULL(st.stage_best_streak, 0))
   WHERE cs.user_id = p_user;
  SELECT 1 AS ok;
END""",

'sp_streak_risk_candidates': """
CREATE PROCEDURE `sp_streak_risk_candidates`(IN p_today DATE)
BEGIN
  SELECT user_id, lifetime_current FROM career_streaks
   WHERE lifetime_current > 0
     AND covered_through < p_today
     AND (last_reminded_on IS NULL OR last_reminded_on < p_today);
END""",

'sp_streak_mark_reminded': """
CREATE PROCEDURE `sp_streak_mark_reminded`(IN p_user CHAR(36), IN p_today DATE)
BEGIN
  UPDATE career_streaks SET last_reminded_on = p_today WHERE user_id = p_user;
END""",

'sp_streak_exam_windows_list': """
CREATE PROCEDURE `sp_streak_exam_windows_list`()
BEGIN
  SELECT * FROM streak_exam_windows ORDER BY start_date DESC;
END""",

'sp_streak_exam_window_upsert': """
CREATE PROCEDURE `sp_streak_exam_window_upsert`(
  IN p_id CHAR(36), IN p_label VARCHAR(120), IN p_group VARCHAR(20), IN p_state VARCHAR(100),
  IN p_start DATE, IN p_end DATE, IN p_active TINYINT, IN p_admin CHAR(36))
BEGIN
  INSERT INTO streak_exam_windows (id, label, stage_group, state, start_date, end_date, is_active, created_by)
  VALUES (p_id, p_label, NULLIF(p_group, ''), NULLIF(p_state, ''), p_start, p_end, IFNULL(p_active, 1), p_admin)
  ON DUPLICATE KEY UPDATE label = p_label, stage_group = NULLIF(p_group, ''), state = NULLIF(p_state, ''),
         start_date = p_start, end_date = p_end, is_active = IFNULL(p_active, is_active);
  SELECT * FROM streak_exam_windows WHERE id = p_id;
END""",

'sp_streak_exam_window_delete': """
CREATE PROCEDURE `sp_streak_exam_window_delete`(IN p_id CHAR(36))
BEGIN
  DELETE FROM streak_exam_windows WHERE id = p_id;
  SELECT ROW_COUNT() AS deleted;
END""",

'sp_buddy_list': """
CREATE PROCEDURE `sp_buddy_list`(IN p_user CHAR(36))
BEGIN
  SELECT b.*, IF(b.user_a = p_user, b.user_b, b.user_a) AS buddy_id,
         u.full_name AS buddy_name, u.avatar_url AS buddy_avatar
    FROM buddy_streaks b
    LEFT JOIN users u ON u.id = IF(b.user_a = p_user, b.user_b, b.user_a)
   WHERE (b.user_a = p_user OR b.user_b = p_user) AND b.status IN ('pending', 'active')
   ORDER BY b.status = 'active' DESC, b.current DESC;
END""",

'sp_buddy_invite': """
CREATE PROCEDURE `sp_buddy_invite`(IN p_id CHAR(36), IN p_user CHAR(36), IN p_code VARCHAR(12))
BEGIN
  INSERT INTO buddy_streaks (id, user_a, invite_code, status) VALUES (p_id, p_user, p_code, 'pending');
  SELECT * FROM buddy_streaks WHERE id = p_id;
END""",

'sp_buddy_accept': """
CREATE PROCEDURE `sp_buddy_accept`(IN p_user CHAR(36), IN p_code VARCHAR(12), IN p_max INT)
proc: BEGIN
  DECLARE v_id CHAR(36) DEFAULT NULL;
  DECLARE v_a CHAR(36) DEFAULT NULL;
  DECLARE v_mine INT DEFAULT 0;
  DECLARE v_theirs INT DEFAULT 0;

  SELECT id, user_a INTO v_id, v_a FROM buddy_streaks
   WHERE invite_code = p_code AND status = 'pending' LIMIT 1;
  IF v_id IS NULL THEN SELECT 0 AS ok, 'invalid_code' AS result; LEAVE proc; END IF;
  IF v_a = p_user THEN SELECT 0 AS ok, 'own_code' AS result; LEAVE proc; END IF;
  IF EXISTS (SELECT 1 FROM buddy_streaks WHERE status = 'active'
              AND ((user_a = v_a AND user_b = p_user) OR (user_a = p_user AND user_b = v_a))) THEN
    SELECT 0 AS ok, 'already_buddies' AS result; LEAVE proc;
  END IF;
  SELECT COUNT(*) INTO v_mine FROM buddy_streaks
   WHERE status = 'active' AND (user_a = p_user OR user_b = p_user);
  SELECT COUNT(*) INTO v_theirs FROM buddy_streaks
   WHERE status = 'active' AND (user_a = v_a OR user_b = v_a);
  IF v_mine >= p_max OR v_theirs >= p_max THEN
    SELECT 0 AS ok, 'buddy_limit' AS result; LEAVE proc;
  END IF;
  UPDATE buddy_streaks SET user_b = p_user, status = 'active' WHERE id = v_id;
  SELECT 1 AS ok, 'accepted' AS result, v_id AS id, v_a AS buddy_id;
END""",

'sp_buddy_end': """
CREATE PROCEDURE `sp_buddy_end`(IN p_user CHAR(36), IN p_id CHAR(36))
BEGIN
  UPDATE buddy_streaks SET status = 'ended', ended_at = UTC_TIMESTAMP()
   WHERE id = p_id AND (user_a = p_user OR user_b = p_user) AND status IN ('pending', 'active');
  SELECT ROW_COUNT() AS ended;
END""",

'sp_buddy_keep_day': """
CREATE PROCEDURE `sp_buddy_keep_day`(IN p_user CHAR(36), IN p_day DATE)
BEGIN
  -- For each active buddy pair of p_user where BOTH kept p_day by action,
  -- move the joint streak on. Returns the pairs that moved.
  DROP TEMPORARY TABLE IF EXISTS tmp_buddy_moved;
  CREATE TEMPORARY TABLE tmp_buddy_moved (id CHAR(36) PRIMARY KEY, current INT, run_started_on DATE);

  INSERT INTO tmp_buddy_moved (id, current, run_started_on)
  SELECT b.id,
         IF(b.covered_through = DATE_SUB(p_day, INTERVAL 1 DAY), b.current + 1, 1),
         IF(b.covered_through = DATE_SUB(p_day, INTERVAL 1 DAY), b.run_started_on, p_day)
    FROM buddy_streaks b
   WHERE b.status = 'active' AND (b.user_a = p_user OR b.user_b = p_user)
     AND (b.covered_through IS NULL OR b.covered_through < p_day)
     AND EXISTS (SELECT 1 FROM streak_days d WHERE d.user_id = b.user_a AND d.day = p_day AND d.kind = 'action')
     AND EXISTS (SELECT 1 FROM streak_days d WHERE d.user_id = b.user_b AND d.day = p_day AND d.kind = 'action');

  UPDATE buddy_streaks b JOIN tmp_buddy_moved m ON m.id = b.id
     SET b.current = m.current, b.best = GREATEST(b.best, m.current),
         b.covered_through = p_day, b.run_started_on = m.run_started_on;

  SELECT m.id, m.current, m.run_started_on, b.user_a, b.user_b
    FROM tmp_buddy_moved m JOIN buddy_streaks b ON b.id = m.id;
  DROP TEMPORARY TABLE IF EXISTS tmp_buddy_moved;
END""",

'sp_buddy_nightly_break': """
CREATE PROCEDURE `sp_buddy_nightly_break`(IN p_day DATE)
BEGIN
  -- A joint streak needs both on the same day; no freezes for pairs.
  UPDATE buddy_streaks SET current = 0, run_started_on = NULL
   WHERE status = 'active' AND current > 0 AND covered_through < p_day;
  SELECT ROW_COUNT() AS broken;
END""",

'sp_streak_admin_overview': """
CREATE PROCEDURE `sp_streak_admin_overview`()
BEGIN
  SELECT COUNT(*) AS students,
         SUM(lifetime_current > 0) AS active_streaks,
         SUM(lifetime_current >= 7) AS at_7,
         SUM(lifetime_current >= 30) AS at_30,
         SUM(lifetime_current >= 100) AS at_100,
         IFNULL(MAX(lifetime_best), 0) AS longest_ever
    FROM career_streaks;
END""",
}


def main():
    with app.app_context():
        for ddl in TABLES:
            db.session.execute(text(ddl))
        db.session.execute(text("INSERT IGNORE INTO streak_settings (id) VALUES (1)"))
        for key, label, order in ACTIONS:
            db.session.execute(text(
                "INSERT IGNORE INTO streak_actions (action_key, label, counts, sort_order) "
                "VALUES (:k, :l, 0, :o)"), {'k': key, 'l': label, 'o': order})
        for key, label in MILESTONE_RULES:
            db.session.execute(text(
                "INSERT IGNORE INTO score_event_rules (event_type, label, points, is_active, cap_type) "
                "VALUES (:k, :l, 0, 0, 'per_item')"), {'k': key, 'l': label})
        db.session.commit()
        print("  tables + inactive actions + inactive milestone rules ready")

        for name, ddl in PROCS.items():
            db.session.execute(text(f"DROP PROCEDURE IF EXISTS `{name}`"))
            db.session.execute(text(ddl))
        db.session.commit()
        print(f"  {len(PROCS)} procedures")

        s = db.session.execute(text("SELECT enabled FROM streak_settings WHERE id = 1")).scalar()
        n = db.session.execute(text("SELECT COUNT(*), SUM(counts) FROM streak_actions")).first()
        print(f"  streaks enabled: {s}; actions: {n[0]} (counting: {int(n[1] or 0)})")
        print("Done.")


if __name__ == '__main__':
    main()
