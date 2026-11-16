"""feat: add coupon_code + discount_amount to achiever_sessions (1-on-1 coupons)

Revision ID: s9n0o1p2q3r4
Revises: r8m9n0o1p2q3
Create Date: 2026-06-25 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision      = 's9n0o1p2q3r4'
down_revision = 'r8m9n0o1p2q3'
branch_labels = None
depends_on    = None


def _col_exists(table, col):
    conn = op.get_bind()
    return conn.execute(sa.text(
        "SELECT COUNT(*) FROM information_schema.columns "
        "WHERE table_schema = DATABASE() AND table_name = :t AND column_name = :c"
    ), {"t": table, "c": col}).scalar() > 0


def upgrade():
    if not _col_exists('achiever_sessions', 'coupon_code'):
        op.execute("ALTER TABLE achiever_sessions ADD COLUMN coupon_code VARCHAR(40) NULL")
    if not _col_exists('achiever_sessions', 'discount_amount'):
        op.execute("ALTER TABLE achiever_sessions ADD COLUMN discount_amount DECIMAL(10,2) DEFAULT 0")


def downgrade():
    if _col_exists('achiever_sessions', 'discount_amount'):
        op.execute("ALTER TABLE achiever_sessions DROP COLUMN discount_amount")
    if _col_exists('achiever_sessions', 'coupon_code'):
        op.execute("ALTER TABLE achiever_sessions DROP COLUMN coupon_code")
