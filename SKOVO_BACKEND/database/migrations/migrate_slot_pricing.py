"""
1-on-1 slots priced like cohorts.

  * achiever_slots: price, offer (type, value, end), meeting link — set per
    slot; a booked slot keeps the price the student paid.
  * achiever_availability: price and offer per weekly window, copied onto the
    slots made from it (so Monday and Wednesday can cost different amounts).
  * achievers.session_meeting_link: default link for every 1-on-1.
  * class_rules.booking_cutoff_min: students cannot book a slot starting sooner.

Additive and idempotent. From SKOVO_BACKEND:
    python database/migrations/migrate_slot_pricing.py
"""
from sqlalchemy import text
import _bootstrap  # noqa: F401
from portal import InitApp
from portal.models import db

app = InitApp().app()


def _add(table, col, ddl):
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
        # Fail fast instead of queueing behind a live transaction (a waiting
        # ALTER blocks every query on the table, which stalled live once).
        db.session.execute(text("SET SESSION lock_wait_timeout = 10"))
        for t in ('achiever_slots', 'achiever_availability'):
            _add(t, 'price', 'DECIMAL(10,2) NULL')
            _add(t, 'offer_type', 'VARCHAR(10) NULL')
            _add(t, 'offer_value', 'DECIMAL(10,2) NULL')
            _add(t, 'offer_ends_at', 'DATETIME NULL')
        _add('achiever_slots', 'meeting_link', 'VARCHAR(500) NULL')
        # Link per weekly window: every Monday 6-7 PM uses the Monday link.
        _add('achiever_availability', 'meeting_link', 'VARCHAR(500) NULL')
        # What the 1-on-1 is about, shown to students (slot and weekly range).
        for t in ('achiever_slots', 'achiever_availability'):
            _add(t, 'title', 'VARCHAR(80) NULL')
            _add(t, 'about', 'VARCHAR(500) NULL')
        _add('achievers', 'session_meeting_link', 'VARCHAR(500) NULL')
        _add('class_rules', 'booking_cutoff_min', 'INT NOT NULL DEFAULT 60')


if __name__ == '__main__':
    run()
