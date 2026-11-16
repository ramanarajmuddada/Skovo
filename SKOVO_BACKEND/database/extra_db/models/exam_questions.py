import uuid
from . import db
from datetime import datetime


class ExamQuestions(db.Model):
    __tablename__ = "exam_questions"
    id             = db.Column(db.CHAR(36),   primary_key=True, default=lambda: str(uuid.uuid4()))
    mock_test_id   = db.Column(db.CHAR(36),   nullable=False)
    question_text  = db.Column(db.Text,       nullable=False)
    question_type  = db.Column(db.String(20), default='mcq')
    options        = db.Column(db.JSON)
    correct_answer = db.Column(db.Text)
    explanation    = db.Column(db.Text)
    marks          = db.Column(db.Integer,    default=1)
    sort_order     = db.Column(db.Integer,    default=0)
    created_at     = db.Column(db.DateTime,   default=datetime.utcnow)
    updated_at     = db.Column(db.DateTime,   default=datetime.utcnow, onupdate=datetime.utcnow)
