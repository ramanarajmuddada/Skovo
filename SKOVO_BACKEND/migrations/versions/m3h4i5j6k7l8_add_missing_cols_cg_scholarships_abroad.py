"""feat: add missing columns to cg_scholarships and cg_abroad_programs

Revision ID: m3h4i5j6k7l8
Revises: l2g3h4i5j6k7
Create Date: 2026-06-04 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision      = 'm3h4i5j6k7l8'
down_revision = 'l2g3h4i5j6k7'
branch_labels = None
depends_on    = None


def _col_exists(table, col):
    conn = op.get_bind()
    return conn.execute(sa.text(
        "SELECT COUNT(*) FROM information_schema.columns "
        "WHERE table_schema = DATABASE() AND table_name = :t AND column_name = :c"
    ), {"t": table, "c": col}).scalar() > 0


def upgrade():
    # ── cg_scholarships ───────────────────────────────────────────────────────
    if not _col_exists('cg_scholarships', 'provider'):
        op.add_column('cg_scholarships', sa.Column('provider', sa.String(300), nullable=True))
    if not _col_exists('cg_scholarships', 'scholarship_mode'):
        op.add_column('cg_scholarships', sa.Column('scholarship_mode', sa.String(30), nullable=True))
    if not _col_exists('cg_scholarships', 'notification_pdf_url'):
        op.add_column('cg_scholarships', sa.Column('notification_pdf_url', sa.Text, nullable=True))

    # ── cg_abroad_programs ────────────────────────────────────────────────────
    if not _col_exists('cg_abroad_programs', 'intake_season'):
        op.add_column('cg_abroad_programs', sa.Column('intake_season', sa.String(50), nullable=True))
    if not _col_exists('cg_abroad_programs', 'pr_opportunities'):
        op.add_column('cg_abroad_programs', sa.Column('pr_opportunities', sa.Text, nullable=True))
    if not _col_exists('cg_abroad_programs', 'application_deadline'):
        op.add_column('cg_abroad_programs', sa.Column('application_deadline', sa.Date, nullable=True))


def downgrade():
    for col in ['provider', 'scholarship_mode', 'notification_pdf_url']:
        if _col_exists('cg_scholarships', col):
            op.drop_column('cg_scholarships', col)
    for col in ['intake_season', 'pr_opportunities', 'application_deadline']:
        if _col_exists('cg_abroad_programs', col):
            op.drop_column('cg_abroad_programs', col)
