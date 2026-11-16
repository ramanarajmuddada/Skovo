import uuid
from . import db
from datetime import datetime


class Cities(db.Model):
    """
    Cities, hung off a state.

    Seeded with the cities students actually come from; onboarding still accepts
    a typed value for anywhere not listed, so a student is never blocked by a
    gap in our data.
    """
    __tablename__ = "cities"

    id       = db.Column(db.CHAR(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    state_id = db.Column(db.CHAR(36), nullable=False, index=True)

    name     = db.Column(db.String(120), nullable=False)
    district = db.Column(db.String(120))
    tier     = db.Column(db.Integer)                    # 1 | 2 | 3 — for content and pricing decisions

    sort_order = db.Column(db.Integer, default=0)
    is_active  = db.Column(db.Boolean, default=True)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    created_by = db.Column(db.CHAR(36), nullable=True)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by = db.Column(db.CHAR(36), nullable=True)

    __table_args__ = (
        db.UniqueConstraint('state_id', 'name', name='uq_cities_state_name'),
    )

    def save(self):
        db.session.add(self)
        db.session.commit()

    def delete(self):
        db.session.delete(self)
        db.session.commit()
