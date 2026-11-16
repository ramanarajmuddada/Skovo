import uuid
from . import db
from datetime import datetime


class Groups(db.Model):
    """
    Assemble community groups.
    Special types: thoughts (tweet-style posts) | knowledge_booster (shared resources)
    Regular groups by category: Semi Startup | JEE Mains | Career Prep | Coding | Design | Finance | General
    """
    __tablename__ = "groups"

    id = db.Column(db.CHAR(36), primary_key=True, default=lambda: str(uuid.uuid4()))


    name = db.Column(db.Text, nullable=False)
    description = db.Column(db.Text)
    category = db.Column(db.String(50))
    # Semi Startup | JEE Mains | Career Prep | Coding | Design | Finance | General

    group_type = db.Column(db.String(20), default="regular")  # regular | thoughts | knowledge_booster

    icon_url = db.Column(db.Text)
    icon_color = db.Column(db.String(20))   # hex color for icon background

    min_members = db.Column(db.Integer)
    max_members = db.Column(db.Integer)

    join_type = db.Column(db.String(20), default="request")  # open | request

    member_count = db.Column(db.Integer, default=0)

    created_by = db.Column(db.CHAR(36))
    is_active = db.Column(db.Boolean, default=True)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)
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
