import uuid
from . import db
from datetime import datetime


class CgAiPrompts(db.Model):
    __tablename__ = "cg_ai_prompts"

    id               = db.Column(db.CHAR(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    prompt_type      = db.Column(db.String(50), unique=True, nullable=False)
    prompt_text      = db.Column(db.Text(4294967295), nullable=False)
    version          = db.Column(db.Integer, default=1)
    is_active        = db.Column(db.Boolean, default=True)
    updated_by_email = db.Column(db.String(200))
    created_at       = db.Column(db.DateTime, default=datetime.utcnow)
    created_by       = db.Column(db.CHAR(36), nullable=True)
    updated_at       = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by       = db.Column(db.CHAR(36), nullable=True)
