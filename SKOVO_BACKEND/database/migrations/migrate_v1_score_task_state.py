"""Score Engine > Tasks: per-task state, and drafts that students never see.

WHAT CHANGES
    score_tasks.state            master_indian_state value (e.g. 'Andhra Pradesh');
                                 NULL = every state. The readiness task sheets
                                 mark a few rows AP-only or TS-only.
    sp_score_task_set_state      sets it (sp_score_batch_task_upsert keeps its
                                 signature, so the admin screen is untouched)
    sp_score_task_list           re-applied from score_tasks.sql with batch_id, state,
                                 action_route and claimed_count (it returned none,
                                 so the admin Tasks tab showed every batch empty)
    sp_score_tasks_for_student   re-applied from stored_procedures/score_tasks.sql,
                                 which now hides drafts outright and filters by
                                 state. Before, any task edited in the last 14
                                 days showed up even when it was not active, so
                                 loading tasks for review would have leaked them.

Only those two procedures are taken from score_tasks.sql: re-running the whole file
would also reapply procedures later migrations have since redefined.

Additive, idempotent. From SKOVO_BACKEND:
    python database/migrations/migrate_v1_score_task_state.py
"""
import os
import re

from sqlalchemy import text

import _bootstrap  # noqa: F401
from portal import InitApp
from portal.models import db

app = InitApp().app()

SQL_FILE = os.path.join(os.path.dirname(__file__), '..', 'stored_procedures', 'score_tasks.sql')

SET_STATE = """
CREATE PROCEDURE `sp_score_task_set_state`(IN p_id CHAR(36), IN p_state VARCHAR(60))
BEGIN
  UPDATE `score_tasks` SET `state` = NULLIF(TRIM(p_state), '') WHERE `id` = p_id;
END"""


def from_sql_file(name):
    src = open(SQL_FILE, encoding='utf-8').read()
    m = re.search(r"(CREATE PROCEDURE `%s`.*?\nEND)\$\$" % name, src, re.S)
    if not m:
        raise SystemExit('%s not found in score_tasks.sql' % name)
    return m.group(1)


BATCHES_FILE = os.path.join(os.path.dirname(__file__), 'migrate_score_task_batches.py')


def batch_task_upsert():
    """sp_score_batch_task_upsert from its owner, which now takes DECIMAL points.
    It took INT, so the readiness sheets' 0.2 / 0.5 tasks were saved as 0."""
    src = open(BATCHES_FILE, encoding='utf-8').read()
    m = re.search(r'\("sp_score_batch_task_upsert", """(.*?)"""\)', src, re.S)
    if not m or 'DECIMAL(5,2)' not in m.group(1):
        raise SystemExit('sp_score_batch_task_upsert (DECIMAL) not found in migrate_score_task_batches.py')
    return m.group(1)


def main():
    with app.app_context():
        has = db.session.execute(text(
            "SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() "
            "AND TABLE_NAME = 'score_tasks' AND COLUMN_NAME = 'state'")).scalar()
        if not has:
            db.session.execute(text("ALTER TABLE `score_tasks` ADD COLUMN `state` VARCHAR(60) NULL"))
            print("  [ok] score_tasks.state added")
        else:
            print("  score_tasks.state already there")

        for name, body in (('sp_score_task_set_state', SET_STATE),
                           ('sp_score_tasks_for_student', from_sql_file('sp_score_tasks_for_student')),
                           # Returns batch_id / state / claimed_count so the admin
                           # Tasks tab can file each task under its batch.
                           ('sp_score_task_list', from_sql_file('sp_score_task_list')),
                           ('sp_score_batch_task_upsert', batch_task_upsert())):
            db.session.execute(text(f"DROP PROCEDURE IF EXISTS `{name}`"))
            db.session.execute(text(body))
            print(f"  [ok] {name}")
        db.session.commit()
        print("Done.")


if __name__ == '__main__':
    main()
