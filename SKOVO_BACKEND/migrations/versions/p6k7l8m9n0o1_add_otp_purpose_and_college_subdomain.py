"""feat: add otp_requests.purpose + colleges.institution_subdomain

- otp_requests.purpose scopes an OTP to a privilege level so a student/achiever
  code can never be replayed against an admin/super flow.
- colleges.institution_subdomain backs the AdminColleges tenant-subdomain field
  that the model/serializer previously dropped silently.

Revision ID: p6k7l8m9n0o1
Revises: o5j6k7l8m9n0
Create Date: 2026-06-22 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision      = 'p6k7l8m9n0o1'
down_revision = 'o5j6k7l8m9n0'
branch_labels = None
depends_on    = None


def _col_exists(table, col):
    conn = op.get_bind()
    return conn.execute(sa.text(
        "SELECT COUNT(*) FROM information_schema.columns "
        "WHERE table_schema = DATABASE() AND table_name = :t AND column_name = :c"
    ), {"t": table, "c": col}).scalar() > 0


def upgrade():
    if not _col_exists('otp_requests', 'purpose'):
        op.add_column('otp_requests', sa.Column('purpose', sa.String(30), nullable=True))
    if not _col_exists('colleges', 'institution_subdomain'):
        op.add_column('colleges', sa.Column('institution_subdomain', sa.String(63), nullable=True))


def downgrade():
    if _col_exists('colleges', 'institution_subdomain'):
        op.drop_column('colleges', 'institution_subdomain')
    if _col_exists('otp_requests', 'purpose'):
        op.drop_column('otp_requests', 'purpose')
