import uuid
from . import db
from datetime import datetime


class Domains(db.Model):
    """
    Career domains used across Cohorts, Opportunities, Assemble groups.
    e.g. technology, finance, healthcare, design, marketing,
         engineering, management, data science, entrepreneurship, law
    """
    __tablename__ = "domains"

    id = db.Column(db.CHAR(36), primary_key=True, default=lambda: str(uuid.uuid4()))


    name = db.Column(db.String(100))
    slug = db.Column(db.String(100))
    description = db.Column(db.Text)
    icon_url = db.Column(db.Text)
    is_active = db.Column(db.Boolean, default=True)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    created_by = db.Column(db.CHAR(36), nullable=True)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by = db.Column(db.CHAR(36), nullable=True)

    __table_args__ = {'mysql_charset': 'utf8mb4', 'mysql_collate': 'utf8mb4_unicode_ci'}

    def save(self):
        db.session.add(self)
        db.session.commit()
