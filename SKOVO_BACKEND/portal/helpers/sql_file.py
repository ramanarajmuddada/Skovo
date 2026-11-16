"""
Load a `database/stored_procedures/*.sql` file into the database.

`DELIMITER $$` is a mysql-client instruction — the driver never sees it and
would choke on it — so strip those lines and split the file on `$$` instead.
Each remaining statement is executed on its own, which is exactly what the
server expects for CREATE PROCEDURE.

Used by the migrate_*.py scripts so the .sql file in the repo stays the single
source of truth for a procedure's body.
"""
import re

from sqlalchemy import text

from portal.models import db


def apply_sql_file(path, only_containing=None):
    """Replay every statement in `path`. Pass `only_containing` to replay just
    the statements mentioning that name. Returns how many ran."""
    raw = open(path, encoding='utf-8').read()
    raw = re.sub(r'^\s*DELIMITER.*$', '', raw, flags=re.MULTILINE)

    statements = []
    for chunk in raw.split('$$'):
        # A chunk usually opens with the comment block that documents the
        # procedure below it. Strip those leading comment lines rather than
        # skipping the chunk — dropping it would skip the DROP that has to run
        # before its CREATE, and MySQL then errors with "already exists".
        lines = [ln for ln in chunk.strip().splitlines()]
        while lines and (not lines[0].strip() or lines[0].lstrip().startswith('--')):
            lines.pop(0)
        stmt = '\n'.join(lines).strip()
        if not stmt:
            continue
        if only_containing and only_containing not in stmt:
            continue
        statements.append(stmt)

    for stmt in statements:
        db.session.execute(text(stmt))
    db.session.commit()
    return len(statements)


def column_exists(table, column):
    return db.session.execute(text("""
        SELECT COUNT(*) FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND COLUMN_NAME = :c
    """), {'t': table, 'c': column}).scalar() > 0


def add_column(table, column, ddl):
    """ADD COLUMN if it isn't there yet. MySQL has no IF NOT EXISTS for this."""
    if column_exists(table, column):
        return False
    db.session.execute(text(f"ALTER TABLE `{table}` ADD COLUMN `{column}` {ddl}"))
    db.session.commit()
    return True
