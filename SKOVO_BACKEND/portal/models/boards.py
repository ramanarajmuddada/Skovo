import uuid
from . import db
from datetime import datetime


class Boards(db.Model):
    """
    School boards — national (CBSE, ICSE, NIOS) and one per state.

    The board is what decides a student's stream vocabulary, syllabus and exam
    calendar, so it hangs off a state and owns its stream rows.
    """
    __tablename__ = "boards"

    id       = db.Column(db.CHAR(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    code     = db.Column(db.String(20), nullable=False)    # CBSE, TSBIE, BIEAP…
    name     = db.Column(db.String(150), nullable=False)
    state_id = db.Column(db.CHAR(36), index=True)          # NULL for national boards

    is_national = db.Column(db.Boolean, default=False)
    sort_order  = db.Column(db.Integer, default=0)
    is_active   = db.Column(db.Boolean, default=True)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    created_by = db.Column(db.CHAR(36), nullable=True)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by = db.Column(db.CHAR(36), nullable=True)

    __table_args__ = (
        db.UniqueConstraint('code', name='uq_boards_code'),
    )

    def save(self):
        db.session.add(self)
        db.session.commit()

    def delete(self):
        db.session.delete(self)
        db.session.commit()
