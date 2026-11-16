import uuid
from . import db
from datetime import datetime


class CollegeReviews(db.Model):
    __tablename__ = "college_reviews"
    id                 = db.Column(db.CHAR(36),  primary_key=True, default=lambda: str(uuid.uuid4()))
    college_id         = db.Column(db.CHAR(36),  nullable=False)
    user_id            = db.Column(db.CHAR(36),  nullable=False)
    rating             = db.Column(db.Integer,   nullable=False)
    academics_rating   = db.Column(db.Integer)
    placement_rating   = db.Column(db.Integer)
    facilities_rating  = db.Column(db.Integer)
    campus_life_rating = db.Column(db.Integer)
    review_text        = db.Column(db.Text)
    pros               = db.Column(db.Text)
    cons               = db.Column(db.Text)
    is_verified        = db.Column(db.Boolean,   default=False)
    is_active          = db.Column(db.Boolean,   default=True)
    created_at         = db.Column(db.DateTime,  default=datetime.utcnow)
    updated_at         = db.Column(db.DateTime,  default=datetime.utcnow, onupdate=datetime.utcnow)
    __table_args__     = (db.UniqueConstraint('college_id', 'user_id', name='uq_college_review'),)
