import uuid
from . import db
from datetime import datetime


class PlatformAnalytics(db.Model):
    __tablename__ = "platform_analytics"
    id          = db.Column(db.CHAR(36),     primary_key=True, default=lambda: str(uuid.uuid4()))
    event_type  = db.Column(db.String(100),  nullable=False)
    entity_type = db.Column(db.String(50))
    entity_id   = db.Column(db.CHAR(36))
    user_id     = db.Column(db.CHAR(36))
    meta        = db.Column(db.JSON)
    session_id  = db.Column(db.String(100))
    ip_address  = db.Column(db.String(45))
    user_agent  = db.Column(db.Text)
    created_at  = db.Column(db.DateTime,     default=datetime.utcnow)
