"""feat: add all missing columns to opportunities, coaching_centres, groups, cohorts, users

Revision ID: g7b8c9d0e1f2
Revises: f6a7b8c9d0e1
Create Date: 2026-06-04 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision      = 'g7b8c9d0e1f2'
down_revision = 'f6a7b8c9d0e1'
branch_labels = None
depends_on    = None


def _col_exists(table, col):
    conn = op.get_bind()
    return conn.execute(sa.text(
        "SELECT COUNT(*) FROM information_schema.columns "
        "WHERE table_schema = DATABASE() AND table_name = :t AND column_name = :c"
    ), {"t": table, "c": col}).scalar() > 0


def upgrade():
    # ── opportunities ────────────────────────────────────────────────────────
    if not _col_exists('opportunities', 'eligibility_criteria'):
        op.add_column('opportunities', sa.Column('eligibility_criteria', sa.Text, nullable=True))
    if not _col_exists('opportunities', 'experience_level'):
        op.add_column('opportunities', sa.Column('experience_level', sa.String(50), nullable=True))
    if not _col_exists('opportunities', 'is_featured'):
        op.add_column('opportunities', sa.Column('is_featured', sa.Boolean, nullable=True, server_default='0'))
    if not _col_exists('opportunities', 'requirements'):
        op.add_column('opportunities', sa.Column('requirements', sa.JSON, nullable=True))
    if not _col_exists('opportunities', 'posted_by'):
        op.add_column('opportunities', sa.Column('posted_by', sa.String(36), nullable=True))
    if not _col_exists('opportunities', 'stipend_type'):
        op.add_column('opportunities', sa.Column('stipend_type', sa.String(50), nullable=True, server_default='fixed'))
    if not _col_exists('opportunities', 'skills_required'):
        op.add_column('opportunities', sa.Column('skills_required', sa.JSON, nullable=True))
    if not _col_exists('opportunities', 'application_link'):
        op.add_column('opportunities', sa.Column('application_link', sa.Text, nullable=True))
    if not _col_exists('opportunities', 'description'):
        op.add_column('opportunities', sa.Column('description', sa.Text, nullable=True))

    # ── coaching_centres ─────────────────────────────────────────────────────
    if not _col_exists('coaching_centres', 'discount_info'):
        op.add_column('coaching_centres', sa.Column('discount_info', sa.Text, nullable=True))
    if not _col_exists('coaching_centres', 'discount_percent'):
        op.add_column('coaching_centres', sa.Column('discount_percent', sa.Integer, nullable=True))
    if not _col_exists('coaching_centres', 'is_verified'):
        op.add_column('coaching_centres', sa.Column('is_verified', sa.Boolean, nullable=True, server_default='0'))
    if not _col_exists('coaching_centres', 'contact_phone'):
        op.add_column('coaching_centres', sa.Column('contact_phone', sa.Text, nullable=True))
    if not _col_exists('coaching_centres', 'contact_email'):
        op.add_column('coaching_centres', sa.Column('contact_email', sa.Text, nullable=True))
    if not _col_exists('coaching_centres', 'categories'):
        op.add_column('coaching_centres', sa.Column('categories', sa.JSON, nullable=True))
    if not _col_exists('coaching_centres', 'banner_url'):
        op.add_column('coaching_centres', sa.Column('banner_url', sa.Text, nullable=True))

    # ── groups ───────────────────────────────────────────────────────────────
    if not _col_exists('groups', 'group_type'):
        op.add_column('groups', sa.Column('group_type', sa.String(20), nullable=True, server_default='regular'))
    if not _col_exists('groups', 'icon_color'):
        op.add_column('groups', sa.Column('icon_color', sa.String(20), nullable=True))
    if not _col_exists('groups', 'min_members'):
        op.add_column('groups', sa.Column('min_members', sa.Integer, nullable=True))
    if not _col_exists('groups', 'max_members'):
        op.add_column('groups', sa.Column('max_members', sa.Integer, nullable=True))
    if not _col_exists('groups', 'join_type'):
        op.add_column('groups', sa.Column('join_type', sa.String(20), nullable=True, server_default='request'))
    if not _col_exists('groups', 'member_count'):
        op.add_column('groups', sa.Column('member_count', sa.Integer, nullable=True, server_default='0'))
    if not _col_exists('groups', 'updated_by'):
        op.add_column('groups', sa.Column('updated_by', sa.String(36), nullable=True))

    # ── users ─────────────────────────────────────────────────────────────────
    if not _col_exists('users', 'deleted_at'):
        op.add_column('users', sa.Column('deleted_at', sa.DateTime, nullable=True))

    # ── cohorts ───────────────────────────────────────────────────────────────
    if not _col_exists('cohorts', 'deleted_at'):
        op.add_column('cohorts', sa.Column('deleted_at', sa.DateTime, nullable=True))


def downgrade():
    pass
