import uuid
from datetime import datetime

from . import db


class SupportContacts(db.Model):
    """Emails and phones Admin types. Audience is student / achiever / public."""
    __tablename__ = 'support_contacts'

    id = db.Column(db.CHAR(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    audience = db.Column(db.String(20), nullable=False)
    channel = db.Column(db.String(20), nullable=False)
    value = db.Column(db.String(255), nullable=False)
    label = db.Column(db.String(80), nullable=False)
    hours = db.Column(db.String(120), nullable=True)
    sort_order = db.Column(db.Integer, nullable=False, default=0)
    is_active = db.Column(db.Boolean, nullable=False, default=True)
    created_by = db.Column(db.CHAR(36), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = {'mysql_charset': 'utf8mb4', 'mysql_collate': 'utf8mb4_unicode_ci'}
