"""feat: add cohort audience-targeting + extended user_profiles columns

These columns exist in the SQLAlchemy models (Cohorts.target_*, UserProfiles
education/career fields) but were never added by a migration — they only
appeared via db.create_all(), which adds missing TABLES but never missing
COLUMNS to a pre-existing table. On any DB that predates them, GET /cohorts/
500s and audience targeting silently breaks. This revision adds them
idempotently so `flask db upgrade` brings every environment into line.

Revision ID: o5j6k7l8m9n0
Revises: n4i5j6k7l8m9
Create Date: 2026-06-22 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision      = 'o5j6k7l8m9n0'
down_revision = 'n4i5j6k7l8m9'
branch_labels = None
depends_on    = None


def _table_exists(table):
    conn = op.get_bind()
    return conn.execute(sa.text(
        "SELECT COUNT(*) FROM information_schema.tables "
        "WHERE table_schema = DATABASE() AND table_name = :t"
    ), {"t": table}).scalar() > 0


def _col_exists(table, col):
    conn = op.get_bind()
    return conn.execute(sa.text(
        "SELECT COUNT(*) FROM information_schema.columns "
        "WHERE table_schema = DATABASE() AND table_name = :t AND column_name = :c"
    ), {"t": table, "c": col}).scalar() > 0


COHORTS_COLS = [
    ('level',                 lambda: sa.Column('level',                 sa.String(50),  nullable=True)),
    ('registration_deadline', lambda: sa.Column('registration_deadline', sa.DateTime,    nullable=True)),
    ('meeting_link',          lambda: sa.Column('meeting_link',          sa.Text,        nullable=True)),
    ('target_categories',     lambda: sa.Column('target_categories',     sa.JSON,        nullable=True)),
    ('target_streams',        lambda: sa.Column('target_streams',        sa.JSON,        nullable=True)),
    ('target_degree_cats',    lambda: sa.Column('target_degree_cats',    sa.JSON,        nullable=True)),
    ('target_exam_targets',   lambda: sa.Column('target_exam_targets',   sa.JSON,        nullable=True)),
    ('target_prof_courses',   lambda: sa.Column('target_prof_courses',   sa.JSON,        nullable=True)),
    ('target_years',          lambda: sa.Column('target_years',          sa.JSON,        nullable=True)),
    ('target_degrees',        lambda: sa.Column('target_degrees',        sa.JSON,        nullable=True)),
    ('target_branches',       lambda: sa.Column('target_branches',       sa.JSON,        nullable=True)),
]

USER_PROFILES_COLS = [
    ('education_category',        lambda: sa.Column('education_category',        sa.String(30),  nullable=True)),
    ('school_name',              lambda: sa.Column('school_name',               sa.String(200), nullable=True)),
    ('stream',                   lambda: sa.Column('stream',                    sa.String(30),  nullable=True)),
    ('iti_trade',                lambda: sa.Column('iti_trade',                 sa.String(100), nullable=True)),
    ('college_name',             lambda: sa.Column('college_name',              sa.String(200), nullable=True)),
    ('degree_category',          lambda: sa.Column('degree_category',           sa.String(50),  nullable=True)),
    ('degree_type',              lambda: sa.Column('degree_type',               sa.String(100), nullable=True)),
    ('branch',                   lambda: sa.Column('branch',                    sa.String(100), nullable=True)),
    ('year_of_study',            lambda: sa.Column('year_of_study',             sa.String(30),  nullable=True)),
    ('professional_course_type', lambda: sa.Column('professional_course_type',  sa.String(20),  nullable=True)),
    ('professional_course_level',lambda: sa.Column('professional_course_level', sa.String(30),  nullable=True)),
    ('exam_target',              lambda: sa.Column('exam_target',               sa.String(50),  nullable=True)),
    ('working_industry',         lambda: sa.Column('working_industry',          sa.String(100), nullable=True)),
    ('working_experience',       lambda: sa.Column('working_experience',        sa.String(20),  nullable=True)),
    ('working_role',             lambda: sa.Column('working_role',              sa.String(100), nullable=True)),
]


def _add_missing(table, cols):
    if not _table_exists(table):
        return
    for col, factory in cols:
        if not _col_exists(table, col):
            op.add_column(table, factory())


def _drop_present(table, cols):
    if not _table_exists(table):
        return
    for col, _ in reversed(cols):
        if _col_exists(table, col):
            op.drop_column(table, col)


def upgrade():
    _add_missing('cohorts', COHORTS_COLS)
    _add_missing('user_profiles', USER_PROFILES_COLS)


def downgrade():
    # Only drop the audience-targeting cohort columns on downgrade; leave the
    # core/profile columns in place to avoid data loss on shared environments.
    _drop_present('cohorts', [c for c in COHORTS_COLS if c[0].startswith('target_')])
