"""
Migration: student-created communities.

Adds sp_assemble_group_create — a student can start their own community, and the
creator is inserted as an `owner` member in the same transaction so the group
never exists with nobody in it.

Also restores two procedures that existed only in the live database and had
never been written back to source: sp_assemble_my_group_count (which the free
tier's 3-community cap calls) and sp_assemble_post_pin_toggle. Rebuilding the
schema from this repo produced a database where joining a community and pinning
a post both returned 500.

Idempotent. Run from SKOVO_BACKEND:
    python migrate_assemble_create.py
"""
from sqlalchemy import text

import _bootstrap  # noqa: F401 — puts SKOVO_BACKEND on sys.path and cwd
from portal import InitApp
from portal.models import db
from portal.helpers.sql_file import apply_sql_file

app = InitApp().app()

WANT = [
    'sp_assemble_group_create',
    'sp_assemble_my_group_count',
    'sp_assemble_post_pin_toggle',
    # Owner moderation
    'sp_assemble_group_requests_list',
    'sp_assemble_group_requests_count',
    'sp_assemble_request_decide',
    'sp_assemble_members_list',
    'sp_assemble_member_remove',
    'sp_assemble_post_delete',
]


def main():
    with app.app_context():
        applied = apply_sql_file('database/stored_procedures/endpoints/assemble.sql')
        print(f'applied {applied} procedure(s) from endpoints/assemble.sql')

        have = {
            r[0] for r in db.session.execute(text(
                "SELECT ROUTINE_NAME FROM information_schema.ROUTINES "
                "WHERE ROUTINE_SCHEMA = DATABASE() AND ROUTINE_NAME LIKE 'sp_assemble_%'"
            )).fetchall()
        }
        for name in WANT:
            print(f'  {"OK  " if name in have else "MISS"} {name}')

        missing = [n for n in WANT if n not in have]
        if missing:
            raise SystemExit(f'FAILED — not created: {", ".join(missing)}')
        print('\nDone.')


if __name__ == '__main__':
    main()
