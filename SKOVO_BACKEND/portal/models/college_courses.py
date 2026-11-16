import uuid
from . import db
from datetime import datetime


class CollegeCourses(db.Model):
    """
    Courses offered by a college.
    e.g. B.Tech CSE, B.Tech ECE, MBA, MCA, B.Pharm
    """
    __tablename__ = "college_courses"

    id = db.Column(db.CHAR(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    college_id = db.Column(db.CHAR(36))

    course_name    = db.Column(db.String(200))
    branch_code    = db.Column(db.String(30))
    duration_years = db.Column(db.Float)
    degree_type    = db.Column(db.String(50))   # UG | PG | Diploma | PhD
    total_seats    = db.Column(db.Integer)
    annual_fee     = db.Column(db.Numeric(12, 2))

    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    created_by = db.Column(db.CHAR(36), nullable=True)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by = db.Column(db.CHAR(36), nullable=True)

    def save(self):
        db.session.add(self)
        db.session.commit()

    def delete(self):
        db.session.delete(self)
        db.session.commit()
