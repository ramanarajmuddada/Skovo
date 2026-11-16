import uuid
from . import db
from datetime import datetime


class Sessions(db.Model):
    __tablename__ = "sessions"

    id = db.Column(db.CHAR(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = db.Column(db.CHAR(36), nullable=False)

    jti = db.Column(db.String(64), unique=True, nullable=True)  # JWT ID from refresh token
    refresh_token_hash = db.Column(db.Text)
    device_id = db.Column(db.Text)
    device_meta = db.Column(db.JSON, default={})

    expires_at = db.Column(db.DateTime)
    revoked_at = db.Column(db.DateTime)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    created_by = db.Column(db.CHAR(36), nullable=True)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by = db.Column(db.CHAR(36), nullable=True)

    def save(self):
        db.session.add(self)
        db.session.commit()

    def update(self):
        db.session.commit()
