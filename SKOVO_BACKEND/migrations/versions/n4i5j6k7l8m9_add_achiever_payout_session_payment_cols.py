"""feat: add achiever payout/session-rate + achiever_sessions payment columns

Captures the v2 bugfix schema changes that were previously applied only via the
standalone migrate_v2_bugfixes.py script, so they are now tracked by Alembic and
applied by `flask db upgrade`.

Revision ID: n4i5j6k7l8m9
Revises: m3h4i5j6k7l8
Create Date: 2026-06-22 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision      = 'n4i5j6k7l8m9'
down_revision = 'm3h4i5j6k7l8'
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


# (table, column, SQLAlchemy column factory) — idempotent, mirrors migrate_v2_bugfixes.py
ACHIEVERS_COLS = [
    ('suitable_for',          lambda: sa.Column('suitable_for',          sa.JSON,           nullable=True)),
    ('session_rate',          lambda: sa.Column('session_rate',          sa.Numeric(10, 2), nullable=True, server_default='0')),
    ('payout_account_name',   lambda: sa.Column('payout_account_name',   sa.String(150),    nullable=True)),
    ('payout_account_number', lambda: sa.Column('payout_account_number', sa.String(50),     nullable=True)),
    ('payout_ifsc',           lambda: sa.Column('payout_ifsc',           sa.String(20),     nullable=True)),
    ('payout_upi',            lambda: sa.Column('payout_upi',            sa.String(100),    nullable=True)),
]

ACHIEVER_SESSIONS_COLS = [
    ('meeting_link',     lambda: sa.Column('meeting_link',     sa.String(500),    nullable=True)),
    ('amount',           lambda: sa.Column('amount',           sa.Numeric(10, 2), nullable=True, server_default='0')),
    ('platform_fee',     lambda: sa.Column('platform_fee',     sa.Numeric(10, 2), nullable=True, server_default='0')),
    ('achiever_earning', lambda: sa.Column('achiever_earning', sa.Numeric(10, 2), nullable=True, server_default='0')),
    ('payment_status',   lambda: sa.Column('payment_status',   sa.String(20),     nullable=True, server_default='free')),
    ('payment_order_id', lambda: sa.Column('payment_order_id', sa.String(100),    nullable=True)),
    ('payment_id',       lambda: sa.Column('payment_id',       sa.String(100),    nullable=True)),
    ('reminder_sent',    lambda: sa.Column('reminder_sent',    sa.Boolean,        nullable=False, server_default='0')),
]


def upgrade():
    if _table_exists('achievers'):
        for col, factory in ACHIEVERS_COLS:
            if not _col_exists('achievers', col):
                op.add_column('achievers', factory())

    if _table_exists('achiever_sessions'):
        for col, factory in ACHIEVER_SESSIONS_COLS:
            if not _col_exists('achiever_sessions', col):
                op.add_column('achiever_sessions', factory())


def downgrade():
    if _table_exists('achiever_sessions'):
        for col, _ in reversed(ACHIEVER_SESSIONS_COLS):
            if _col_exists('achiever_sessions', col):
                op.drop_column('achiever_sessions', col)

    if _table_exists('achievers'):
        for col, _ in reversed(ACHIEVERS_COLS):
            if _col_exists('achievers', col):
                op.drop_column('achievers', col)
