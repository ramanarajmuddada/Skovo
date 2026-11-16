import uuid
from . import db
from datetime import datetime


class CgCollegeCutoffs(db.Model):
    __tablename__ = "cg_college_cutoffs"

    id           = db.Column(db.CHAR(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    college_name = db.Column(db.String(500), nullable=False, index=True)
    college_city = db.Column(db.String(100))
    college_state= db.Column(db.String(100))
    college_type = db.Column(db.String(20))   # government | private | deemed | autonomous
    branch_code  = db.Column(db.String(30),  index=True)
    branch_name  = db.Column(db.String(200))
    exam_type    = db.Column(db.String(20),  index=True)  # EAMCET | ECET | JEE | NEET
    year         = db.Column(db.Integer, nullable=False)
    category     = db.Column(db.String(10))  # OC | BC-A | BC-B | BC-C | BC-D | BC-E | SC | ST | EWS
    gender       = db.Column(db.String(10))  # Boys | Girls | CoEd
    opening_rank = db.Column(db.Integer)
    closing_rank = db.Column(db.Integer)
    total_seats  = db.Column(db.Integer)
    created_at   = db.Column(db.DateTime, default=datetime.utcnow)
    created_by   = db.Column(db.CHAR(36), nullable=True)
    updated_at   = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by   = db.Column(db.CHAR(36), nullable=True)
