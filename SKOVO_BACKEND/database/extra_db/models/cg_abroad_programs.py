import uuid
from . import db
from datetime import datetime


class CgAbroadPrograms(db.Model):
    __tablename__ = "cg_abroad_programs"

    id                       = db.Column(db.CHAR(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    country                  = db.Column(db.String(100), nullable=False)
    university_name          = db.Column(db.String(300))
    program_type             = db.Column(db.String(20))
    intake_season            = db.Column(db.String(50))     # Fall | Spring | Summer | Winter | Rolling
    required_exams           = db.Column(db.JSON)
    min_gre_score            = db.Column(db.Integer)
    min_ielts_score          = db.Column(db.Float)
    min_toefl_score          = db.Column(db.Integer)
    min_gpa                  = db.Column(db.Float)
    tuition_per_year_usd     = db.Column(db.Integer)
    living_cost_per_year_usd = db.Column(db.Integer)
    scholarship_available    = db.Column(db.Boolean, default=False)
    scholarship_info         = db.Column(db.Text)
    popular_scholarships     = db.Column(db.JSON)
    duration_years           = db.Column(db.Float)
    language_of_instruction  = db.Column(db.String(50))
    visa_type                = db.Column(db.String(20))
    job_opportunities        = db.Column(db.Text)
    pr_opportunities         = db.Column(db.Text)
    avg_salary_after_ms_usd  = db.Column(db.Integer)
    visa_guidance            = db.Column(db.Text)
    application_process      = db.Column(db.Text)
    application_deadline     = db.Column(db.Date)
    best_for_branches        = db.Column(db.JSON)
    is_active                = db.Column(db.Boolean, default=True)
    created_at               = db.Column(db.DateTime, default=datetime.utcnow)
    created_by               = db.Column(db.CHAR(36), nullable=True)
    updated_at               = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by               = db.Column(db.CHAR(36), nullable=True)
