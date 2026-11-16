"""BhaAI v1: the usage table and its procedures.

Idempotent. From SKOVO_BACKEND:
    python database/migrations/migrate_bhaai.py
"""
from pathlib import Path

from sqlalchemy import text

import _bootstrap  # noqa: F401
from portal import InitApp
from portal.models import db
from portal.helpers.sql_file import apply_sql_file

app = InitApp().app()
ROOT = Path(__file__).resolve().parents[1]

WANT = [
    'sp_bhaai_usage_count',
    'sp_bhaai_usage_reserve',
    'sp_bhaai_usage_finish',
    'sp_bhaai_cohorts',
]


def _load_table(path):
    ddl = path.read_text(encoding='utf-8')
    lines = [ln for ln in ddl.splitlines() if not ln.strip().startswith('--')]
    ddl = '\n'.join(lines)
    for stmt in [s.strip() for s in ddl.split(';') if s.strip()]:
        db.session.execute(text(stmt))
    db.session.commit()


def main():
    with app.app_context():
        _load_table(ROOT / 'tables' / 'bhaai_usage.sql')
        print('  bhaai_usage ready')
        apply_sql_file(str(ROOT / 'stored_procedures' / 'bhaai.sql'))
        print('  procedures applied')
        missing = []
        for name in WANT:
            n = db.session.execute(text(
                "SELECT COUNT(*) FROM information_schema.ROUTINES "
                "WHERE ROUTINE_SCHEMA = DATABASE() AND ROUTINE_NAME = :n"
            ), {'n': name}).scalar()
            print(f"  {'OK  ' if int(n or 0) else 'MISS'} {name}")
            if not int(n or 0):
                missing.append(name)
        if missing:
            raise SystemExit(f'missing: {", ".join(missing)}')
        print('Done.')


if __name__ == '__main__':
    main()
