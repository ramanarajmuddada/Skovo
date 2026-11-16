import uuid
from . import db
from datetime import datetime


class CgBranches(db.Model):
    __tablename__ = "cg_branches"

    id                  = db.Column(db.CHAR(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    code                = db.Column(db.String(30), unique=True, nullable=False)
    name                = db.Column(db.String(200), nullable=False)
    category            = db.Column(db.String(30))          # engineering | medical | science | commerce
    description         = db.Column(db.Text)
    future_scope        = db.Column(db.Text)
    salary_fresher_min  = db.Column(db.Float)
    salary_fresher_max  = db.Column(db.Float)
    salary_5yr_min      = db.Column(db.Float)
    salary_5yr_max      = db.Column(db.Float)
    salary_10yr_min     = db.Column(db.Float)
    salary_10yr_max     = db.Column(db.Float)
    demand_level        = db.Column(db.String(10))          # very_high | high | medium | low
    ai_impact           = db.Column(db.String(10))          # high | medium | low
    difficulty_level    = db.Column(db.String(10))          # high | medium | low
    work_life_balance   = db.Column(db.String(10))          # good | average | poor
    coding_required     = db.Column(db.Boolean, default=False)
    govt_opportunities  = db.Column(db.Boolean, default=False)
    abroad_opportunities= db.Column(db.Boolean, default=False)
    skills_required     = db.Column(db.JSON)
    top_companies       = db.Column(db.JSON)
    related_roles       = db.Column(db.JSON)
    is_active           = db.Column(db.Boolean, default=True)
    created_at          = db.Column(db.DateTime, default=datetime.utcnow)
    created_by          = db.Column(db.CHAR(36), nullable=True)
    updated_at          = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by          = db.Column(db.CHAR(36), nullable=True)
