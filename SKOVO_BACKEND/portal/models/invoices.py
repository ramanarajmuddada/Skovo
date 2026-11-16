import uuid
from . import db
from datetime import datetime


class Invoices(db.Model):
    """GST tax invoice / receipt generated for every paid purchase."""
    __tablename__ = "invoices"

    id             = db.Column(db.CHAR(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    invoice_number = db.Column(db.String(40), unique=True, nullable=False)   # SKOVO/2026/000123

    user_id      = db.Column(db.CHAR(36), nullable=False)
    context_type = db.Column(db.String(10))    # cohort | course | session
    context_id   = db.Column(db.CHAR(36))
    description  = db.Column(db.Text)

    # Money (₹). gross = base before tax; total = what the student paid.
    base_amount    = db.Column(db.Numeric(10, 2), default=0)   # taxable value
    discount_amount = db.Column(db.Numeric(10, 2), default=0)
    gst_rate       = db.Column(db.Numeric(5, 2), default=18)   # %
    gst_amount     = db.Column(db.Numeric(10, 2), default=0)
    total_amount   = db.Column(db.Numeric(10, 2), default=0)

    payment_id     = db.Column(db.String(100))
    coupon_code    = db.Column(db.String(40))
    status         = db.Column(db.String(15), default='paid')  # paid | refunded
    refunded_at    = db.Column(db.DateTime)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    __table_args__ = {'mysql_charset': 'utf8mb4', 'mysql_collate': 'utf8mb4_unicode_ci'}
