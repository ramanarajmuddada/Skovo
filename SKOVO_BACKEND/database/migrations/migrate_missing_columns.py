"""
NOT v1 - this migration ALTERs cg_abroad_programs and cg_scholarships, two tables removed from
version-1 and moved to database/extra_db/.

The ledger records it as applied so apply_all.py skips it. On a fresh
database it would run against tables that no longer exist.
"""

"""
DB Migration — Add missing columns to match SQLAlchemy models.
Run from SKOVO_BACKEND folder:
    python migrate_missing_columns.py
Safe to re-run: skips columns that already exist.
"""

import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

import _bootstrap  # noqa: F401 — puts SKOVO_BACKEND on sys.path and cwd
from portal import InitApp
from portal.models import db

app = InitApp().app()

MIGRATIONS = [
    # achievers: missing achievement_title, skills, is_featured
    ("achievers",   "achievement_title", "ALTER TABLE achievers ADD COLUMN achievement_title TEXT NULL AFTER full_name"),
    ("achievers",   "skills",            "ALTER TABLE achievers ADD COLUMN skills JSON NULL AFTER avatar_url"),
    ("achievers",   "is_featured",       "ALTER TABLE achievers ADD COLUMN is_featured TINYINT(1) NOT NULL DEFAULT 0 AFTER is_verified"),

    # cg_abroad_programs: missing intake_season, pr_opportunities, application_deadline
    ("cg_abroad_programs", "intake_season",       "ALTER TABLE cg_abroad_programs ADD COLUMN intake_season VARCHAR(50) NULL AFTER program_type"),
    ("cg_abroad_programs", "pr_opportunities",    "ALTER TABLE cg_abroad_programs ADD COLUMN pr_opportunities TEXT NULL AFTER job_opportunities"),
    ("cg_abroad_programs", "application_deadline","ALTER TABLE cg_abroad_programs ADD COLUMN application_deadline DATE NULL AFTER application_process"),

    # cohort_tasks: missing task_type, submission_type, difficulty_level, attachment_url, task_status
    ("cohort_tasks", "task_type",       "ALTER TABLE cohort_tasks ADD COLUMN task_type VARCHAR(50) NULL AFTER description"),
    ("cohort_tasks", "submission_type", "ALTER TABLE cohort_tasks ADD COLUMN submission_type VARCHAR(50) NULL AFTER task_type"),
    ("cohort_tasks", "difficulty_level","ALTER TABLE cohort_tasks ADD COLUMN difficulty_level VARCHAR(50) NULL AFTER submission_type"),
    ("cohort_tasks", "attachment_url",  "ALTER TABLE cohort_tasks ADD COLUMN attachment_url TEXT NULL AFTER difficulty_level"),
    ("cohort_tasks", "task_status",     "ALTER TABLE cohort_tasks ADD COLUMN task_status VARCHAR(20) NOT NULL DEFAULT 'active' AFTER attachment_url"),

    # domains: missing description, is_active
    ("domains", "description", "ALTER TABLE domains ADD COLUMN description TEXT NULL AFTER slug"),
    ("domains", "is_active",   "ALTER TABLE domains ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1 AFTER icon_url"),

    # cg_scholarships: missing provider, scholarship_mode, notification_pdf_url
    ("cg_scholarships", "provider",            "ALTER TABLE cg_scholarships ADD COLUMN provider VARCHAR(300) NULL AFTER name"),
    ("cg_scholarships", "scholarship_mode",    "ALTER TABLE cg_scholarships ADD COLUMN scholarship_mode VARCHAR(30) NULL AFTER scheme_type"),
    ("cg_scholarships", "notification_pdf_url","ALTER TABLE cg_scholarships ADD COLUMN notification_pdf_url TEXT NULL AFTER scholarship_mode"),
]


def column_exists(conn, table, column):
    result = conn.execute(
        "SELECT COUNT(*) FROM information_schema.COLUMNS "
        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s AND COLUMN_NAME = %s",
        (table, column)
    )
    return result.fetchone()[0] > 0


def run():
    with app.app_context():
        with db.engine.connect() as conn:
            added = 0
            skipped = 0
            for table, col, sql in MIGRATIONS:
                if column_exists(conn, table, col):
                    print(f"  SKIP  {table}.{col} — already exists")
                    skipped += 1
                else:
                    conn.execute(sql)
                    conn.execute("COMMIT")
                    print(f"  ADD   {table}.{col}")
                    added += 1

            print(f"\nDone — {added} column(s) added, {skipped} skipped.")


if __name__ == "__main__":
    run()
