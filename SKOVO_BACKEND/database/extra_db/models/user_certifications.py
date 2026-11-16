import uuid
from . import db
from datetime import datetime


class UserCertifications(db.Model):
    __tablename__ = "user_certifications"
    id              = db.Column(db.CHAR(36),    primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id         = db.Column(db.CHAR(36),    nullable=False)
    title           = db.Column(db.String(500), nullable=False)
    provider        = db.Column(db.String(300))
    credential_id   = db.Column(db.String(200))
    issue_date      = db.Column(db.Date)
    expiry_date     = db.Column(db.Date)
    certificate_url = db.Column(db.Text)
    skills          = db.Column(db.JSON)
    is_verified     = db.Column(db.Boolean,     default=False)
    created_at      = db.Column(db.DateTime,    default=datetime.utcnow)
    updated_at      = db.Column(db.DateTime,    default=datetime.utcnow, onupdate=datetime.utcnow)
