import uuid
from . import db
from datetime import datetime


class SessionMessages(db.Model):
    __tablename__ = "session_messages"

    id          = db.Column(db.CHAR(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    session_id  = db.Column(db.CHAR(36), nullable=False, index=True)
    sender_id   = db.Column(db.CHAR(36), nullable=False)
    sender_role = db.Column(db.String(20))   # student | mentor
    body        = db.Column(db.Text, nullable=False)
    is_read     = db.Column(db.Boolean, default=False)
    created_at  = db.Column(db.DateTime, default=datetime.utcnow, index=True)
