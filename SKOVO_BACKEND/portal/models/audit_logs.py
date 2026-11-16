import uuid
from . import db
from datetime import datetime


class AuditLogs(db.Model):
    __tablename__ = "audit_logs"

    id = db.Column(db.CHAR(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = db.Column(db.String(36))

    action = db.Column(db.String(100))         # e.g. user.login, cohort.enroll
    resource_type = db.Column(db.String(50))   # user | cohort | college | opportunity | etc.
    resource_id = db.Column(db.String(36))

    ip_address = db.Column(db.String(50))
    user_agent = db.Column(db.Text)
    meta = db.Column(db.JSON, default={})

    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    created_by = db.Column(db.CHAR(36), nullable=True)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by = db.Column(db.CHAR(36), nullable=True)

    def save(self):
        db.session.add(self)
        db.session.commit()
