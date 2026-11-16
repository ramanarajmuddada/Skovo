import uuid
from . import db
from datetime import datetime


class SopDocuments(db.Model):
    __tablename__ = "sop_documents"
    id                 = db.Column(db.CHAR(36),    primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id            = db.Column(db.CHAR(36),    nullable=False)
    title              = db.Column(db.String(500), nullable=False)
    doc_type           = db.Column(db.String(30),  default='sop')
    target_institution = db.Column(db.String(500))
    target_program     = db.Column(db.String(300))
    content            = db.Column(db.Text)
    word_count         = db.Column(db.Integer)
    status             = db.Column(db.String(20),  default='draft')
    created_at         = db.Column(db.DateTime,    default=datetime.utcnow)
    updated_at         = db.Column(db.DateTime,    default=datetime.utcnow, onupdate=datetime.utcnow)
