"""add_password_hash_to_users

Revision ID: 6afca7e11c50
Revises:
Create Date: 2026-05-01 17:38:37.819905

"""
from alembic import op
import sqlalchemy as sa

revision = '6afca7e11c50'
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('users', sa.Column('password_hash', sa.Text(), nullable=True))


def downgrade():
    op.drop_column('users', 'password_hash')
