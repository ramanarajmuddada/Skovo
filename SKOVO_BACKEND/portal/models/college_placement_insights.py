import uuid
from . import db
from datetime import datetime


class CollegePlacementInsights(db.Model):
    """
    Year-wise placement data for a college.
    """
    __tablename__ = "college_placement_insights"

    id = db.Column(db.CHAR(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    college_id = db.Column(db.CHAR(36))

    year = db.Column(db.Integer)
    placement_rate = db.Column(db.Float)
    avg_package = db.Column(db.Float)      # in LPA
    highest_package = db.Column(db.Float)  # in LPA
    total_students  = db.Column(db.Integer)
    placed_students = db.Column(db.Integer)
    median_package  = db.Column(db.Float)
    top_recruiters  = db.Column(db.JSON)    # ['TCS', 'Wipro', 'Google']

    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    created_by = db.Column(db.CHAR(36), nullable=True)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by = db.Column(db.CHAR(36), nullable=True)

    def save(self):
        db.session.add(self)
        db.session.commit()
