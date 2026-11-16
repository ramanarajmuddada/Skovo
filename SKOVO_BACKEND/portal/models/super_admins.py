import uuid
from . import db
from datetime import datetime


class SuperAdmins(db.Model):
    __tablename__ = "super_admins"

    id            = db.Column(db.CHAR(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    full_name     = db.Column(db.String(255), nullable=False)
    email         = db.Column(db.String(255), unique=True, nullable=False)
    password_hash = db.Column(db.Text, nullable=False)
    status        = db.Column(db.String(20), nullable=False, default='active')
    created_at    = db.Column(db.DateTime, default=datetime.utcnow)
    created_by    = db.Column(db.CHAR(36), nullable=True)
    updated_at    = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by    = db.Column(db.CHAR(36), nullable=True)
