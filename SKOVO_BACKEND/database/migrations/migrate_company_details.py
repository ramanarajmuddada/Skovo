"""Company details for the legal / contact pages: table, the empty row 1 and
its procedures. No business values are seeded -- every field starts NULL
("to be confirmed") until an admin fills it in Admin › Support › Company.

Idempotent. From SKOVO_BACKEND:
    python database/migrations/migrate_company_details.py
"""
from pathlib import Path

from sqlalchemy import text

import _bootstrap  # noqa: F401
from portal import InitApp
from portal.models import db
from portal.helpers.sql_file import apply_sql_file

app = InitApp().app()
ROOT = Path(__file__).resolve().parents[1]
WANT = ['sp_company_details_get', 'sp_company_details_update']


def main():
    with app.app_context():
        ddl = (ROOT / 'tables' / 'company_details.sql').read_text(encoding='utf-8')
        ddl = '\n'.join(ln for ln in ddl.splitlines() if not ln.strip().startswith('--'))
        for stmt in [s.strip() for s in ddl.split(';') if s.strip()]:
            db.session.execute(text(stmt))
        db.session.execute(text('INSERT IGNORE INTO company_details (id) VALUES (1)'))
        db.session.commit()
        print('  company_details ready')

        apply_sql_file(str(ROOT / 'stored_procedures' / 'company_details.sql'))
        missing = [n for n in WANT if not int(db.session.execute(text(
            'SELECT COUNT(*) FROM information_schema.ROUTINES '
            'WHERE ROUTINE_SCHEMA = DATABASE() AND ROUTINE_NAME = :n'), {'n': n}).scalar() or 0)]
        if missing:
            raise SystemExit(f'missing: {", ".join(missing)}')
        print('Done.')


if __name__ == '__main__':
    main()
