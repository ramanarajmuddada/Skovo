import uuid
from . import db
from datetime import datetime


class UserBadges(db.Model):
    __tablename__ = "user_badges"
    id         = db.Column(db.CHAR(36),  primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id    = db.Column(db.CHAR(36),  nullable=False)
    badge_id   = db.Column(db.CHAR(36),  nullable=False)
    earned_at  = db.Column(db.DateTime,  default=datetime.utcnow)
    created_at = db.Column(db.DateTime,  default=datetime.utcnow)
    __table_args__ = (db.UniqueConstraint('user_id', 'badge_id', name='uq_user_badge'),)
