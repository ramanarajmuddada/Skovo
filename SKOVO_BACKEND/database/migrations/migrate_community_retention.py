"""
Community chat and document retention, plus platform removal of any member.

Idempotent. From SKOVO_BACKEND:
    python database/migrations/migrate_community_retention.py
"""
from sqlalchemy import text

import _bootstrap  # noqa: F401
from portal import InitApp
from portal.models import db
from portal.helpers.sql_file import apply_sql_file

app = InitApp().app()

WANT = [
    'sp_community_retention_get',
    'sp_community_retention_set',
    'sp_community_files_due',
    'sp_community_purge',
    'sp_community_close',
    'sp_community_admin_remove_member',
    'sp_community_admin_list',
    'sp_community_track_members',
    'sp_community_track_posts',
    'sp_community_track_messages',
    'sp_community_member_exists',
]


def _load_table(path):
    ddl = open(path, encoding='utf-8').read()
    for stmt in [s.strip() for s in ddl.split(';') if s.strip()]:
        db.session.execute(text(stmt))
    db.session.commit()


def main():
    with app.app_context():
        _load_table('database/tables/community_retention.sql')
        print('table community_retention: ready')
        n = apply_sql_file('database/stored_procedures/community_retention.sql')
        print(f'community procedures: {n}')
        have = {r[0] for r in db.session.execute(text(
            "SELECT ROUTINE_NAME FROM information_schema.ROUTINES "
            "WHERE ROUTINE_SCHEMA = DATABASE() AND ROUTINE_NAME IN "
            f"({', '.join(repr(x) for x in WANT)})"
        )).fetchall()}
        for name in WANT:
            print(f'  {"OK  " if name in have else "MISS"} {name}')
        missing = [name for name in WANT if name not in have]
        if missing:
            raise SystemExit(f'FAILED — not created: {", ".join(missing)}')
        row = db.session.execute(text('CALL sp_community_retention_get()')).mappings().fetchone()
        db.session.commit()
        print(f"retention chat_days={row['chat_days']} file_days={row['file_days']}")
        print('Done.')


if __name__ == '__main__':
    main()
