import uuid
from . import db
from datetime import datetime


class Cohorts(db.Model):
    """
    Sunday Achiever Cohorts — 90-min live sessions led by industry achievers.
    """
    __tablename__ = "cohorts"

    id = db.Column(db.CHAR(36), primary_key=True, default=lambda: str(uuid.uuid4()))

    title       = db.Column(db.Text, nullable=False)
    achiever_id = db.Column(db.CHAR(36))
    domain_id   = db.Column(db.CHAR(36))

    session_date      = db.Column(db.DateTime)
    duration_minutes  = db.Column(db.Integer, default=90)

    # No default: a cohort is uncapped unless someone deliberately sets a
    # ceiling. NULL means unlimited everywhere that reads this.
    total_seats  = db.Column(db.Integer)
    filled_seats = db.Column(db.Integer, default=0)

    price  = db.Column(db.Integer, default=0)      # in INR, 0 = free

    status = db.Column(db.String(20), default="upcoming")  # upcoming | live | completed | cancelled
    reminder_sent = db.Column(db.Boolean, default=False)   # T-15min reminder pushed to enrollees

    about          = db.Column(db.Text)
    what_you_learn = db.Column(db.JSON, default=[])
    thumbnail_url  = db.Column(db.Text)
    level          = db.Column(db.String(50))                # beginner | intermediate | advanced
    registration_deadline = db.Column(db.DateTime)
    meeting_link   = db.Column(db.Text)

    # ── Audience targeting (granular — all empty arrays = visible to everyone) ──
    target_categories   = db.Column(db.JSON, default=list)
    target_streams      = db.Column(db.JSON, default=list)
    target_degree_cats  = db.Column(db.JSON, default=list)
    target_exam_targets = db.Column(db.JSON, default=list)
    target_prof_courses = db.Column(db.JSON, default=list)
    target_years        = db.Column(db.JSON, default=list)
    target_degrees      = db.Column(db.JSON, default=list)
    target_branches     = db.Column(db.JSON, default=list)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    created_by = db.Column(db.CHAR(36), nullable=True)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by = db.Column(db.CHAR(36), nullable=True)
    deleted_at = db.Column(db.DateTime)

    __table_args__ = {'mysql_charset': 'utf8mb4', 'mysql_collate': 'utf8mb4_unicode_ci'}

    def save(self):
        db.session.add(self)
        db.session.commit()

    def update(self):
        db.session.commit()

    def delete(self):
        db.session.delete(self)
        db.session.commit()
