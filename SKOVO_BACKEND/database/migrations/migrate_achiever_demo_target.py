"""
Migration: demo target is per achiever, not a hardcoded 3.

An admin who asks for more demos names a number (1, 2 or 3). That number is
added to demo_sessions_required so Approve and the achiever's progress bar
use the same target. Without the column, "ask for more" only cleared a flag
and Approve still passed at 3.

Idempotent. From SKOVO_BACKEND:
    python database/migrations/migrate_achiever_demo_target.py
"""
from sqlalchemy import text

import _bootstrap  # noqa: F401

from portal import InitApp
from portal.models import db
from portal.helpers.sql_file import apply_sql_file

app = InitApp().app()

SP_FILE = 'database/stored_procedures/business/achiever_lifecycle.sql'


def run():
    with app.app_context():
        conn = db.session
        exists = conn.execute(text(
            "SELECT COUNT(*) FROM information_schema.COLUMNS "
            "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'achievers' "
            "  AND COLUMN_NAME = 'demo_sessions_required'"
        )).scalar()
        if not exists:
            conn.execute(text(
                "ALTER TABLE `achievers` ADD COLUMN `demo_sessions_required` INT NOT NULL "
                "DEFAULT 3 AFTER `demo_sessions_done`"
            ))
            print("  [ok] added achievers.demo_sessions_required")
        else:
            print("  [ok] achievers.demo_sessions_required already present")
        db.session.commit()

        procs = apply_sql_file(SP_FILE)
        db.session.commit()
        print(f"  [ok] loaded {procs} statement(s) from {SP_FILE}")
        print("Achiever demo-target migration complete.")


if __name__ == "__main__":
    run()
