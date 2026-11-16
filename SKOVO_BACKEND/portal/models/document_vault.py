import uuid
from . import db
from datetime import datetime


class DocumentVault(db.Model):
    __tablename__ = "document_vault"
    id          = db.Column(db.CHAR(36),    primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id     = db.Column(db.CHAR(36),    nullable=False)
    name        = db.Column(db.String(500), nullable=False)
    file_url    = db.Column(db.Text,        nullable=False)
    file_type   = db.Column(db.String(50))
    file_size   = db.Column(db.Integer)
    category    = db.Column(db.String(50),  default='general')
    tags        = db.Column(db.JSON)
    is_active   = db.Column(db.Boolean,     default=True)
    created_at  = db.Column(db.DateTime,    default=datetime.utcnow)
    updated_at  = db.Column(db.DateTime,    default=datetime.utcnow, onupdate=datetime.utcnow)
