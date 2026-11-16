"""
Make a migration runnable from anywhere.

These scripts used to sit in SKOVO_BACKEND/ and relied on that being both the
import root (`from portal import InitApp`) and the working directory (several
open `database/stored_procedures/*.sql` by relative path). Moving them into
database/migrations/ broke both, so this restores them:

  * puts SKOVO_BACKEND on sys.path, so `portal` imports resolve
  * chdir's to SKOVO_BACKEND, so the relative .sql paths still find their files

Import it first, before anything from `portal`:

    import _bootstrap  # noqa: F401

Then a migration runs the same from either directory:

    python database/migrations/migrate_split_master_tables.py
    cd database/migrations && python migrate_split_master_tables.py
"""
import os
import sys

# .../SKOVO_BACKEND/database/migrations/_bootstrap.py -> .../SKOVO_BACKEND
BACKEND_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

if BACKEND_ROOT not in sys.path:
    sys.path.insert(0, BACKEND_ROOT)

os.chdir(BACKEND_ROOT)


def skip_if_masters_dropped():
    """Exit cleanly if the legacy `masters` table is gone.

    Thirteen of these migrations seeded that one shared table. It has since been
    split into 123 `master_<type>` tables and dropped, and master data now ships
    as database/seeds/master_data.sql. Replaying them would fail on a missing
    table, which reads like a broken repo — say what actually happened instead.
    """
    from sqlalchemy import text

    from portal import InitApp
    from portal.models import db

    app = InitApp().app()
    with app.app_context():
        present = db.session.execute(text(
            "SELECT COUNT(*) FROM information_schema.TABLES "
            "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'masters'")).scalar()

    if not present:
        print('superseded — the shared `masters` table was split into one table per '
              'dropdown and dropped.\nMaster data now loads from '
              'database/seeds/master_data.sql. Nothing to do.')
        raise SystemExit(0)


def skip_if_mentors_dropped():
    """Exit cleanly if the legacy `mentors` table is gone.

    Two migrations read FROM mentors to fold it into `achievers`. That merge
    happened long ago and the table was dropped, so on any fresh database they
    fail with "Table 'mentors' doesn't exist" - a red [FAIL] on a deploy for
    work that is already done. Same shape as skip_if_masters_dropped above.
    """
    from sqlalchemy import text

    from portal import InitApp
    from portal.models import db

    app = InitApp().app()
    with app.app_context():
        present = db.session.execute(text(
            "SELECT COUNT(*) FROM information_schema.TABLES "
            "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'mentors'")).scalar()

    if not present:
        print('superseded - `mentors` was merged into `achievers` and dropped. '
              'Nothing to do.')
        raise SystemExit(0)


def ensure_columns(conn, text, table, columns):
    """Add columns a pre-existing table is missing. Returns the names added.

    `CREATE TABLE IF NOT EXISTS` is a no-op when the table is already there, so
    a migration that adds its own columns to an otherwise-generic master table
    silently gets neither the create nor the columns. That is exactly what
    happens here: migrate_split_master_tables.py builds every master_* table
    from the generic five-column shape, and it runs first, so the specialised
    migrations found their table present and their extra columns absent - then
    died on "Unknown column 'category' in 'field list'".

    MySQL 8 has no ADD COLUMN IF NOT EXISTS, so check information_schema.

        ensure_columns(conn, text, "master_achiever_doc_type", {
            "category": "VARCHAR(20) NULL",
        })
    """
    have = {r[0] for r in conn.execute(text(
        "SELECT column_name FROM information_schema.columns "
        "WHERE table_schema = DATABASE() AND table_name = :t"), {"t": table})}

    added = []
    for name, ddl in columns.items():
        if name in have:
            continue
        conn.execute(text("ALTER TABLE `%s` ADD COLUMN `%s` %s" % (table, name, ddl)))
        added.append(name)
    return added
