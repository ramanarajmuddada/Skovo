"""
Migration: one hold vocabulary, one commission source, and a deadline on every
reservation.

Three defects this repairs, all of which cost real money:

1. `sp_student_session_book` set a slot to 'held' and **nothing in the codebase
   ever set it back** — one write, zero releases. Every abandoned paid checkout
   destroyed that slot permanently. Slots now go to 'blocked' (the same word the
   payment_orders flow uses) with a `blocked_until` deadline, and
   sp_payment_expire_holds releases them.

2. Three procedures had the commission written in as `* 0.30` — cohort confirm,
   session confirm and course confirm. Editing the rate in commission_rules
   moved sessions but not those three, so the split silently drifted. All three
   now resolve the rate the same way every other path does.

3. Cohort seats were only claimed *after* payment, so two students buying the
   last seat meant one had money taken with no seat and no refund path. This
   adds `cohort_enrollments.expires_at` so a seat can be held before payment and
   released if it never completes.

Existing 'held' slots are converted and back-dated so the very next expiry run
recovers them — otherwise the slots leaked before this migration stay lost.

Idempotent — safe to re-run. Run from SKOVO_BACKEND:
    python database/migrations/migrate_payment_flow_unify.py
"""
from sqlalchemy import text

import _bootstrap  # noqa: F401 — puts SKOVO_BACKEND on sys.path and cwd

from portal import InitApp
from portal.models import db
from portal.helpers.sql_file import apply_sql_file

app = InitApp().app()

SP_FILES = [
    'database/stored_procedures/business/payments.sql',
    'database/stored_procedures/business/payments_cohort.sql',
    'database/stored_procedures/business/student.sql',
]


def _column_exists(conn, table, column):
    return conn.execute(text(
        "SELECT COUNT(*) FROM information_schema.COLUMNS "
        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND COLUMN_NAME = :c"
    ), {'t': table, 'c': column}).scalar() > 0


def main():
    with app.app_context():
        conn = db.session

        # Held cohort seats need their own deadline: the seat is counted in
        # cohorts.filled_seats from the moment it is held, so the expiry job has
        # to know when to give it back.
        if not _column_exists(conn, 'cohort_enrollments', 'expires_at'):
            conn.execute(text(
                "ALTER TABLE `cohort_enrollments` "
                "ADD COLUMN `expires_at` DATETIME NULL AFTER `payment_status`"
            ))
            print("  cohort_enrollments.expires_at: added")
        else:
            print("  cohort_enrollments.expires_at: already present")

        # The expiry job scans for (pending, past-deadline) rows every minute.
        has_index = conn.execute(text(
            "SELECT COUNT(*) FROM information_schema.STATISTICS "
            "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cohort_enrollments' "
            "AND INDEX_NAME = 'ix_cohort_enroll_expiry'"
        )).scalar()

        if not has_index:
            conn.execute(text(
                "CREATE INDEX ix_cohort_enroll_expiry ON `cohort_enrollments` "
                "(`payment_status`, `expires_at`)"
            ))
            print("  ix_cohort_enroll_expiry: created")
        else:
            print("  ix_cohort_enroll_expiry: already present")

        # Recover slots leaked by the old 'held' status. Back-dated rather than
        # released outright: the expiry procedure re-checks that no payment
        # actually succeeded, which a blunt UPDATE here would not.
        leaked = conn.execute(text(
            "SELECT COUNT(*) FROM `achiever_slots` WHERE status = 'held'"
        )).scalar()

        if leaked:
            conn.execute(text(
                "UPDATE `achiever_slots` "
                "   SET status = 'blocked', "
                "       blocked_until = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 MINUTE) "
                " WHERE status = 'held'"
            ))
            print(f"  recovered {leaked} leaked 'held' slot(s) -> 'blocked', back-dated")
        else:
            print("  no leaked 'held' slots found")

        conn.commit()

        for f in SP_FILES:
            n = apply_sql_file(f)
            print(f"  procedures: {n} statement(s) from {f.split('/')[-1]}")

        print()
        print("verifying:")
        print("  cohort_enrollments.expires_at  ",
              "OK" if _column_exists(conn, 'cohort_enrollments', 'expires_at') else "MISSING")

        remaining = conn.execute(text(
            "SELECT COUNT(*) FROM `achiever_slots` WHERE status = 'held'"
        )).scalar()
        print(f"  slots still on legacy 'held'   {remaining} (want 0)")

        rate = conn.execute(text(
            "SELECT rate FROM `commission_rules` WHERE scope='global' AND is_active=1 LIMIT 1"
        )).scalar()
        print(f"  global commission rate         {rate}")

        print()
        print("done")


if __name__ == '__main__':
    main()
