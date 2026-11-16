"""
Migration: streak actions for version 1.

  * sp_streak_action_delete — admins can hard-delete a streak action from
    Admin > Career Streaks. Days already counted are kept (streak_days holds
    its own record); the action just stops being a choice.
  * Two labels match v1: "Apply to an opportunity" (Resume and SOP builders
    are hidden) and "Answer marked Solved in Assemble" (the Forum is hidden).

The five actions for hidden / unbuilt features (mock test, course lesson,
learning-path level, current affairs quiz, coding problem) were deleted from
the screen on 17 Oct 2026 and are no longer seeded by migrate_v1_streaks.py.

Idempotent. Run from anywhere:
    venv/Scripts/python.exe database/migrations/migrate_streaks_v1_actions.py
"""
import _bootstrap  # noqa: F401 — puts SKOVO_BACKEND on sys.path and cwd
from sqlalchemy import text

from portal import InitApp
from portal.models import db

app = InitApp().app()

PROC = """
CREATE PROCEDURE `sp_streak_action_delete`(IN p_key VARCHAR(40))
BEGIN
    DELETE FROM `streak_actions` WHERE `action_key` = p_key;
    SELECT IF(ROW_COUNT() > 0, 'deleted', 'notfound') AS `result`;
END
"""

LABELS = {
    'career_tool_used': 'Apply to an opportunity',
    'answer_solved': 'Answer marked Solved in Assemble',
}


def main():
    with app.app_context():
        db.session.execute(text('DROP PROCEDURE IF EXISTS `sp_streak_action_delete`'))
        db.session.execute(text(PROC))
        renamed = sum(db.session.execute(text(
            'UPDATE `streak_actions` SET `label` = :l WHERE `action_key` = :k AND `label` <> :l'),
            {'k': k, 'l': l}).rowcount for k, l in LABELS.items())
        db.session.commit()
        print(f'sp_streak_action_delete ready; labels renamed {renamed}')


if __name__ == '__main__':
    main()
