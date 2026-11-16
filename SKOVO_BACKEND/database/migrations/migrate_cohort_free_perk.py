"""
Migration: the one free cohort a free member gets for life.

Scope §4.2 / Playbook §5.2 promise it and the paywall table lists it, but nothing
implemented it — a non-Pro student could only enrol in cohorts priced at zero.

Adds `cohort_enrollments.enrolled_via` so a Pro seat, a paid seat and the
one-per-lifetime free seat are distinguishable. Without it they are all just
payment_status='free' and the allowance cannot be counted.

Existing rows are backfilled from what can actually be known: amount_paid > 0
means paid, everything else 'free'. Which historical seats were Pro-covered is
not reconstructable, and guessing would make the perk count wrong — so none of
them are marked as having spent the perk. Anyone enrolled before today keeps it.

Idempotent. Run from SKOVO_BACKEND:
    python migrate_cohort_free_perk.py
"""
from sqlalchemy import text

import _bootstrap  # noqa: F401 — puts SKOVO_BACKEND on sys.path and cwd
from portal import InitApp
from portal.models import db
from portal.helpers.sql_file import apply_sql_file, add_column, column_exists

app = InitApp().app()

WANT = ['sp_cohort_free_perk_status', 'sp_student_cohort_enroll_free_perk']


def main():
    with app.app_context():
        fresh = not column_exists('cohort_enrollments', 'enrolled_via')

        add_column(
            'cohort_enrollments', 'enrolled_via',
            "VARCHAR(20) NULL DEFAULT NULL "
            "COMMENT 'paid | pro | free | free_perk — how the seat was obtained'",
        )
        print(f"column enrolled_via: {'added' if fresh else 'already present'}")

        if fresh:
            done = db.session.execute(text("""
                UPDATE `cohort_enrollments`
                   SET `enrolled_via` = CASE
                         WHEN IFNULL(`amount_paid`, 0) > 0 THEN 'paid'
                         ELSE 'free'
                       END
                 WHERE `enrolled_via` IS NULL
            """)).rowcount
            db.session.commit()
            print(f"backfilled {done} existing enrolment(s) — none marked as having spent the perk")

        applied = apply_sql_file('database/stored_procedures/cohort_free_perk.sql')
        print(f'applied {applied} procedure(s)')

        have = {r[0] for r in db.session.execute(text(
            "SELECT ROUTINE_NAME FROM information_schema.ROUTINES "
            "WHERE ROUTINE_SCHEMA = DATABASE() AND ROUTINE_NAME IN "
            "('sp_cohort_free_perk_status','sp_student_cohort_enroll_free_perk')")).fetchall()}
        for name in WANT:
            print(f'  {"OK  " if name in have else "MISS"} {name}')

        missing = [n for n in WANT if n not in have]
        if missing:
            raise SystemExit(f'FAILED — not created: {", ".join(missing)}')
        print('\nDone.')


if __name__ == '__main__':
    main()
