import uuid
from . import db
from datetime import datetime


class CourseCatalogue(db.Model):
    """
    The master list of what a student can be studying — one row per real course.

    Named `course_catalogue` to keep it distinct from `college_courses` (what a
    particular college offers) and `achiever_courses` (paid content on the
    platform). This is the vocabulary those two, the student's profile and
    cohort audience targeting all draw from.

    One row carries the whole triple (degree_category / degree / branch), so a
    student picks "B.Tech — Computer Science" once instead of walking three
    cascading dropdowns, and an achiever targeting that audience picks the same
    row. Two screens can no longer spell the same course differently.
    """
    __tablename__ = "course_catalogue"

    id = db.Column(db.CHAR(36), primary_key=True, default=lambda: str(uuid.uuid4()))

    # Which onboarding stage this belongs to: ug | pg | diploma | iti |
    # professional | phd. Matches education_category so the search can be scoped.
    level = db.Column(db.String(20), nullable=False, index=True)

    degree_category = db.Column(db.String(60), nullable=False)   # Engineering, Management…
    degree          = db.Column(db.String(60), nullable=False)   # B.Tech, MBA, MBBS…
    branch          = db.Column(db.String(120))                  # CSE, Finance… (NULL where none)

    display_name = db.Column(db.String(200), nullable=False)     # "B.Tech — Computer Science (CSE)"
    # Lowercase alias blob: how students actually type it ("btech cse computer science").
    search_text  = db.Column(db.String(400), nullable=False)

    duration_years = db.Column(db.Float)

    sort_order = db.Column(db.Integer, default=0)
    is_active  = db.Column(db.Boolean, default=True)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    created_by = db.Column(db.CHAR(36), nullable=True)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by = db.Column(db.CHAR(36), nullable=True)

    __table_args__ = (
        db.UniqueConstraint('level', 'degree', 'branch', name='uq_course_level_degree_branch'),
    )

    def save(self):
        db.session.add(self)
        db.session.commit()

    def delete(self):
        db.session.delete(self)
        db.session.commit()
