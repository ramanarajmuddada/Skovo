import uuid
from . import db
from datetime import datetime


class ForumPosts(db.Model):
    __tablename__ = "forum_posts"
    id            = db.Column(db.CHAR(36),    primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id       = db.Column(db.CHAR(36),    nullable=False)
    title         = db.Column(db.String(500), nullable=False)
    content       = db.Column(db.Text,        nullable=False)
    category      = db.Column(db.String(50),  default='general')
    tags          = db.Column(db.JSON)
    upvotes       = db.Column(db.Integer,     default=0)
    views         = db.Column(db.Integer,     default=0)
    replies_count = db.Column(db.Integer,     default=0)
    is_pinned     = db.Column(db.Boolean,     default=False)
    is_solved     = db.Column(db.Boolean,     default=False)
    is_active     = db.Column(db.Boolean,     default=True)
    created_at    = db.Column(db.DateTime,    default=datetime.utcnow)
    updated_at    = db.Column(db.DateTime,    default=datetime.utcnow, onupdate=datetime.utcnow)
    deleted_at    = db.Column(db.DateTime,    nullable=True)
