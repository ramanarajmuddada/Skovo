import uuid
from . import db
from datetime import datetime


class ForumReplies(db.Model):
    __tablename__ = "forum_replies"
    id          = db.Column(db.CHAR(36),  primary_key=True, default=lambda: str(uuid.uuid4()))
    post_id     = db.Column(db.CHAR(36),  nullable=False)
    user_id     = db.Column(db.CHAR(36),  nullable=False)
    content     = db.Column(db.Text,      nullable=False)
    upvotes     = db.Column(db.Integer,   default=0)
    is_accepted = db.Column(db.Boolean,   default=False)
    is_active   = db.Column(db.Boolean,   default=True)
    created_at  = db.Column(db.DateTime,  default=datetime.utcnow)
    updated_at  = db.Column(db.DateTime,  default=datetime.utcnow, onupdate=datetime.utcnow)
    deleted_at  = db.Column(db.DateTime,  nullable=True)
