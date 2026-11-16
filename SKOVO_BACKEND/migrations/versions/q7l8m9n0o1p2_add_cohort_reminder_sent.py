"""feat: add cohorts.reminder_sent for the session-lifecycle scheduler

Revision ID: q7l8m9n0o1p2
Revises: p6k7l8m9n0o1
Create Date: 2026-06-25 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision      = 'q7l8m9n0o1p2'
down_revision = 'p6k7l8m9n0o1'
branch_labels = None
depends_on    = None


def _col_exists(table, col):
    conn = op.get_bind()
    return conn.execute(sa.text(
        "SELECT COUNT(*) FROM information_schema.columns "
        "WHERE table_schema = DATABASE() AND table_name = :t AND column_name = :c"
    ), {"t": table, "c": col}).scalar() > 0


def upgrade():
    if not _col_exists('cohorts', 'reminder_sent'):
        op.add_column('cohorts', sa.Column('reminder_sent', sa.Boolean, nullable=False, server_default='0'))


def downgrade():
    if _col_exists('cohorts', 'reminder_sent'):
        op.drop_column('cohorts', 'reminder_sent')
