"""Cohorts: late joining.

An achiever chooses, per cohort, how many minutes after the start a student may
still take a free seat (0 = closes at the start, the old rule).

Run from the SKOVO_BACKEND folder:
    python database/migrations/migrate_v21_cohort_late_join.py
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
            "AND TABLE_NAME = 'cohorts' AND COLUMN_NAME = 'late_join_minutes'")).scalar()
        if not has:
            db.session.execute(text("ALTER TABLE cohorts ADD COLUMN late_join_minutes INT NOT NULL DEFAULT 0"))
            db.session.commit()
        print("migrate_v21_cohort_late_join: done")


if __name__ == '__main__':
    main()
