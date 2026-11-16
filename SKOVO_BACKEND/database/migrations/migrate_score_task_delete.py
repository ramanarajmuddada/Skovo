"""
Migration: let an admin delete a batch task (hard delete).

Tasks could only be expired, so the 400-odd drafts loaded from the readiness
sheets — most for features hidden in v1 — could never be cleared out.

sp_score_task_delete removes the task and its claims, and clears any other
task that pointed at it as `same_as_id`. It refuses a task that has already
paid somebody: score_events.ref_id holds the task id, and deleting the task
would leave those points pointing at nothing. Expire it instead.

Idempotent. Run from anywhere:
    venv/Scripts/python.exe database/migrations/migrate_score_task_delete.py
"""
import _bootstrap  # noqa: F401 — puts SKOVO_BACKEND on sys.path and cwd
from sqlalchemy import text

from portal import InitApp
from portal.models import db

app = InitApp().app()

PROC = """
CREATE PROCEDURE `sp_score_task_delete`(IN p_id CHAR(36))
BEGIN
    DECLARE v_paid INT DEFAULT 0;
    SELECT COUNT(*) INTO v_paid FROM `score_events` WHERE `ref_id` = p_id;
    IF v_paid > 0 THEN
        SELECT 'paid' AS `result`, v_paid AS `paid`;
    ELSE
        UPDATE `score_tasks` SET `same_as_id` = NULL WHERE `same_as_id` = p_id;
        DELETE FROM `score_task_submissions` WHERE `task_id` = p_id;
        DELETE FROM `score_tasks` WHERE `id` = p_id;
        SELECT IF(ROW_COUNT() > 0, 'deleted', 'notfound') AS `result`, 0 AS `paid`;
    END IF;
END
"""


def main():
    with app.app_context():
        db.session.execute(text('DROP PROCEDURE IF EXISTS `sp_score_task_delete`'))
        db.session.execute(text(PROC))
        db.session.commit()
        print('sp_score_task_delete ready')


if __name__ == '__main__':
    main()
