"""feat: add missing columns to mentors table

Revision ID: h8c9d0e1f2g3
Revises: g7b8c9d0e1f2
Create Date: 2026-06-04 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision      = 'h8c9d0e1f2g3'
down_revision = 'g7b8c9d0e1f2'
branch_labels = None
depends_on    = None


def _col_exists(table, col):
    conn = op.get_bind()
    return conn.execute(sa.text(
        "SELECT COUNT(*) FROM information_schema.columns "
        "WHERE table_schema = DATABASE() AND table_name = :t AND column_name = :c"
    ), {"t": table, "c": col}).scalar() > 0


def upgrade():
    if not _col_exists('mentors', 'phone'):
        op.add_column('mentors', sa.Column('phone', sa.String(20), nullable=True))
    if not _col_exists('mentors', 'skills'):
        op.add_column('mentors', sa.Column('skills', sa.JSON, nullable=True))
    if not _col_exists('mentors', 'profile_image_url'):
        op.add_column('mentors', sa.Column('profile_image_url', sa.Text, nullable=True))


def downgrade():
    for col in ['phone', 'skills', 'profile_image_url']:
        if _col_exists('mentors', col):
            op.drop_column('mentors', col)
