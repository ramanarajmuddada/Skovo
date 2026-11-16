import uuid
from . import db
from datetime import datetime


class Opportunities(db.Model):
    """
    Readiness-gated internships, fresher jobs, part-time roles, fellowships.
    Students need a minimum readiness score to apply.
    """
    __tablename__ = "opportunities"

    id = db.Column(db.CHAR(36), primary_key=True, default=lambda: str(uuid.uuid4()))


    title = db.Column(db.Text, nullable=False)
    company = db.Column(db.Text)
    type = db.Column(db.String(20))       # internship | fresher_job | part_time | fellowship

    domain = db.Column(db.String(50))     # technology | finance | healthcare | design | etc.
    location = db.Column(db.Text)
    is_remote = db.Column(db.Boolean, default=False)

    duration = db.Column(db.String(50))   # e.g. "4 months" or "Ongoing"
    stipend_min = db.Column(db.Integer)   # monthly in INR, None for performance-based
    stipend_max = db.Column(db.Integer)
    stipend_type = db.Column(db.String(50), default="fixed")  # fixed | performance_based | unpaid

    min_readiness_score = db.Column(db.Integer, default=0)   # 0 = open to all
    deadline = db.Column(db.DateTime)

    skills_required = db.Column(db.JSON, default=[])
    eligibility_criteria = db.Column(db.Text)
    experience_level = db.Column(db.String(50))   # fresher | junior | mid_level | senior | any
    application_link = db.Column(db.Text)
    is_featured = db.Column(db.Boolean, default=False)

    description = db.Column(db.Text)
    requirements = db.Column(db.JSON, default=[])

    status = db.Column(db.String(20), default="active")  # active | closed | draft

    posted_by = db.Column(db.String(36))  # admin user_id

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
