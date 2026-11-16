"""feat: billing — coupons, coupon_redemptions, invoices + enrollment/session columns

Revision ID: r8m9n0o1p2q3
Revises: q7l8m9n0o1p2
Create Date: 2026-06-25 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision      = 'r8m9n0o1p2q3'
down_revision = 'q7l8m9n0o1p2'
branch_labels = None
depends_on    = None


def _col_exists(table, col):
    conn = op.get_bind()
    return conn.execute(sa.text(
        "SELECT COUNT(*) FROM information_schema.columns "
        "WHERE table_schema = DATABASE() AND table_name = :t AND column_name = :c"
    ), {"t": table, "c": col}).scalar() > 0


def _add(table, col, ddl):
    if not _col_exists(table, col):
        op.execute(ddl)


def upgrade():
    op.execute("""
        CREATE TABLE IF NOT EXISTS coupons (
            id CHAR(36) PRIMARY KEY,
            code VARCHAR(40) NOT NULL UNIQUE,
            discount_type VARCHAR(10) DEFAULT 'percent',
            value DECIMAL(10,2) DEFAULT 0,
            max_discount DECIMAL(10,2) NULL,
            min_amount DECIMAL(10,2) DEFAULT 0,
            applies_to VARCHAR(10) DEFAULT 'all',
            max_uses INT NULL,
            used_count INT DEFAULT 0,
            per_user_limit INT DEFAULT 1,
            valid_from DATETIME NULL,
            valid_until DATETIME NULL,
            is_active TINYINT(1) DEFAULT 1,
            created_at DATETIME NULL,
            created_by CHAR(36) NULL,
            updated_at DATETIME NULL
        ) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """)
    op.execute("""
        CREATE TABLE IF NOT EXISTS coupon_redemptions (
            id CHAR(36) PRIMARY KEY,
            coupon_id CHAR(36) NOT NULL,
            code VARCHAR(40) NULL,
            user_id CHAR(36) NOT NULL,
            context_type VARCHAR(10) NULL,
            context_id CHAR(36) NULL,
            discount_amount DECIMAL(10,2) DEFAULT 0,
            created_at DATETIME NULL
        ) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """)
    op.execute("""
        CREATE TABLE IF NOT EXISTS invoices (
            id CHAR(36) PRIMARY KEY,
            invoice_number VARCHAR(40) NOT NULL UNIQUE,
            user_id CHAR(36) NOT NULL,
            context_type VARCHAR(10) NULL,
            context_id CHAR(36) NULL,
            description TEXT NULL,
            base_amount DECIMAL(10,2) DEFAULT 0,
            discount_amount DECIMAL(10,2) DEFAULT 0,
            gst_rate DECIMAL(5,2) DEFAULT 18,
            gst_amount DECIMAL(10,2) DEFAULT 0,
            total_amount DECIMAL(10,2) DEFAULT 0,
            payment_id VARCHAR(100) NULL,
            coupon_code VARCHAR(40) NULL,
            status VARCHAR(15) DEFAULT 'paid',
            refunded_at DATETIME NULL,
            created_at DATETIME NULL
        ) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """)

    _add('cohort_enrollments', 'coupon_code',
         "ALTER TABLE cohort_enrollments ADD COLUMN coupon_code VARCHAR(40) NULL")
    _add('cohort_enrollments', 'discount_amount',
         "ALTER TABLE cohort_enrollments ADD COLUMN discount_amount DECIMAL(10,2) DEFAULT 0")
    _add('course_enrollments', 'coupon_code',
         "ALTER TABLE course_enrollments ADD COLUMN coupon_code VARCHAR(40) NULL")
    _add('course_enrollments', 'discount_amount',
         "ALTER TABLE course_enrollments ADD COLUMN discount_amount DECIMAL(10,2) DEFAULT 0")
    _add('achiever_sessions', 'no_show',
         "ALTER TABLE achiever_sessions ADD COLUMN no_show TINYINT(1) NOT NULL DEFAULT 0")


def downgrade():
    for t, c in [('achiever_sessions', 'no_show'),
                 ('course_enrollments', 'discount_amount'), ('course_enrollments', 'coupon_code'),
                 ('cohort_enrollments', 'discount_amount'), ('cohort_enrollments', 'coupon_code')]:
        if _col_exists(t, c):
            op.execute(f"ALTER TABLE {t} DROP COLUMN {c}")
    op.execute("DROP TABLE IF EXISTS invoices")
    op.execute("DROP TABLE IF EXISTS coupon_redemptions")
    op.execute("DROP TABLE IF EXISTS coupons")
