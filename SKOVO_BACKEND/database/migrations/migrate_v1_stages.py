"""Stages: the readiness score starts from zero at each stage.

WHY
    feature-updates.md §2. A student who moves from Class 10 to Inter (or Inter
    to a UG course) starts a new season: the score counts only what was earned
    in the current stage, and the closed stage is kept as a snapshot on the
    career timeline.

HOW THE RESET WORKS
    Nothing is deleted and no event is re-tagged. Every score total now counts
    only ledger rows with occurred_at >= the active stage's counts_from (the
    epoch for a student's first stage, the promotion time after that). So:
      * promotion  -> new stage starts now -> score counts from now (0 + boost)
      * roll back  -> the older stage is active again -> its events count again
    The ledger stays append-only, exactly as before.

WHAT CHANGES
    student_stages                       new table, one active row per student
    readiness_rules + legacy_boost_percent  INT DEFAULT 0   (off: nothing by default)
                    + legacy_boost_max      INT DEFAULT 0
                    + auto_promote_enabled  TINYINT DEFAULT 0 (off)
                    + auto_promote_on       CHAR(5) DEFAULT '07-01' (MM-DD, IST)
    score_event_rules + segment_stage, segment_branch  VARCHAR(255) NULL
                    (rules limited to a stage group / branch; NULL = everyone)
    sp_stage_*                            open, promote, update year, roll back,
                                          history, admin list / count
    sp_score_recalc, sp_score_recalc_bulk, sp_score_breakdown
                    count only the active stage; 'stage_boost' joins the direct
                    credits (no admin rule row, like admin_task). sp_score_recalc
                    also honours expires_days now, as sp_score_recalc_bulk did.

OWNERSHIP
    This migration now owns sp_score_recalc, sp_score_recalc_bulk and
    sp_score_breakdown. Re-running an older migration that recreates them
    (migrate_score_direct_credits, migrate_score_bulk_recalc, migrate_score_engine)
    would drop the stage filter -- run this one again afterwards.

SEED
    Every student (a user with a profile) without a stage gets one built from
    their profile, started at their account creation, so every existing point
    still counts and no score moves.

Additive and idempotent. From SKOVO_BACKEND:
    python database/migrations/migrate_v1_stages.py
"""
import uuid

from sqlalchemy import text

import _bootstrap  # noqa: F401
from portal import InitApp
from portal.models import db
from portal.helpers.stages import stage_group, sub_year_from

app = InitApp().app()

DIRECT_CREDITS = "('admin_task', 'admin_adjustment', 'referral_bonus', 'stage_boost', 'refund_reversal')"

# Where the active stage starts counting, or the epoch when there is none --
# a student with no stage row behaves exactly as before. A student's FIRST stage
# counts from the epoch too (counts_from default), so nothing earned before the
# stage row existed is lost; only a stage opened by promotion counts from then.
STAGE_START = ("IFNULL((SELECT st.counts_from FROM student_stages st "
               "WHERE st.user_id = {u} AND st.status = 'active' LIMIT 1), '1970-01-01')")

TABLE = """
CREATE TABLE IF NOT EXISTS `student_stages` (
  `id`                 CHAR(36)     NOT NULL,
  `user_id`            CHAR(36)     NOT NULL,
  `stage_group`        VARCHAR(20)  NOT NULL,
  `sub_year`           VARCHAR(30)  NULL,
  `education_category` VARCHAR(30)  NULL,
  `board`              VARCHAR(100) NULL,
  `stream`             VARCHAR(30)  NULL,
  `degree_category`    VARCHAR(60)  NULL,
  `degree_type`        VARCHAR(100) NULL,
  `branch`             VARCHAR(120) NULL,
  `institute`          VARCHAR(200) NULL,
  `state`              VARCHAR(100) NULL,
  `status`             VARCHAR(12)  NOT NULL DEFAULT 'active',
  `started_at`         DATETIME     NOT NULL,
  `counts_from`        DATETIME     NOT NULL DEFAULT '1970-01-01 00:00:00',
  `ended_at`           DATETIME     NULL,
  `final_score`        INT          NULL,
  `final_level`        VARCHAR(40)  NULL,
  `final_decay`        INT          NULL,
  `cohorts_completed`  INT          NULL,
  `tasks_completed`    INT          NULL,
  `best_rank_json`     JSON         NULL,
  `stage_best_streak`  INT          NULL,
  `badges_json`        JSON         NULL,
  `boost_points`       DECIMAL(5,2) NOT NULL DEFAULT 0,
  `closed_by`          CHAR(36)     NULL,
  `close_reason`       VARCHAR(255) NULL,
  `created_at`         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`         DATETIME     NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `ix_stage_user_status` (`user_id`, `status`),
  KEY `ix_stage_group` (`stage_group`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
"""

COLUMNS = [
    ('student_stages', 'counts_from', "DATETIME NOT NULL DEFAULT '1970-01-01 00:00:00' AFTER `started_at`"),
    ('readiness_rules', 'legacy_boost_percent', "INT NOT NULL DEFAULT 0"),
    ('readiness_rules', 'legacy_boost_max',     "INT NOT NULL DEFAULT 0"),
    ('readiness_rules', 'auto_promote_enabled', "TINYINT(1) NOT NULL DEFAULT 0"),
    ('readiness_rules', 'auto_promote_on',      "CHAR(5) NOT NULL DEFAULT '07-01'"),
    ('score_event_rules', 'segment_stage',      "VARCHAR(255) NULL"),
    ('score_event_rules', 'segment_branch',     "VARCHAR(255) NULL"),
]

STAGE_COLS = ("stage_group, sub_year, education_category, board, stream, degree_category, "
              "degree_type, branch, institute, state")

PROCS = {
'sp_stage_get_active': """
CREATE PROCEDURE `sp_stage_get_active`(IN p_user CHAR(36))
BEGIN
  SELECT * FROM student_stages
   WHERE user_id = p_user AND status = 'active'
   ORDER BY started_at DESC LIMIT 1;
END""",

'sp_stage_open': """
CREATE PROCEDURE `sp_stage_open`(
  IN p_id CHAR(36), IN p_user CHAR(36), IN p_group VARCHAR(20), IN p_sub_year VARCHAR(30),
  IN p_category VARCHAR(30), IN p_board VARCHAR(100), IN p_stream VARCHAR(30),
  IN p_degree_category VARCHAR(60), IN p_degree_type VARCHAR(100), IN p_branch VARCHAR(120),
  IN p_institute VARCHAR(200), IN p_state VARCHAR(100), IN p_started_at DATETIME)
BEGIN
  DECLARE v_start DATETIME;
  -- Only when the student has no active stage: never a second active row.
  IF NOT EXISTS (SELECT 1 FROM student_stages WHERE user_id = p_user AND status = 'active') THEN
    -- A student's FIRST stage starts at account creation, so what they earned
    -- before saving their profile (registration, the first login) still counts.
    -- Only a stage that follows an earlier one starts now.
    SET v_start = p_started_at;
    IF v_start IS NULL AND NOT EXISTS (SELECT 1 FROM student_stages WHERE user_id = p_user) THEN
      SELECT created_at INTO v_start FROM users WHERE id = p_user;
    END IF;
    INSERT INTO student_stages (id, user_id, """ + STAGE_COLS + """, status, started_at)
    VALUES (p_id, p_user, p_group, p_sub_year, p_category, p_board, p_stream,
            p_degree_category, p_degree_type, p_branch, p_institute, p_state,
            'active', IFNULL(v_start, UTC_TIMESTAMP()));
    -- Not the first stage (an odd state: closed stages but none active):
    -- count from its start, like a promotion.
    IF EXISTS (SELECT 1 FROM student_stages WHERE user_id = p_user AND status <> 'active') THEN
      UPDATE student_stages SET counts_from = started_at WHERE id = p_id;
    END IF;
  END IF;
  SELECT * FROM student_stages WHERE user_id = p_user AND status = 'active' LIMIT 1;
END""",

'sp_stage_update_details': """
CREATE PROCEDURE `sp_stage_update_details`(
  IN p_user CHAR(36), IN p_sub_year VARCHAR(30), IN p_category VARCHAR(30),
  IN p_board VARCHAR(100), IN p_stream VARCHAR(30), IN p_degree_category VARCHAR(60),
  IN p_degree_type VARCHAR(100), IN p_branch VARCHAR(120), IN p_institute VARCHAR(200),
  IN p_state VARCHAR(100))
BEGIN
  -- Same stage group (Inter 1st -> 2nd year, branch change, new school): the
  -- details follow the profile, the score does not reset.
  UPDATE student_stages
     SET sub_year = p_sub_year, education_category = p_category, board = p_board,
         stream = p_stream, degree_category = p_degree_category,
         degree_type = p_degree_type, branch = p_branch,
         institute = p_institute, state = p_state
   WHERE user_id = p_user AND status = 'active';
  SELECT * FROM student_stages WHERE user_id = p_user AND status = 'active' LIMIT 1;
END""",

'sp_stage_promote': """
CREATE PROCEDURE `sp_stage_promote`(
  IN p_new_id CHAR(36), IN p_user CHAR(36), IN p_group VARCHAR(20), IN p_sub_year VARCHAR(30),
  IN p_category VARCHAR(30), IN p_board VARCHAR(100), IN p_stream VARCHAR(30),
  IN p_degree_category VARCHAR(60), IN p_degree_type VARCHAR(100), IN p_branch VARCHAR(120),
  IN p_institute VARCHAR(200), IN p_state VARCHAR(100), IN p_actor CHAR(36), IN p_reason VARCHAR(255))
proc: BEGIN
  DECLARE v_old CHAR(36) DEFAULT NULL;
  DECLARE v_score INT DEFAULT 0;
  DECLARE v_level VARCHAR(40) DEFAULT NULL;
  DECLARE v_decay INT DEFAULT 0;
  DECLARE v_cohorts INT DEFAULT 0;
  DECLARE v_tasks INT DEFAULT 0;
  DECLARE v_pct INT DEFAULT 0;
  DECLARE v_max INT DEFAULT 0;
  DECLARE v_boost DECIMAL(5,2) DEFAULT 0;
  DECLARE v_now DATETIME;

  SET v_now = UTC_TIMESTAMP();
  SELECT id INTO v_old FROM student_stages
   WHERE user_id = p_user AND status = 'active' ORDER BY started_at DESC LIMIT 1;

  -- The snapshot reads the cached score; the caller refreshes it first
  -- (sp_score_read) so the closed stage keeps the number the student last saw.
  SELECT IFNULL(score, 0), level, IFNULL(decay_points, 0),
         IFNULL(cohorts_completed, 0), IFNULL(tasks_completed, 0)
    INTO v_score, v_level, v_decay, v_cohorts, v_tasks
    FROM readiness_scores WHERE user_id = p_user LIMIT 1;

  IF v_old IS NOT NULL THEN
    UPDATE student_stages
       SET status = 'closed', ended_at = v_now, final_score = v_score,
           final_level = v_level, final_decay = v_decay,
           cohorts_completed = v_cohorts, tasks_completed = v_tasks,
           closed_by = p_actor, close_reason = p_reason
     WHERE id = v_old;
  END IF;

  INSERT INTO student_stages (id, user_id, """ + STAGE_COLS + """, status, started_at, counts_from)
  VALUES (p_new_id, p_user, p_group, p_sub_year, p_category, p_board, p_stream,
          p_degree_category, p_degree_type, p_branch, p_institute, p_state, 'active', v_now, v_now);

  -- A new season: decay starts fresh. The old stage's decay is in its snapshot
  -- and comes back if the promotion is rolled back.
  UPDATE readiness_scores
     SET decay_points = 0, last_decay_on = NULL, last_seq = NULL
   WHERE user_id = p_user;

  -- Legacy boost: off unless admin set both numbers.
  SELECT IFNULL(legacy_boost_percent, 0), IFNULL(legacy_boost_max, 0) INTO v_pct, v_max
    FROM readiness_rules ORDER BY created_at ASC LIMIT 1;
  IF v_old IS NOT NULL AND v_pct > 0 AND v_max > 0 THEN
    SET v_boost = LEAST(v_max, FLOOR(v_score * v_pct / 100));
    IF v_boost > 0 THEN
      INSERT INTO score_events (id, user_id, event_type, points, ref_id, meta, occurred_at)
      VALUES (UUID(), p_user, 'stage_boost', v_boost, p_new_id,
              CONCAT('legacy boost from previous stage (', v_score, ')'), v_now);
      UPDATE student_stages SET boost_points = v_boost WHERE id = p_new_id;
    END IF;
  END IF;

  SELECT p_new_id AS stage_id, v_old AS closed_stage_id, v_score AS closed_score,
         v_boost AS boost;
END""",

'sp_stage_rollback': """
CREATE PROCEDURE `sp_stage_rollback`(IN p_user CHAR(36), IN p_actor CHAR(36), IN p_reason VARCHAR(255))
proc: BEGIN
  DECLARE v_cur CHAR(36) DEFAULT NULL;
  DECLARE v_prev CHAR(36) DEFAULT NULL;
  DECLARE v_boost DECIMAL(5,2) DEFAULT 0;
  DECLARE v_decay INT DEFAULT 0;

  SELECT id, boost_points INTO v_cur, v_boost FROM student_stages
   WHERE user_id = p_user AND status = 'active' ORDER BY started_at DESC LIMIT 1;
  SELECT id, IFNULL(final_decay, 0) INTO v_prev, v_decay FROM student_stages
   WHERE user_id = p_user AND status = 'closed' ORDER BY ended_at DESC LIMIT 1;

  IF v_cur IS NULL OR v_prev IS NULL THEN
    SELECT 0 AS ok, 'nothing_to_roll_back' AS result;
    LEAVE proc;
  END IF;

  UPDATE student_stages
     SET status = 'rolled_back', ended_at = UTC_TIMESTAMP(),
         closed_by = p_actor, close_reason = p_reason
   WHERE id = v_cur;

  -- The boost was paid for a stage that no longer counts: a negative row, never
  -- a delete -- the ledger stays append-only. Its own ref_id: the ledger is
  -- unique on (user, event_type, ref_id) and the boost row holds the stage id.
  IF IFNULL(v_boost, 0) > 0 THEN
    INSERT INTO score_events (id, user_id, event_type, points, ref_id, meta)
    VALUES (UUID(), p_user, 'stage_boost', -v_boost, CONCAT(v_cur, '-reversed'),
            'legacy boost reversed (stage rolled back)');
  END IF;

  UPDATE student_stages
     SET status = 'active', ended_at = NULL, final_score = NULL, final_level = NULL,
         closed_by = NULL, close_reason = NULL
   WHERE id = v_prev;

  UPDATE readiness_scores SET decay_points = v_decay, last_seq = NULL WHERE user_id = p_user;

  SELECT 1 AS ok, 'rolled_back' AS result, v_prev AS stage_id, v_cur AS rolled_back_stage_id;
END""",

'sp_stage_history': """
CREATE PROCEDURE `sp_stage_history`(IN p_user CHAR(36))
BEGIN
  SELECT * FROM student_stages
   WHERE user_id = p_user AND status IN ('active', 'closed')
   ORDER BY started_at ASC;
END""",

'sp_stage_admin_list': """
CREATE PROCEDURE `sp_stage_admin_list`(
  IN p_search VARCHAR(100), IN p_group VARCHAR(20), IN p_status VARCHAR(12),
  IN p_limit INT, IN p_offset INT)
BEGIN
  -- closed_stages: what sp_stage_rollback needs to have something to undo, so
  -- the admin screen only offers "Undo promotion" where it can work.
  SELECT st.*, u.full_name, u.email,
         (SELECT COUNT(*) FROM student_stages p
           WHERE p.user_id = st.user_id AND p.status = 'closed') AS closed_stages
    FROM student_stages st
    JOIN users u ON u.id = st.user_id
   WHERE (p_group IS NULL OR p_group = '' OR st.stage_group = p_group)
     AND (p_status IS NULL OR p_status = '' OR st.status = p_status)
     AND (p_search IS NULL OR p_search = ''
          OR u.full_name LIKE CONCAT('%', p_search, '%')
          OR u.email LIKE CONCAT('%', p_search, '%'))
   ORDER BY st.started_at DESC
   LIMIT p_limit OFFSET p_offset;
END""",

'sp_stage_admin_count': """
CREATE PROCEDURE `sp_stage_admin_count`(IN p_search VARCHAR(100), IN p_group VARCHAR(20), IN p_status VARCHAR(12))
BEGIN
  SELECT COUNT(*) AS total
    FROM student_stages st
    JOIN users u ON u.id = st.user_id
   WHERE (p_group IS NULL OR p_group = '' OR st.stage_group = p_group)
     AND (p_status IS NULL OR p_status = '' OR st.status = p_status)
     AND (p_search IS NULL OR p_search = ''
          OR u.full_name LIKE CONCAT('%', p_search, '%')
          OR u.email LIKE CONCAT('%', p_search, '%'));
END""",

'sp_stage_settings_get': """
CREATE PROCEDURE `sp_stage_settings_get`()
BEGIN
  SELECT id, IFNULL(legacy_boost_percent, 0) AS legacy_boost_percent,
         IFNULL(legacy_boost_max, 0) AS legacy_boost_max,
         IFNULL(auto_promote_enabled, 0) AS auto_promote_enabled,
         IFNULL(auto_promote_on, '07-01') AS auto_promote_on
    FROM readiness_rules ORDER BY created_at ASC LIMIT 1;
END""",

'sp_stage_settings_set': """
CREATE PROCEDURE `sp_stage_settings_set`(
  IN p_pct INT, IN p_max INT, IN p_auto TINYINT, IN p_on CHAR(5), IN p_admin CHAR(36))
BEGIN
  UPDATE readiness_rules
     SET legacy_boost_percent = GREATEST(0, LEAST(100, IFNULL(p_pct, legacy_boost_percent))),
         legacy_boost_max = GREATEST(0, LEAST(100, IFNULL(p_max, legacy_boost_max))),
         auto_promote_enabled = IFNULL(p_auto, auto_promote_enabled),
         auto_promote_on = IFNULL(p_on, auto_promote_on),
         updated_by = p_admin
   ORDER BY created_at ASC LIMIT 1;
  CALL sp_stage_settings_get();
END""",

'sp_stage_auto_promote_candidates': """
CREATE PROCEDURE `sp_stage_auto_promote_candidates`(IN p_limit INT)
BEGIN
  -- Students whose active stage started before this academic year began.
  -- The Python job decides what each moves to; this only finds them.
  -- Which stages take part is master_stage_group.auto_promote
  -- (migrate_v1_stage_groups.py).
  SELECT st.user_id, st.stage_group, st.sub_year, st.education_category, st.started_at
    FROM student_stages st
    JOIN `master_stage_group` g ON g.value = st.stage_group AND g.auto_promote = 1 AND g.is_active = 1
   WHERE st.status = 'active'
   ORDER BY st.started_at ASC
   LIMIT p_limit;
END""",

'sp_score_recalc': """
CREATE PROCEDURE `sp_score_recalc`(IN p_user CHAR(36))
BEGIN
  DECLARE v_base DECIMAL(7,2) DEFAULT 0;
  DECLARE v_decay INT DEFAULT 0;
  DECLARE v_score INT DEFAULT 0;
  DECLARE v_level VARCHAR(40);
  DECLARE v_cohorts INT DEFAULT 0;
  DECLARE v_tasks INT DEFAULT 0;
  DECLARE v_start DATETIME;

  -- Only the active stage counts (migrate_v1_stages). No stage row = epoch,
  -- which is the old behaviour.
  SET v_start = """ + STAGE_START.format(u='p_user') + """;

  -- Caps were applied at write time, so the ledger simply sums. Switching a
  -- rule off retroactively stops its events counting. Direct credits have no
  -- rule row, hence the LEFT JOIN. Lapsing points stop counting once older
  -- than the rule's expires_days -- the same rule sp_score_recalc_bulk applies.
  SELECT IFNULL(SUM(e.points), 0) INTO v_base
    FROM score_events e
    LEFT JOIN score_event_rules r ON r.event_type = e.event_type
   WHERE e.user_id = p_user
     AND e.occurred_at >= v_start
     AND (e.event_type IN """ + DIRECT_CREDITS + """ OR r.is_active = 1)
     AND (r.expires_days IS NULL OR r.expires_days <= 0
          OR e.occurred_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL r.expires_days DAY));

  SELECT IFNULL(decay_points, 0) INTO v_decay FROM readiness_scores WHERE user_id = p_user;

  SET v_score = GREATEST(0, LEAST(100, FLOOR(v_base - IFNULL(v_decay, 0))));

  SELECT label INTO v_level FROM readiness_levels
   WHERE is_active = 1 AND min_score <= v_score
   ORDER BY min_score DESC LIMIT 1;

  IF v_level IS NULL OR v_level = '' THEN
      SELECT `level` INTO v_level FROM readiness_scores WHERE user_id = p_user;
      SET v_level = IFNULL(v_level, '');
  END IF;

  SELECT COUNT(*) INTO v_cohorts FROM cohort_enrollments
   WHERE user_id = p_user AND payment_status IN ('paid','free') AND created_at >= v_start;
  SELECT COUNT(*) INTO v_tasks FROM task_submissions
   WHERE user_id = p_user AND status = 'approved' AND IFNULL(reviewed_at, created_at) >= v_start;

  INSERT INTO readiness_scores
      (id, user_id, score, level, base_points, cohorts_completed, tasks_completed)
  VALUES (UUID(), p_user, v_score, v_level, v_base, v_cohorts, v_tasks)
  ON DUPLICATE KEY UPDATE
      score = v_score, level = v_level, base_points = v_base,
      cohorts_completed = v_cohorts, tasks_completed = v_tasks;

  SELECT v_score AS score, v_level AS level, v_base AS base_points,
         IFNULL(v_decay, 0) AS decay_points,
         v_cohorts AS cohorts_completed, v_tasks AS tasks_completed;
END""",

'sp_score_recalc_bulk': """
CREATE PROCEDURE `sp_score_recalc_bulk`(IN p_scope VARCHAR(20))
BEGIN
  DROP TEMPORARY TABLE IF EXISTS `tmp_score_rebuild`;
  CREATE TEMPORARY TABLE `tmp_score_rebuild` (
      `user_id` CHAR(36) NOT NULL,
      `stage_start` DATETIME NOT NULL DEFAULT '1970-01-01',
      PRIMARY KEY (`user_id`)
  ) ENGINE=MEMORY;

  IF p_scope = 'touched' THEN
      INSERT IGNORE INTO `tmp_score_rebuild` (`user_id`)
      SELECT `user_id` FROM `tmp_score_touched`;
  ELSE
      INSERT IGNORE INTO `tmp_score_rebuild` (`user_id`)
      SELECT DISTINCT `user_id` FROM `score_events`;
  END IF;

  -- Only the active stage counts (migrate_v1_stages).
  UPDATE `tmp_score_rebuild` t
    JOIN `student_stages` st ON st.`user_id` = t.`user_id` AND st.`status` = 'active'
     SET t.`stage_start` = st.`counts_from`;

  INSERT IGNORE INTO `readiness_scores` (`id`, `user_id`, `score`, `level`, `base_points`)
  SELECT UUID(), t.`user_id`, 0, '', 0
    FROM `tmp_score_rebuild` t
   WHERE NOT EXISTS (SELECT 1 FROM `readiness_scores` r WHERE r.`user_id` = t.`user_id`);

  UPDATE `readiness_scores` rs
    JOIN `tmp_score_rebuild` t ON t.`user_id` = rs.`user_id`
     SET rs.`base_points` = IFNULL((
           SELECT SUM(e.`points`)
             FROM `score_events` e
             LEFT JOIN `score_event_rules` r ON r.`event_type` = e.`event_type`
            WHERE e.`user_id` = rs.`user_id`
              AND e.`occurred_at` >= t.`stage_start`
              AND (e.`event_type` IN """ + DIRECT_CREDITS + """ OR r.`is_active` = 1)
              AND (r.`expires_days` IS NULL OR r.`expires_days` <= 0
                   OR e.`occurred_at` >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL r.`expires_days` DAY))
         ), 0);

  UPDATE `readiness_scores` rs
    JOIN `tmp_score_rebuild` t ON t.`user_id` = rs.`user_id`
     SET rs.`score` = GREATEST(0, LEAST(100, FLOOR(rs.base_points - IFNULL(rs.decay_points, 0)))),
         rs.`level` = IFNULL((
             SELECT l.`label` FROM `readiness_levels` l
              WHERE l.`is_active` = 1 AND l.`min_score` <= GREATEST(0, LEAST(100, FLOOR(rs.base_points - IFNULL(rs.decay_points, 0))))
              ORDER BY l.`min_score` DESC LIMIT 1
         ), rs.`level`);

  UPDATE `readiness_scores` rs
    JOIN `tmp_score_rebuild` t ON t.`user_id` = rs.`user_id`
     SET rs.`cohorts_completed` = (
           SELECT COUNT(*) FROM `cohort_enrollments` ce
            WHERE ce.`user_id` = rs.`user_id`
              AND ce.`payment_status` IN ('paid','free')
              AND ce.`created_at` >= t.`stage_start`),
         rs.`tasks_completed` = (
           SELECT COUNT(*) FROM `task_submissions` ts
            WHERE ts.`user_id` = rs.`user_id` AND ts.`status` = 'approved'
              AND IFNULL(ts.`reviewed_at`, ts.`created_at`) >= t.`stage_start`);

  SELECT COUNT(*) INTO @score_rebuilt FROM `tmp_score_rebuild`;
  DROP TEMPORARY TABLE IF EXISTS `tmp_score_rebuild`;
END""",

'sp_score_breakdown': """
CREATE PROCEDURE `sp_score_breakdown`(IN p_user CHAR(36))
BEGIN
  DECLARE v_start DATETIME;
  SET v_start = """ + STAGE_START.format(u='p_user') + """;

  SELECT r.event_type, r.label, r.points AS points_each,
         r.cap_type, r.cap_value,
         r.metric_key, r.rule_test, r.threshold,
         IFNULL(SUM(e.points), 0) AS earned,
         COUNT(e.id) AS times
    FROM score_event_rules r
    LEFT JOIN score_events e ON e.event_type = r.event_type AND e.user_id = p_user
                            AND e.occurred_at >= v_start
   WHERE r.is_active = 1
   GROUP BY r.event_type, r.label, r.points, r.cap_type, r.cap_value,
            r.metric_key, r.rule_test, r.threshold

  UNION ALL

  SELECT e.event_type,
         CASE e.event_type
           WHEN 'admin_task'       THEN 'Tasks from Skovo'
           WHEN 'admin_adjustment' THEN 'Adjustments by Skovo'
           WHEN 'referral_bonus'   THEN 'Referral rewards'
           WHEN 'stage_boost'      THEN 'Head start from your last stage'
           WHEN 'refund_reversal'  THEN 'Points from refunded purchases'
           ELSE e.event_type END AS label,
         0 AS points_each, 'none' AS cap_type, NULL AS cap_value,
         NULL AS metric_key, NULL AS rule_test, NULL AS threshold,
         SUM(e.points) AS earned, COUNT(*) AS times
    FROM score_events e
   WHERE e.user_id = p_user
     AND e.occurred_at >= v_start
     AND e.event_type IN """ + DIRECT_CREDITS + """
     AND NOT EXISTS (SELECT 1 FROM score_event_rules r2 WHERE r2.event_type = e.event_type)
   GROUP BY e.event_type

   ORDER BY earned DESC, points_each DESC;
END""",
}


def has_column(table, col):
    return db.session.execute(text(
        "SELECT COUNT(*) FROM information_schema.COLUMNS "
        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND COLUMN_NAME = :c"
    ), {'t': table, 'c': col}).scalar() > 0


def seed():
    rows = db.session.execute(text("""
        SELECT u.id AS user_id, u.created_at, p.education_category, p.year_of_study,
               p.board, p.stream, p.degree_category, p.degree_type, p.branch,
               COALESCE(NULLIF(p.college_name, ''), p.school_name) AS institute, p.state
          FROM users u
          JOIN user_profiles p ON p.user_id = u.id
         WHERE u.deleted_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM student_stages s WHERE s.user_id = u.id AND s.status = 'active')
    """)).mappings().all()
    for r in rows:
        group = stage_group(r['education_category'])
        db.session.execute(text(
            "CALL sp_stage_open(:i, :u, :g, :y, :c, :b, :s, :dc, :dt, :br, :ins, :st, :at)"),
            {'i': str(uuid.uuid4()), 'u': r['user_id'], 'g': group,
             'y': sub_year_from(r['year_of_study'], r['education_category']),
             'c': r['education_category'], 'b': r['board'], 's': r['stream'],
             'dc': r['degree_category'], 'dt': r['degree_type'], 'br': r['branch'],
             'ins': r['institute'], 'st': r['state'], 'at': r['created_at']})
    db.session.commit()
    print(f"  stages seeded for {len(rows)} students (started at account creation -- no score moves)")


def main():
    with app.app_context():
        db.session.execute(text(TABLE))
        print("  student_stages ready")
        for table, col, ddl in COLUMNS:
            if not has_column(table, col):
                db.session.execute(text(f"ALTER TABLE `{table}` ADD COLUMN `{col}` {ddl}"))
                print(f"  {table}.{col} added")
        db.session.commit()

        before = dict(db.session.execute(text(
            "SELECT user_id, score FROM readiness_scores")).all())

        for name, ddl in PROCS.items():
            db.session.execute(text(f"DROP PROCEDURE IF EXISTS `{name}`"))
            db.session.execute(text(ddl))
            print(f"  {name}")
        db.session.commit()

        seed()

        # Prove the seed moved nothing: rebuild everyone, compare.
        db.session.execute(text("CALL sp_score_recalc_bulk('all')"))
        db.session.commit()
        after = dict(db.session.execute(text(
            "SELECT user_id, score FROM readiness_scores")).all())
        moved = [(u, before.get(u), s) for u, s in after.items()
                 if u in before and before[u] != s]
        print(f"  scores compared: {len(after)}; changed: {len(moved)}")
        for u, b, a in moved[:10]:
            print(f"    {u}: {b} -> {a}")
        print("Done.")


if __name__ == '__main__':
    main()
