"""
Adds `achievers.cohort_seat_allocation` — how many seats an admin grants an
achiever per cohort.

Until now every achiever cohort was created uncapped: the create path in
achiever.py hardcoded `total_seats: None`, and both enrolment paths read
NULL/0 as "unlimited". The seat machinery was already built and correct
(sp_student_cohort_enroll refuses with 'No seats available.', and the paid
hold in sp_payment_cohort_hold does the same) — it was simply never given a
number to enforce.

The number is the admin's, not the achiever's, for the same reason the
commission rate is: an achiever who sizes their own cohort has no counterparty
on the decision. It is set when the application is approved and can be changed
afterwards from the lifecycle screen.

NULL is deliberate and meaningful: it means "no cap set", which behaves exactly
as every cohort behaved before this column existed. Achievers approved before
this migration keep working unchanged rather than being locked out of their own
cohorts by a column that appeared overnight.

Idempotent: re-running changes nothing.
"""
import _bootstrap  # noqa: F401

from sqlalchemy import text
from portal import InitApp
from portal.models import db

app = InitApp().app()

TABLE = 'achievers'
COLUMN = 'cohort_seat_allocation'


def main():
    with app.app_context():
        present = db.session.execute(
            text("SELECT COUNT(*) FROM information_schema.columns "
                 "WHERE table_schema = DATABASE() "
                 "  AND table_name = :t AND column_name = :c"),
            {'t': TABLE, 'c': COLUMN},
        ).scalar()

        if present:
            print(f"{TABLE}.{COLUMN} already exists - nothing to do")
            return

        db.session.execute(text(
            f"ALTER TABLE `{TABLE}` "
            f"ADD COLUMN `{COLUMN}` INT NULL AFTER `session_rate`"
        ))
        db.session.commit()
        print(f"added {TABLE}.{COLUMN} (INT NULL)")

        left_null = db.session.execute(
            text(f"SELECT COUNT(*) FROM `{TABLE}` WHERE `{COLUMN}` IS NULL")
        ).scalar()
        print(f"{left_null} existing achievers have no allocation yet "
              f"(uncapped, unchanged from before)")


if __name__ == '__main__':
    main()
