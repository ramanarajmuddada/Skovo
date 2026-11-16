import uuid
from . import db
from datetime import datetime


class AchieverAvailability(db.Model):
    __tablename__ = "achiever_availability"
    id          = db.Column(db.CHAR(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    mentor_id   = db.Column(db.CHAR(36), nullable=False)
    day_of_week = db.Column(db.SmallInteger, nullable=False)   # 0=Mon ... 6=Sun
    start_time  = db.Column(db.Time,     nullable=False)
    end_time    = db.Column(db.Time,     nullable=False)
    is_active   = db.Column(db.Boolean,  default=True)
    created_at  = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at  = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
