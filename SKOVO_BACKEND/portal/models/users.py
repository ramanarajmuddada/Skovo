import uuid
from . import db
from datetime import datetime


class Users(db.Model):
    __tablename__ = "users"

    id = db.Column(db.CHAR(36), primary_key=True, default=lambda: str(uuid.uuid4()))


    phone = db.Column(db.Text)
    email = db.Column(db.Text)
    full_name = db.Column(db.Text, nullable=False)

    password_hash = db.Column(db.Text)           # NULL for OTP-only users

    avatar_url = db.Column(db.Text)

    # Both are written by sp_user_set_dob. The model declared neither, so a
    # database built by create_all() had no date_of_birth at all and
    # /v1/auth/consent/dob died with 1054 on every signup.
    #
    # There is no age gate: date_of_birth is plain profile data and every
    # account is granted. The band column that used to sit beside these and
    # decide access is gone.
    date_of_birth = db.Column(db.Date)
    consent_status = db.Column(db.String(20), default='pending')
    status = db.Column(db.String(20), default="active")  # active | blocked | deleted

    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    created_by = db.Column(db.CHAR(36), nullable=True)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by = db.Column(db.CHAR(36), nullable=True)
    deleted_at = db.Column(db.DateTime)

    def save(self):
        db.session.add(self)
        db.session.commit()

    def update(self):
        db.session.commit()

    def delete(self):
        db.session.delete(self)
        db.session.commit()
