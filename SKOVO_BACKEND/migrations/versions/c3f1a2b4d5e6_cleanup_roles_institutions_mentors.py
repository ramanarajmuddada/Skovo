"""cleanup: remove roles/user_roles/institutions, fix mentors to standalone

Revision ID: c3f1a2b4d5e6
Revises: a1b2c3d4e5f6
Create Date: 2026-06-02 00:00:00.000000

What this migration does:
- Drops roles, user_roles, institutions tables (no longer needed)
- Migrates mentors table from linked (user_id) to standalone (email, password_hash, full_name, status)
- All operations are idempotent (safe to run on any DB state)
"""
from alembic import op
import sqlalchemy as sa


revision      = 'c3f1a2b4d5e6'
down_revision = '6afca7e11c50'
branch_labels = None
depends_on    = None


def _table_exists(name):
    conn = op.get_bind()
    return conn.execute(sa.text(
        "SELECT COUNT(*) FROM information_schema.tables "
        "WHERE table_schema = DATABASE() AND table_name = :t"
    ), {"t": name}).scalar() > 0


def _column_exists(table, column):
    conn = op.get_bind()
    return conn.execute(sa.text(
        "SELECT COUNT(*) FROM information_schema.columns "
        "WHERE table_schema = DATABASE() AND table_name = :t AND column_name = :c"
    ), {"t": table, "c": column}).scalar() > 0


def _index_exists(table, index):
    conn = op.get_bind()
    return conn.execute(sa.text(
        "SELECT COUNT(*) FROM information_schema.statistics "
        "WHERE table_schema = DATABASE() AND table_name = :t AND index_name = :i"
    ), {"t": table, "i": index}).scalar() > 0


def upgrade():
    conn = op.get_bind()

    # ── 1. Drop roles + user_roles + institutions ─────────────────────────────
    conn.execute(sa.text("SET FOREIGN_KEY_CHECKS = 0"))

    if _table_exists('user_roles'):
        op.drop_table('user_roles')

    if _table_exists('roles'):
        op.drop_table('roles')

    if _table_exists('institutions'):
        op.drop_table('institutions')

    conn.execute(sa.text("SET FOREIGN_KEY_CHECKS = 1"))

    # ── 2. Fix mentors table to standalone schema ─────────────────────────────
    # Only migrate if still on the old linked schema (has user_id, missing email)
    if _table_exists('mentors') and _column_exists('mentors', 'user_id') and not _column_exists('mentors', 'email'):

        conn.execute(sa.text("SET FOREIGN_KEY_CHECKS = 0"))

        # Drop old unique/FK index on user_id if it exists
        for idx in ('uq_mentors_user', 'fk_mentors_user', 'ix_mentors_user_id'):
            if _index_exists('mentors', idx):
                conn.execute(sa.text(f"ALTER TABLE mentors DROP INDEX `{idx}`"))

        # Add new standalone columns
        if not _column_exists('mentors', 'full_name'):
            conn.execute(sa.text("ALTER TABLE mentors ADD COLUMN full_name VARCHAR(255) NOT NULL DEFAULT '' AFTER id"))

        if not _column_exists('mentors', 'email'):
            conn.execute(sa.text("ALTER TABLE mentors ADD COLUMN email VARCHAR(255) NOT NULL DEFAULT '' AFTER full_name"))

        if not _column_exists('mentors', 'password_hash'):
            conn.execute(sa.text("ALTER TABLE mentors ADD COLUMN password_hash TEXT AFTER email"))

        if not _column_exists('mentors', 'status'):
            conn.execute(sa.text("ALTER TABLE mentors ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'active' AFTER password_hash"))

        # Add unique index on email
        if not _index_exists('mentors', 'uq_mentors_email'):
            conn.execute(sa.text("ALTER TABLE mentors ADD UNIQUE INDEX uq_mentors_email (email)"))

        # Drop old columns
        for col in ('user_id', 'deleted_at', 'created_by', 'updated_by'):
            if _column_exists('mentors', col):
                conn.execute(sa.text(f"ALTER TABLE mentors DROP COLUMN `{col}`"))

        conn.execute(sa.text("SET FOREIGN_KEY_CHECKS = 1"))


def downgrade():
    pass
