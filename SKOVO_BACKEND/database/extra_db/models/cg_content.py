import uuid
from . import db
from datetime import datetime


class CgContent(db.Model):
    __tablename__ = "cg_content"

    id               = db.Column(db.CHAR(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    content_type     = db.Column(db.String(30))     # blog | notification | article | announcement | exam_update
    title            = db.Column(db.String(500), nullable=False)
    slug             = db.Column(db.String(300), unique=True)
    body             = db.Column(db.Text)
    summary          = db.Column(db.Text)
    tags             = db.Column(db.JSON)
    target_audience  = db.Column(db.JSON)            # ['10th', 'intermediate', 'btech', 'all']
    thumbnail_url    = db.Column(db.Text)
    is_published     = db.Column(db.Boolean, default=False)
    published_at     = db.Column(db.DateTime)
    author_name      = db.Column(db.String(200))
    author_email     = db.Column(db.String(200))
    view_count       = db.Column(db.Integer, default=0)
    created_at       = db.Column(db.DateTime, default=datetime.utcnow)
    created_by       = db.Column(db.CHAR(36), nullable=True)
    updated_at       = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by       = db.Column(db.CHAR(36), nullable=True)
    deleted_at       = db.Column(db.DateTime)
