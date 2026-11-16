"""feat: add type and is_read columns to notification_logs

Revision ID: i9d0e1f2g3h4
Revises: h8c9d0e1f2g3
Create Date: 2026-06-04 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision      = 'i9d0e1f2g3h4'
down_revision = 'h8c9d0e1f2g3'
branch_labels = None
depends_on    = None


def _col_exists(table, col):
    conn = op.get_bind()
    return conn.execute(sa.text(
        "SELECT COUNT(*) FROM information_schema.columns "
        "WHERE table_schema = DATABASE() AND table_name = :t AND column_name = :c"
    ), {"t": table, "c": col}).scalar() > 0


def upgrade():
    if not _col_exists('notification_logs', 'type'):
        op.add_column('notification_logs', sa.Column('type', sa.String(50), nullable=True, server_default='system'))
    if not _col_exists('notification_logs', 'is_read'):
        op.add_column('notification_logs', sa.Column('is_read', sa.Boolean, nullable=False, server_default='0'))


def downgrade():
    for col in ['type', 'is_read']:
        if _col_exists('notification_logs', col):
            op.drop_column('notification_logs', col)
