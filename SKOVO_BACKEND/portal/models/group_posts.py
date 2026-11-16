import uuid
from . import db
from datetime import datetime


class GroupPosts(db.Model):
    """
    Posts inside Assemble groups.
    type = thought: tweet-style text post (Thoughts group)
    type = resource: shared link/resource (Knowledge Booster group)
    type = general: regular post in any group
    """
    __tablename__ = "group_posts"

    id = db.Column(db.CHAR(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    group_id = db.Column(db.CHAR(36))
    user_id = db.Column(db.CHAR(36))

    post_type = db.Column(db.String(20), default="general")  # thought | resource | general

    content = db.Column(db.Text)
    link_url = db.Column(db.Text)        # for resource posts
    link_title = db.Column(db.Text)      # for resource posts
    media_url = db.Column(db.Text)

    likes_count = db.Column(db.Integer, default=0)
    comments_count = db.Column(db.Integer, default=0)

    is_pinned = db.Column(db.Boolean, default=False)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    created_by = db.Column(db.CHAR(36), nullable=True)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by = db.Column(db.CHAR(36), nullable=True)
    deleted_at = db.Column(db.DateTime)

    def save(self):
        db.session.add(self)
        db.session.commit()

    def update(self):
        db.session.commit()

    def delete(self):
        db.session.delete(self)
        db.session.commit()
