"""A new cohort task is worth 0 points until admin says otherwise.

WHY
    Points are admin-owned (feature-updates.md §5): nothing earns readiness
    points by default, only what admin sets and switches on. cohort_tasks
    .score_weight defaulted to 5, so every task created without a value showed
    "+5" to students though no admin had decided that.

WHAT CHANGES
    cohort_tasks.score_weight   DEFAULT 5 -> DEFAULT 0

    Only the column default. Existing tasks keep their current weight -- an
    admin may have set those on purpose, and changing them silently would move
    what students were promised. Admin edits them on the Tasks screen.

    The code paths already pass 0 explicitly (achiever create, admin create);
    this makes a raw INSERT agree with them.

Idempotent. From SKOVO_BACKEND:
    python database/migrations/migrate_task_weight_default_zero.py
"""
from sqlalchemy import text

import _bootstrap  # noqa: F401
from portal import InitApp
from portal.models import db

app = InitApp().app()


def main():
    with app.app_context():
        now = db.session.execute(text(
            "SELECT COLUMN_DEFAULT FROM information_schema.COLUMNS "
            "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cohort_tasks' "
            "AND COLUMN_NAME = 'score_weight'"
        )).scalar()
        if now is not None and str(now).strip("'") == '0':
            print("  cohort_tasks.score_weight already DEFAULT 0")
        else:
            db.session.execute(text(
                "ALTER TABLE `cohort_tasks` MODIFY COLUMN `score_weight` INT NULL DEFAULT 0"))
            db.session.commit()
            print(f"  cohort_tasks.score_weight: DEFAULT {now} -> DEFAULT 0")

        kept = db.session.execute(text(
            "SELECT COUNT(*) FROM cohort_tasks WHERE score_weight > 0")).scalar()
        print(f"  existing tasks with points, left unchanged: {kept}")
        print("Done.")


if __name__ == '__main__':
    main()
