"""
DB Migration — align ALL column defaults with database/tables/*.sql.

Under the old ORM, column defaults (is_active=1, counters=0, status strings,
timestamps) were applied from Python model definitions. The stored procedures
rely on DB-level defaults instead — but databases created by the old Alembic
migrations never got them, so SP inserts left NULLs. Symptoms: new forum
posts invisible (is_active NULL fails `is_active = 1` filters), bookings with
no created_at, NULL counters.

This reads the repo's DDL files (the source of truth), finds every column
whose live DEFAULT differs, applies `ALTER ... ALTER COLUMN ... SET DEFAULT`
(metadata-only — never touches column types or data), and backfills existing
NULLs with the default so previously-invisible rows reappear.

Run from the SKOVO_BACKEND folder:
    python migrate_column_defaults.py

Safe to re-run: does nothing once live defaults match the DDL. Companion to
migrate_timestamp_defaults.py (which additionally applies NOT NULL +
ON UPDATE CURRENT_TIMESTAMP to the timestamp columns — run that one first).
"""

import sys
import os
import re

sys.path.insert(0, os.path.dirname(__file__))

from sqlalchemy import text
import _bootstrap  # noqa: F401 — puts SKOVO_BACKEND on sys.path and cwd
from portal import InitApp
from portal.models import db

app = InitApp().app()

# Relative to SKOVO_BACKEND, not to this file. _bootstrap has already
# chdir'd there; anchoring on __file__ pointed at
# database/migrations/database/tables, which does not exist.
TABLES_DIR = os.path.join('database', 'tables')

# `col` TYPE ... DEFAULT <literal-or-keyword>  (one column per line in the
# generated DDL). Captures quoted strings, numbers, and CURRENT_TIMESTAMP.
_COL_RE = re.compile(
    r"^\s*`(?P<col>\w+)`\s+.*?DEFAULT\s+(?P<default>'[^']*'|[\w.]+)\s*,?\s*$",
    re.IGNORECASE,
)

def desired_defaults():
    """{(table, column): default-literal} from the DDL files."""
    out = {}
    for fname in sorted(os.listdir(TABLES_DIR)):
        if not fname.endswith('.sql') or fname.startswith('_'):
            continue
        table = fname[:-4]
        with open(os.path.join(TABLES_DIR, fname), encoding='utf-8') as f:
            for line in f:
                m = _COL_RE.match(line)
                if m:
                    out[(table, m.group('col'))] = m.group('default')
    return out


def norm(v):
    """Normalize a default for comparison with information_schema."""
    if v is None:
        return None
    s = str(v).strip().strip("'")
    # CURRENT_TIMESTAMP, CURRENT_TIMESTAMP(6), now(), … are all "now"
    if re.match(r'^(CURRENT_TIMESTAMP|NOW)(\(\d*\))?$', s, re.IGNORECASE):
        return 'CURRENT_TIMESTAMP'
    try:
        return str(int(float(s)))  # 0 == 0.00 == '0'
    except ValueError:
        return s


with app.app_context():
    live = {}
    for t, c, d, ctype, nullable in db.session.execute(text(
        "SELECT TABLE_NAME, COLUMN_NAME, COLUMN_DEFAULT, COLUMN_TYPE, IS_NULLABLE "
        "FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()"
    )).fetchall():
        live[(t, c)] = (d, ctype, nullable)

    fixed = backfilled = errors = 0
    for (table, col), ddl_default in sorted(desired_defaults().items()):
        if (table, col) not in live:
            continue                                    # table/column not in this DB
        cur_default, ctype, nullable = live[(table, col)]
        if norm(cur_default) == norm(ddl_default):
            continue                                    # already matches
        is_ts = norm(ddl_default) == 'CURRENT_TIMESTAMP'
        try:
            if is_ts:
                # SET DEFAULT doesn't accept CURRENT_TIMESTAMP — needs a full
                # MODIFY. Keep the live column type/nullability, add the default.
                nn = 'NOT NULL' if nullable == 'NO' else 'NULL'
                db.session.execute(text(
                    f"ALTER TABLE `{table}` MODIFY COLUMN `{col}` {ctype} {nn} DEFAULT CURRENT_TIMESTAMP"
                ))
            else:
                db.session.execute(text(
                    f"ALTER TABLE `{table}` ALTER COLUMN `{col}` SET DEFAULT {ddl_default}"
                ))
            # Backfill NULLs so rows inserted while the default was missing
            # behave like the ORM would have written them.
            r = db.session.execute(text(
                f"UPDATE `{table}` SET `{col}` = "
                + ("NOW()" if is_ts else ddl_default)
                + f" WHERE `{col}` IS NULL"
            ))
            db.session.commit()
            fixed += 1
            backfilled += r.rowcount or 0
            print(f"  fixed {table}.{col} -> DEFAULT {ddl_default} (backfilled {r.rowcount or 0} rows)")
        except Exception as e:
            db.session.rollback()
            errors += 1
            print(f"  ERROR {table}.{col}: {e}")

    print(f"\nDone. columns_fixed={fixed} rows_backfilled={backfilled} errors={errors}")
