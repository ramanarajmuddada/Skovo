import uuid
from . import db
from datetime import datetime


class NotificationLogs(db.Model):
    __tablename__ = "notification_logs"

    id = db.Column(db.CHAR(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = db.Column(db.CHAR(36))

    title = db.Column(db.Text)
    body = db.Column(db.Text)
    channel = db.Column(db.String(20))   # push | sms | email
    status = db.Column(db.String(20))    # sent | failed | pending

    type = db.Column(db.String(50), default='system')  # task_scored | opportunity | cohort | booking | mentor | system
    reference_type = db.Column(db.String(50))
    reference_id = db.Column(db.String(36))

    is_read = db.Column(db.Boolean, default=False)

    sent_at = db.Column(db.DateTime)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    created_by = db.Column(db.CHAR(36), nullable=True)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by = db.Column(db.CHAR(36), nullable=True)

    def save(self):
        db.session.add(self)
        db.session.commit()
