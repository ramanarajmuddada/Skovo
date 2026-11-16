"""
Gender for students and achievers, date of birth for achievers.

  * users.gender            student's gender (value from master_gender)
  * achievers.gender        achiever's gender
  * achievers.date_of_birth checked against the ID during verification
  * master_gender row 'prefer_not' ("Prefer not to say")

The 'all' row in master_gender is for filters only; forms leave it out.
Additive and idempotent: only new columns and one new masters row.
From SKOVO_BACKEND:
    python database/migrations/migrate_gender_dob.py
"""
from sqlalchemy import text
import _bootstrap  # noqa: F401
from portal import InitApp
from portal.models import db

app = InitApp().app()

COLUMNS = [
    ('users',     'gender',        "VARCHAR(20) NULL"),
    ('achievers', 'gender',        "VARCHAR(20) NULL"),
    ('achievers', 'date_of_birth', "DATE NULL"),
]


def _has(table, column):
    return db.session.execute(text(
        "SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()"
        " AND TABLE_NAME = :t AND COLUMN_NAME = :c"), {'t': table, 'c': column}).scalar()


def run():
    with app.app_context():
        db.session.execute(text("SET SESSION lock_wait_timeout = 10"))
        for table, column, ddl in COLUMNS:
            if _has(table, column):
                print(f"  [ok] {table}.{column} already there")
                continue
            db.session.execute(text(f"ALTER TABLE `{table}` ADD COLUMN `{column}` {ddl}"))
            db.session.commit()
            print(f"  [ok] {table}.{column}")

        exists = db.session.execute(text(
            "SELECT COUNT(*) FROM master_gender WHERE value = 'prefer_not'")).scalar()
        if exists:
            print("  [ok] master_gender 'prefer_not' already there")
        else:
            db.session.execute(text(
                "INSERT INTO master_gender (id, value, label, sort_order, is_active, created_at, updated_at)"
                " VALUES (UUID(), 'prefer_not', 'Prefer not to say', 50, 1, UTC_TIMESTAMP(), UTC_TIMESTAMP())"))
            db.session.commit()
            print("  [ok] master_gender 'prefer_not'")


if __name__ == '__main__':
    run()
