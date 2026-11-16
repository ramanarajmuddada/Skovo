"""
Migration: Help & support contacts and issues.

Creates support_contacts and support_issues, then loads:
  sp_support_contacts_{list,create,update,delete}
  sp_support_issues_{create,list,get,update_status,list_for_user}

Idempotent. From SKOVO_BACKEND:
    python database/migrations/migrate_support.py
"""
from sqlalchemy import text

import _bootstrap  # noqa: F401
from portal import InitApp
from portal.models import db
from portal.helpers.sql_file import apply_sql_file

app = InitApp().app()

WANT = [
    'sp_support_contacts_list',
    'sp_support_contacts_create',
    'sp_support_contacts_update',
    'sp_support_contacts_get',
    'sp_support_contacts_delete',
    'sp_support_issues_create',
    'sp_support_issues_list',
    'sp_support_issues_get',
    'sp_support_issues_update_status',
    'sp_support_issues_list_for_user',
]


def _load_table(path):
    ddl = open(path, encoding='utf-8').read()
    for stmt in [s.strip() for s in ddl.split(';') if s.strip()]:
        db.session.execute(text(stmt))
    db.session.commit()


def main():
    with app.app_context():
        _load_table('database/tables/support_contacts.sql')
        print('table support_contacts: ready')
        _load_table('database/tables/support_issues.sql')
        print('table support_issues: ready')

        have_ft = db.session.execute(text(
            "SELECT INDEX_NAME FROM information_schema.STATISTICS "
            "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'support_issues' "
            "AND INDEX_NAME = 'ft_support_issues_text'"
        )).fetchone()
        if not have_ft:
            db.session.execute(text(
                "ALTER TABLE support_issues ADD FULLTEXT KEY ft_support_issues_text (subject, body)"
            ))
            db.session.commit()
            print('fulltext ft_support_issues_text: added')
        else:
            print('fulltext ft_support_issues_text: ready')

        n = apply_sql_file('database/stored_procedures/support.sql')
        print(f'support procedures: {n}')

        have = {r[0] for r in db.session.execute(text(
            "SELECT ROUTINE_NAME FROM information_schema.ROUTINES "
            "WHERE ROUTINE_SCHEMA = DATABASE() AND ROUTINE_NAME IN "
            f"({', '.join(repr(x) for x in WANT)})"
        )).fetchall()}
        for name in WANT:
            print(f'  {"OK  " if name in have else "MISS"} {name}')
        missing = [n for n in WANT if n not in have]
        if missing:
            raise SystemExit(f'FAILED — not created: {", ".join(missing)}')
        print('\nDone.')


if __name__ == '__main__':
    main()
