"""feat: add extended columns to colleges table

Revision ID: f6a7b8c9d0e1
Revises: e5f6a7b8c9d0
Create Date: 2026-06-04 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision      = 'f6a7b8c9d0e1'
down_revision = 'e5f6a7b8c9d0'
branch_labels = None
depends_on    = None


def _col_exists(table, col):
    conn = op.get_bind()
    rows = conn.execute(sa.text(
        "SELECT COUNT(*) FROM information_schema.columns "
        "WHERE table_schema = DATABASE() AND table_name = :t AND column_name = :c"
    ), {"t": table, "c": col}).scalar()
    return rows > 0


def upgrade():
    if not _col_exists('colleges', 'accreditation'):
        op.add_column('colleges', sa.Column('accreditation', sa.String(100), nullable=True))
    if not _col_exists('colleges', 'contact_info'):
        op.add_column('colleges', sa.Column('contact_info', sa.Text, nullable=True))
    if not _col_exists('colleges', 'admission_process'):
        op.add_column('colleges', sa.Column('admission_process', sa.Text, nullable=True))
    if not _col_exists('colleges', 'entrance_exams_accepted'):
        op.add_column('colleges', sa.Column('entrance_exams_accepted', sa.JSON, nullable=True))
    if not _col_exists('colleges', 'hostel_fee'):
        op.add_column('colleges', sa.Column('hostel_fee', sa.Integer, nullable=True))
    if not _col_exists('colleges', 'established_year'):
        op.add_column('colleges', sa.Column('established_year', sa.Integer, nullable=True))
    if not _col_exists('colleges', 'total_students'):
        op.add_column('colleges', sa.Column('total_students', sa.Integer, nullable=True))
    if not _col_exists('colleges', 'facilities'):
        op.add_column('colleges', sa.Column('facilities', sa.JSON, nullable=True))
    if not _col_exists('colleges', 'top_recruiters'):
        op.add_column('colleges', sa.Column('top_recruiters', sa.JSON, nullable=True))
    if not _col_exists('colleges', 'achievements'):
        op.add_column('colleges', sa.Column('achievements', sa.JSON, nullable=True))


def downgrade():
    for col in ['accreditation', 'contact_info', 'admission_process', 'entrance_exams_accepted',
                'hostel_fee', 'established_year', 'total_students', 'facilities',
                'top_recruiters', 'achievements']:
        if _col_exists('colleges', col):
            op.drop_column('colleges', col)
