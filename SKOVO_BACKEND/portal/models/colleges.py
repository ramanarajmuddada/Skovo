import uuid
from . import db
from datetime import datetime


class Colleges(db.Model):
    """
    College directory for rank-fit matching.
    Types: government | private | deemed | autonomous
    """
    __tablename__ = "colleges"

    id = db.Column(db.CHAR(36), primary_key=True, default=lambda: str(uuid.uuid4()))


    name = db.Column(db.Text, nullable=False)
    institution_subdomain = db.Column(db.String(63))   # tenant subdomain e.g. "iitb" -> iitb.skovo.in
    type = db.Column(db.String(20))        # government | private | deemed | autonomous
    location_city = db.Column(db.String(100))
    location_state = db.Column(db.String(100))

    nirf_ranking = db.Column(db.Integer)
    naac_grade = db.Column(db.String(5))   # A++ | A+ | A | B++ | etc.

    annual_fees_min = db.Column(db.Integer)  # in INR
    annual_fees_max = db.Column(db.Integer)

    placement_rate = db.Column(db.Float)   # percentage e.g. 65.0
    avg_package = db.Column(db.Float)      # in LPA
    highest_package = db.Column(db.Float)  # in LPA

    website_url = db.Column(db.Text)
    logo_url    = db.Column(db.Text)
    banner_url  = db.Column(db.Text)

    # Extended info
    about                  = db.Column(db.Text)
    accreditation          = db.Column(db.String(100))   # NAAC | NBA | NIRF | UGC | AICTE
    contact_info           = db.Column(db.Text)
    admission_process      = db.Column(db.Text)
    entrance_exams_accepted= db.Column(db.JSON)          # ['JEE', 'EAMCET', 'GATE']
    hostel_fee             = db.Column(db.Integer)
    established_year       = db.Column(db.Integer)
    total_students         = db.Column(db.Integer)
    facilities             = db.Column(db.JSON)
    top_recruiters         = db.Column(db.JSON)
    achievements           = db.Column(db.JSON)

    is_active = db.Column(db.Boolean, default=True)

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
