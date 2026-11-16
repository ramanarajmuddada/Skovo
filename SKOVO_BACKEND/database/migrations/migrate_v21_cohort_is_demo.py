"""Cohorts: is_demo.

A demo is a free cohort run while the achiever is on probation. Before this,
"free" and "demo" were the same test (price = 0), so a free class an active
achiever runs later counted as a demo too. The flag is set once, at creation.

Backfill: free cohorts created while the achiever was still on probation
(achiever still on probation, or created before their move to active).

Run from the SKOVO_BACKEND folder:
    python database/migrations/migrate_v21_cohort_is_demo.py
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
            "AND TABLE_NAME = 'cohorts' AND COLUMN_NAME = 'is_demo'")).scalar()
        if not has:
            db.session.execute(text("ALTER TABLE cohorts ADD COLUMN is_demo TINYINT(1) NOT NULL DEFAULT 0"))
            db.session.execute(text("""
                UPDATE cohorts c
                  JOIN achievers a ON a.id = c.achiever_id
                   SET c.is_demo = 1
                 WHERE IFNULL(c.price, 0) = 0
                   AND (a.state = 'probation'
                        OR c.created_at < (SELECT MIN(e.created_at) FROM achiever_state_events e
                                            WHERE e.achiever_id = a.id AND e.to_state = 'active'))"""))
            db.session.commit()
        print("migrate_v21_cohort_is_demo: done")


if __name__ == '__main__':
    main()
