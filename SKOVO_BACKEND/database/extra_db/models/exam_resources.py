import uuid
from . import db
from datetime import datetime


class ExamResources(db.Model):
    __tablename__ = "exam_resources"
    id            = db.Column(db.CHAR(36),    primary_key=True, default=lambda: str(uuid.uuid4()))
    title         = db.Column(db.String(500), nullable=False)
    description   = db.Column(db.Text)
    exam_type     = db.Column(db.String(50))
    subject       = db.Column(db.String(100))
    resource_type = db.Column(db.String(30),  default='notes')
    file_url      = db.Column(db.Text)
    external_url  = db.Column(db.Text)
    thumbnail_url = db.Column(db.Text)
    tags          = db.Column(db.JSON)
    downloads     = db.Column(db.Integer,     default=0)
    is_free       = db.Column(db.Boolean,     default=True)
    is_active     = db.Column(db.Boolean,     default=True)
    created_at    = db.Column(db.DateTime,    default=datetime.utcnow)
    updated_at    = db.Column(db.DateTime,    default=datetime.utcnow, onupdate=datetime.utcnow)
    created_by    = db.Column(db.CHAR(36))
    updated_by    = db.Column(db.CHAR(36))
