import uuid
from . import db
from datetime import datetime


class ScholarshipTracking(db.Model):
    __tablename__ = "scholarship_tracking"
    id               = db.Column(db.CHAR(36),    primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id          = db.Column(db.CHAR(36),    nullable=False)
    scholarship_id   = db.Column(db.CHAR(36),    nullable=True)
    scholarship_name = db.Column(db.String(500))
    provider         = db.Column(db.String(300))
    amount           = db.Column(db.Integer)
    deadline_date    = db.Column(db.Date)
    status           = db.Column(db.String(30),  default='interested')
    applied_at       = db.Column(db.Date)
    result           = db.Column(db.String(30))
    notes            = db.Column(db.Text)
    application_url  = db.Column(db.Text)
    created_at       = db.Column(db.DateTime,    default=datetime.utcnow)
    updated_at       = db.Column(db.DateTime,    default=datetime.utcnow, onupdate=datetime.utcnow)
