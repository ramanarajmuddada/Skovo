import uuid
from . import db
from datetime import datetime


class MockTests(db.Model):
    __tablename__ = "mock_tests"
    id               = db.Column(db.CHAR(36),     primary_key=True, default=lambda: str(uuid.uuid4()))
    title            = db.Column(db.String(500),  nullable=False)
    exam_type        = db.Column(db.String(50))
    description      = db.Column(db.Text)
    duration_minutes = db.Column(db.Integer,      default=60)
    total_marks      = db.Column(db.Integer,      default=100)
    pass_marks       = db.Column(db.Integer,      default=40)
    difficulty       = db.Column(db.String(20),   default='medium')
    is_active        = db.Column(db.Boolean,      default=True)
    created_at       = db.Column(db.DateTime,     default=datetime.utcnow)
    updated_at       = db.Column(db.DateTime,     default=datetime.utcnow, onupdate=datetime.utcnow)
    created_by       = db.Column(db.CHAR(36))
    updated_by       = db.Column(db.CHAR(36))
