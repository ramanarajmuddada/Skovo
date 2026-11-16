"""
Migration: the Excel "Common" actions whose feature exists but which nothing
counted (SKOVO-readiness-streak-tasks-v1.xlsx, group A of the 17 Oct 2026
review). Every rule is added OFF, at the sheet's points. C29 (mock above cutoff)
and C36 (full course) keep their metrics but have no rule: Mock Tests and
Courses are hidden in v1, and both rules were deleted on 17 Oct 2026.

  Already awarded in code, only the rule row was missing:
    C03 Fill all 4 vault folders   profile_completed     5    once
    C52 Post reaches 5 reactions   community_reactions   0.5  once a day

  New metrics (sources added to SOURCES in migrate_score_metric_rules.py and
  migrate_score_rule_shapes.py — the two must match):
    C02 Complete onboarding        onboarding_done       3    once
    C10 Parent consent (under 18)  parent_consent        2    once
    C29 Mock test above cutoff     mock_tests_passed     3    each mock, once
    C36 Complete a full course     courses_completed     3    each course
    C63 Use the college predictor  predictor_used        0.5  each exam, once
    C75 Pro monthly paid 3 times   pro_monthly_paid      2    once, at 3
    C76 Buy a paid cohort          cohorts_paid          1    each cohort
    C79 Referred friend buys Pro   referrals_bought_pro  3    each, max 10

  Not buildable yet: C46 "attend 80% of a cohort's sessions" — attendance is
  one flag per enrolment, not one row per session.

Creates:
  * college_predictor_usage — one row per student per exam, written by
    POST /colleges/predict through sp_predictor_usage_log;
  * three views for counts one table cannot express;
  * the metric rows, then rebuilds sp_score_metric_snapshot and
    sp_score_streak_snapshot from the (now longer) SOURCES.

Idempotent. Run from anywhere:
    venv/Scripts/python.exe database/migrations/migrate_score_sources_v1_extra.py
"""
import _bootstrap  # noqa: F401 — puts SKOVO_BACKEND on sys.path and cwd
from sqlalchemy import text

import migrate_score_metric_rules as metric_rules
import migrate_score_rule_shapes as rule_shapes
from portal.models import db

app = metric_rules.app

USAGE_TABLE = """
CREATE TABLE IF NOT EXISTS `college_predictor_usage` (
  `id`         CHAR(36)    NOT NULL,
  `user_id`    CHAR(36)    NOT NULL,
  `exam`       VARCHAR(60) NOT NULL,
  `created_at` DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_predictor_user_exam` (`user_id`, `exam`),
  KEY `ix_predictor_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
"""

USAGE_PROC = """
CREATE PROCEDURE `sp_predictor_usage_log`(IN p_user CHAR(36), IN p_exam VARCHAR(60))
BEGIN
  -- First use per exam only: the score counts exams tried, not refreshes.
  INSERT IGNORE INTO `college_predictor_usage` (`id`, `user_id`, `exam`)
  VALUES (UUID(), p_user, LEFT(p_exam, 60));
END
"""

VIEWS = {
    # A mock passed twice is one pass.
    'v_score_mock_passed': """
        SELECT `user_id`, `mock_test_id`, MIN(`completed_at`) AS `completed_at`
          FROM `test_attempts`
         WHERE `completed_at` IS NOT NULL AND `passed` = 1
         GROUP BY `user_id`, `mock_test_id`""",
    # Every active module of the course done. Courses with no modules never count.
    'v_score_course_completed': """
        SELECT cp.`user_id`, cp.`course_id`, MAX(cp.`completed_at`) AS `completed_at`
          FROM `course_progress` cp
          JOIN `course_modules` m ON m.`id` = cp.`module_id` AND m.`is_active` = 1
         WHERE cp.`completed_at` IS NOT NULL
         GROUP BY cp.`user_id`, cp.`course_id`
        HAVING COUNT(DISTINCT cp.`module_id`) >= (
                 SELECT COUNT(*) FROM `course_modules` m2
                  WHERE m2.`course_id` = cp.`course_id` AND m2.`is_active` = 1)""",
    # One row per referred friend who has paid for Pro at least once.
    'v_score_referral_pro': """
        SELECT r.`referrer_id`, r.`id` AS `referral_id`, MIN(s.`started_at`) AS `started_at`
          FROM `referrals` r
          JOIN `subscriptions` s ON s.`user_id` = r.`referred_user_id`
         WHERE s.`plan` IN ('monthly', 'quarterly', 'annual')
           AND s.`status` IN ('active', 'expired')
         GROUP BY r.`referrer_id`, r.`id`""",
}

# value, label, description, tests, sort
METRICS = [
    ('onboarding_done',      'Onboarding completed',        'Stage and city filled in on the profile.',            'becomes_active', 230),
    ('parent_consent',       'Parent consent confirmed',    'A parent confirmed consent for an under-18 student.', 'becomes_active', 235),
    ('mock_tests_passed',    'Mock tests passed',           'Mocks scored above the pass mark — once per mock.',   'each,reaches,every', 240),
    ('courses_completed',    'Courses completed',           'Courses with every module finished.',                 'each,reaches,every', 245),
    ('predictor_used',       'College predictor used',      'Exams run through the college predictor — once each.', 'each,reaches', 250),
    ('pro_monthly_paid',     'Pro monthly plans paid',      'Monthly Pro periods actually paid for.',              'each,reaches', 255),
    ('cohorts_paid',         'Paid cohorts bought',         'Cohort enrolments that were paid for.',               'each,reaches,every', 260),
    ('referrals_bought_pro', 'Referred friends bought Pro', 'Friends you referred who paid for Pro.',              'each,reaches,every', 265),
]

# event_type, label, points, cap_type, cap_value, metric, test, threshold
RULES = [
    ('profile_completed',            'Fill all 4 document-vault folders', 5,   'once',     1,    None,                   None,             None),
    ('community_reactions',          'Post reaches 5 reactions',          0.5, 'daily',    1,    None,                   None,             None),
    ('m_onboarding_done_active',     'Complete onboarding',               3,   'once',     None, 'onboarding_done',      'becomes_active', None),
    ('m_parent_consent_active',      'Parent consent completed',          2,   'once',     None, 'parent_consent',       'becomes_active', None),
    ('m_predictor_used_each',        'Use the college predictor',         0.5, 'none',     None, 'predictor_used',       'each',           None),
    ('m_pro_monthly_paid_r_3',       'Renew Pro 3 months in a row',       2,   'once',     None, 'pro_monthly_paid',     'reaches',        3),
    ('m_cohorts_paid_each',          'Buy a paid cohort',                 1,   'none',     None, 'cohorts_paid',         'each',           None),
    ('m_referrals_bought_pro_each',  'Referred friend buys Pro',          3,   'lifetime', 10,   'referrals_bought_pro', 'each',           None),
]


def main():
    with app.app_context():
        x = lambda sql, **p: db.session.execute(text(sql), p)

        x(USAGE_TABLE)
        x('DROP PROCEDURE IF EXISTS `sp_predictor_usage_log`')
        x(USAGE_PROC)
        for name, body in VIEWS.items():
            x(f'CREATE OR REPLACE VIEW `{name}` AS {body}')

        metrics = sum(x("""
            INSERT IGNORE INTO `score_metrics` (`id`, `value`, `label`, `description`, `tests`, `sort_order`, `is_active`)
            VALUES (UUID(), :v, :l, :d, :t, :o, 1)""", v=v, l=l, d=d, t=t, o=o).rowcount
            for v, l, d, t, o in METRICS)

        # Rebuild both snapshot procedures from the extended SOURCES.
        x('DROP PROCEDURE IF EXISTS `sp_score_metric_snapshot`')
        x(metric_rules.build_snapshot_proc())
        x('DROP PROCEDURE IF EXISTS `sp_score_streak_snapshot`')
        x(rule_shapes.STREAK.replace('__BRANCHES__', rule_shapes.streak_branches()))

        rules = sum(x("""
            INSERT IGNORE INTO `score_event_rules`
                (`event_type`, `label`, `points`, `is_active`, `cap_type`, `cap_value`,
                 `metric_key`, `rule_test`, `threshold`, `shape`, `leaderboard_points`)
            VALUES (:k, :l, :p, 0, :ct, :cv, :m, :t, :th, 'simple', 0)""",
            k=k, l=l, p=p, ct=ct, cv=cv, m=m, t=t, th=th).rowcount
            for k, l, p, ct, cv, m, t, th in RULES)

        db.session.commit()

        # Prove every new source is readable: one snapshot per metric.
        for v, *_ in METRICS:
            x('CALL sp_score_metric_snapshot(:m, NULL, NULL, NULL)', m=v)
            n = x('SELECT COUNT(*) FROM `tmp_score_metric`').scalar()
            print(f'  {v:22} ok — {n} student(s) counted today')
        print(f'metrics added {metrics}, rules added {rules} (all off)')


if __name__ == '__main__':
    main()
