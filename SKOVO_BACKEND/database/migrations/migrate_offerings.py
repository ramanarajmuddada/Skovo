"""
1-on-1s as offerings (what the achiever offers) + hours (when he is free).

  * achiever_offerings: title, about, length, price/offer, link, days,
    available from/to, active/paused. Students pick one, then a free time.
  * achiever_date_overrides: one-off changes to the weekly hours — a day off,
    or extra hours on a date.
  * achiever_slots.offering_id: the slot a booking creates remembers which
    1-on-1 it was (title, length and price are copied onto the slot too, so a
    later edit never changes a booking).

Additive and idempotent. From SKOVO_BACKEND:
    python database/migrations/migrate_offerings.py
"""
from sqlalchemy import text
import _bootstrap  # noqa: F401
from portal import InitApp
from portal.models import db

app = InitApp().app()


def _table(name, ddl):
    have = db.session.execute(text(
        "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t"),
        {'t': name}).scalar()
    if have:
        print(f"  [ok] {name} already there")
        return
    db.session.execute(text(ddl))
    db.session.commit()
    print(f"  [ok] {name}")


def _col(table, col, ddl):
    have = db.session.execute(text(
        "SELECT COUNT(*) FROM information_schema.COLUMNS"
        " WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND COLUMN_NAME = :c"), {'t': table, 'c': col}).scalar()
    if have:
        print(f"  [ok] {table}.{col} already there")
        return
    db.session.execute(text(f"ALTER TABLE `{table}` ADD COLUMN `{col}` {ddl}"))
    db.session.commit()
    print(f"  [ok] {table}.{col}")


def run():
    with app.app_context():
        db.session.execute(text("SET SESSION lock_wait_timeout = 10"))
        _table('achiever_offerings', """
            CREATE TABLE `achiever_offerings` (
              `id` CHAR(36) NOT NULL PRIMARY KEY,
              `mentor_id` CHAR(36) NOT NULL,
              `title` VARCHAR(80) NOT NULL,
              `about` VARCHAR(500) NULL,
              `duration_min` INT NOT NULL,
              `price` DECIMAL(10,2) NOT NULL DEFAULT 0,
              `offer_type` VARCHAR(10) NULL,
              `offer_value` DECIMAL(10,2) NULL,
              `offer_ends_at` DATETIME NULL,
              `meeting_link` VARCHAR(500) NULL,
              `days` VARCHAR(20) NULL,
              `available_from` DATE NULL,
              `available_to` DATE NULL,
              `status` VARCHAR(10) NOT NULL DEFAULT 'active',
              `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
              `updated_at` DATETIME NULL,
              KEY `ix_offerings_mentor` (`mentor_id`, `status`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci""")
        _table('achiever_date_overrides', """
            CREATE TABLE `achiever_date_overrides` (
              `id` CHAR(36) NOT NULL PRIMARY KEY,
              `mentor_id` CHAR(36) NOT NULL,
              `on_date` DATE NOT NULL,
              `kind` VARCHAR(10) NOT NULL,
              `start_time` TIME NULL,
              `end_time` TIME NULL,
              `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
              KEY `ix_overrides_mentor_date` (`mentor_id`, `on_date`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci""")
        _col('achiever_slots', 'offering_id', 'CHAR(36) NULL')


if __name__ == '__main__':
    run()
