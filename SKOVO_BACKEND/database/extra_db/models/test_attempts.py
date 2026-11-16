import uuid
from . import db
from datetime import datetime


class TestAttempts(db.Model):
    __tablename__ = "test_attempts"
    id                 = db.Column(db.CHAR(36),  primary_key=True, default=lambda: str(uuid.uuid4()))
    mock_test_id       = db.Column(db.CHAR(36),  nullable=False)
    user_id            = db.Column(db.CHAR(36),  nullable=False)
    answers            = db.Column(db.JSON)
    score              = db.Column(db.Integer)
    total_marks        = db.Column(db.Integer)
    percentage         = db.Column(db.Float)
    passed             = db.Column(db.Boolean)
    time_taken_minutes = db.Column(db.Integer)
    status             = db.Column(db.String(20), default='in_progress')
    started_at         = db.Column(db.DateTime)
    completed_at       = db.Column(db.DateTime)
    created_at         = db.Column(db.DateTime,   default=datetime.utcnow)
