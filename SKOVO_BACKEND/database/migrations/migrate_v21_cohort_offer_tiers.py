"""Cohort offers in slabs: first 3 at 50% off, next 3 at 40%, ...

    cohorts.offer_tiers  JSON NULL
        {"type": "percent" | "amount", "tiers": [{"seats": 3, "value": 50}, ...]}
        A blank `seats` on the last slab means every remaining seat.

A single offer is one slab. Cohorts saved before this keep their
offer_price / offer_percent / offer_seats and are priced as before.
The slab price is worked out again inside sp_payment_cohort_hold_offer,
under the cohort's row lock.

Run from the SKOVO_BACKEND folder:
    python database/migrations/migrate_v21_cohort_offer_tiers.py
Safe to re-run.
"""
from sqlalchemy import text

import _bootstrap  # noqa: F401
from portal import InitApp
from portal.models import db

app = InitApp().app()


def main():
    with app.app_context():
        has = db.session.execute(text(
            "SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() "
            "AND TABLE_NAME = 'cohorts' AND COLUMN_NAME = 'offer_tiers'")).scalar()
        if not has:
            db.session.execute(text("ALTER TABLE `cohorts` ADD COLUMN `offer_tiers` JSON NULL"))
            db.session.commit()
        print("migrate_v21_cohort_offer_tiers: done")


if __name__ == '__main__':
    main()
