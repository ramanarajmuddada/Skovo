import uuid
from . import db
from datetime import datetime


class Masters(db.Model):
    """
    Single master table for all dropdown options across the admin portal.
    Use `type` to group options (e.g. 'college_type', 'degree_type').
    """
    __tablename__ = "masters"

    id         = db.Column(db.CHAR(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    type       = db.Column(db.String(50), nullable=False, index=True)
    value      = db.Column(db.String(100), nullable=False)
    label      = db.Column(db.String(150), nullable=False)
    sort_order = db.Column(db.Integer, default=0)
    is_active  = db.Column(db.Boolean, default=True)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    created_by = db.Column(db.CHAR(36), nullable=True)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by = db.Column(db.CHAR(36), nullable=True)

    __table_args__ = (
        db.UniqueConstraint('type', 'value', name='uq_masters_type_value'),
    )

    def save(self):
        db.session.add(self)
        db.session.commit()

    def update(self):
        db.session.commit()

    def delete(self):
        db.session.delete(self)
        db.session.commit()
