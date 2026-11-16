import uuid
from . import db
from datetime import datetime


class CourseProgress(db.Model):
    """Tracks which modules a student has completed in an enrolled course."""
    __tablename__ = "course_progress"

    id        = db.Column(db.CHAR(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id   = db.Column(db.CHAR(36), nullable=False)
    course_id = db.Column(db.CHAR(36), nullable=False)
    module_id = db.Column(db.CHAR(36), nullable=False)

    completed_at = db.Column(db.DateTime, default=datetime.utcnow)

    __table_args__ = (
        db.UniqueConstraint('user_id', 'module_id', name='uq_progress_user_module'),
    )

    def save(self):
        db.session.add(self)
        db.session.commit()
