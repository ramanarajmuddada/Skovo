"""Wipe every achiever and everything hanging off one, plus error_logs.

WHY THIS EXISTS AS A SCRIPT
    The permission classifier blocks a mass DELETE against the production RDS
    from an agent session, as it has for `clear_resolved_error_logs.py` in every
    previous session. So the work is written down and a human runs it.

WHAT IT DOES
    Removes all achievers, every row keyed to one, and the cohorts they own —
    which necessarily takes the student enrolments in those cohorts with them.
    Then clears error_logs, and otp_requests so a re-registration starts clean.

ORDER MATTERS AND THE SCHEMA WILL NOT HELP YOU
    There is not one foreign key pointing at `achievers`. Nothing cascades and
    nothing rejects a wrong order — children are deleted first, by hand, below.

EACH STATEMENT RUNS IN ITS OWN TRANSACTION
    A teardown that stops at the first error is a teardown that silently did not
    run. This codebase has been bitten by exactly that (see the X-02 row in
    CLAUDE.md, where a misnamed table left 249 rows in production). One bad
    statement must not strand the rest.

USAGE
    SKOVO_BACKEND> ./venv/Scripts/python.exe ../automation/wipe_achievers.py
    SKOVO_BACKEND> ./venv/Scripts/python.exe ../automation/wipe_achievers.py --apply

    Default is a DRY RUN: it prints what each statement would remove and writes
    nothing. `--apply` performs the deletes.

    Run from SKOVO_BACKEND (it reads .env there) with the venv Python — system
    Python lacks the dependencies.

ARCHIVE FIRST
    A JSON archive of every affected row was written to
    automation/archive/achiever-wipe-<timestamp>.json before this script was
    created. If you are re-running this later, take a fresh archive first:
    payment_orders and payout_requests are financial records and the cohort
    enrolments are real student history. None of it is reconstructable.
"""
import os
import sys

from dotenv import load_dotenv
from sqlalchemy import create_engine, text

APPLY = '--apply' in sys.argv

# Children first. The comment beside each is why it sits where it does.
STEPS = [
    # ── cohort tree, deepest first ───────────────────────────────────────────
    ('task_submissions',           "DELETE FROM task_submissions WHERE task_id IN (SELECT id FROM cohort_tasks)",
                                   "SELECT COUNT(*) FROM task_submissions WHERE task_id IN (SELECT id FROM cohort_tasks)"),
    ('cohort_tasks',               "DELETE FROM cohort_tasks", "SELECT COUNT(*) FROM cohort_tasks"),
    ('cohort_attendance_codes',    "DELETE FROM cohort_attendance_codes", "SELECT COUNT(*) FROM cohort_attendance_codes"),
    # Student-facing: these are real enrolments held by real students.
    ('cohort_enrollments',         "DELETE FROM cohort_enrollments", "SELECT COUNT(*) FROM cohort_enrollments"),
    ('cohorts',                    "DELETE FROM cohorts", "SELECT COUNT(*) FROM cohorts"),

    # ── everything keyed directly to an achiever ─────────────────────────────
    ('achiever_reviews',           "DELETE FROM achiever_reviews", "SELECT COUNT(*) FROM achiever_reviews"),
    ('achiever_sessions',          "DELETE FROM achiever_sessions", "SELECT COUNT(*) FROM achiever_sessions"),
    ('achiever_slots',             "DELETE FROM achiever_slots", "SELECT COUNT(*) FROM achiever_slots"),
    ('achiever_availability',      "DELETE FROM achiever_availability", "SELECT COUNT(*) FROM achiever_availability"),
    ('achiever_documents',         "DELETE FROM achiever_documents", "SELECT COUNT(*) FROM achiever_documents"),
    ('achiever_document_requests', "DELETE FROM achiever_document_requests", "SELECT COUNT(*) FROM achiever_document_requests"),
    ('achiever_agreements',        "DELETE FROM achiever_agreements", "SELECT COUNT(*) FROM achiever_agreements"),
    ('achiever_state_events',      "DELETE FROM achiever_state_events", "SELECT COUNT(*) FROM achiever_state_events"),
    ('achiever_trust_events',      "DELETE FROM achiever_trust_events", "SELECT COUNT(*) FROM achiever_trust_events"),
    ('achiever_profile_views',     "DELETE FROM achiever_profile_views", "SELECT COUNT(*) FROM achiever_profile_views"),
    ('achiever_courses',           "DELETE FROM achiever_courses", "SELECT COUNT(*) FROM achiever_courses"),
    ('achiever_mentees',           "DELETE FROM achiever_mentees", "SELECT COUNT(*) FROM achiever_mentees"),
    # Financial records. Archived, then removed — they point at achievers that
    # will not exist, and an orphaned order is worse than no order.
    ('payout_requests',            "DELETE FROM payout_requests", "SELECT COUNT(*) FROM payout_requests"),
    ('payment_orders',             "DELETE FROM payment_orders", "SELECT COUNT(*) FROM payment_orders"),
    ('achievers',                  "DELETE FROM achievers", "SELECT COUNT(*) FROM achievers"),

    # ── asked for separately ─────────────────────────────────────────────────
    ('error_logs',                 "DELETE FROM error_logs", "SELECT COUNT(*) FROM error_logs"),
    # A leftover unexpired code for one of the wiped addresses would still be
    # honoured, so a "register from scratch with OTP" test would not be from
    # scratch at all.
    ('otp_requests',               "DELETE FROM otp_requests", "SELECT COUNT(*) FROM otp_requests"),
]

# Deliberately NOT touched, so nobody has to guess afterwards:
#   users              — students stay; only their cohort enrolments go
#   admins/super_admins— the two console accounts
#   master_*           — master data is never deleted (working agreement)
#   colleges, opportunities, communities, subscriptions

def main():
    load_dotenv('.env')
    url = os.getenv('DATABASE_URL')
    if not url:
        sys.exit('DATABASE_URL not set — run this from SKOVO_BACKEND, where .env lives.')

    engine = create_engine(url)
    host = url.split('@')[-1].split('/')[0]
    print(f'target: {host}')
    print('mode  : ' + ('APPLY — rows will be deleted' if APPLY else 'DRY RUN — nothing will be written'))
    print('-' * 62)

    total = 0
    for name, delete_sql, count_sql in STEPS:
        try:
            with engine.connect() as c:
                n = c.execute(text(count_sql)).scalar() or 0
        except Exception as ex:
            print(f'  SKIP  {name}: {str(ex)[:70]}')
            continue

        if not APPLY:
            print(f'  would delete {n:>5}  {name}')
            total += n
            continue

        try:
            # Own transaction per statement: one failure must not strand the rest.
            with engine.begin() as c:
                deleted = c.execute(text(delete_sql)).rowcount
            print(f'  deleted {n if deleted in (-1, None) else deleted:>6}  {name}')
            total += n
        except Exception as ex:
            print(f'  FAILED       {name}: {str(ex)[:80]}')

    print('-' * 62)
    print(f'{"would remove" if not APPLY else "removed"} {total} rows')

    if APPLY:
        print('\nverifying...')
        with engine.connect() as c:
            for t in ('achievers', 'cohorts', 'cohort_enrollments', 'error_logs', 'otp_requests'):
                print(f'  {t:<20} {c.execute(text(f"SELECT COUNT(*) FROM {t}")).scalar()}')
            print(f'  {"users (kept)":<20} {c.execute(text("SELECT COUNT(*) FROM users")).scalar()}')
            print(f'  {"admins (kept)":<20} {c.execute(text("SELECT COUNT(*) FROM admins")).scalar()}')
            print(f'  {"super_admins (kept)":<20} {c.execute(text("SELECT COUNT(*) FROM super_admins")).scalar()}')
    else:
        print('\nNothing was written. Re-run with --apply to perform the deletes.')


if __name__ == '__main__':
    main()
