import uuid
from . import db
from datetime import datetime


class Referrals(db.Model):
    __tablename__ = "referrals"
    id               = db.Column(db.CHAR(36),    primary_key=True, default=lambda: str(uuid.uuid4()))
    referrer_id      = db.Column(db.CHAR(36),    nullable=False)
    referred_email   = db.Column(db.String(320), nullable=False)
    referred_user_id = db.Column(db.CHAR(36),    nullable=True)
    referral_code    = db.Column(db.String(20),  unique=True)
    status           = db.Column(db.String(20),  default='pending')
    reward_given     = db.Column(db.Boolean,     default=False)
    created_at       = db.Column(db.DateTime,    default=datetime.utcnow)
    updated_at       = db.Column(db.DateTime,    default=datetime.utcnow, onupdate=datetime.utcnow)
