import uuid
from . import db
from datetime import datetime


class ReadinessRules(db.Model):
    """
    Admin-configurable scoring rules per institution.
    ForeignKey declaration omitted to avoid MySQL collation mismatches across environments.
    """
    __tablename__ = "readiness_rules"

    id             = db.Column(db.CHAR(36), primary_key=True, default=lambda: str(uuid.uuid4()))

    # Points per action
    cohort_pts_each  = db.Column(db.Integer, default=5)    # pts per cohort enrolled/attended
    cohort_pts_max   = db.Column(db.Integer, default=25)   # cap on cohort contribution
    task_pts_each    = db.Column(db.Integer, default=5)    # pts per approved task
    task_pts_max     = db.Column(db.Integer, default=25)   # cap on task contribution

    # Unlock threshold
    opportunity_unlock_score = db.Column(db.Integer, default=60)  # score needed to see opportunities

    # Level bands are rows in `readiness_levels` -- editable names and scores,
    # any number of them. The pioneer_min / achiever_min columns that used to
    # live here were dropped: they fixed the count at three and named the top
    # one "Achiever", already the mentor role.

    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    created_by = db.Column(db.CHAR(36), nullable=True)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by = db.Column(db.CHAR(36), nullable=True)

    def save(self):
        db.session.add(self)
        db.session.commit()

    def update(self):
        db.session.commit()
