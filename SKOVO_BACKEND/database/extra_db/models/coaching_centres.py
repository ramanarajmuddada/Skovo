import uuid
from . import db
from datetime import datetime


class CoachingCentres(db.Model):
    """
    Coaching & Skill Centres directory with exclusive Skovo platform discounts.
    Categories: JEE | NEET | Coding | Skill Dev | Language | Finance | Design | Management
    """
    __tablename__ = "coaching_centres"

    id = db.Column(db.CHAR(36), primary_key=True, default=lambda: str(uuid.uuid4()))


    name = db.Column(db.Text, nullable=False)
    description = db.Column(db.Text)

    city = db.Column(db.String(100))
    state = db.Column(db.String(100))
    address = db.Column(db.Text)

    # Stored as JSON array e.g. ["JEE", "NEET", "Coding"]
    categories = db.Column(db.JSON, default=[])

    discount_info = db.Column(db.Text)    # e.g. "15% off for Skovo students"
    discount_percent = db.Column(db.Integer)

    logo_url = db.Column(db.Text)
    banner_url = db.Column(db.Text)
    website_url = db.Column(db.Text)
    contact_phone = db.Column(db.Text)
    contact_email = db.Column(db.Text)

    is_active = db.Column(db.Boolean, default=True)
    is_verified = db.Column(db.Boolean, default=False)

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
