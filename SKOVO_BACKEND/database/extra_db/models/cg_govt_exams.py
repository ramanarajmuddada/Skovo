import uuid
from . import db
from datetime import datetime


class CgGovtExams(db.Model):
    __tablename__ = "cg_govt_exams"

    id                          = db.Column(db.CHAR(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name                        = db.Column(db.String(200), nullable=False)
    exam_category               = db.Column(db.String(30))  # upsc | ssc | banking | railway | state | police | teaching | psu | defence
    conducting_body             = db.Column(db.String(200))
    for_state                   = db.Column(db.String(100))
    eligible_qualifications     = db.Column(db.JSON)
    eligible_age_min            = db.Column(db.Integer)
    eligible_age_max            = db.Column(db.Integer)
    age_relaxation_info         = db.Column(db.Text)
    salary_min                  = db.Column(db.Integer)
    salary_max                  = db.Column(db.Integer)
    job_benefits                = db.Column(db.Text)
    competition_level           = db.Column(db.String(15))  # very_high | high | medium | low
    preparation_timeline_months = db.Column(db.Integer)
    syllabus                    = db.Column(db.JSON)
    roadmap                     = db.Column(db.JSON)
    recommended_books           = db.Column(db.JSON)
    notification_url            = db.Column(db.Text)
    official_website            = db.Column(db.Text)
    is_active                   = db.Column(db.Boolean, default=True)
    created_at                  = db.Column(db.DateTime, default=datetime.utcnow)
    created_by                  = db.Column(db.CHAR(36), nullable=True)
    updated_at                  = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by                  = db.Column(db.CHAR(36), nullable=True)
