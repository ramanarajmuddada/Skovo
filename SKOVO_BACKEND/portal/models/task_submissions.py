import uuid
from . import db
from datetime import datetime


class TaskSubmissions(db.Model):
    """
    A student's submission for a cohort task.
    Admin / mentor reviews and scores it; approval triggers readiness score update.
    ForeignKey declarations omitted to avoid MySQL collation mismatches across environments.
    Relationships are enforced at the application level via route queries.
    """
    __tablename__ = "task_submissions"

    id            = db.Column(db.CHAR(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    task_id       = db.Column(db.String(36), nullable=False, index=True)
    user_id       = db.Column(db.String(36), nullable=False, index=True)

    status        = db.Column(db.String(20), default="pending")   # pending | reviewed | approved | rejected
    evidence_url  = db.Column(db.Text)
    evidence_text = db.Column(db.Text)

    mentor_score  = db.Column(db.Integer)        # 0-10
    mentor_notes  = db.Column(db.Text)
    reviewed_by   = db.Column(db.String(36))     # admin user_id
    reviewed_at   = db.Column(db.DateTime)
    submitted_at  = db.Column(db.DateTime, default=datetime.utcnow)

    created_at    = db.Column(db.DateTime, default=datetime.utcnow)
    created_by    = db.Column(db.CHAR(36), nullable=True)
    updated_at    = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by    = db.Column(db.CHAR(36), nullable=True)

    __table_args__ = (
        db.UniqueConstraint('task_id', 'user_id', name='uq_task_submission_user'),
    )

    def save(self):
        db.session.add(self)
        db.session.commit()

    def update(self):
        db.session.commit()
