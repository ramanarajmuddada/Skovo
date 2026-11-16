"""
migrate_rename_mentor_to_achiever.py
Renames the 4 mentor_* tables to achiever_* tables.
Safe to re-run — all operations are idempotent.
"""
import os
import re
import sys
import pymysql
from urllib.parse import urlparse, unquote
import _bootstrap  # noqa: F401 — chdir's to SKOVO_BACKEND so .env is found
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "")

if not DATABASE_URL:
    print("ERROR: DATABASE_URL not found in .env")
    sys.exit(1)

# Parse mysql+pymysql://user:pass@host:port/dbname?...
url = DATABASE_URL
url = re.sub(r'^mysql\+pymysql://', '', url)
url = re.sub(r'\?.*$', '', url)           # strip query string

user_pass, host_db = url.split('@', 1)
if ':' in user_pass:
    DB_USER, DB_PASS = user_pass.split(':', 1)
else:
    DB_USER, DB_PASS = user_pass, ''

if '/' in host_db:
    host_port, DB_NAME = host_db.rsplit('/', 1)
else:
    host_port, DB_NAME = host_db, ''

if ':' in host_port:
    DB_HOST, port_str = host_port.rsplit(':', 1)
    DB_PORT = int(port_str)
else:
    DB_HOST, DB_PORT = host_port, 3306

DB_USER = unquote(DB_USER)
DB_PASS = unquote(DB_PASS)

print(f"Connecting to {DB_USER}@{DB_HOST}:{DB_PORT}/{DB_NAME} ...")

conn = pymysql.connect(
    host=DB_HOST, port=DB_PORT,
    user=DB_USER, password=DB_PASS,
    database=DB_NAME, charset="utf8mb4",
)
conn.autocommit = True


def table_exists(conn, name):
    with conn.cursor() as cur:
        cur.execute(
            "SELECT COUNT(*) FROM information_schema.tables "
            "WHERE table_schema = %s AND table_name = %s",
            (DB_NAME, name),
        )
        return cur.fetchone()[0] > 0


def rename_table(conn, old_name, new_name):
    if table_exists(conn, old_name) and not table_exists(conn, new_name):
        with conn.cursor() as cur:
            cur.execute(f"RENAME TABLE `{old_name}` TO `{new_name}`")
        print(f"  Renamed: {old_name} -> {new_name}")
    elif table_exists(conn, new_name):
        print(f"  Skip (already exists): {new_name}")
    else:
        print(f"  Skip (source not found): {old_name}")


print("\nPart 1 — Rename mentor_* tables to achiever_*")
rename_table(conn, "mentor_sessions",     "achiever_sessions")
rename_table(conn, "mentor_mentees",      "achiever_mentees")
rename_table(conn, "mentor_availability", "achiever_availability")
rename_table(conn, "mentor_slots",        "achiever_slots")

conn.close()
print("\nDone. All mentor tables renamed to achiever_*.")
