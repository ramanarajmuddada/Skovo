"""
Booking note on paid 1-on-1 orders.

  * payment_orders.note: what the student wrote in "Note (optional)". A paid
    session is only created once the payment lands, so the note waits on the
    order and is copied to achiever_sessions.note when it is paid.

Additive and idempotent. From SKOVO_BACKEND:
    python database/migrations/migrate_order_note.py
"""
from sqlalchemy import text
import _bootstrap  # noqa: F401
from portal import InitApp
from portal.models import db

app = InitApp().app()


def run():
    with app.app_context():
        db.session.execute(text("SET SESSION lock_wait_timeout = 10"))
        have = db.session.execute(text(
            "SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()"
            " AND TABLE_NAME = 'payment_orders' AND COLUMN_NAME = 'note'")).scalar()
        if have:
            print("  [ok] payment_orders.note already there")
            return
        db.session.execute(text("ALTER TABLE payment_orders ADD COLUMN `note` VARCHAR(1000) NULL"))
        db.session.commit()
        print("  [ok] payment_orders.note")


if __name__ == '__main__':
    run()
