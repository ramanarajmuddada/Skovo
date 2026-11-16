"""feat: add mentor_notes to mentor_sessions table

Revision ID: j0e1f2g3h4i5
Revises: i9d0e1f2g3h4
Create Date: 2026-06-04 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision      = 'j0e1f2g3h4i5'
down_revision = 'i9d0e1f2g3h4'
branch_labels = None
depends_on    = None


def _col_exists(table, col):
    conn = op.get_bind()
    return conn.execute(sa.text(
        "SELECT COUNT(*) FROM information_schema.columns "
        "WHERE table_schema = DATABASE() AND table_name = :t AND column_name = :c"
    ), {"t": table, "c": col}).scalar() > 0


def upgrade():
    if not _col_exists('mentor_sessions', 'mentor_notes'):
        op.add_column('mentor_sessions', sa.Column('mentor_notes', sa.Text, nullable=True))


def downgrade():
    if _col_exists('mentor_sessions', 'mentor_notes'):
        op.drop_column('mentor_sessions', 'mentor_notes')
