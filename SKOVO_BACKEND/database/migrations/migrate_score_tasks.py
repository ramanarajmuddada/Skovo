"""Admin-authored readiness tasks.

Idempotent. From SKOVO_BACKEND:
    python database/migrations/migrate_score_tasks.py
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
    'sp_score_task_upsert',
    'sp_score_task_list',
    'sp_score_task_complete',
    'sp_score_tasks_for_student',
    'sp_score_student_find',
    'sp_score_recalc',
]


def _load_table(path):
    ddl = path.read_text(encoding='utf-8')
    lines = [ln for ln in ddl.splitlines() if not ln.strip().startswith('--')]
    ddl = '\n'.join(lines)
    for stmt in [s.strip() for s in ddl.split(';') if s.strip()]:
        db.session.execute(text(stmt))
    db.session.commit()


def _add_column(table, column, ddl):
    have = db.session.execute(text(
        "SELECT COUNT(*) FROM information_schema.COLUMNS "
        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND COLUMN_NAME = :c"
    ), {'t': table, 'c': column}).scalar()
    if not int(have or 0):
        db.session.execute(text(f"ALTER TABLE `{table}` ADD COLUMN {ddl}"))
        db.session.commit()
        print(f'  added {table}.{column}')


def main():
    with app.app_context():
        _load_table(ROOT / 'tables' / 'score_tasks.sql')
        print('  score_tasks ready')
        _add_column('score_tasks', 'education_category', "education_category VARCHAR(30) NULL")
        _add_column('score_tasks', 'degree_type', "degree_type VARCHAR(100) NULL")
        _add_column('score_tasks', 'same_as_id', "same_as_id CHAR(36) NULL")
        _add_column('score_tasks', 'status', "status VARCHAR(12) NOT NULL DEFAULT 'active'")
        have = db.session.execute(text(
            "SELECT COUNT(*) FROM score_event_rules WHERE event_type = 'admin_task'"
        )).scalar()
        if not int(have or 0):
            db.session.execute(text(
                "INSERT INTO score_event_rules "
                "(event_type, label, points, cap_type, cap_value, is_active) "
                "VALUES ('admin_task', 'Task from Skovo', 0, 'per_item', NULL, 1)"
            ))
            db.session.commit()
            print('  added score rule admin_task')
        # A repeat names its group's first task, never another repeat. Older
        # rows could chain (C -> B -> A); point each one at the root.
        for _ in range(10):
            moved = db.session.execute(text(
                "UPDATE score_tasks t JOIN score_tasks r ON r.id = t.same_as_id "
                "SET t.same_as_id = r.same_as_id "
                "WHERE r.same_as_id IS NOT NULL AND r.same_as_id <> t.id"
            )).rowcount
            db.session.commit()
            if not moved:
                break
        db.session.execute(text("UPDATE score_tasks SET same_as_id = NULL WHERE same_as_id = id"))
        db.session.commit()
        print('  repeat links point at the first task')
        apply_sql_file(str(ROOT / 'stored_procedures' / 'score_tasks.sql'))
        print('  procedures applied')
        missing = []
        for name in WANT:
            n = db.session.execute(text(
                "SELECT COUNT(*) FROM information_schema.ROUTINES "
                "WHERE ROUTINE_SCHEMA = DATABASE() AND ROUTINE_NAME = :n"
            ), {'n': name}).scalar()
            if int(n or 0):
                print(f'  OK {name}')
            else:
                missing.append(name)
                print(f'  MISS {name}')
        if missing:
            raise SystemExit(f'missing: {", ".join(missing)}')
        print('Done.')


if __name__ == '__main__':
    main()
