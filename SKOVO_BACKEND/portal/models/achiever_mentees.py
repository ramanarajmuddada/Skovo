import uuid
from . import db
from datetime import datetime


class AchieverMentees(db.Model):
    """Mapping of achiever to assigned student mentees."""
    __tablename__ = "achiever_mentees"

    id = db.Column(db.CHAR(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    mentor_id = db.Column(db.String(36), nullable=False)
    mentee_id = db.Column(db.String(36), nullable=False)

    status = db.Column(db.String(20), default="active")  # active | inactive

    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    created_by = db.Column(db.CHAR(36), nullable=True)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by = db.Column(db.CHAR(36), nullable=True)

    def save(self):
        db.session.add(self)
        db.session.commit()

    def update(self):
        db.session.commit()
