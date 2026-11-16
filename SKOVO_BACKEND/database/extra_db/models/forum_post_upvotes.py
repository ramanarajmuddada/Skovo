import uuid
from . import db
from datetime import datetime


class ForumPostUpvotes(db.Model):
    """One row per (post, user) — prevents a user upvoting the same post twice."""
    __tablename__ = "forum_post_upvotes"

    id = db.Column(db.CHAR(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    post_id = db.Column(db.CHAR(36), nullable=False)
    user_id = db.Column(db.CHAR(36), nullable=False)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    __table_args__ = (
        db.UniqueConstraint('post_id', 'user_id', name='uq_forum_upvote_post_user'),
    )

    def save(self):
        db.session.add(self)
        db.session.commit()

    def delete(self):
        db.session.delete(self)
        db.session.commit()
