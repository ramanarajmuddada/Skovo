import uuid
from . import db
from datetime import datetime


class AchieverCourses(db.Model):
    """
    Courses launched by achievers — multi-module, self-paced + live hybrid, paid.
    """
    __tablename__ = "achiever_courses"

    id          = db.Column(db.CHAR(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    achiever_id = db.Column(db.CHAR(36), nullable=False)

    title         = db.Column(db.Text, nullable=False)
    description   = db.Column(db.Text)
    thumbnail_url = db.Column(db.Text)

    price          = db.Column(db.Integer, default=0)
    duration_weeks = db.Column(db.Integer, default=4)
    level          = db.Column(db.String(30), default='beginner')  # beginner|intermediate|advanced
    category       = db.Column(db.String(100))

    what_you_learn = db.Column(db.JSON, default=list)
    requirements   = db.Column(db.JSON, default=list)

    status         = db.Column(db.String(20), default='draft')  # draft|published|archived
    enrolled_count = db.Column(db.Integer, default=0)

    # ── Audience targeting (granular — all empty arrays = visible to everyone) ──
    # target_categories: which education_category values to include
    #   e.g. ['ug', 'pg', 'entrance_exam'] — empty = all
    target_categories   = db.Column(db.JSON, default=list)

    # target_streams: school/entrance_exam stream filter
    #   e.g. ['pcm', 'pcb'] — empty = all streams
    target_streams      = db.Column(db.JSON, default=list)

    # target_degree_cats: degree category filter for UG/PG
    #   e.g. ['Engineering', 'Computer'] — empty = all degree categories
    target_degree_cats  = db.Column(db.JSON, default=list)

    # target_exam_targets: specific exam filter
    #   e.g. ['JEE Main', 'JEE Advanced'] — empty = all exams
    target_exam_targets = db.Column(db.JSON, default=list)

    # target_prof_courses: professional course type filter
    #   e.g. ['CA', 'CS'] — empty = all professional courses
    target_prof_courses = db.Column(db.JSON, default=list)

    # target_years: year of study filter
    #   e.g. ['1st Year', '2nd Year'] — empty = all years
    target_years        = db.Column(db.JSON, default=list)

    # target_degrees / target_branches: very specific degree/branch filter
    target_degrees      = db.Column(db.JSON, default=list)
    target_branches     = db.Column(db.JSON, default=list)

    is_active  = db.Column(db.Boolean, default=True)
    deleted_at = db.Column(db.DateTime)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    created_by = db.Column(db.CHAR(36))
    updated_by = db.Column(db.CHAR(36))

    __table_args__ = {}

    def save(self):
        db.session.add(self)
        db.session.commit()

    def update(self):
        db.session.commit()
