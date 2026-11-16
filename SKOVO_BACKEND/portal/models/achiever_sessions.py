import uuid
from . import db
from datetime import datetime


class AchieverSessions(db.Model):
    """Student-initiated session requests with an achiever."""
    __tablename__ = "achiever_sessions"

    id         = db.Column(db.CHAR(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    mentor_id  = db.Column(db.String(36), nullable=False, index=True)
    student_id = db.Column(db.String(36), nullable=False, index=True)

    note         = db.Column(db.Text)
    mentor_notes = db.Column(db.Text)
    meeting_link = db.Column(db.String(500))  # achiever-supplied join link (Zoom/Meet/etc.)
    status       = db.Column(db.String(20), default="pending")  # pending | confirmed | completed | cancelled

    # Payment (for paid 1-on-1 sessions; free sessions stay payment_status='free')
    amount           = db.Column(db.Numeric(10, 2), default=0)
    platform_fee     = db.Column(db.Numeric(10, 2), default=0)
    achiever_earning = db.Column(db.Numeric(10, 2), default=0)
    payment_status   = db.Column(db.String(20), default="free")  # free | pending | paid | refunded
    payment_order_id = db.Column(db.String(100), nullable=True)
    payment_id       = db.Column(db.String(100), nullable=True)

    reminder_sent    = db.Column(db.Boolean, default=False)  # pre-session reminder dispatched
    no_show          = db.Column(db.Boolean, default=False)  # student didn't attend

    coupon_code      = db.Column(db.String(40), nullable=True)
    discount_amount  = db.Column(db.Numeric(10, 2), default=0)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    created_by = db.Column(db.CHAR(36), nullable=True)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by = db.Column(db.CHAR(36), nullable=True)
