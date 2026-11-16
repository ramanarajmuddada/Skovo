import uuid
from . import db
from datetime import datetime


class GroupMemberships(db.Model):
    """
    Members of Assemble groups.
    Creating/managing a group earns +10 Leadership Points.
    Staying active earns +5 Passion Points.
    """
    __tablename__ = "group_memberships"

    id = db.Column(db.CHAR(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = db.Column(db.CHAR(36))
    group_id = db.Column(db.CHAR(36))

    role = db.Column(db.String(20), default="member")  # leader | member
    status = db.Column(db.String(20), default="active")  # pending | active | rejected | left

    joined_at = db.Column(db.DateTime)
    requested_at = db.Column(db.DateTime, default=datetime.utcnow)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    created_by = db.Column(db.CHAR(36), nullable=True)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by = db.Column(db.CHAR(36), nullable=True)

    def save(self):
        db.session.add(self)
        db.session.commit()

    def update(self):
        db.session.commit()
