"""
Migration: make the student Colleges list load in one query instead of two dumps.

WHY
    `GET /v1/colleges` called sp_colleges_list(5000, 0, 1) and
    sp_college_courses_list(50000, 0) on every request — both `SELECT *` — and
    then did the searching, filtering, sorting and pagination in Python. With
    the colleges table empty that is still three round trips to RDS for twenty
    empty rows; with the table populated it is megabytes of TEXT and JSON blobs
    per page view.

    This installs sp_colleges_browse / sp_college_courses_by_ids (see
    database/stored_procedures/business/colleges_browse.sql) and the indexes
    they need.

INDEXES
    `colleges` and `college_courses` had nothing but their PRIMARY KEY. Every
    filter the browse screen offers — type, state, the name/city search, the
    NIRF ordering — was a full scan plus a filesort, and the personalised
    degree filter had no way into college_courses except by reading all of it.

    idx_colleges_browse leads on (is_active, deleted_at) because every list
    query carries both, then nirf_ranking so the ORDER BY can walk the index
    instead of sorting. The single-column indexes cover the filter chips.

    LIKE '%x%' cannot use an index — the search is still a scan of the rows the
    other predicates leave. That is the right trade for now: a FULLTEXT index on
    `name` would change what "matching" means (word boundaries, stopwords,
    minimum token length), and this screen's search is a substring match people
    use for partial names like "gitam". Revisit if colleges passes ~50k rows.

CREATES NO TABLES.
    The `skovo` schema's table count is checked before and after — see the note
    in CLAUDE.md. Indexes and procedures do not move it.

Idempotent — MySQL 8 has no ADD INDEX IF NOT EXISTS, so each one is checked
against information_schema first. Run from SKOVO_BACKEND:
    python database/migrations/migrate_colleges_browse_perf.py
"""
import os

from sqlalchemy import text

import _bootstrap  # noqa: F401 — puts SKOVO_BACKEND on sys.path and cwd
from portal import InitApp
from portal.models import db
from portal.helpers.sql_file import apply_sql_file

app = InitApp().app()

SP_FILE = os.path.join('database', 'stored_procedures', 'business', 'colleges_browse.sql')

INDEXES = [
    # table,            index name,              columns
    ('colleges',        'idx_colleges_browse',   '`is_active`, `deleted_at`, `nirf_ranking`'),
    ('colleges',        'idx_colleges_type',     '`type`'),
    ('colleges',        'idx_colleges_state',    '`location_state`'),
    ('colleges',        'idx_colleges_city',     '`location_city`'),
    ('college_courses', 'idx_cc_college',        '`college_id`'),
    ('college_courses', 'idx_cc_degree',         '`degree_type`'),
]


def _table_count(conn):
    return conn.execute(text(
        "SELECT COUNT(*) FROM information_schema.TABLES "
        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'")).scalar()


def _has_index(conn, table, name):
    return conn.execute(text(
        "SELECT COUNT(*) FROM information_schema.STATISTICS "
        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND INDEX_NAME = :i"),
        {"t": table, "i": name}).scalar() > 0


def main():
    with app.app_context():
        before = _table_count(db.session)
        print(f"tables before: {before}")

        # ── indexes ───────────────────────────────────────────────────────────
        for table, name, cols in INDEXES:
            if _has_index(db.session, table, name):
                print(f"[skip] {table}.{name} already present")
                continue
            db.session.execute(text(f"ALTER TABLE `{table}` ADD INDEX `{name}` ({cols})"))
            db.session.commit()
            print(f"[ok]   {table}.{name} created")

        # ── procedures ────────────────────────────────────────────────────────
        # apply_sql_file handles DELIMITER $$ and, crucially, strips the comment
        # block that opens each chunk instead of skipping the chunk — a naive
        # splitter drops the CREATE and leaves only the DROP.
        ran = apply_sql_file(SP_FILE)
        print(f"[ok]   {SP_FILE} - {ran} statements")

        present = db.session.execute(text(
            "SELECT ROUTINE_NAME FROM information_schema.ROUTINES "
            "WHERE ROUTINE_SCHEMA = DATABASE() AND ROUTINE_NAME IN "
            "('sp_colleges_browse', 'sp_college_courses_by_ids')")).scalars().all()
        for name in ('sp_colleges_browse', 'sp_college_courses_by_ids'):
            print(f"{'[ok]  ' if name in present else '[FAIL]'} {name}")

        after = _table_count(db.session)
        print(f"tables after:  {after}")
        if after != before:
            print(f"[FAIL] table count moved {before} -> {after}; this migration adds no tables")


if __name__ == '__main__':
    main()
