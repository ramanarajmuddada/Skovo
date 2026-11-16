import uuid
from . import db
from datetime import datetime


class CgRankData(db.Model):
    __tablename__ = "cg_rank_data"

    id                = db.Column(db.CHAR(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    exam_type         = db.Column(db.String(20), nullable=False, index=True)  # EAMCET | ECET | JEE | NEET
    year              = db.Column(db.Integer, nullable=False)
    marks_obtained    = db.Column(db.Float, nullable=False)
    total_marks       = db.Column(db.Float)
    marks_percentage  = db.Column(db.Float)
    rank_obtained     = db.Column(db.Integer, nullable=False)
    category          = db.Column(db.String(10))
    state             = db.Column(db.String(50))
    data_source       = db.Column(db.String(200))
    created_at        = db.Column(db.DateTime, default=datetime.utcnow)
    created_by        = db.Column(db.CHAR(36), nullable=True)
    updated_at        = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by        = db.Column(db.CHAR(36), nullable=True)
