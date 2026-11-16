import uuid
from . import db
from datetime import datetime


class Resumes(db.Model):
    __tablename__ = "resumes"
    id                 = db.Column(db.CHAR(36),    primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id            = db.Column(db.CHAR(36),    nullable=False)
    title              = db.Column(db.String(300), default='My Resume')
    template           = db.Column(db.String(50),  default='classic')
    personal_info      = db.Column(db.JSON)
    education          = db.Column(db.JSON)
    experience         = db.Column(db.JSON)
    skills             = db.Column(db.JSON)
    projects           = db.Column(db.JSON)
    certifications     = db.Column(db.JSON)
    achievements       = db.Column(db.JSON)
    languages          = db.Column(db.JSON)
    summary            = db.Column(db.Text)
    is_active          = db.Column(db.Boolean,     default=True)
    last_downloaded_at = db.Column(db.DateTime)
    created_at         = db.Column(db.DateTime,    default=datetime.utcnow)
    updated_at         = db.Column(db.DateTime,    default=datetime.utcnow, onupdate=datetime.utcnow)
