import uuid
from . import db
from datetime import datetime


class AchieverReviews(db.Model):
    __tablename__ = "achiever_reviews"
    id           = db.Column(db.CHAR(36),    primary_key=True, default=lambda: str(uuid.uuid4()))
    achiever_id  = db.Column(db.CHAR(36),    nullable=False)
    user_id      = db.Column(db.CHAR(36),    nullable=False)   # the student
    rating       = db.Column(db.Integer,     nullable=False)   # 1-5
    review_text  = db.Column(db.Text)
    context_type = db.Column(db.String(20))                    # cohort | session | course | general
    context_id   = db.Column(db.CHAR(36),    nullable=True)    # the cohort/session/course id this review is about
    is_active    = db.Column(db.Boolean,     default=True)
    created_at   = db.Column(db.DateTime,    default=datetime.utcnow)
    updated_at   = db.Column(db.DateTime,    default=datetime.utcnow, onupdate=datetime.utcnow)
