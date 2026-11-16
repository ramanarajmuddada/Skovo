import uuid
from datetime import datetime

from . import db


class SupportIssues(db.Model):
    """An issue raised in the app. user_id is nullable for a later public form."""
    __tablename__ = 'support_issues'

    id = db.Column(db.CHAR(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = db.Column(db.CHAR(36), nullable=True)
    contact_email = db.Column(db.String(255), nullable=True)
    portal = db.Column(db.String(20), nullable=False)
    subject = db.Column(db.String(200), nullable=False)
    body = db.Column(db.Text, nullable=False)
    category = db.Column(db.String(40), nullable=False, default='other')
    status = db.Column(db.String(20), nullable=False, default='open')
    reference_type = db.Column(db.String(50), nullable=True)
    reference_id = db.Column(db.String(36), nullable=True)
    source = db.Column(db.String(20), nullable=False, default='web')
    first_response_at = db.Column(db.DateTime, nullable=True)
    resolved_at = db.Column(db.DateTime, nullable=True)
    resolved_by = db.Column(db.CHAR(36), nullable=True)
    created_by = db.Column(db.CHAR(36), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = {'mysql_charset': 'utf8mb4', 'mysql_collate': 'utf8mb4_unicode_ci'}
