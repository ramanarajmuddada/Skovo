import uuid
from . import db
from datetime import datetime


class OtpRequests(db.Model):
    __tablename__ = "otp_requests"

    id = db.Column(db.CHAR(36), primary_key=True, default=lambda: str(uuid.uuid4()))

    channel = db.Column(db.String(10))     # sms | email
    target = db.Column(db.Text)            # phone number or email address
    otp_hash = db.Column(db.Text)          # SHA-256 hash of OTP
    # Privilege scope of this OTP so a low-priv code (student/achiever) can never be
    # replayed against an admin/super flow. NULL = legacy (pre-migration) codes.
    purpose = db.Column(db.String(30), nullable=True)

    attempt_count = db.Column(db.Integer, default=0)
    expires_at = db.Column(db.DateTime)
    verified_at = db.Column(db.DateTime)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    created_by = db.Column(db.CHAR(36), nullable=True)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by = db.Column(db.CHAR(36), nullable=True)

    def save(self):
        db.session.add(self)
        db.session.commit()

    def update(self):
        db.session.commit()
