import uuid
from . import db
from datetime import datetime


class Coupons(db.Model):
    """Discount codes applicable to cohort / course / 1-on-1 checkouts."""
    __tablename__ = "coupons"

    id   = db.Column(db.CHAR(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    code = db.Column(db.String(40), unique=True, nullable=False)   # stored UPPERCASE

    discount_type = db.Column(db.String(10), default='percent')    # 'percent' | 'flat'
    value         = db.Column(db.Numeric(10, 2), default=0)         # 10 (% ) or 100 (₹)
    max_discount  = db.Column(db.Numeric(10, 2))                    # cap for percent coupons
    min_amount    = db.Column(db.Numeric(10, 2), default=0)         # min cart value

    applies_to = db.Column(db.String(10), default='all')           # all | cohort | course | session

    max_uses        = db.Column(db.Integer)                        # null = unlimited
    used_count      = db.Column(db.Integer, default=0)
    per_user_limit  = db.Column(db.Integer, default=1)

    valid_from  = db.Column(db.DateTime)
    valid_until = db.Column(db.DateTime)
    is_active   = db.Column(db.Boolean, default=True)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    created_by = db.Column(db.CHAR(36), nullable=True)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = {'mysql_charset': 'utf8mb4', 'mysql_collate': 'utf8mb4_unicode_ci'}


class CouponRedemptions(db.Model):
    """One row per successful coupon use — enforces per-user limits + audit."""
    __tablename__ = "coupon_redemptions"

    id          = db.Column(db.CHAR(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    coupon_id   = db.Column(db.CHAR(36), nullable=False)
    code        = db.Column(db.String(40))
    user_id     = db.Column(db.CHAR(36), nullable=False)
    context_type = db.Column(db.String(10))   # cohort | course | session
    context_id   = db.Column(db.CHAR(36))
    discount_amount = db.Column(db.Numeric(10, 2), default=0)
    created_at  = db.Column(db.DateTime, default=datetime.utcnow)
