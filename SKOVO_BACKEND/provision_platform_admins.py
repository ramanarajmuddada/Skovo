"""
Provision the two fixed staff accounts. Safe to re-run.

    PLATFORM_ADMIN_PASSWORD=...  PLATFORM_SUPER_ADMIN_PASSWORD=...  \
        python provision_platform_admins.py

  * creates or updates skovoadmin@gmail.com      in `admins`
  * creates or updates skovosuperadmin@gmail.com in `super_admins`
  * stores only a salted hash (werkzeug generate_password_hash), never the password
  * suspends every other admin / super-admin row, so nothing else can sign in
    (the allowlist in portal/helpers/platform_admins.py refuses them anyway)

The passwords come from the environment so they are never committed.
"""
import os
import sys
import uuid
import datetime

from dotenv import load_dotenv
load_dotenv()

from sqlalchemy import text
from werkzeug.security import generate_password_hash

from portal import InitApp
from portal.models import db
from portal.helpers.platform_admins import ADMIN_EMAILS, SUPER_ADMIN_EMAILS

ACCOUNTS = [
    # table,          email,                       full name,           env var
    ('admins',        'skovoadmin@gmail.com',      'Skovo Admin',       'PLATFORM_ADMIN_PASSWORD'),
    ('super_admins',  'skovosuperadmin@gmail.com', 'Skovo Super Admin', 'PLATFORM_SUPER_ADMIN_PASSWORD'),
]
assert {a[1] for a in ACCOUNTS} == set(ADMIN_EMAILS) | set(SUPER_ADMIN_EMAILS)


def has_column(table, column):
    return db.session.execute(text(
        "SELECT COUNT(*) FROM information_schema.columns "
        "WHERE table_schema = DATABASE() AND table_name = :t AND column_name = :c"),
        {'t': table, 'c': column}).scalar() > 0


app = InitApp().app()
with app.app_context():
    now = datetime.datetime.utcnow()
    for table, email, name, env in ACCOUNTS:
        pw = os.environ.get(env, '')
        if len(pw) < 8:
            sys.exit(f"{env} is missing or shorter than 8 characters.")
        pw_hash = generate_password_hash(pw)
        row = db.session.execute(text(f"SELECT id FROM {table} WHERE LOWER(email) = :e"), {'e': email}).fetchone()
        if row:
            db.session.execute(text(
                f"UPDATE {table} SET full_name=:n, password_hash=:h, status='active', updated_at=:t WHERE id=:i"),
                {'n': name, 'h': pw_hash, 't': now, 'i': row[0]})
            acct_id, verb = row[0], 'updated'
        else:
            acct_id, verb = str(uuid.uuid4()), 'created'
            db.session.execute(text(
                f"INSERT INTO {table} (id, full_name, email, password_hash, status, created_at, updated_at) "
                "VALUES (:i, :n, :e, :h, 'active', :t, :t)"),
                {'i': acct_id, 'n': name, 'e': email, 'h': pw_hash, 't': now})
        # The admin approval gate also reads admins.state; make it 'active'.
        if table == 'admins' and has_column('admins', 'state'):
            db.session.execute(text("UPDATE admins SET state='active' WHERE id=:i"), {'i': acct_id})
        # Suspend everyone else in the table.
        res = db.session.execute(text(
            f"UPDATE {table} SET status='suspended' WHERE LOWER(email) <> :e AND status <> 'suspended'"), {'e': email})
        if table == 'admins' and has_column('admins', 'state'):
            db.session.execute(text("UPDATE admins SET state='suspended' WHERE LOWER(email) <> :e AND state <> 'suspended'"), {'e': email})
        print(f"{table:13s} {email:28s} {verb}; other rows suspended: {res.rowcount}")
    db.session.commit()
    for table in ('admins', 'super_admins'):
        rows = db.session.execute(text(f"SELECT email, status FROM {table}")).fetchall()
        print(table, '->', [(r[0], r[1]) for r in rows])
