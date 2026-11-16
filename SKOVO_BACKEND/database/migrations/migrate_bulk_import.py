"""
Migration: bulk import support for the catalogue data.

Colleges (22), college courses (57) and cutoffs (8) are the three tables that
decide whether this is a national product, and they cannot be typed in by hand —
they arrive as spreadsheets from AICTE / UGC / NIRF and counselling authorities,
get corrected, and get re-sent. So the import has to be idempotent and it has to
report per-row rather than fail the file.

Adds `source` and `verified_at` to cg_college_cutoffs. A student plans around a
closing rank; every row must be able to say where it came from and when someone
last checked it.

Idempotent. Run from SKOVO_BACKEND:
    python migrate_bulk_import.py
"""
from sqlalchemy import text

import _bootstrap  # noqa: F401 — puts SKOVO_BACKEND on sys.path and cwd
from portal import InitApp
from portal.models import db
from portal.helpers.sql_file import apply_sql_file, add_column

app = InitApp().app()


def main():
    with app.app_context():
        src = add_column('cg_college_cutoffs', 'source', 'VARCHAR(255) NULL')
        ver = add_column('cg_college_cutoffs', 'verified_at', 'DATETIME NULL')

        # Speeds up the upsert lookup, which runs once per row of a big file.
        idx = db.session.execute(text("""
            SELECT COUNT(1) FROM information_schema.STATISTICS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cg_college_cutoffs'
               AND INDEX_NAME = 'idx_cutoff_identity'
        """)).scalar()
        if not idx:
            db.session.execute(text("""
                CREATE INDEX idx_cutoff_identity ON cg_college_cutoffs
                    (exam_type, year, college_name(100), category)
            """))
            db.session.commit()

        procs = apply_sql_file('database/stored_procedures/bulk_import.sql')

        print(f"statements run: {procs}")
        print(f"cutoffs.source added: {src} | cutoffs.verified_at added: {ver} | identity index: {bool(idx) is False}")


if __name__ == "__main__":
    main()
