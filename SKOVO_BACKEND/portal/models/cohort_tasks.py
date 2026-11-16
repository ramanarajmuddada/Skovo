import uuid
from . import db
from datetime import datetime


class CohortTasks(db.Model):
    """
    Tasks assigned to a cohort. Students must submit evidence to earn readiness points.
    ForeignKey declarations omitted to avoid MySQL collation mismatches across environments.
    Relationships are enforced at the application level via route queries.
    """
    __tablename__ = "cohort_tasks"

    id             = db.Column(db.CHAR(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    cohort_id      = db.Column(db.String(36), nullable=False, index=True)

    title           = db.Column(db.String(255), nullable=False)
    description     = db.Column(db.Text)
    task_type       = db.Column(db.String(50))   # assignment | quiz | project | presentation | live_session
    submission_type = db.Column(db.String(50))   # url_link | file_upload | text_only | github_repo | video_link
    difficulty_level= db.Column(db.String(50))   # beginner | intermediate | advanced
    attachment_url  = db.Column(db.Text)
    task_status     = db.Column(db.String(20), default='active')  # active | inactive | draft
    due_date        = db.Column(db.DateTime)
    score_weight    = db.Column(db.Integer, default=0)

    created_at     = db.Column(db.DateTime, default=datetime.utcnow)
    created_by     = db.Column(db.CHAR(36), nullable=True)
    updated_at     = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by     = db.Column(db.CHAR(36), nullable=True)
    deleted_at     = db.Column(db.DateTime)

    def save(self):
        db.session.add(self)
        db.session.commit()

    def update(self):
        db.session.commit()
