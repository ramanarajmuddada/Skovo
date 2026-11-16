from datetime import datetime

from . import db


class ProFreeLimits(db.Model):
    """Single-row table: free-tier caps every student shares.

    Admin → Subscriptions writes these numbers. Gates read them. A missing
    row is not a crash — helpers.pro_limits falls back to the shipped defaults.
    """
    __tablename__ = 'pro_free_limits'

    id = db.Column(db.Integer, primary_key=True, autoincrement=False, default=1)
    # Every cap is nullable and NULL means UNLIMITED — Admin → Subscriptions
    # offers Limited / Unlimited per cap. nullable=False would make "no limit"
    # unrepresentable and the ORM fallback path in helpers.pro_limits would
    # reject exactly the value the admin chose.
    free_paid_cohorts = db.Column(db.Integer, nullable=True, default=1)
    saved_colleges = db.Column(db.Integer, nullable=True, default=3)
    communities = db.Column(db.Integer, nullable=True, default=3)
    vault_docs = db.Column(db.Integer, nullable=True, default=5)
    # Was monthly_session_credits; now counted per subscription period.
    session_credits = db.Column(db.Integer, nullable=True, default=2)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by = db.Column(db.CHAR(36), nullable=True)

    __table_args__ = {'mysql_charset': 'utf8mb4', 'mysql_collate': 'utf8mb4_unicode_ci'}
