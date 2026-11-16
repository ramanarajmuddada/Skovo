"""Score Engine > Actions rules from SKOVO-readiness-streak-tasks-v1.xlsx, Common sheet.

Creates the 27 metric rules (plus points/caps on 23 existing v1 rules) whose metric already exists in score_metrics, every one
INACTIVE (the workbook's golden rule: nothing pays until an admin switches it
on in Admin > Score Engine). No backfill: a rule switched on later only counts
what happens after it was saved.

Same path as the admin form (POST /score-rules/metric-rule): the event key is
derived the same way and the row goes through sp_score_metric_rule_upsert, so
running this twice updates the same 22 rows instead of adding duplicates.

Left out on purpose -- see the session notes:
    C03 C52                    need an aggregate metric (all 4 vault folders; a post at 5 reactions)
    C41                        0 points and no college-view log to count
    C74                        Pro annual is already active at +20 (sheet says 8)
    C43                        "Tiered" without the tier values
    C45                        paid per task type by the task_approved_* rules
    C57 C58                    0 points, tracking only
    C66 C67                    resume / SOP features were removed
    C09 C28 C35 C37 C64 C65    removed 17 Oct 2026 — Assessment, Mock Tests, Courses,
                               Certifications, App Tracker, Scholarships are hidden in v1
"Once per stage" (C05, C09) is saved as cap "once".

Writes to the database in DATABASE_URL. From SKOVO_BACKEND:
    python database/seeds/seed_v1_score_rules_common.py
"""
import os
import sys
from datetime import datetime

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..')))

from portal import InitApp  # noqa: E402
from portal.models import db  # noqa: E402
from portal.helpers.sp import call_proc, call_proc_one  # noqa: E402
from portal.routes.Admin.admin_score_rules import _metric_event_key  # noqa: E402

app = InitApp().app()

# id, label, metric, filter, test, threshold, points, cap_type, cap_value
RULES = [
    ('C01', 'Create account', 'account_created', None, 'becomes_active', None, 5, 'once', None),
    ('C05', 'Set career goals', 'goals_set', None, 'becomes_active', None, 2, 'once', None),
    ('C06', 'Add skills (reaches 5)', 'skills_added', None, 'reaches', 5, 1, 'once', None),
    ('C07', 'Publish public profile', 'public_profile', None, 'becomes_active', None, 1, 'once', None),
    ('C11', 'Upload marksheet', 'documents_uploaded', 'marksheet', 'each', None, 2, 'per_item', 1),
    ('C12', 'Upload ID proof', 'documents_uploaded', 'id_proof', 'each', None, 1, 'once', None),
    ('C13', 'Daily login', 'daily_login', None, 'each', None, 0.2, 'daily', 1),
    ('C44', 'Attend a live session', 'cohorts_attended', None, 'each', None, 1, 'per_item', 1),
    ('C48', 'Complete a 1-on-1 mentor session', 'sessions_completed', None, 'each', None, 2, 'monthly', 4),
    ('C49', 'Review the achiever after a session', 'reviews_written', None, 'each', None, 0.5, 'per_item', 1),
    ('C50', 'Join a community', 'communities_joined', None, 'each', None, 1, 'lifetime', 5),
    ('C62', 'Save 5 colleges', 'colleges_saved', None, 'reaches', 5, 1, 'once', None),
    ('C68', 'Apply to an opportunity', 'applications_submitted', None, 'each', None, 3, 'monthly', 5),
    ('C69', 'Shortlist (save) an opportunity', 'opportunities_saved', None, 'each', None, 0.5, 'lifetime', 10),
    ('C71', 'Write a college review', 'college_reviews', None, 'each', None, 1, 'per_item', 1),
    ('C78', 'Friend joins and completes profile', 'referrals_completed', None, 'each', None, 2, 'lifetime', 10),
    # Metrics added by migrate_score_metric_rules (community_created, opportunity_shortlisted);
    # C77's sheet name "market_redeem" is the existing market_deals_used metric.
    ('C51', 'Create a community', 'community_created', None, 'each', None, 2, 'lifetime', 5),
    ('C70', 'Get shortlisted for an opportunity', 'opportunity_shortlisted', None, 'each', None, 10, 'none', None),
    ('C77', 'Redeem a market deal / coupon', 'market_deals_used', None, 'each', None, 0.5, 'monthly', 5),
    ('C72', 'Pro — monthly plan active', 'pro_subscription', 'monthly', 'becomes_active', None, 3, 'once', None),
    ('C73', 'Pro — quarterly plan active', 'pro_subscription', 'quarterly', 'becomes_active', None, 6, 'once', None),
]


# Version-1 rules that already exist (inactive, 0 pts) and match a sheet row.
# Only points and cap are set from the sheet; the name stays and so does Inactive.
# event_type, sheet id, points, cap_type, cap_value
V1_RULES = [
    ('daily_goal_met',          'C14', 0.5, 'daily',    1),
    ('quest_completed',         'C15', 0.2, 'daily',    3),
    ('quests_all_done',         'C16', 0.5, 'daily',    1),
    ('monthly_challenge',       'C17', 2,   'monthly',  1),
    ('perfect_week',            'C18', 1,   'weekly',   1),
    ('streak_7',                'C20', 0.5, 'per_item', None),
    ('streak_30',               'C21', 1,   'per_item', None),
    ('streak_100',              'C22', 3,   'per_item', None),
    ('streak_365',              'C23', 5,   'per_item', None),
    ('buddy_streak_7',          'C24', 1,   'per_item', None),
    ('quiz_submitted',          'C25', 0.5, 'daily',    5),
    ('quiz_passed',             'C26', 1,   'per_item', 1),
    ('quiz_perfect',            'C27', 0.5, 'per_item', 1),
    ('mistakes_cleared',        'C30', 0.5, 'daily',    1),
    ('speed_round',             'C31', 0.2, 'daily',    3),
    ('task_approved_capstone',  'C47', 8,   'per_item', None),
    ('answer_solved',           'C53', 1,   'daily',    2),
    ('top_helper_week',         'C55', 2,   'weekly',   1),
]


def main():
    with app.app_context():
        for rid, label, metric, mfilter, test, threshold, points, cap_type, cap_value in RULES:
            key = _metric_event_key(metric, mfilter, test, threshold)
            # since_at = NULL would backfill history; the form's default is "from now".
            call_proc_one('sp_score_metric_rule_upsert', key, label, points, metric, mfilter, test,
                          threshold, cap_type, cap_value, datetime.utcnow(), 0)
            print(f"  [ok] {rid} {key}  {points} pts  {cap_type}{'' if cap_value is None else ' ' + str(cap_value)}  INACTIVE")
        labels = dict(db.session.execute(db.text(
            "SELECT event_type, label FROM score_event_rules")).all())
        for event_type, rid, points, cap_type, cap_value in V1_RULES:
            if event_type not in labels:
                print(f"  [skip] {rid} {event_type} not found")
                continue
            call_proc_one('sp_score_event_rule_upsert', event_type, labels[event_type],
                          points, cap_type, cap_value, 0)
            print(f"  [ok] {rid} {event_type}  {points} pts  {cap_type}{'' if cap_value is None else ' ' + str(cap_value)}  INACTIVE")
        db.session.commit()
        call_proc('sp_score_rules_bump')
        db.session.commit()
        print(f"Done: {len(RULES)} metric rules + {len(V1_RULES)} v1 rules, all inactive.")


if __name__ == '__main__':
    main()
