import uuid
from . import db
from datetime import datetime


class LedgerEntries(db.Model):
    """Append-only record of money owed, earned and paid.

    Nothing in this table is ever UPDATEd or DELETEd. A refund is not an edit of
    the original entry, it is a new entry with the opposite sign. That is what
    lets any balance be recomputed from scratch and proved to an achiever who
    disputes it — a mutable balance column can only ever be asserted.

    An achiever's payable balance is:

        SELECT SUM(amount) FROM ledger_entries
         WHERE account_type = 'achiever' AND account_id = ?
           AND entry_type IN ('earning','refund_reversal','payout')

    Sign convention: positive credits the account, negative debits it. A payout
    is therefore negative — it discharges what the platform owes.
    """
    __tablename__ = "ledger_entries"

    id = db.Column(db.CHAR(36), primary_key=True, default=lambda: str(uuid.uuid4()))

    # Who this entry belongs to. platform rows use account_id NULL.
    account_type = db.Column(db.String(20), nullable=False, index=True)  # achiever | platform
    account_id   = db.Column(db.CHAR(36), nullable=True, index=True)

    # earning | platform_fee | refund_reversal | payout | adjustment
    entry_type = db.Column(db.String(30), nullable=False, index=True)
    amount     = db.Column(db.Numeric(12, 2), nullable=False)
    currency   = db.Column(db.String(3), nullable=False, default="INR")

    # What produced this entry, so any line traces back to a real event.
    order_id   = db.Column(db.CHAR(36), nullable=True, index=True)
    session_id = db.Column(db.CHAR(36), nullable=True, index=True)
    payout_id  = db.Column(db.CHAR(36), nullable=True, index=True)

    # Set on a reversing entry to point at the row it reverses.
    reverses_id = db.Column(db.CHAR(36), nullable=True, index=True)

    note       = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)
    created_by = db.Column(db.CHAR(36), nullable=True)

    __table_args__ = {'mysql_charset': 'utf8mb4', 'mysql_collate': 'utf8mb4_unicode_ci'}

    def save(self):
        db.session.add(self)
        db.session.commit()
