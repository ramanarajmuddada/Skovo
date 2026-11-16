import uuid
from . import db
from datetime import datetime


class ReadinessAssessments(db.Model):
    """
    4-step readiness assessment responses.
    Step 1: Skills
    Step 2: Experience (internships, projects)
    Step 3: Career Goals
    Step 4: Engagement (cohorts attended, community activity)
    """
    __tablename__ = "readiness_assessments"

    id = db.Column(db.CHAR(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = db.Column(db.CHAR(36))

    step = db.Column(db.Integer)           # 1 | 2 | 3 | 4
    step_data = db.Column(db.JSON, default={})  # flexible answers per step
    is_complete = db.Column(db.Boolean, default=False)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    created_by = db.Column(db.CHAR(36), nullable=True)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by = db.Column(db.CHAR(36), nullable=True)

    def save(self):
        db.session.add(self)
        db.session.commit()

    def update(self):
        db.session.commit()
