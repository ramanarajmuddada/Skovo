"""feat: add level, registration_deadline, meeting_link to cohorts

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-06-04 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision      = 'e5f6a7b8c9d0'
down_revision = 'd4e5f6a7b8c9'
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
    if not _col_exists('cohorts', 'level'):
        op.add_column('cohorts', sa.Column('level', sa.String(50), nullable=True))
    if not _col_exists('cohorts', 'registration_deadline'):
        op.add_column('cohorts', sa.Column('registration_deadline', sa.DateTime, nullable=True))
    if not _col_exists('cohorts', 'meeting_link'):
        op.add_column('cohorts', sa.Column('meeting_link', sa.Text, nullable=True))


def downgrade():
    for col in ['level', 'registration_deadline', 'meeting_link']:
        if _col_exists('cohorts', col):
            op.drop_column('cohorts', col)
