"""Cohort offers: "first N students" and which seats were bought at the offer.

v1 has no coupon codes. An achiever sets a public offer while creating or
editing a cohort (% or Rs off, optional first-N limit, optional end date) and
every student sees it. The limit is enforced inside sp_payment_cohort_hold,
under the cohort's row lock, from cohort_enrollments.offer_applied.

    cohorts.offer_seats                 INT NULL      NULL = no limit
    cohort_enrollments.offer_applied    TINYINT(1)    1 = this seat took an offer place

Run from the SKOVO_BACKEND folder:
    python database/migrations/migrate_v21_cohort_offer_seats.py
Safe to re-run.
"""
from sqlalchemy import text

import _bootstrap  # noqa: F401
from portal import InitApp
from portal.models import db

app = InitApp().app()

COLUMNS = [
    ('cohorts', 'offer_seats', 'INT NULL'),
    ('cohort_enrollments', 'offer_applied', 'TINYINT(1) NOT NULL DEFAULT 0'),
]


def main():
    with app.app_context():
        for table, col, ddl in COLUMNS:
            has = db.session.execute(text(
                "SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() "
                "AND TABLE_NAME = :t AND COLUMN_NAME = :c"), {'t': table, 'c': col}).scalar()
            if not has:
                db.session.execute(text(f"ALTER TABLE `{table}` ADD COLUMN `{col}` {ddl}"))
        db.session.commit()
        print("migrate_v21_cohort_offer_seats: done")


if __name__ == '__main__':
    main()
