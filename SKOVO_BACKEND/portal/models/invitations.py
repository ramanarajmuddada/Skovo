import uuid
from . import db
from datetime import datetime


class Invitations(db.Model):
    __tablename__ = "invitations"

    id = db.Column(db.CHAR(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    token = db.Column(db.String(64), unique=True, nullable=False)
    email = db.Column(db.String(255), nullable=False)
    role_code = db.Column(db.String(50), nullable=False, default='mentor')

    invited_by_id = db.Column(db.String(36), nullable=False)
    invited_by_email = db.Column(db.String(255), nullable=False)
    message = db.Column(db.Text, nullable=True)

    expires_at = db.Column(db.DateTime, nullable=False)
    accepted_at = db.Column(db.DateTime, nullable=True)
    accepted_by_id = db.Column(db.String(36), nullable=True)
    revoked_at = db.Column(db.DateTime, nullable=True)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    created_by = db.Column(db.CHAR(36), nullable=True)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by = db.Column(db.CHAR(36), nullable=True)

    def save(self):
        db.session.add(self)
        db.session.commit()
