"""
Reopen flow on support issues.

  * reopen_count: how many times the person reopened it (max 3).
  * reopened_at:  last reopen (shown as an orange "Reopened" tag).
  * confirmed_at: the person tapped "Yes, solved".
  "Closed" is not stored: it is Solved more than 7 days ago.

Additive and idempotent. From SKOVO_BACKEND:
    python database/migrations/migrate_support_reopen.py
"""
from sqlalchemy import text
import _bootstrap  # noqa: F401
from portal import InitApp
from portal.models import db

app = InitApp().app()


def run():
    with app.app_context():
        db.session.execute(text("SET SESSION lock_wait_timeout = 10"))
        for col, ddl in (('reopen_count', 'INT NOT NULL DEFAULT 0'), ('reopened_at', 'DATETIME NULL'),
                         ('confirmed_at', 'DATETIME NULL')):
            have = db.session.execute(text(
                "SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()"
                " AND TABLE_NAME = 'support_issues' AND COLUMN_NAME = :c"), {'c': col}).scalar()
            if have:
                print(f"  [ok] support_issues.{col} already there")
                continue
            db.session.execute(text(f"ALTER TABLE support_issues ADD COLUMN `{col}` {ddl}"))
            db.session.commit()
            print(f"  [ok] support_issues.{col}")


if __name__ == '__main__':
    run()
