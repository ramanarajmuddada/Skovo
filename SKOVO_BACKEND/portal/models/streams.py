import uuid
from . import db
from datetime import datetime


class Streams(db.Model):
    """
    11th/12th stream options, per board — with one canonical value underneath.

    The same subject combination is called PCM in CBSE and MPC in Telangana, so
    the label is what the student sees and `canonical` is what we store on the
    profile and target cohorts against. That split is the fix for matching that
    used to fail because two screens spelled a stream differently.

    A board with no rows of its own falls back to the DEFAULT board's set.
    """
    __tablename__ = "streams"

    id       = db.Column(db.CHAR(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    board_id = db.Column(db.CHAR(36), nullable=False, index=True)

    canonical   = db.Column(db.String(40), nullable=False)   # science_pcm, commerce, arts…
    label       = db.Column(db.String(80), nullable=False)   # "MPC (Maths, Physics, Chemistry)"
    short_label = db.Column(db.String(20), nullable=False)   # "MPC"

    sort_order = db.Column(db.Integer, default=0)
    is_active  = db.Column(db.Boolean, default=True)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    created_by = db.Column(db.CHAR(36), nullable=True)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by = db.Column(db.CHAR(36), nullable=True)

    __table_args__ = (
        db.UniqueConstraint('board_id', 'canonical', name='uq_streams_board_canonical'),
    )

    def save(self):
        db.session.add(self)
        db.session.commit()

    def delete(self):
        db.session.delete(self)
        db.session.commit()
