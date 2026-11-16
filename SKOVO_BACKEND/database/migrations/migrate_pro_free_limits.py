"""
Migration: admin-editable Skovo Pro free-tier caps.

Creates pro_free_limits (one row, shared by every student) and reloads:
  - sp_pro_free_limits_get / _update
  - sp_cohort_free_perk_status / sp_student_cohort_enroll_free_perk
    (now take the allowance so N free paid-cohort seats is not hardcoded to 1)

Idempotent. From SKOVO_BACKEND:
    python database/migrations/migrate_pro_free_limits.py
"""
from sqlalchemy import text

import _bootstrap  # noqa: F401
from portal import InitApp
from portal.models import db
from portal.helpers.sql_file import apply_sql_file

app = InitApp().app()

WANT = [
    'sp_pro_free_limits_get',
    'sp_pro_free_limits_update',
    'sp_cohort_free_perk_status',
    'sp_student_cohort_enroll_free_perk',
]


def main():
    with app.app_context():
        ddl = open('database/tables/pro_free_limits.sql', encoding='utf-8').read()
        for stmt in [s.strip() for s in ddl.split(';') if s.strip()]:
            db.session.execute(text(stmt))
        db.session.commit()
        print('table pro_free_limits: ready')

        n = apply_sql_file('database/stored_procedures/business/pro_free_limits.sql')
        print(f'pro_free_limits procedures: {n}')

        n = apply_sql_file('database/stored_procedures/cohort_free_perk.sql')
        print(f'cohort free-perk procedures: {n}')

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
