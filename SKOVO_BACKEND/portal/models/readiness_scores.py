import uuid
from . import db
from datetime import datetime


class ReadinessScores(db.Model):
    """
    Live readiness score for a user.
    Score 0-100. Level badge: Explorer (0-29) | Pioneer (30-64) | Achiever (65-100).
    Opportunity Hub unlocks at score >= 65.
    """
    __tablename__ = "readiness_scores"

    id = db.Column(db.CHAR(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = db.Column(db.CHAR(36), unique=True)

    score = db.Column(db.Integer, default=0)
    level = db.Column(db.String(20), default="Explorer")  # Explorer | Pioneer | Achiever

    cohorts_completed = db.Column(db.Integer, default=0)
    tasks_completed = db.Column(db.Integer, default=0)
    assessment_completed = db.Column(db.Boolean, default=False)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    created_by = db.Column(db.CHAR(36), nullable=True)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by = db.Column(db.CHAR(36), nullable=True)

    def save(self):
        db.session.add(self)
        db.session.commit()

    def update(self):
        db.session.commit()
