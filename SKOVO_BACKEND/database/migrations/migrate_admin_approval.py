"""
Migration: admin accounts need a super-admin's approval before they can work.

Until now `admins.status` was set to 'active' the moment the row was created,
so registering *was* being approved. The only thing standing between a stranger
and a working admin account was that the public register endpoint closes once
one admin exists — a rule that silently reopens whenever the table is empty,
which is exactly what happened after a data wipe earlier today.

    PENDING -> ACTIVE -> SUSPENDED
                 ^________|

A pending admin can still sign in. They see their own status and nothing else:
no students, no achievers, no money. Locking them out entirely gives them
nothing to look at and no way to tell whether the request was even received.

The first admin is exempt. Someone has to be able to approve the second one,
and requiring a super-admin to approve the very first admin on an empty
database is a deadlock.

Idempotent - safe to re-run. Run from SKOVO_BACKEND:
    python database/migrations/migrate_admin_approval.py
"""
from sqlalchemy import text

import _bootstrap  # noqa: F401 - puts SKOVO_BACKEND on sys.path and cwd

from portal import InitApp
from portal.models import db
from portal.helpers.sql_file import apply_sql_file

app = InitApp().app()

SP_FILE = 'database/stored_procedures/business/admin_approval.sql'

COLUMNS = [
    ('admins', 'state',
     "ALTER TABLE `admins` ADD COLUMN `state` VARCHAR(20) NOT NULL "
     "DEFAULT 'pending' AFTER `status`"),
    ('admins', 'state_reason',
     "ALTER TABLE `admins` ADD COLUMN `state_reason` TEXT NULL AFTER `state`"),
    ('admins', 'state_changed_at',
     "ALTER TABLE `admins` ADD COLUMN `state_changed_at` DATETIME NULL AFTER `state_reason`"),
    ('admins', 'state_changed_by',
     "ALTER TABLE `admins` ADD COLUMN `state_changed_by` CHAR(36) NULL AFTER `state_changed_at`"),
]

INDEXES = [
    ('admins', 'ix_admins_state',
     "CREATE INDEX ix_admins_state ON `admins` (`state`)"),
]

TABLES = [
    ("admin_state_events", """
        CREATE TABLE IF NOT EXISTS `admin_state_events` (
          `id` CHAR(36) NOT NULL,
          `admin_id` CHAR(36) NOT NULL,
          `from_state` VARCHAR(20) NULL,
          `to_state` VARCHAR(20) NOT NULL,
          `reason` TEXT NULL,
          `actor_id` CHAR(36) NULL,
          `actor_role` VARCHAR(20) NULL,
          `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (`id`),
          KEY `ix_ase_admin` (`admin_id`, `created_at`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """),
]


def _has_column(conn, table, column):
    return conn.execute(text(
        "SELECT COUNT(*) FROM information_schema.COLUMNS "
        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND COLUMN_NAME = :c"
    ), {'t': table, 'c': column}).scalar() > 0


def _has_index(conn, table, index):
    return conn.execute(text(
        "SELECT COUNT(*) FROM information_schema.STATISTICS "
        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND INDEX_NAME = :i"
    ), {'t': table, 'i': index}).scalar() > 0


def main():
    with app.app_context():
        conn = db.session

        for name, ddl in TABLES:
            conn.execute(text(ddl))
            print(f"  table ready: {name}")

        for table, column, ddl in COLUMNS:
            if _has_column(conn, table, column):
                print(f"  {table}.{column}: already present")
            else:
                conn.execute(text(ddl))
                print(f"  {table}.{column}: added")

        for table, index, ddl in INDEXES:
            if _has_index(conn, table, index):
                print(f"  {index}: already present")
            else:
                conn.execute(text(ddl))
                print(f"  {index}: created")

        # Everyone who already had a working account keeps it. Flipping existing
        # admins to pending would lock the platform out of its own console.
        moved = conn.execute(text("""
            UPDATE `admins`
               SET state = 'active',
                   state_changed_at = UTC_TIMESTAMP(),
                   state_reason = 'Existing admin at the time approval was introduced'
             WHERE state = 'pending'
               AND state_changed_at IS NULL
        """)).rowcount
        print(f"  existing admins grandfathered to active: {moved}")

        conn.commit()

        procs = apply_sql_file(SP_FILE)
        print(f"  procedures: {procs} statement(s) from {SP_FILE.split('/')[-1]}")

        print()
        print("verifying:")
        for r in conn.execute(text("SELECT state, COUNT(*) FROM `admins` GROUP BY state")):
            print(f"  state {r[0]:<12} {r[1]}")
        print()
        print("done")


if __name__ == '__main__':
    main()
