"""The rest of the rule shapes: combo, any-N-of-M, streak, tiered, segment,
campaign window, and points that lapse.

WHAT A RULE CAN SAY AFTER THIS
    each time            0.2 a login                     (already existed)
    when it reaches N    5 colleges -> 3                 (already existed)
    every N              every 10 posts -> 1             (already existed)
    when it starts       Pro -> 20                       (already existed)
    tiered               1st cohort 5, 2nd 3, 3rd 1      NEW
    streak               7 logins in a row -> 2          NEW
    all of these         register + login + cohort -> 5  NEW
    any N of these       any 2 of 4 -> 3                 NEW

    and on any of them:
    segment              only Class 12 / only Karnataka  NEW
    campaign window      1 Oct - 7 Oct only              NEW  (since_at existed)
    points lapse         a marksheet is worth 2 for a year, then nothing   NEW

HOW EACH ONE STAYS IDEMPOTENT
    Everything rests on UNIQUE (user_id, event_type, ref_id). Each shape just
    picks a different ref_id, and that is the whole difference between them:

        each / tiered    'm:1', 'm:2', ...   one per item, by position
        reaches          'm:reach:5'          once, when crossed
        every            'm:every:1', ...     once per multiple
        becomes_active   'm:active'           once, ever
        streak           'm:streak:2026-10-07' once per completed run
        all of / any of  'm:combo'            once, when enough conditions pass

    Re-running any of them writes the same refs and MySQL drops the duplicates.

NO NEGATIVE ROWS, EVER
    "Points lapse after a year" is not a -2 row. It is a WHERE clause: an event
    older than the rule's expires_days stops being counted by sp_score_recalc.
    Same mechanism as switching a rule off. The ledger only ever grows, and
    setting expires_days back to NULL brings the points back.

    That is also why the campaign window and the lapse window are different
    things. until_at stops a rule AWARDING after a date -- points already earned
    during the campaign are kept forever. expires_days stops old events
    COUNTING. A campaign whose points vanished when it ended would be a
    disappointing campaign.

PARTIAL PAYS NOTHING
    A combo with 2 of 3 conditions met awards 0, not two thirds. The student
    sees "2 of 3 - 5 points waiting" instead, from sp_score_rule_progress.

Idempotent. From SKOVO_BACKEND:
    python database/migrations/migrate_score_rule_shapes.py
"""
from sqlalchemy import text

import _bootstrap  # noqa: F401
from portal import InitApp
from portal.models import db

app = InitApp().app()

# Mirrors SOURCES in migrate_score_metric_rules. Duplicated deliberately and
# asserted against at the end of this file: the streak snapshot needs the same
# tables, and importing across migrations couples their run order.
SOURCES = {
    'account_created':        ('id',          'users',                    "deleted_at IS NULL",                'created_at'),
    'daily_login':            ('user_id',     'sessions',                 "1 = 1",                             'created_at'),
    'cohorts_enrolled':       ('user_id',     'cohort_enrollments',       "payment_status IN ('paid','free')", 'created_at'),
    'cohorts_attended':       ('user_id',     'cohort_enrollments',       "attended = 1",                      'created_at'),
    # ^ Attendance is a COLUMN on cohort_enrollments, not a table. This
    # pointed at `cohort_attendance`, which has never existed, so any rule
    # on "Cohorts attended" threw at sweep time instead of scoring.
    'cohort_tasks_approved':  ('user_id',     'task_submissions',         "status = 'approved'",               'created_at'),
    'pro_subscription':       ('user_id',     'subscriptions',            "status = 'active'",                 'created_at'),
    'sessions_completed':     ('student_id',  'achiever_sessions',        "status = 'completed' AND is_demo = 0", 'created_at'),
    'documents_uploaded':     ('user_id',     'document_vault',           "is_active = 1",                     'created_at'),
    'communities_joined':     ('user_id',     'group_memberships',        "status = 'active'",                 'joined_at'),
    'community_posts':        ('user_id',     'group_posts',              "1 = 1",                             'created_at'),
    'colleges_saved':         ('user_id',     'saved_colleges',           "1 = 1",                             'created_at'),
    'applications_submitted': ('user_id',     'opportunity_applications', "1 = 1",                             'applied_at'),
    'referrals_completed':    ('referrer_id', 'referrals',                "status = 'completed'",              'completed_at'),
    'reviews_written':        ('user_id',     'achiever_reviews',         "is_active = 1",                     'created_at'),
    'skills_added':           ('user_id',     'user_skills',              "1 = 1",                             'created_at'),
    'college_applications':   ('user_id',     'college_applications',     "1 = 1",                             'created_at'),
    'college_reviews':        ('user_id',     'college_reviews',          "is_active = 1",                     'created_at'),
    'courses_joined':         ('user_id',     'course_enrollments',       "1 = 1",                             'created_at'),
    'course_lessons_done':    ('user_id',     'course_progress',          "completed_at IS NOT NULL",          'completed_at'),
    'forum_posts':            ('user_id',     'forum_posts',              "is_active = 1",                     'created_at'),
    'forum_replies':          ('user_id',     'forum_replies',            "is_active = 1",                     'created_at'),
    'opportunities_saved':    ('user_id',     'opportunity_shortlist',    "1 = 1",                             'created_at'),
    'resumes_built':          ('user_id',     'resumes',                  "is_active = 1",                     'created_at'),
    'sops_written':           ('user_id',     'sop_documents',            "1 = 1",                             'created_at'),
    'scholarships_tracked':   ('user_id',     'scholarship_tracking',     "1 = 1",                             'created_at'),
    'mock_tests_taken':       ('user_id',     'test_attempts',            "completed_at IS NOT NULL",          'completed_at'),
    'certifications_added':   ('user_id',     'user_certifications',      "1 = 1",                             'created_at'),
    'badges_earned':          ('user_id',     'user_badges',              "1 = 1",                             'earned_at'),
    'assessment_done':        ('user_id',     'readiness_assessments',    "is_complete = 1",                   'created_at'),
    'bhaai_used':             ('user_id',     'bhaai_usage',              "1 = 1",                             'created_at'),
    'market_deals_used':      ('user_id',     'market_deal_clicks',       "1 = 1",                             'created_at'),
    'coupons_redeemed':       ('user_id',     'coupon_redemptions',       "1 = 1",                             'created_at'),
    'public_profile':         ('user_id',     'public_profiles',          "1 = 1",                             'created_at'),
    'goals_set':              ('user_id',     'student_goals',            "1 = 1",                             'created_at'),
    # v1 Common sheet C51 / C70 (SKOVO-readiness-streak-tasks-v1.xlsx).
    'community_created':      ('created_by',  'groups',                   "deleted_at IS NULL",                'created_at'),
    # No 'shortlisted' applicant stage exists; a recruiter shortlisting moves
    # the application to interviewing (or straight to offered).
    'opportunity_shortlisted': ('user_id',    'opportunity_applications', "status IN ('interviewing','offered')", 'status_updated_at'),
    # v1 Common sheet, group A (17 Oct 2026). The v_score_* names are views
    # created by migrate_score_sources_v1_extra.py, for counts a single
    # table cannot express (distinct per mock, course fully done, a friend's
    # paid plan).
    'onboarding_done':        ('user_id',     'user_profiles',            "education_category IS NOT NULL AND education_category <> '' AND city IS NOT NULL AND city <> ''", 'created_at'),
    'parent_consent':         ('user_id',     'parental_consents',        "status = 'confirmed'",              'confirmed_at'),
    'mock_tests_passed':      ('user_id',     'v_score_mock_passed',      "1 = 1",                             'completed_at'),
    'courses_completed':      ('user_id',     'v_score_course_completed', "1 = 1",                             'completed_at'),
    'predictor_used':         ('user_id',     'college_predictor_usage',  "1 = 1",                             'created_at'),
    'pro_monthly_paid':       ('user_id',     'subscriptions',            "plan = 'monthly' AND status IN ('active','expired')", 'started_at'),
    'cohorts_paid':           ('user_id',     'cohort_enrollments',       "payment_status = 'paid'",           'created_at'),
    'referrals_bought_pro':   ('referrer_id', 'v_score_referral_pro',     "1 = 1",                             'started_at'),
}

RULE_COLUMNS = [
    # 'simple' keeps every existing rule behaving exactly as it does today.
    ('shape',             "VARCHAR(12) NOT NULL DEFAULT 'simple'"),
    # any_of only: how many of the conditions have to pass. all_of ignores it.
    ('require_count',     "INT NULL"),
    # tiered only: '5,3,1' -- 1st is worth 5, 2nd 3, 3rd and after 1.
    ('tier_points',       "VARCHAR(120) NULL"),
    # streak only: how many consecutive days make a run.
    ('streak_days',       "INT NULL"),
    # campaign window. since_at already exists and is the opening date.
    ('until_at',          "DATETIME NULL"),
    # points from this rule stop counting once they are this many days old.
    ('expires_days',      "INT NULL"),
    # segment. NULL means everyone.
    ('segment_education', "VARCHAR(50) NULL"),
    ('segment_degree',    "VARCHAR(60) NULL"),
    ('segment_state',     "VARCHAR(60) NULL"),
]

CONDITIONS_DDL = """
CREATE TABLE IF NOT EXISTS `score_rule_conditions` (
  `id`            CHAR(36)    NOT NULL,
  `rule_key`      VARCHAR(50) NOT NULL,
  `metric_key`    VARCHAR(40) NOT NULL,
  `metric_filter` VARCHAR(40) NULL,
  -- A condition passes when its measured value reaches `threshold`. One test
  -- for every condition, deliberately: "did they do it" and "did they do it N
  -- times" are the same question with a different N, and a condition that
  -- could also say `every` would make the combo's meaning ambiguous.
  `threshold`     INT         NOT NULL DEFAULT 1,
  `label`         VARCHAR(120) NULL,
  `sort_order`    INT         NOT NULL DEFAULT 0,
  `created_at`    DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_rule_condition` (`rule_key`, `metric_key`, `metric_filter`),
  KEY `idx_rule_conditions_rule` (`rule_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
"""


def streak_branches():
    """One gaps-and-islands branch per metric.

    A "run" is a set of consecutive calendar dates on which the student did the
    thing. Subtracting a row number from the date gives every date in a run the
    same value, so grouping on it counts the runs -- the standard trick, and one
    pass rather than a cursor per student.
    """
    out = []
    for i, (key, (ucol, table, where, tscol)) in enumerate(SOURCES.items()):
        kw = 'IF' if i == 0 else 'ELSEIF'
        out.append(f"""    {kw} p_metric = '{key}' THEN
        INSERT INTO `tmp_score_streak` (`user_id`, `ref`)
        WITH d AS (
            SELECT DISTINCT `{ucol}` AS uid, DATE(`{tscol}`) AS dt
              FROM `{table}`
             WHERE {where}
               AND `{ucol}` IS NOT NULL
               AND `{tscol}` IS NOT NULL
               AND EXISTS (SELECT 1 FROM `users` su WHERE su.`id` = `{ucol}`)
               AND (p_user IS NULL OR `{ucol}` = p_user)
        ), g AS (
            SELECT uid, dt,
                   DATE_SUB(dt, INTERVAL ROW_NUMBER() OVER (
                       PARTITION BY uid ORDER BY dt) DAY) AS grp
              FROM d
        )
        SELECT uid, CONCAT('m:streak:', MAX(dt))
          FROM g
         GROUP BY uid, grp
        HAVING COUNT(*) >= p_days;""")
    return "\n".join(out)


STREAK = """
CREATE PROCEDURE `sp_score_streak_snapshot`(
    IN p_metric VARCHAR(40),
    IN p_days   INT,
    IN p_user   CHAR(36)
)
BEGIN
  DROP TEMPORARY TABLE IF EXISTS `tmp_score_streak`;
  CREATE TEMPORARY TABLE `tmp_score_streak` (
      `user_id` CHAR(36)    NOT NULL,
      `ref`     VARCHAR(64) NOT NULL,
      PRIMARY KEY (`user_id`, `ref`)
  ) ENGINE=MEMORY;

  IF IFNULL(p_days, 0) < 2 THEN
      SET p_days = 2;     -- a "run" of one day is just `each`
  END IF;

__BRANCHES__
  END IF;
END
"""

# ── tiered ───────────────────────────────────────────────────────────────────
TIER = """
CREATE PROCEDURE `sp_score_tier_apply`(
    IN p_key    VARCHAR(50),
    IN p_tiers  VARCHAR(120),
    IN p_cap    INT
)
BEGIN
  DECLARE v_n INT DEFAULT 0;
  -- How many tiers were given. Positions past the end are worth the last one,
  -- so '5,3,1' means the fourth cohort is also worth 1. End the list with 0 to
  -- stop paying instead.
  SET v_n = CHAR_LENGTH(p_tiers) - CHAR_LENGTH(REPLACE(p_tiers, ',', '')) + 1;

  INSERT IGNORE INTO `score_events` (`id`, `user_id`, `event_type`, `points`, `ref_id`, `meta`)
  WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 500)
  SELECT UUID(), t.`user_id`, p_key,
         CAST(TRIM(SUBSTRING_INDEX(SUBSTRING_INDEX(p_tiers, ',', LEAST(n.i, v_n)), ',', -1))
              AS DECIMAL(5,2)),
         CONCAT('m:', n.i), 'tiered rule'
    FROM `tmp_score_metric` t
    JOIN n ON n.i <= LEAST(t.`val`, IFNULL(NULLIF(p_cap, 0), t.`val`))
   WHERE t.`val` > 0;

  SET @score_rule_awarded = ROW_COUNT();
END
"""

STREAK_APPLY = """
CREATE PROCEDURE `sp_score_streak_apply`(
    IN p_key    VARCHAR(50),
    IN p_points DECIMAL(5,2),
    IN p_cap    INT
)
BEGIN
  -- One award per completed run. ref_id is the run's last day, so a run that
  -- grows tomorrow is a NEW ref and pays again -- which is why p_cap matters
  -- on a streak rule more than on most.
  INSERT IGNORE INTO `score_events` (`id`, `user_id`, `event_type`, `points`, `ref_id`, `meta`)
  SELECT UUID(), s.`user_id`, p_key, p_points, s.`ref`, 'streak rule'
    FROM `tmp_score_streak` s
   WHERE IFNULL(NULLIF(p_cap, 0), 999999) > (
           SELECT COUNT(*) FROM `score_events` e
            WHERE e.`user_id` = s.`user_id` AND e.`event_type` = p_key);

  SET @score_rule_awarded = ROW_COUNT();
END
"""


SEGMENT = """
CREATE PROCEDURE `sp_score_segment_filter`(
    IN p_education VARCHAR(50),
    IN p_degree    VARCHAR(60),
    IN p_state     VARCHAR(60)
)
BEGIN
  -- Applied to whatever sp_score_metric_snapshot just produced. NULL or empty
  -- means "no restriction", so an unsegmented rule costs one no-op DELETE.
  IF (p_education IS NOT NULL AND p_education <> '')
     OR (p_degree IS NOT NULL AND p_degree <> '')
     OR (p_state IS NOT NULL AND p_state <> '') THEN
      DELETE t FROM `tmp_score_metric` t
       WHERE NOT EXISTS (
             SELECT 1 FROM `user_profiles` up
              WHERE up.`user_id` = t.`user_id`
                AND (p_education IS NULL OR p_education = ''
                     OR up.`education_category` = p_education)
                AND (p_degree IS NULL OR p_degree = ''
                     OR up.`degree_type` = p_degree)
                AND (p_state IS NULL OR p_state = ''
                     OR up.`state` = p_state));
  END IF;
END
"""

# ── all of / any N of ────────────────────────────────────────────────────────
COMBO = """
CREATE PROCEDURE `sp_score_combo_apply`(
    IN p_key     VARCHAR(50),
    IN p_points  DECIMAL(5,2),
    IN p_shape   VARCHAR(12),
    IN p_require INT,
    IN p_since   DATETIME,
    IN p_user    CHAR(36),
    IN p_education VARCHAR(50),
    IN p_degree    VARCHAR(60),
    IN p_state     VARCHAR(60)
)
BEGIN
  DECLARE v_done   INT DEFAULT 0;
  DECLARE v_metric VARCHAR(40);
  DECLARE v_filter VARCHAR(40);
  DECLARE v_thresh INT;
  DECLARE v_total  INT DEFAULT 0;
  DECLARE v_need   INT DEFAULT 0;

  DECLARE cur CURSOR FOR
      SELECT `metric_key`, `metric_filter`, `threshold`
        FROM `score_rule_conditions`
       WHERE `rule_key` = p_key
       ORDER BY `sort_order`, `created_at`;
  DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_done = 1;

  SELECT COUNT(*) INTO v_total
    FROM `score_rule_conditions` WHERE `rule_key` = p_key;
  IF v_total = 0 THEN
      SET @score_rule_awarded = 0;
  ELSE
      -- all_of needs every condition; any_of needs the configured number,
      -- clamped so a bad value can never make the rule unpayable or free.
      SET v_need = IF(p_shape = 'any_of',
                      LEAST(GREATEST(IFNULL(p_require, 1), 1), v_total),
                      v_total);

      DROP TEMPORARY TABLE IF EXISTS `tmp_score_cond`;
      CREATE TEMPORARY TABLE `tmp_score_cond` (
          `user_id` CHAR(36) NOT NULL,
          `metric`  VARCHAR(40) NOT NULL,
          PRIMARY KEY (`user_id`, `metric`)
      ) ENGINE=MEMORY;

      OPEN cur;
      cond_loop: LOOP
          FETCH cur INTO v_metric, v_filter, v_thresh;
          IF v_done = 1 THEN LEAVE cond_loop; END IF;

          CALL sp_score_metric_snapshot(v_metric, v_filter, p_since, p_user);
          CALL sp_score_segment_filter(p_education, p_degree, p_state);

          INSERT IGNORE INTO `tmp_score_cond` (`user_id`, `metric`)
          SELECT `user_id`, v_metric FROM `tmp_score_metric`
           WHERE `val` >= GREATEST(IFNULL(v_thresh, 1), 1);
      END LOOP;
      CLOSE cur;

      -- Partial pays nothing: the HAVING is the whole rule.
      INSERT IGNORE INTO `score_events` (`id`, `user_id`, `event_type`, `points`, `ref_id`, `meta`)
      SELECT UUID(), c.`user_id`, p_key, p_points, 'm:combo', 'combo rule'
        FROM `tmp_score_cond` c
       GROUP BY c.`user_id`
      HAVING COUNT(*) >= v_need;

      SET @score_rule_awarded = ROW_COUNT();
      DROP TEMPORARY TABLE IF EXISTS `tmp_score_cond`;
  END IF;
END
"""

# ── what the student sees while a combo is incomplete ────────────────────────
PROGRESS = """
CREATE PROCEDURE `sp_score_rule_progress`(IN p_user CHAR(36))
BEGIN
  DECLARE v_done   INT DEFAULT 0;
  DECLARE v_key    VARCHAR(50);
  DECLARE v_shape  VARCHAR(12);
  DECLARE v_req    INT;
  DECLARE v_metric VARCHAR(40);
  DECLARE v_filter VARCHAR(40);
  DECLARE v_thresh INT;
  DECLARE v_label  VARCHAR(120);
  DECLARE v_since  DATETIME;

  DECLARE cur CURSOR FOR
      SELECT r.`event_type`, r.`shape`, r.`require_count`, r.`since_at`,
             c.`metric_key`, c.`metric_filter`, c.`threshold`,
             IFNULL(c.`label`, m.`label`)
        FROM `score_event_rules` r
        JOIN `score_rule_conditions` c ON c.`rule_key` = r.`event_type`
        LEFT JOIN `score_metrics` m ON m.`value` = c.`metric_key`
       WHERE r.`is_active` = 1 AND r.`shape` IN ('all_of', 'any_of')
       ORDER BY r.`event_type`, c.`sort_order`;
  DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_done = 1;

  DROP TEMPORARY TABLE IF EXISTS `tmp_score_progress`;
  CREATE TEMPORARY TABLE `tmp_score_progress` (
      `rule_key` VARCHAR(50)  NOT NULL,
      `label`    VARCHAR(120) NULL,
      `done`     TINYINT(1)   NOT NULL,
      `sort`     INT          NOT NULL AUTO_INCREMENT,
      PRIMARY KEY (`sort`)
  ) ENGINE=MEMORY;

  OPEN cur;
  p_loop: LOOP
      FETCH cur INTO v_key, v_shape, v_req, v_since, v_metric, v_filter, v_thresh, v_label;
      IF v_done = 1 THEN LEAVE p_loop; END IF;

      CALL sp_score_metric_snapshot(v_metric, v_filter, v_since, p_user);

      INSERT INTO `tmp_score_progress` (`rule_key`, `label`, `done`)
      SELECT v_key, v_label,
             IF(IFNULL((SELECT `val` FROM `tmp_score_metric` WHERE `user_id` = p_user), 0)
                >= GREATEST(IFNULL(v_thresh, 1), 1), 1, 0);
  END LOOP;
  CLOSE cur;

  SELECT p.`rule_key`, r.`label` AS rule_label, r.`points`, r.`shape`,
         IFNULL(r.`require_count`, COUNT(*)) AS need,
         COUNT(*) AS total,
         SUM(p.`done`) AS done,
         -- Already paid? Then this is history, not a goal.
         EXISTS (SELECT 1 FROM `score_events` e
                  WHERE e.`user_id` = p_user AND e.`event_type` = p.`rule_key`
                    AND e.`ref_id` = 'm:combo') AS earned,
         GROUP_CONCAT(CONCAT(IF(p.`done`, '1', '0'), ':', IFNULL(p.`label`, ''))
                      ORDER BY p.`sort` SEPARATOR '|') AS steps
    FROM `tmp_score_progress` p
    JOIN `score_event_rules` r ON r.`event_type` = p.`rule_key`
   GROUP BY p.`rule_key`, r.`label`, r.`points`, r.`shape`, r.`require_count`;

  DROP TEMPORARY TABLE IF EXISTS `tmp_score_progress`;
END
"""


# ── writing a rule's shape, without widening an existing signature ───────────
SHAPE_SET = """
CREATE PROCEDURE `sp_score_rule_shape_set`(
    IN p_key       VARCHAR(50),
    IN p_label     VARCHAR(160),
    IN p_points    DECIMAL(5,2),
    IN p_shape     VARCHAR(12),
    IN p_require   INT,
    IN p_tiers     VARCHAR(120),
    IN p_streak    INT,
    IN p_test      VARCHAR(16),
    IN p_cap_type  VARCHAR(12),
    IN p_cap_value INT,
    IN p_since     DATETIME,
    IN p_until     DATETIME,
    IN p_expires   INT,
    IN p_edu       VARCHAR(50),
    IN p_degree    VARCHAR(60),
    IN p_state     VARCHAR(60),
    IN p_active    TINYINT
)
BEGIN
  -- Separate from sp_score_metric_rule_upsert rather than seventeen more
  -- parameters on it: that procedure is called by code already deployed, and
  -- widening it would break every one of those callers the moment this ran.
  --
  -- A combo carries no metric_key of its own -- its conditions hold them --
  -- which is why this can create a rule the metric upsert cannot.
  INSERT INTO `score_event_rules`
      (`event_type`, `label`, `points`, `is_active`, `rule_test`, `cap_type`,
       `cap_value`, `since_at`, `until_at`, `shape`, `require_count`,
       `tier_points`, `streak_days`, `expires_days`,
       `segment_education`, `segment_degree`, `segment_state`)
  VALUES (p_key, p_label, IFNULL(p_points, 0), IFNULL(p_active, 1),
          IFNULL(p_test, 'each'), IFNULL(p_cap_type, 'none'), p_cap_value,
          p_since, p_until, IFNULL(p_shape, 'simple'), p_require,
          p_tiers, p_streak, p_expires, p_edu, p_degree, p_state)
  ON DUPLICATE KEY UPDATE
      `label` = VALUES(`label`), `points` = VALUES(`points`),
      `is_active` = VALUES(`is_active`), `rule_test` = VALUES(`rule_test`),
      `cap_type` = VALUES(`cap_type`), `cap_value` = VALUES(`cap_value`),
      `until_at` = VALUES(`until_at`), `shape` = VALUES(`shape`),
      `require_count` = VALUES(`require_count`), `tier_points` = VALUES(`tier_points`),
      `streak_days` = VALUES(`streak_days`), `expires_days` = VALUES(`expires_days`),
      `segment_education` = VALUES(`segment_education`),
      `segment_degree` = VALUES(`segment_degree`),
      `segment_state` = VALUES(`segment_state`),
      -- since_at is never overwritten on edit. Re-saving a rule must not
      -- silently turn it into a backfill and pay every existing student.
      `since_at` = `since_at`;

  SELECT * FROM `score_event_rules` WHERE `event_type` = p_key;
END
"""

COND_SET = """
CREATE PROCEDURE `sp_score_rule_conditions_set`(
    IN p_key  VARCHAR(50),
    IN p_spec TEXT
)
BEGIN
  -- p_spec is 'metric:filter:threshold|metric::threshold|...'. A small format
  -- rather than JSON because the whole list is rewritten every save, so there
  -- is nothing to merge and nothing to name.
  DECLARE v_rest  TEXT;
  DECLARE v_one   VARCHAR(200);
  DECLARE v_i     INT DEFAULT 0;

  DELETE FROM `score_rule_conditions` WHERE `rule_key` = p_key;

  SET v_rest = IFNULL(p_spec, '');
  WHILE CHAR_LENGTH(v_rest) > 0 DO
      SET v_one = SUBSTRING_INDEX(v_rest, '|', 1);
      SET v_rest = IF(LOCATE('|', v_rest) > 0,
                      SUBSTRING(v_rest, LOCATE('|', v_rest) + 1), '');
      IF TRIM(v_one) <> '' THEN
          INSERT IGNORE INTO `score_rule_conditions`
                 (`id`, `rule_key`, `metric_key`, `metric_filter`, `threshold`, `sort_order`)
          VALUES (UUID(), p_key,
                  SUBSTRING_INDEX(v_one, ':', 1),
                  NULLIF(SUBSTRING_INDEX(SUBSTRING_INDEX(v_one, ':', 2), ':', -1), ''),
                  GREATEST(1, IFNULL(NULLIF(SUBSTRING_INDEX(v_one, ':', -1), ''), 1)),
                  v_i);
          SET v_i = v_i + 1;
      END IF;
  END WHILE;

  SELECT COUNT(*) AS conditions FROM `score_rule_conditions` WHERE `rule_key` = p_key;
END
"""

COND_LIST = """
CREATE PROCEDURE `sp_score_rule_conditions_list`(IN p_key VARCHAR(50))
BEGIN
  SELECT c.`id`, c.`rule_key`, c.`metric_key`, c.`metric_filter`, c.`threshold`,
         c.`sort_order`, IFNULL(c.`label`, m.`label`) AS label
    FROM `score_rule_conditions` c
    LEFT JOIN `score_metrics` m ON m.`value` = c.`metric_key`
   WHERE (p_key IS NULL OR p_key = '' OR c.`rule_key` = p_key)
   ORDER BY c.`rule_key`, c.`sort_order`;
END
"""


def has_column(table, col):
    return db.session.execute(text(
        "SELECT COUNT(*) FROM information_schema.COLUMNS "
        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND COLUMN_NAME = :c"
    ), {'t': table, 'c': col}).scalar() > 0


def main():
    with app.app_context():
        for col, ddl in RULE_COLUMNS:
            if has_column('score_event_rules', col):
                print(f"  score_event_rules.{col} already there")
                continue
            db.session.execute(text(
                f"ALTER TABLE `score_event_rules` ADD COLUMN `{col}` {ddl}"))
            print(f"  score_event_rules.{col} added")

        db.session.execute(text(CONDITIONS_DDL))
        db.session.commit()
        print("  score_rule_conditions ready")

        # The streak snapshot reads the same tables as the metric snapshot. If
        # a metric is added there and not here, streaks would silently not work
        # for it -- so fail loudly instead.
        live = db.session.execute(text(
            "SELECT value FROM score_metrics WHERE is_active = 1")).scalars().all()
        missing = sorted(set(live) - set(SOURCES))
        if missing:
            raise SystemExit(
                f"  These metrics have no streak source: {missing}\n"
                f"  Add them to SOURCES in this file as well as in "
                f"migrate_score_metric_rules.py.")
        print(f"  streak sources cover all {len(live)} live metrics")

        procs = [
            ('sp_score_segment_filter',  SEGMENT),
            ('sp_score_streak_snapshot', STREAK.replace('__BRANCHES__', streak_branches())),
            ('sp_score_streak_apply',    STREAK_APPLY),
            ('sp_score_tier_apply',      TIER),
            ('sp_score_combo_apply',     COMBO),
            ('sp_score_rule_progress',   PROGRESS),
            ('sp_score_rule_shape_set',  SHAPE_SET),
            ('sp_score_rule_conditions_set',  COND_SET),
            ('sp_score_rule_conditions_list', COND_LIST),
        ]
        for name, body in procs:
            db.session.execute(text(f"DROP PROCEDURE IF EXISTS `{name}`"))
            db.session.execute(text(body.strip()))
            print(f"  created {name}")
        db.session.commit()
        print("Done.")


if __name__ == '__main__':
    main()
