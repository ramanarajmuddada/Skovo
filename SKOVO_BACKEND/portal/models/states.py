import uuid
from . import db
from datetime import datetime


class States(db.Model):
    """
    Indian states and union territories — a real table, not a `masters` row.

    A state owns cities, boards and state-level entrance exams, so it needs a
    primary key other rows can point at. The generic masters table has no parent
    column, which is why the old data faked hierarchy in the type string.
    """
    __tablename__ = "states"

    id   = db.Column(db.CHAR(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    code = db.Column(db.String(10), nullable=False)     # AP, TS, DL, TN…
    name = db.Column(db.String(100), nullable=False)

    kind   = db.Column(db.String(10), default='state')  # state | ut
    region = db.Column(db.String(20))                   # north | south | east | west | central | northeast

    sort_order = db.Column(db.Integer, default=0)
    is_active  = db.Column(db.Boolean, default=True)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    created_by = db.Column(db.CHAR(36), nullable=True)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by = db.Column(db.CHAR(36), nullable=True)

    __table_args__ = (
        db.UniqueConstraint('code', name='uq_states_code'),
    )

    def save(self):
        db.session.add(self)
        db.session.commit()

    def delete(self):
        db.session.delete(self)
        db.session.commit()
