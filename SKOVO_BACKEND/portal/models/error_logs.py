import uuid
from . import db
from datetime import datetime


class ErrorLogs(db.Model):
    __tablename__ = "error_logs"

    id = db.Column(db.CHAR(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    error_id = db.Column(db.CHAR(8), unique=True, nullable=False)

    endpoint = db.Column(db.String(255))
    method = db.Column(db.String(10))
    status_code = db.Column(db.Integer, default=500)

    error_type = db.Column(db.String(100))
    error_message = db.Column(db.Text)
    traceback = db.Column(db.Text)

    user_id = db.Column(db.String(36), nullable=True)
    role = db.Column(db.String(20), nullable=True)
    ip_address = db.Column(db.String(50), nullable=True)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def save(self):
        db.session.add(self)
        db.session.commit()
