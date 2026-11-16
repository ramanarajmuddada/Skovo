"""
DB Migration — Merge mentors table into achievers.

Steps:
  1. Add mentor-login columns to achievers (email, password_hash, status, phone,
     profile_image_url, domains)
  2. Add UNIQUE index on achievers.email
  3. Copy existing mentor rows into achievers (INSERT IGNORE — safe to re-run)
  4. Re-point FK on mentor_mentees  from mentors → achievers
  5. Re-point FK on mentor_sessions from mentors → achievers

Run from SKOVO_BACKEND folder:
    python migrate_achievers_mentors_merge.py

Safe to re-run: every step checks before acting.
"""

import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

import _bootstrap  # noqa: F401 — puts SKOVO_BACKEND on sys.path and cwd
_bootstrap.skip_if_mentors_dropped()
from portal import InitApp
from portal.models import db

app = InitApp().app()

NEW_COLS = [
    ("achievers", "email",             "ALTER TABLE achievers ADD COLUMN email VARCHAR(255) NULL AFTER is_featured"),
    ("achievers", "password_hash",     "ALTER TABLE achievers ADD COLUMN password_hash TEXT NULL AFTER email"),
    ("achievers", "status",            "ALTER TABLE achievers ADD COLUMN status VARCHAR(20) NULL AFTER password_hash"),
    ("achievers", "phone",             "ALTER TABLE achievers ADD COLUMN phone VARCHAR(20) NULL AFTER status"),
    ("achievers", "profile_image_url", "ALTER TABLE achievers ADD COLUMN profile_image_url TEXT NULL AFTER phone"),
    ("achievers", "domains",           "ALTER TABLE achievers ADD COLUMN domains JSON NULL AFTER profile_image_url"),
]


def column_exists(conn, table, column):
    r = conn.execute(
        "SELECT COUNT(*) FROM information_schema.COLUMNS "
        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s AND COLUMN_NAME = %s",
        (table, column)
    )
    return r.fetchone()[0] > 0


def index_exists(conn, table, idx):
    r = conn.execute(
        "SELECT COUNT(*) FROM information_schema.STATISTICS "
        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s AND INDEX_NAME = %s",
        (table, idx)
    )
    return r.fetchone()[0] > 0


def fk_exists(conn, table, constraint):
    r = conn.execute(
        "SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS "
        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s AND CONSTRAINT_NAME = %s",
        (table, constraint)
    )
    return r.fetchone()[0] > 0


def run():
    with app.app_context():
        with db.engine.connect() as conn:

            # ── Step 1: Add new columns ──────────────────────────────────────
            print("Step 1: Adding columns to achievers...")
            for table, col, sql in NEW_COLS:
                if column_exists(conn, table, col):
                    print(f"  SKIP  {table}.{col} — already exists")
                else:
                    conn.execute(sql)
                    conn.execute("COMMIT")
                    print(f"  ADD   {table}.{col}")

            # ── Step 2: Unique index on email ────────────────────────────────
            print("\nStep 2: Unique index on achievers.email...")
            if index_exists(conn, 'achievers', 'uq_achievers_email'):
                print("  SKIP  uq_achievers_email — already exists")
            else:
                conn.execute("ALTER TABLE achievers ADD UNIQUE INDEX uq_achievers_email (email)")
                conn.execute("COMMIT")
                print("  ADD   uq_achievers_email")

            # ── Step 3: Copy mentor rows into achievers ──────────────────────
            print("\nStep 3: Migrating mentor rows into achievers...")
            conn.execute("""
                INSERT IGNORE INTO achievers
                    (id, full_name, email, password_hash, status, phone, bio,
                     designation, company, linkedin_url, profile_image_url,
                     domains, skills, is_active, is_verified, is_featured,
                     created_at, updated_at)
                SELECT
                    id, full_name, email, password_hash, status, phone, bio,
                    designation, company, linkedin_url, profile_image_url,
                    domains, skills, is_active, is_verified, 0,
                    created_at, updated_at
                FROM mentors
            """)
            conn.execute("COMMIT")
            print("  Mentor rows inserted (duplicates skipped via INSERT IGNORE)")

            # ── Step 4: Fix FK on mentor_mentees ────────────────────────────
            print("\nStep 4: Updating mentor_mentees FK...")
            if fk_exists(conn, 'mentor_mentees', 'fk_mentees_mentor'):
                conn.execute("ALTER TABLE mentor_mentees DROP FOREIGN KEY fk_mentees_mentor")
                conn.execute("COMMIT")
                print("  DROP  fk_mentees_mentor")
            else:
                print("  SKIP  fk_mentees_mentor — already dropped")

            if fk_exists(conn, 'mentor_mentees', 'fk_mentees_achiever'):
                print("  SKIP  fk_mentees_achiever — already added")
            else:
                conn.execute(
                    "ALTER TABLE mentor_mentees "
                    "ADD CONSTRAINT fk_mentees_achiever "
                    "FOREIGN KEY (mentor_id) REFERENCES achievers(id) ON DELETE CASCADE"
                )
                conn.execute("COMMIT")
                print("  ADD   fk_mentees_achiever → achievers")

            # ── Step 5: Fix FK on mentor_sessions ───────────────────────────
            print("\nStep 5: Updating mentor_sessions FK...")
            if fk_exists(conn, 'mentor_sessions', 'mentor_sessions_ibfk_1'):
                conn.execute("ALTER TABLE mentor_sessions DROP FOREIGN KEY mentor_sessions_ibfk_1")
                conn.execute("COMMIT")
                print("  DROP  mentor_sessions_ibfk_1")
            else:
                print("  SKIP  mentor_sessions_ibfk_1 — already dropped")

            if fk_exists(conn, 'mentor_sessions', 'fk_sessions_achiever'):
                print("  SKIP  fk_sessions_achiever — already added")
            else:
                conn.execute(
                    "ALTER TABLE mentor_sessions "
                    "ADD CONSTRAINT fk_sessions_achiever "
                    "FOREIGN KEY (mentor_id) REFERENCES achievers(id) ON DELETE CASCADE"
                )
                conn.execute("COMMIT")
                print("  ADD   fk_sessions_achiever → achievers")

            print("\nMigration complete!")


if __name__ == "__main__":
    run()
