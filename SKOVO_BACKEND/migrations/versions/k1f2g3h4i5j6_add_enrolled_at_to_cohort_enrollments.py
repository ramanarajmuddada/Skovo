"""feat: add enrolled_at to cohort_enrollments table

Revision ID: k1f2g3h4i5j6
Revises: j0e1f2g3h4i5
Create Date: 2026-06-04 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision      = 'k1f2g3h4i5j6'
down_revision = 'j0e1f2g3h4i5'
branch_labels = None
depends_on    = None


def _col_exists(table, col):
    conn = op.get_bind()
    return conn.execute(sa.text(
        "SELECT COUNT(*) FROM information_schema.columns "
        "WHERE table_schema = DATABASE() AND table_name = :t AND column_name = :c"
    ), {"t": table, "c": col}).scalar() > 0


def upgrade():
    if not _col_exists('cohort_enrollments', 'enrolled_at'):
        op.add_column('cohort_enrollments', sa.Column('enrolled_at', sa.DateTime, nullable=True))
        op.execute(sa.text("UPDATE cohort_enrollments SET enrolled_at = created_at WHERE enrolled_at IS NULL"))


def downgrade():
    if _col_exists('cohort_enrollments', 'enrolled_at'):
        op.drop_column('cohort_enrollments', 'enrolled_at')
