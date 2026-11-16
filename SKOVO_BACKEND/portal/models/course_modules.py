import uuid
from . import db
from datetime import datetime


class CourseModules(db.Model):
    """
    Individual modules/lessons inside an AchieverCourse.
    Can be video, text content, or a scheduled live session.
    """
    __tablename__ = "course_modules"

    id        = db.Column(db.CHAR(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    course_id = db.Column(db.CHAR(36), nullable=False)

    title       = db.Column(db.String(300), nullable=False)
    description = db.Column(db.Text)
    order_index = db.Column(db.Integer, default=0)

    # video | text | live_session | resource
    content_type = db.Column(db.String(30), default='video')
    video_url    = db.Column(db.Text)
    content_text = db.Column(db.Text)

    live_session_date             = db.Column(db.DateTime)
    live_session_duration_minutes = db.Column(db.Integer, default=60)

    is_free_preview = db.Column(db.Boolean, default=False)
    is_active       = db.Column(db.Boolean, default=True)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = {}

    def save(self):
        db.session.add(self)
        db.session.commit()

    def update(self):
        db.session.commit()
