import uuid
from . import db
from datetime import datetime


class Badges(db.Model):
    __tablename__ = "badges"
    id          = db.Column(db.CHAR(36),    primary_key=True, default=lambda: str(uuid.uuid4()))
    name        = db.Column(db.String(200), nullable=False)
    description = db.Column(db.Text)
    icon_url    = db.Column(db.Text)
    badge_type  = db.Column(db.String(50),  default='achievement')
    criteria    = db.Column(db.JSON)
    points      = db.Column(db.Integer,     default=10)
    is_active   = db.Column(db.Boolean,     default=True)
    created_at  = db.Column(db.DateTime,    default=datetime.utcnow)
    updated_at  = db.Column(db.DateTime,    default=datetime.utcnow, onupdate=datetime.utcnow)
