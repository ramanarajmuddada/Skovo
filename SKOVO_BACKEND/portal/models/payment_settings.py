import uuid
from . import db
from datetime import datetime


class PaymentSettings(db.Model):
    """Operational payment knobs, so none of them live as literals in code.

    Key/value rather than typed columns because the set of knobs grows: adding
    a new one is an INSERT, not a migration plus a deploy. `value_type` is
    carried so readers can cast without guessing.

    Nothing here has a code-side default. A missing row raises rather than
    falling back to an assumed value — a payment priced or held on a guessed
    setting is worse than one that refuses to start, because the guess is
    invisible and only shows up in the numbers weeks later.

    Seeded by migrate_payment_ledger.py:
        hold_minutes      how long a slot stays blocked awaiting payment
        currency          ISO code written onto new orders
        payment_provider  the active gateway; a change here needs no deploy
        order_no_prefix   human-readable prefix on order numbers
    """
    __tablename__ = "payment_settings"

    setting_key   = db.Column(db.String(60), primary_key=True)
    setting_value = db.Column(db.String(255), nullable=False)
    value_type    = db.Column(db.String(20), nullable=False, default="string")  # int|decimal|bool|string

    label = db.Column(db.String(120), nullable=True)
    note  = db.Column(db.Text, nullable=True)

    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by = db.Column(db.CHAR(36), nullable=True)

    __table_args__ = {'mysql_charset': 'utf8mb4', 'mysql_collate': 'utf8mb4_unicode_ci'}

    def save(self):
        db.session.add(self)
        db.session.commit()

    def update(self):
        db.session.commit()
