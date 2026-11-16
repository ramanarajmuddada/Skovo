import uuid
from . import db
from datetime import datetime


class CollegeApplications(db.Model):
    __tablename__ = "college_applications"
    id               = db.Column(db.CHAR(36),    primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id          = db.Column(db.CHAR(36),    nullable=False)
    college_id       = db.Column(db.CHAR(36),    nullable=True)
    college_name     = db.Column(db.String(500))
    program_name     = db.Column(db.String(300))
    exam_type        = db.Column(db.String(50))
    application_date = db.Column(db.Date)
    deadline_date    = db.Column(db.Date)
    status           = db.Column(db.String(30),  default='planning')
    priority         = db.Column(db.String(10),  default='medium')
    notes            = db.Column(db.Text)
    application_url  = db.Column(db.Text)
    created_at       = db.Column(db.DateTime,    default=datetime.utcnow)
    updated_at       = db.Column(db.DateTime,    default=datetime.utcnow, onupdate=datetime.utcnow)
