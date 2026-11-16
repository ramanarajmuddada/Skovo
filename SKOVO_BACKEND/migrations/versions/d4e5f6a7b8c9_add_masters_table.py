"""feat: add masters table for all admin dropdown options

Revision ID: d4e5f6a7b8c9
Revises: c3f1a2b4d5e6
Create Date: 2026-06-03 00:00:00.000000

What this migration does:
- Creates the masters table to store all dropdown options centrally
- Covers 20 dropdown types: college_type, degree_type, exam_type, etc.
- Idempotent: safe to re-run
"""
from alembic import op
import sqlalchemy as sa


revision      = 'd4e5f6a7b8c9'
down_revision = 'c3f1a2b4d5e6'
branch_labels = None
depends_on    = None


def _table_exists(name):
    conn = op.get_bind()
    return conn.execute(sa.text(
        "SELECT COUNT(*) FROM information_schema.tables "
        "WHERE table_schema = DATABASE() AND table_name = :t"
    ), {"t": name}).scalar() > 0


def upgrade():
    if not _table_exists('masters'):
        op.create_table(
            'masters',
            sa.Column('id',         sa.CHAR(36),     nullable=False),
            sa.Column('type',       sa.String(50),   nullable=False),
            sa.Column('value',      sa.String(100),  nullable=False),
            sa.Column('label',      sa.String(150),  nullable=False),
            sa.Column('sort_order', sa.Integer,      nullable=True,  server_default='0'),
            sa.Column('is_active',  sa.Boolean,      nullable=True,  server_default='1'),
            sa.Column('created_at', sa.DateTime,     nullable=True),
            sa.Column('created_by', sa.CHAR(36),     nullable=True),
            sa.Column('updated_at', sa.DateTime,     nullable=True),
            sa.Column('updated_by', sa.CHAR(36),     nullable=True),
            sa.PrimaryKeyConstraint('id'),
            sa.UniqueConstraint('type', 'value', name='uq_masters_type_value'),
        )
        op.create_index('ix_masters_type', 'masters', ['type'])


def downgrade():
    if _table_exists('masters'):
        op.drop_index('ix_masters_type', table_name='masters')
        op.drop_table('masters')
