"""
Migration: let students see the exam windows that protect their streak.

The nightly job already covered exam days, but nothing on the student side
said so — a student studying for boards could not tell their streak was safe.

sp_streak_exam_windows_for(user, today, ahead) returns the windows that apply
to this student (their active stage, their profile state — the same match the
nightly job uses in sp_streak_in_exam_window) and are on now or start within
`ahead` days. The Streak page and Today panel show one as a banner.

Idempotent. Run from anywhere:
    venv/Scripts/python.exe database/migrations/migrate_streak_exam_notice.py
"""
import _bootstrap  # noqa: F401 — puts SKOVO_BACKEND on sys.path and cwd
from sqlalchemy import text

from portal import InitApp
from portal.models import db

app = InitApp().app()

PROC = """
CREATE PROCEDURE `sp_streak_exam_windows_for`(IN p_user CHAR(36), IN p_today DATE, IN p_ahead INT)
BEGIN
    DECLARE v_group VARCHAR(20) DEFAULT NULL;
    DECLARE v_state VARCHAR(100) DEFAULT NULL;

    SELECT st.`stage_group` INTO v_group
      FROM `student_stages` st
     WHERE st.`user_id` = p_user AND st.`status` = 'active'
     ORDER BY st.`started_at` DESC LIMIT 1;
    SELECT p.`state` INTO v_state
      FROM `user_profiles` p WHERE p.`user_id` = p_user LIMIT 1;

    SELECT `id`, `label`, `start_date`, `end_date`
      FROM `streak_exam_windows`
     WHERE `is_active` = 1
       AND `end_date` >= p_today
       AND `start_date` <= DATE_ADD(p_today, INTERVAL GREATEST(0, IFNULL(p_ahead, 0)) DAY)
       AND (`stage_group` IS NULL OR `stage_group` = '' OR `stage_group` = v_group)
       AND (`state` IS NULL OR `state` = '' OR `state` = v_state)
     ORDER BY `start_date`;
END
"""


def main():
    with app.app_context():
        db.session.execute(text('DROP PROCEDURE IF EXISTS `sp_streak_exam_windows_for`'))
        db.session.execute(text(PROC))
        db.session.commit()
        print('sp_streak_exam_windows_for ready')


if __name__ == '__main__':
    main()
