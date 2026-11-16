"""
Remove everything seed_ui_fixtures.py and seed_test_accounts.py created.

`.env` points at the production RDS, so every fixture this suite creates lives in
the real database until something takes it out. That includes
`e2e.super@skovo-test.local`, whose password is hardcoded in
seed_test_accounts.py — a super-admin with a known password is not something to
leave lying around after a test run.

Deletes are ordered children-first and each runs in its own transaction, so one
failing statement cannot strand the rest. That is not hypothetical: a teardown
that stopped at its first error once left 249 rows behind, and the only reason
it was noticed was counting against a known baseline afterwards.

    ..\\SKOVO_BACKEND\\venv\\Scripts\\python.exe cleanup_ui_fixtures.py
"""
import os
import sys

BACKEND = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'SKOVO_BACKEND'))
sys.path.insert(0, BACKEND)
os.chdir(BACKEND)

from dotenv import load_dotenv                                      # noqa: E402
from sqlalchemy import create_engine, text                          # noqa: E402

load_dotenv('.env')
engine = create_engine(os.environ['DATABASE_URL'], connect_args={'connect_timeout': 15})

U = "(SELECT id FROM users WHERE email LIKE '%@skovo-test.local')"
A = "(SELECT id FROM achievers WHERE email LIKE '%@skovo-test.local')"
C = (f"(SELECT id FROM cohorts WHERE achiever_id IN {A} "
     "OR title LIKE 'E2E %' OR title LIKE 'UI-FIXTURE %')")

STEPS = [
    ('payment_events',        f"DELETE FROM payment_events WHERE order_id IN "
                              f"(SELECT id FROM payment_orders WHERE student_id IN {U})"),
    ('payment_orders',        f"DELETE FROM payment_orders WHERE student_id IN {U}"),
    ('task_submissions',      f"DELETE FROM task_submissions WHERE user_id IN {U}"),
    ('cohort_tasks',          f"DELETE FROM cohort_tasks WHERE cohort_id IN {C} "
                              "OR title LIKE 'E2E %'"),
    ('cohort_attendance_codes', f"DELETE FROM cohort_attendance_codes WHERE cohort_id IN {C}"),
    ('cohort_enrollments',    f"DELETE FROM cohort_enrollments WHERE user_id IN {U} "
                              f"OR cohort_id IN {C}"),
    ('achiever_reviews',      f"DELETE FROM achiever_reviews WHERE user_id IN {U} "
                              f"OR achiever_id IN {A}"),
    ('notification_logs',     f"DELETE FROM notification_logs WHERE user_id IN {U}"),
    ('score_events',          f"DELETE FROM score_events WHERE user_id IN {U}"),
    ('readiness_scores',      f"DELETE FROM readiness_scores WHERE user_id IN {U}"),
    ('subscriptions',         f"DELETE FROM subscriptions WHERE user_id IN {U}"),
    ('group_memberships',     f"DELETE FROM group_memberships WHERE user_id IN {U}"),
    ('opportunity_shortlist', f"DELETE FROM opportunity_shortlist WHERE user_id IN {U}"),
    ('opportunity_applications', f"DELETE FROM opportunity_applications WHERE user_id IN {U}"),
    ('saved_colleges',        f"DELETE FROM saved_colleges WHERE user_id IN {U} "
                              "OR college_id IN (SELECT id FROM colleges WHERE name LIKE 'UI-FIXTURE %')"),
    ('document_vault',        f"DELETE FROM document_vault WHERE user_id IN {U}"),
    ('dm_reports',            "DELETE FROM dm_reports WHERE reason LIKE 'E2E %'"),
    ('market_deals',          "DELETE FROM market_deals WHERE title LIKE 'E2E %'"),
    ('opportunities',         "DELETE FROM opportunities WHERE title LIKE 'E2E %'"),
    ('groups',                "DELETE FROM `groups` WHERE name LIKE 'E2E %'"),
    ('domains',               "DELETE FROM domains WHERE name LIKE 'E2E %'"),
    ('achiever_slots',        f"DELETE FROM achiever_slots WHERE mentor_id IN {A}"),
    ('achiever_availability', f"DELETE FROM achiever_availability WHERE mentor_id IN {A}"),
    ('achiever_sessions',     f"DELETE FROM achiever_sessions WHERE mentor_id IN {A}"),
    ('payout_requests',       f"DELETE FROM payout_requests WHERE achiever_id IN {A}"),
    ('cohorts',               f"DELETE FROM cohorts WHERE achiever_id IN {A} "
                              "OR title LIKE 'E2E %' OR title LIKE 'UI-FIXTURE %'"),
    # Courses BEFORE the colleges they hang off, or the parent rows go and these
    # are orphaned in a table nothing then cleans.
    ('college_courses',       "DELETE FROM college_courses WHERE college_id IN "
                              "(SELECT id FROM colleges WHERE name LIKE 'UI-FIXTURE %')"),
    ('colleges',              "DELETE FROM colleges WHERE name LIKE 'UI-FIXTURE %'"),
    ('user_profiles',         f"DELETE FROM user_profiles WHERE user_id IN {U}"),
    ('auth_identities',       f"DELETE FROM auth_identities WHERE user_id IN {U}"),
    ('otp_requests',          "DELETE FROM otp_requests WHERE target LIKE '%@skovo-test.local'"),
    ('users',                 "DELETE FROM users WHERE email LIKE '%@skovo-test.local'"),
    ('achievers',             "DELETE FROM achievers WHERE email LIKE '%@skovo-test.local'"),
    ('admins',                "DELETE FROM admins WHERE email LIKE '%@skovo-test.local'"),
    ('super_admins',          "DELETE FROM super_admins WHERE email LIKE '%@skovo-test.local'"),
]

BASELINE = {'users': 6, 'achievers': 6, 'admins': 3, 'super_admins': 1, 'cohorts': 12}


def main():
    for label, sql in STEPS:
        try:
            with engine.begin() as c:
                n = c.execute(text(sql)).rowcount
            if n:
                print(f'  {label:26} -{n}')
        except Exception as exc:                                    # noqa: BLE001
            print(f'  {label:26} SKIP ({str(exc)[:70]})')

    print()
    drift = []
    with engine.connect() as c:
        for table, expected in BASELINE.items():
            actual = c.execute(text(f'SELECT COUNT(*) FROM {table}')).scalar()
            flag = '' if actual == expected else f'  <-- expected {expected}'
            print(f'  {table:14} {actual}{flag}')
            if actual != expected:
                drift.append(f'{table}: {actual} vs {expected}')

    # Counting against a known baseline is the only way to find rows a teardown
    # missed — the fixture reporting success proves nothing about what it left.
    print('\nBASELINE OK' if not drift else f'\nDRIFT: {"; ".join(drift)}')


if __name__ == '__main__':
    main()
