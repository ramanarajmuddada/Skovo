"""Scoring actions become rules over recorded facts, instead of fixed event keys.

WHY
    An action used to be `event_type + points`, and the key had to match a
    hardcoded award() call somewhere in the product. There were 15 of them. So
    "Pro annual is worth 20 points" was not a settings change, it was a code
    change -- and an admin who typed a key nothing fires got a row that looked
    wired and silently never paid.

    That is the wrong shape for a platform where every reward is for something
    the student did ON the platform. Those facts are already in the database;
    the rule just has to be allowed to point at them.

WHAT A RULE IS NOW
        WHEN  <metric>  [filter]  <test>  [value]   ->  points, cap

        Pro subscription   plan=annual    becomes active  -> +20  once
        1-on-1 sessions    completed      reaches 20      ->  +5  once
        Cohorts attended   --             each            ->  +2  cap 10

    `metric` is a row in `score_metrics`, which is registered as a master, so
    the dropdown gets the same DB search every other master-backed select has.
    The SQL behind each metric lives in sp_score_metric_snapshot as a whitelist
    -- an admin picks a metric, never supplies a query.

THE OLD ROWS STILL WORK
    score_event_rules is EXTENDED, not replaced. A row with metric_key NULL is
    a classic code-fired rule and behaves exactly as before, so the 135 events
    already in the ledger keep counting. Both kinds live in one list.

NOT BACKFILLED BY DEFAULT
    `since_at` is stamped with the creation time unless the admin explicitly
    asks to apply a rule to existing history. 403 students already have cohorts
    and documents and subscriptions sitting in those tables; a rule saved
    without thinking must not move all of them at once.

IDEMPOTENT AWARDS
    score_events already has UNIQUE (user_id, event_type, ref_id). Every award
    here carries a deterministic ref -- 'm:7', 'm:reach:20', 'm:active' -- so
    INSERT IGNORE makes a re-run a no-op. The nightly sweep can be run twice,
    or resumed after a crash, without paying anyone twice.

Idempotent. From SKOVO_BACKEND:
    python database/migrations/migrate_score_metric_rules.py
"""
from sqlalchemy import text

import _bootstrap  # noqa: F401
from portal import InitApp
from portal.models import db

app = InitApp().app()

# ── The catalogue ────────────────────────────────────────────────────────────
# value, label, description, filter_key, filter_label, filter_values, tests
METRICS = [
    ('cohorts_enrolled', 'Cohorts enrolled', 'Cohorts the student has joined (paid or free).',
     None, None, None, 'each,reaches,every', 10),
    ('cohorts_attended', 'Cohorts attended', 'Cohorts the student actually turned up to.',
     None, None, None, 'each,reaches,every', 20),
    ('cohort_tasks_approved', 'Cohort tasks approved', 'Task submissions a mentor approved.',
     None, None, None, 'each,reaches,every', 30),
    ('pro_subscription', 'Pro subscription', 'An active Skovo Pro plan.',
     'plan', 'Plan', 'monthly,quarterly,annual', 'becomes_active,each', 40),
    ('sessions_completed', '1-on-1 sessions completed', 'Paid mentor sessions finished. Demos excluded.',
     None, None, None, 'each,reaches,every', 50),
    # The category filter is what makes "Marksheet only" sayable. Without it a
    # rule worth 2 points per document pays the same for an Aadhaar scan.
    # The values come from master_document_category, which an admin already
    # edits, so they are filled in at run time rather than frozen here.
    ('documents_uploaded', 'Documents uploaded', 'Files in the document vault.',
     'category', 'Document type', None, 'each,reaches,every', 60),
    ('communities_joined', 'Communities joined', 'Groups the student is an active member of.',
     None, None, None, 'each,reaches,every', 70),
    ('community_posts', 'Community posts', 'Posts written in any group.',
     None, None, None, 'each,reaches,every', 80),
    ('colleges_saved', 'Colleges saved', 'Colleges added to the shortlist.',
     None, None, None, 'each,reaches,every', 90),
    ('applications_submitted', 'Opportunity applications', 'Applications sent from the Hub.',
     None, None, None, 'each,reaches,every', 100),
    ('referrals_completed', 'Referrals completed', 'Friends who signed up and finished onboarding.',
     None, None, None, 'each,reaches,every', 110),
    ('reviews_written', 'Reviews written', 'Reviews the student left for an achiever.',
     None, None, None, 'each,reaches,every', 120),
    ('skills_added', 'Skills added', 'Skills listed on the profile.',
     None, None, None, 'each,reaches', 130),
    ('account_created', 'Account created', 'The student registered. Once, ever.',
     None, None, None, 'becomes_active', 5),
    # One per calendar day, however many times they open the app -- the count is
    # DISTINCT days, see DISTINCT_DAYS below. A quarter point a day is about 91
    # points a year; anything larger pins every active student at 100 inside a
    # month and the score stops telling you anything.
    ('daily_login', 'Logged in on a day', 'Days the student signed in. One per day.',
     None, None, None, 'each,reaches,every', 7),
    ('college_applications', 'College applications', 'Applications sent to a college.',
     None, None, None, 'each,reaches,every', 105),
    ('college_reviews', 'College reviews written', 'Reviews the student left for a college.',
     None, None, None, 'each,reaches,every', 125),
    ('courses_joined', 'Courses joined', 'Courses the student enrolled in.',
     None, None, None, 'each,reaches,every', 145),
    ('course_lessons_done', 'Course lessons finished', 'Lessons marked complete.',
     None, None, None, 'each,reaches,every', 150),
    ('forum_posts', 'Forum posts', 'Questions and answers posted in the forum.',
     None, None, None, 'each,reaches,every', 155),
    ('forum_replies', 'Forum replies', 'Replies written to other students.',
     None, None, None, 'each,reaches,every', 160),
    ('opportunities_saved', 'Opportunities shortlisted', 'Opportunities saved from the Hub.',
     None, None, None, 'each,reaches,every', 165),
    ('resumes_built', 'Resumes built', 'Resumes created in the builder.',
     None, None, None, 'each,reaches', 170),
    ('sops_written', 'SOPs written', 'Statements of purpose drafted.',
     None, None, None, 'each,reaches', 175),
    ('scholarships_tracked', 'Scholarships tracked', 'Scholarships added to the tracker.',
     None, None, None, 'each,reaches,every', 180),
    ('mock_tests_taken', 'Mock tests finished', 'Practice tests completed.',
     None, None, None, 'each,reaches,every', 185),
    ('certifications_added', 'Certifications added', 'Certificates listed on the profile.',
     None, None, None, 'each,reaches,every', 190),
    ('badges_earned', 'Badges earned', 'Badges the platform awarded.',
     None, None, None, 'each,reaches,every', 195),
    ('assessment_done', 'Readiness assessment finished', 'The guided assessment, completed.',
     None, None, None, 'becomes_active,reaches', 200),
    ('bhaai_used', 'BhaAI used', 'Conversations with the AI guide.',
     None, None, None, 'each,reaches,every', 205),
    ('market_deals_used', 'Market deals used', 'Student deals opened from the Market.',
     None, None, None, 'each,reaches,every', 210),
    ('coupons_redeemed', 'Coupons redeemed', 'Coupons the student redeemed.',
     None, None, None, 'each,reaches,every', 215),
    ('public_profile', 'Public profile published', 'A shareable profile page exists.',
     None, None, None, 'becomes_active', 220),
    ('goals_set', 'Career goals set', 'Target exams, courses or colleges saved.',
     None, None, None, 'becomes_active,reaches', 140),
    ('community_created', 'Communities created', 'Groups the student started.',
     None, None, None, 'each,reaches,every', 300),
    ('opportunity_shortlisted', 'Shortlisted for an opportunity', 'Applications a recruiter moved to interviewing or offered.',
     None, None, None, 'each,reaches,every', 310),
]

# ── Where each metric counts from ────────────────────────────────────────────
# (user column, table, extra WHERE, timestamp column). This is the whitelist:
# an admin picks a key, the SQL is ours.
SOURCES = {
    'cohorts_enrolled':       ('user_id',     'cohort_enrollments',       "payment_status IN ('paid','free')", 'created_at'),
    'cohorts_attended':       ('user_id',     'cohort_enrollments',       "attended = 1",                      'created_at'),
    'cohort_tasks_approved':  ('user_id',     'task_submissions',         "status = 'approved'",               'submitted_at'),
    'pro_subscription':       ('user_id',     'subscriptions',            "status = 'active'",                 'started_at'),
    'sessions_completed':     ('student_id',  'achiever_sessions',        "status = 'completed' AND is_demo = 0", 'created_at'),
    'documents_uploaded':     ('user_id',     'document_vault',           "is_active = 1",                     'created_at'),
    'communities_joined':     ('user_id',     'group_memberships',        "status = 'active'",                 'joined_at'),
    'community_posts':        ('user_id',     'group_posts',              "1 = 1",                             'created_at'),
    'colleges_saved':         ('user_id',     'saved_colleges',           "1 = 1",                             'created_at'),
    'applications_submitted': ('user_id',     'opportunity_applications', "1 = 1",                             'applied_at'),
    'referrals_completed':    ('referrer_id', 'referrals',                "status = 'completed'",              'completed_at'),
    'reviews_written':        ('user_id',     'achiever_reviews',         "is_active = 1",                     'created_at'),
    'skills_added':           ('user_id',     'user_skills',              "1 = 1",                             'created_at'),
    'account_created':        ('id',          'users',                    "deleted_at IS NULL",                'created_at'),
    'daily_login':            ('user_id',     'sessions',                 "1 = 1",                             'created_at'),
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

# Which column a metric's filter compares against. The rule stores the chosen
# value in score_event_rules.metric_filter; this says where to look for it.
FILTER_COLUMN = {
    'pro_subscription':   'plan',
    'documents_uploaded': 'category',
}

# Metrics counted as DISTINCT days rather than rows. A student with 40 sessions
# across 6 days has logged in on 6 days, not 40 times -- and because ref_id is
# derived from the count, 6 is also exactly how many awards they should hold.
DISTINCT_DAYS = {'daily_login'}

METRICS_DDL = """
CREATE TABLE IF NOT EXISTS `score_metrics` (
  `id`            CHAR(36)     NOT NULL,
  `value`         VARCHAR(40)  NOT NULL,
  `label`         VARCHAR(100) NOT NULL,
  `description`   VARCHAR(255) NULL,
  `filter_key`    VARCHAR(40)  NULL,
  `filter_label`  VARCHAR(60)  NULL,
  `filter_values` VARCHAR(255) NULL,
  `tests`         VARCHAR(80)  NOT NULL DEFAULT 'each',
  `sort_order`    INT          NOT NULL DEFAULT 0,
  `is_active`     TINYINT(1)   NOT NULL DEFAULT 1,
  `created_at`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_score_metrics_value` (`value`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
"""

RULE_COLUMNS = [
    ('metric_key',    "VARCHAR(40) NULL"),
    ('metric_filter', "VARCHAR(40) NULL"),
    ('rule_test',     "VARCHAR(16) NULL"),
    ('threshold',     "INT NULL"),
    ('since_at',      "DATETIME NULL"),
    ('created_at',    "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP"),
]


def build_snapshot_proc():
    """sp_score_metric_snapshot -- per-user counts for ONE metric into a temp table.

    Set-based on purpose. The obvious shape is a cursor over students, but that
    is 403 round trips per rule per night; this is one INSERT..SELECT per rule.
    """
    branches = []
    for i, (key, (ucol, table, where, tscol)) in enumerate(SOURCES.items()):
        fcol = FILTER_COLUMN.get(key)
        filt = (f"\n           AND (p_filter IS NULL OR p_filter = '' OR `{fcol}` = p_filter)"
                if fcol else "")
        kw = 'IF' if i == 0 else 'ELSEIF'
        count_expr = (f"COUNT(DISTINCT DATE(`{tscol}`))" if key in DISTINCT_DAYS
                      else "COUNT(*)")
        branches.append(f"""    {kw} p_metric = '{key}' THEN
        INSERT INTO `tmp_score_metric` (`user_id`, `val`)
        SELECT `{ucol}`, {count_expr}
          FROM `{table}`
         WHERE {where}
           AND `{ucol}` IS NOT NULL
           -- Only real students. Test data leaves rows pointing at users that
           -- no longer exist; without this the preview counts ghosts and the
           -- evaluator writes ledger rows nobody owns.
           AND EXISTS (SELECT 1 FROM `users` su WHERE su.`id` = `{ucol}`)
           AND IFNULL(`{tscol}`, '1000-01-01') >= v_since
           AND (p_user IS NULL OR `{ucol}` = p_user)
           -- A batch can switch Tab 1 Actions off for its students; the most
           -- specific matching batch decides, and no batch means global
           -- applies. The outer column is qualified because `user_id` also
           -- exists inside the subquery on user_profiles.
           AND IFNULL((
                 SELECT b.`include_global`
                   FROM `score_task_batches` b
                   LEFT JOIN `user_profiles` up ON up.`user_id` = `{table}`.`{ucol}`
                  WHERE b.`is_active` = 1
                    AND (b.`education_category` IS NULL OR b.`education_category` = ''
                         OR b.`education_category` = up.`education_category`)
                    AND (b.`degree_type` IS NULL OR b.`degree_type` = ''
                         OR b.`degree_type` = up.`degree_type`)
                  ORDER BY b.`specificity` DESC, b.`include_global` ASC
                  LIMIT 1), 1) = 1{filt}
         GROUP BY `{ucol}`;""")
    return """
CREATE PROCEDURE `sp_score_metric_snapshot`(
    IN p_metric VARCHAR(40),
    IN p_filter VARCHAR(40),
    IN p_since  DATETIME,
    IN p_user   CHAR(36)
)
BEGIN
    DECLARE v_since DATETIME;
    -- NULL since_at means "count all history" -- that is the backfill case.
    SET v_since = IFNULL(p_since, '1000-01-01 00:00:00');

    DROP TEMPORARY TABLE IF EXISTS `tmp_score_metric`;
    CREATE TEMPORARY TABLE `tmp_score_metric` (
        `user_id` CHAR(36) NOT NULL,
        `val`     INT      NOT NULL,
        PRIMARY KEY (`user_id`)
    ) ENGINE=MEMORY;

""" + "\n".join(branches) + """
    END IF;
END
"""


APPLY_PROC = """
CREATE PROCEDURE `sp_score_rule_apply`(
    IN p_key       VARCHAR(50),
    IN p_points    DECIMAL(5,2),
    IN p_test      VARCHAR(16),
    IN p_threshold INT,
    IN p_cap_type  VARCHAR(12),
    IN p_cap_value INT
)
BEGIN
    -- Reads whatever sp_score_metric_snapshot last put in tmp_score_metric.
    --
    -- Every ref_id is derived from the count, never from NOW(), so running this
    -- again produces the same refs and UNIQUE (user_id, event_type, ref_id)
    -- swallows them. That is what makes the nightly sweep safe to repeat.
    DECLARE v_cap INT;
    SET v_cap = IF(p_cap_type = 'none' OR p_cap_value IS NULL OR p_cap_value <= 0,
                   NULL, p_cap_value);

    IF p_test = 'each' THEN
        INSERT IGNORE INTO `score_events` (`id`, `user_id`, `event_type`, `points`, `ref_id`, `meta`)
        WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 500)
        SELECT UUID(), t.`user_id`, p_key, p_points, CONCAT('m:', n.i), 'metric rule'
          FROM `tmp_score_metric` t
          JOIN n ON n.i <= LEAST(t.`val`, IFNULL(v_cap, t.`val`))
         WHERE t.`val` > 0;

    ELSEIF p_test = 'reaches' THEN
        INSERT IGNORE INTO `score_events` (`id`, `user_id`, `event_type`, `points`, `ref_id`, `meta`)
        SELECT UUID(), t.`user_id`, p_key, p_points,
               CONCAT('m:reach:', p_threshold), 'metric rule'
          FROM `tmp_score_metric` t
         WHERE p_threshold IS NOT NULL AND t.`val` >= p_threshold;

    ELSEIF p_test = 'every' THEN
        INSERT IGNORE INTO `score_events` (`id`, `user_id`, `event_type`, `points`, `ref_id`, `meta`)
        WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 500)
        SELECT UUID(), t.`user_id`, p_key, p_points, CONCAT('m:every:', n.i), 'metric rule'
          FROM `tmp_score_metric` t
          JOIN n ON n.i <= LEAST(FLOOR(t.`val` / p_threshold), IFNULL(v_cap, 500))
         WHERE p_threshold IS NOT NULL AND p_threshold > 0
           AND FLOOR(t.`val` / p_threshold) >= 1;

    ELSEIF p_test = 'becomes_active' THEN
        INSERT IGNORE INTO `score_events` (`id`, `user_id`, `event_type`, `points`, `ref_id`, `meta`)
        SELECT UUID(), t.`user_id`, p_key, p_points, 'm:active', 'metric rule'
          FROM `tmp_score_metric` t
         WHERE t.`val` >= 1;
    END IF;

    -- A session variable, not a result set. This procedure is called in a loop
    -- from sp_score_rules_run, and in MySQL every inner SELECT leaks out to the
    -- client as its own result set -- pushing the caller's own row down the
    -- list, where nothing reads it. Callers read the FIRST result set.
    SET @score_rule_awarded = ROW_COUNT();
END
"""

RUN_PROC = """
CREATE PROCEDURE `sp_score_rules_run`(IN p_user CHAR(36))
BEGIN
    -- Evaluates every active metric rule. p_user NULL = everyone (the nightly
    -- sweep); a user id = just them, which is what a write hook calls so Pro
    -- feels instant instead of next-morning.
    DECLARE v_done INT DEFAULT 0;
    DECLARE v_key VARCHAR(50);
    DECLARE v_metric VARCHAR(40);
    DECLARE v_filter VARCHAR(40);
    DECLARE v_test VARCHAR(16);
    DECLARE v_threshold INT;
    DECLARE v_points DECIMAL(5,2);
    DECLARE v_cap_type VARCHAR(12);
    DECLARE v_cap INT;
    DECLARE v_since DATETIME;
    DECLARE v_rules INT DEFAULT 0;

    DECLARE v_shape   VARCHAR(12);
    DECLARE v_require INT;
    DECLARE v_tiers   VARCHAR(120);
    DECLARE v_streak  INT;
    DECLARE v_until   DATETIME;
    DECLARE v_edu     VARCHAR(50);
    DECLARE v_deg     VARCHAR(60);
    DECLARE v_state   VARCHAR(60);

    DECLARE cur CURSOR FOR
        SELECT `event_type`, `metric_key`, `metric_filter`, `rule_test`,
               `threshold`, `points`, `cap_type`, `cap_value`, `since_at`,
               `shape`, `require_count`, `tier_points`, `streak_days`, `until_at`,
               `segment_education`, `segment_degree`, `segment_state`
          FROM `score_event_rules`
         WHERE `is_active` = 1
           -- A combo has no metric of its own; its conditions carry them.
           AND (`shape` IN ('all_of', 'any_of')
                OR (`metric_key` IS NOT NULL AND `metric_key` <> ''))
           -- The campaign window. A rule past its end date stops AWARDING;
           -- points it already gave are kept, which is the difference between
           -- a campaign ending and points expiring.
           AND (`until_at` IS NULL OR UTC_TIMESTAMP() <= `until_at`)
           AND (`since_at` IS NULL OR UTC_TIMESTAMP() >= `since_at`
                -- since_at doubles as "count activity from", so a rule whose
                -- window has not opened yet is skipped, but one with a
                -- backdated since_at is not.
                OR `since_at` <= UTC_TIMESTAMP());
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_done = 1;

    DROP TEMPORARY TABLE IF EXISTS `tmp_score_touched`;
    CREATE TEMPORARY TABLE `tmp_score_touched` (
        `user_id` CHAR(36) NOT NULL, PRIMARY KEY (`user_id`)
    ) ENGINE=MEMORY;

    OPEN cur;
    rule_loop: LOOP
        FETCH cur INTO v_key, v_metric, v_filter, v_test,
                       v_threshold, v_points, v_cap_type, v_cap, v_since,
                       v_shape, v_require, v_tiers, v_streak, v_until,
                       v_edu, v_deg, v_state;
        IF v_done = 1 THEN LEAVE rule_loop; END IF;

        -- One evaluator per shape. They differ only in what they use for
        -- ref_id, which is what makes each of them repeat-safe.
        IF v_shape IN ('all_of', 'any_of') THEN
            CALL sp_score_combo_apply(v_key, v_points, v_shape, v_require,
                                      v_since, p_user, v_edu, v_deg, v_state);
            -- A combo's conditions leave their own users in tmp_score_metric;
            -- whoever the last condition matched is close enough for the
            -- rebuild set, and the combo's own award adds the rest.
            INSERT IGNORE INTO `tmp_score_touched` (`user_id`)
            SELECT `user_id` FROM `tmp_score_metric` WHERE `val` > 0;

        ELSEIF v_test = 'streak' THEN
            CALL sp_score_streak_snapshot(v_metric, v_streak, p_user);
            INSERT IGNORE INTO `tmp_score_touched` (`user_id`)
            SELECT `user_id` FROM `tmp_score_streak`;
            CALL sp_score_streak_apply(v_key, v_points, v_cap);

        ELSE
            CALL sp_score_metric_snapshot(v_metric, v_filter, v_since, p_user);
            CALL sp_score_segment_filter(v_edu, v_deg, v_state);

            INSERT IGNORE INTO `tmp_score_touched` (`user_id`)
            SELECT `user_id` FROM `tmp_score_metric` WHERE `val` > 0;

            IF v_test = 'tiered' THEN
                CALL sp_score_tier_apply(v_key, v_tiers, v_cap);
            ELSE
                CALL sp_score_rule_apply(v_key, v_points, v_test, v_threshold,
                                         v_cap_type, v_cap);
            END IF;
        END IF;
        SET v_rules = v_rules + 1;
    END LOOP;
    CLOSE cur;

    DROP TEMPORARY TABLE IF EXISTS `tmp_score_metric`;
    -- Tasks pay themselves the same way rules do. Scoped to one student here;
    -- the nightly pass uses sp_score_task_autopay_all, which walks only the
    -- students with an unpaid provable task rather than all of them.
    IF p_user IS NOT NULL THEN
        CALL sp_score_task_autopay(p_user);
        INSERT IGNORE INTO `tmp_score_touched` (`user_id`) VALUES (p_user);
    END IF;

    -- Every rule has been applied. Rebuild the students they moved, in one
    -- set-based pass, so the cached score is right before anyone reads it --
    -- rather than waiting for each student to open a page and trigger their
    -- own sp_score_recalc, which is what used to keep the number correct.
    --
    -- sp_score_recalc_bulk is owned by migrate_score_bulk_recalc.py. On a fresh
    -- database run that migration before the first sweep; every other path
    -- already has it.
    CALL sp_score_recalc_bulk('touched');

    SELECT v_rules AS rules_run,
           (SELECT COUNT(*) FROM `tmp_score_touched`) AS students_touched;
END
"""

PREVIEW_PROC = """
CREATE PROCEDURE `sp_score_rule_preview`(
    IN p_metric    VARCHAR(40),
    IN p_filter    VARCHAR(40),
    IN p_test      VARCHAR(16),
    IN p_threshold INT,
    IN p_points    DECIMAL(5,2),
    IN p_since     DATETIME,
    IN p_cap_value INT
)
BEGIN
    -- What saving this rule would do, without doing it. Writes nothing.
    -- The screen shows this before an admin commits, because "apply to
    -- everyone" on 403 students is not an action to take blind.
    DECLARE v_cap INT;
    SET v_cap = IF(p_cap_value IS NULL OR p_cap_value <= 0, NULL, p_cap_value);

    CALL sp_score_metric_snapshot(p_metric, p_filter, p_since, NULL);

    IF p_test = 'each' THEN
        SELECT COUNT(*) AS students,
               IFNULL(SUM(LEAST(`val`, IFNULL(v_cap, `val`))), 0) AS awards,
               IFNULL(SUM(LEAST(`val`, IFNULL(v_cap, `val`))), 0) * p_points AS points
          FROM `tmp_score_metric` WHERE `val` > 0;
    ELSEIF p_test = 'reaches' THEN
        SELECT COUNT(*) AS students, COUNT(*) AS awards, COUNT(*) * p_points AS points
          FROM `tmp_score_metric` WHERE p_threshold IS NOT NULL AND `val` >= p_threshold;
    ELSEIF p_test = 'every' THEN
        SELECT COUNT(*) AS students,
               IFNULL(SUM(LEAST(FLOOR(`val` / p_threshold), IFNULL(v_cap, 500))), 0) AS awards,
               IFNULL(SUM(LEAST(FLOOR(`val` / p_threshold), IFNULL(v_cap, 500))), 0) * p_points AS points
          FROM `tmp_score_metric`
         WHERE p_threshold IS NOT NULL AND p_threshold > 0 AND FLOOR(`val` / p_threshold) >= 1;
    ELSE
        SELECT COUNT(*) AS students, COUNT(*) AS awards, COUNT(*) * p_points AS points
          FROM `tmp_score_metric` WHERE `val` >= 1;
    END IF;

    DROP TEMPORARY TABLE IF EXISTS `tmp_score_metric`;
END
"""


UPSERT_PROC = """
CREATE PROCEDURE `sp_score_metric_rule_upsert`(
    IN p_key       VARCHAR(50),
    IN p_label     VARCHAR(160),
    IN p_points    DECIMAL(5,2),
    IN p_metric    VARCHAR(40),
    IN p_filter    VARCHAR(40),
    IN p_test      VARCHAR(16),
    IN p_threshold INT,
    IN p_cap_type  VARCHAR(12),
    IN p_cap_value INT,
    IN p_since     DATETIME,
    IN p_is_active TINYINT
)
BEGIN
    -- since_at NULL means the rule counts all history (the backfill case). The
    -- route stamps it with NOW() unless the admin asked for backfill, so the
    -- default is the safe one.
    INSERT INTO `score_event_rules`
        (`event_type`, `label`, `points`, `is_active`, `cap_type`, `cap_value`,
         `metric_key`, `metric_filter`, `rule_test`, `threshold`, `since_at`)
    VALUES (p_key, p_label, p_points, p_is_active, IFNULL(p_cap_type,'none'), p_cap_value,
            p_metric, p_filter, p_test, p_threshold, p_since)
    ON DUPLICATE KEY UPDATE
        `label` = VALUES(`label`),
        `points` = VALUES(`points`),
        `is_active` = VALUES(`is_active`),
        `cap_type` = VALUES(`cap_type`),
        `cap_value` = VALUES(`cap_value`),
        `metric_key` = VALUES(`metric_key`),
        `metric_filter` = VALUES(`metric_filter`),
        `rule_test` = VALUES(`rule_test`),
        `threshold` = VALUES(`threshold`),
        -- since_at is NOT overwritten on edit: re-saving a rule must not
        -- silently turn it into a backfill, or change points for one student
        -- and suddenly pay 400.
        `since_at` = `since_at`;

    SELECT * FROM `score_event_rules` WHERE `event_type` = p_key;
END
"""


def main():
    with app.app_context():
        # 1. catalogue table + rows
        db.session.execute(text(METRICS_DDL))
        for value, label, desc, fkey, flabel, fvals, tests, order in METRICS:
            db.session.execute(text(
                "INSERT INTO `score_metrics` "
                "(id, value, label, description, filter_key, filter_label, filter_values, tests, sort_order, is_active) "
                "VALUES (UUID(), :v, :l, :d, :fk, :fl, :fv, :t, :o, 1) "
                "ON DUPLICATE KEY UPDATE label=VALUES(label), description=VALUES(description), "
                "filter_key=VALUES(filter_key), filter_label=VALUES(filter_label), "
                "filter_values=VALUES(filter_values), tests=VALUES(tests), sort_order=VALUES(sort_order)"
            ), {'v': value, 'l': label, 'd': desc, 'fk': fkey, 'fl': flabel,
                'fv': fvals, 't': tests, 'o': order})

        # documents_uploaded's filter values are the live document categories,
        # not a frozen list. An admin who adds a category to
        # master_document_category can then write a rule about it, and one who
        # renames "Marksheet" does not end up with a rule pointing at a value
        # that no longer exists.
        cats = db.session.execute(text(
            "SELECT GROUP_CONCAT(value ORDER BY sort_order) FROM master_document_category "
            "WHERE is_active = 1")).scalar()
        if cats:
            db.session.execute(text(
                "UPDATE `score_metrics` SET filter_values = :c WHERE value = 'documents_uploaded'"
            ), {'c': cats})
            print(f"  document categories offered: {cats}")
        db.session.commit()

        # registered as a master so the dropdown gets DB search for free
        db.session.execute(text(
            "INSERT INTO `master_registry` (id, type, table_name, label, is_active) "
            "VALUES (UUID(), 'score_metric', 'score_metrics', 'Score Metric', 1) "
            "ON DUPLICATE KEY UPDATE table_name=VALUES(table_name), label=VALUES(label), is_active=1"
        ))

        # 2. extend the rules table
        for col, ddl in RULE_COLUMNS:
            exists = db.session.execute(text(
                "SELECT COUNT(*) FROM information_schema.COLUMNS "
                "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'score_event_rules' "
                "AND COLUMN_NAME = :c"), {'c': col}).scalar()
            if not exists:
                db.session.execute(text(
                    f"ALTER TABLE `score_event_rules` ADD COLUMN `{col}` {ddl}"))
                print(f"  added score_event_rules.{col}")
            else:
                print(f"  score_event_rules.{col} already there")
        db.session.commit()

        # 3. procedures
        for name, body in (
            ('sp_score_metric_snapshot', build_snapshot_proc()),
            ('sp_score_rule_apply',      APPLY_PROC),
            ('sp_score_rules_run',       RUN_PROC),
            ('sp_score_rule_preview',    PREVIEW_PROC),
            ('sp_score_metric_rule_upsert', UPSERT_PROC),
        ):
            db.session.execute(text(f"DROP PROCEDURE IF EXISTS `{name}`"))
            db.session.execute(text(body.strip()))
            print(f"  created {name}")
        db.session.commit()

        n = db.session.execute(text(
            "SELECT COUNT(*) FROM `score_metrics` WHERE is_active = 1")).scalar()
        cols = db.session.execute(text(
            "SELECT COLUMN_NAME FROM information_schema.COLUMNS "
            "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'score_event_rules' "
            "ORDER BY ORDINAL_POSITION")).fetchall()
        print(f"  metrics in catalogue: {n}")
        print("  score_event_rules:", ", ".join(c[0] for c in cols))
        print("Done.")


if __name__ == '__main__':
    main()
