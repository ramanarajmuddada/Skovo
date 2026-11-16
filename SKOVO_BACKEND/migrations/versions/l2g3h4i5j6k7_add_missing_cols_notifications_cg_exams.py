"""feat: add sent_at to notification_logs; add missing cols to cg_entrance_exams

Revision ID: l2g3h4i5j6k7
Revises: k1f2g3h4i5j6
Create Date: 2026-06-04 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision      = 'l2g3h4i5j6k7'
down_revision = 'k1f2g3h4i5j6'
branch_labels = None
depends_on    = None


def _col_exists(table, col):
    conn = op.get_bind()
    return conn.execute(sa.text(
        "SELECT COUNT(*) FROM information_schema.columns "
        "WHERE table_schema = DATABASE() AND table_name = :t AND column_name = :c"
    ), {"t": table, "c": col}).scalar() > 0


def upgrade():
    # ── notification_logs ─────────────────────────────────────────────────────
    if not _col_exists('notification_logs', 'sent_at'):
        op.add_column('notification_logs', sa.Column('sent_at', sa.DateTime, nullable=True))

    # ── cg_entrance_exams ─────────────────────────────────────────────────────
    if not _col_exists('cg_entrance_exams', 'conducting_authority'):
        op.add_column('cg_entrance_exams', sa.Column('conducting_authority', sa.String(300), nullable=True))
    if not _col_exists('cg_entrance_exams', 'exam_mode'):
        op.add_column('cg_entrance_exams', sa.Column('exam_mode', sa.String(50), nullable=True))
    if not _col_exists('cg_entrance_exams', 'notification_pdf_url'):
        op.add_column('cg_entrance_exams', sa.Column('notification_pdf_url', sa.Text, nullable=True))


def downgrade():
    for col in ['sent_at']:
        if _col_exists('notification_logs', col):
            op.drop_column('notification_logs', col)
    for col in ['conducting_authority', 'exam_mode', 'notification_pdf_url']:
        if _col_exists('cg_entrance_exams', col):
            op.drop_column('cg_entrance_exams', col)
