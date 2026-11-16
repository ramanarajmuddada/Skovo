import uuid
from . import db
from datetime import datetime


class CgEntranceExams(db.Model):
    __tablename__ = "cg_entrance_exams"

    id                    = db.Column(db.CHAR(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    exam_code             = db.Column(db.String(30), unique=True, nullable=False)
    exam_name             = db.Column(db.String(200), nullable=False)
    exam_type             = db.Column(db.String(20))
    for_stream            = db.Column(db.String(30))
    conducting_authority  = db.Column(db.String(200))
    exam_mode             = db.Column(db.String(20))        # online | offline | hybrid
    eligibility           = db.Column(db.Text)
    exam_pattern          = db.Column(db.JSON)
    notification_pdf_url  = db.Column(db.Text)
    syllabus_highlights   = db.Column(db.Text)
    counseling_info       = db.Column(db.Text)
    cutoff_notes          = db.Column(db.Text)
    registration_period   = db.Column(db.String(100))
    exam_period           = db.Column(db.String(100))
    useful_for_states     = db.Column(db.JSON)
    official_url          = db.Column(db.Text)
    preparation_tips      = db.Column(db.Text)
    important_books       = db.Column(db.JSON)
    is_active             = db.Column(db.Boolean, default=True)
    created_at            = db.Column(db.DateTime, default=datetime.utcnow)
    created_by            = db.Column(db.CHAR(36), nullable=True)
    updated_at            = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by            = db.Column(db.CHAR(36), nullable=True)
