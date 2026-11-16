import uuid
from . import db
from datetime import datetime


class CgScholarships(db.Model):
    __tablename__ = "cg_scholarships"

    id                       = db.Column(db.CHAR(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name                     = db.Column(db.String(300), nullable=False)
    provider                 = db.Column(db.String(300))
    scheme_type              = db.Column(db.String(20))     # central | state | private | international
    scholarship_mode         = db.Column(db.String(30))     # merit | need_based | merit_cum_need | sports | disability
    notification_pdf_url     = db.Column(db.Text)
    for_state                = db.Column(db.String(100))
    eligible_categories      = db.Column(db.JSON)
    eligible_courses         = db.Column(db.JSON)
    eligible_qualifications  = db.Column(db.JSON)
    income_limit             = db.Column(db.Integer)        # annual family income limit in INR
    benefit_type             = db.Column(db.String(30))     # full_fees | partial | stipend | merit
    benefit_amount           = db.Column(db.Integer)
    eligibility_criteria     = db.Column(db.Text)
    required_documents       = db.Column(db.JSON)
    application_url          = db.Column(db.Text)
    application_deadline_info= db.Column(db.String(200))
    contact_info             = db.Column(db.String(300))
    is_active                = db.Column(db.Boolean, default=True)
    created_at               = db.Column(db.DateTime, default=datetime.utcnow)
    created_by               = db.Column(db.CHAR(36), nullable=True)
    updated_at               = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by               = db.Column(db.CHAR(36), nullable=True)
