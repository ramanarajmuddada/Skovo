import uuid
from . import db
from datetime import datetime


class UserStreaks(db.Model):
    __tablename__ = "user_streaks"
    id               = db.Column(db.CHAR(36),  primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id          = db.Column(db.CHAR(36),  nullable=False, unique=True)
    current_streak   = db.Column(db.Integer,   default=0)
    longest_streak   = db.Column(db.Integer,   default=0)
    last_active_date = db.Column(db.Date)
    total_points     = db.Column(db.Integer,   default=0)
    created_at       = db.Column(db.DateTime,  default=datetime.utcnow)
    updated_at       = db.Column(db.DateTime,  default=datetime.utcnow, onupdate=datetime.utcnow)
