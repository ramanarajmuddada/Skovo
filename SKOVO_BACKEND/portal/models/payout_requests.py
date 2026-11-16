import uuid
from . import db
from datetime import datetime


class PayoutRequests(db.Model):
    """Achiever-initiated payout (withdrawal) requests."""
    __tablename__ = "payout_requests"

    id          = db.Column(db.CHAR(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    achiever_id = db.Column(db.CHAR(36), nullable=False, index=True)
    amount      = db.Column(db.Numeric(10, 2), nullable=False)
    status      = db.Column(db.String(20), default="pending")  # pending | processing | failed | paid | rejected
    method      = db.Column(db.String(20))                      # bank | upi

    # Snapshot of the achiever's payout details at request time
    account_name   = db.Column(db.String(150), nullable=True)
    account_number = db.Column(db.String(50),  nullable=True)
    ifsc           = db.Column(db.String(20), nullable=True)
    upi            = db.Column(db.String(100), nullable=True)

    # Cashfree Payouts. Paid only after SUCCESS + UTR — never on Admin Pay click.
    transfer_id    = db.Column(db.String(40), nullable=True, index=True)
    cf_transfer_id = db.Column(db.String(80), nullable=True)
    utr            = db.Column(db.String(40), nullable=True)
    failure_reason = db.Column(db.String(255), nullable=True)

    note         = db.Column(db.Text)
    created_at   = db.Column(db.DateTime, default=datetime.utcnow)
    processed_at = db.Column(db.DateTime, nullable=True)

    __table_args__ = {'mysql_charset': 'utf8mb4', 'mysql_collate': 'utf8mb4_unicode_ci'}

    def save(self):
        db.session.add(self)
        db.session.commit()

    def update(self):
        db.session.commit()
