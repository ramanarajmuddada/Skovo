"""
DB Migration — timestamp defaults for the stored-procedure backend.

Under the old ORM, created_at/updated_at were filled in from Python
(default=/onupdate= on the models). The stored procedures rely on DB-level
defaults instead — but databases created by the old Alembic migrations never
got them, so SP inserts left these columns NULL (new bookings showed no date
and sorted as the oldest items).

This aligns every drifted created_at/updated_at column with the convention
already declared in database/tables/*.sql:

    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP

Run from the SKOVO_BACKEND folder:
    python migrate_timestamp_defaults.py

Safe to re-run: it discovers drifted columns from information_schema, so a
second run finds nothing to do. Existing NULLs are backfilled with NOW()
before NOT NULL is applied.
"""

import sys
import os

sys.path.insert(0, os.path.dirname(__file__))

from sqlalchemy import text
import _bootstrap  # noqa: F401 — puts SKOVO_BACKEND on sys.path and cwd
from portal import InitApp
from portal.models import db

app = InitApp().app()

CREATED_SPEC = "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP"
UPDATED_SPEC = "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"

with app.app_context():
    drifted = db.session.execute(text(
        "SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS "
        "WHERE TABLE_SCHEMA = DATABASE() "
        "  AND COLUMN_NAME IN ('created_at', 'updated_at') "
        "  AND COLUMN_DEFAULT IS NULL "
        "ORDER BY TABLE_NAME, COLUMN_NAME"
    )).fetchall()

    if not drifted:
        print("Nothing to do — all created_at/updated_at columns already have defaults.")

    fixed, errors = 0, 0
    for table, col in drifted:
        spec = CREATED_SPEC if col == 'created_at' else UPDATED_SPEC
        try:
            db.session.execute(text(f"UPDATE `{table}` SET `{col}` = NOW() WHERE `{col}` IS NULL"))
            db.session.execute(text(f"ALTER TABLE `{table}` MODIFY COLUMN `{col}` {spec}"))
            db.session.commit()
            fixed += 1
            print(f"  fixed {table}.{col}")
        except Exception as e:
            db.session.rollback()
            errors += 1
            print(f"  ERROR {table}.{col}: {e}")

    print(f"\nDone. fixed={fixed} errors={errors}")
