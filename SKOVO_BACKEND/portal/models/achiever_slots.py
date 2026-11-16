import uuid
from . import db
from datetime import datetime


class AchieverSlots(db.Model):
    __tablename__ = "achiever_slots"
    id          = db.Column(db.CHAR(36),  primary_key=True, default=lambda: str(uuid.uuid4()))
    mentor_id   = db.Column(db.CHAR(36),  nullable=False)
    slot_date   = db.Column(db.Date,      nullable=False)
    start_time  = db.Column(db.Time,      nullable=False)
    end_time    = db.Column(db.Time,      nullable=False)
    session_id  = db.Column(db.CHAR(36),  nullable=True)
    status      = db.Column(db.String(20), default='available')
    created_at  = db.Column(db.DateTime,  default=datetime.utcnow)
    updated_at  = db.Column(db.DateTime,  default=datetime.utcnow, onupdate=datetime.utcnow)
