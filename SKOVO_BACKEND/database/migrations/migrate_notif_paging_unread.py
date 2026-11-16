"""Notifications: paging and "mark as unread".

WHAT CHANGES
    sp_notif_list_page    one page of a user's notifications, newest first,
                          with total_rows (COUNT(*) OVER()) so the screen can
                          offer "Load more" instead of silently stopping at 50
    sp_notif_mark_unread  the opposite of sp_notif_mark_read

Procedures only — no table or data changes. Idempotent. From SKOVO_BACKEND:
    python database/migrations/migrate_notif_paging_unread.py
"""
from sqlalchemy import text

import _bootstrap  # noqa: F401
from portal import InitApp
from portal.models import db

app = InitApp().app()

PROCS = [
    "DROP PROCEDURE IF EXISTS `sp_notif_list_page`",
    """CREATE PROCEDURE `sp_notif_list_page`(IN p_user_id CHAR(36), IN p_limit INT, IN p_offset INT)
BEGIN
    SELECT n.*, COUNT(*) OVER() AS total_rows
      FROM `notification_logs` n
     WHERE n.`user_id` = p_user_id
     ORDER BY n.`created_at` DESC
     LIMIT p_limit OFFSET p_offset;
END""",
    "DROP PROCEDURE IF EXISTS `sp_notif_mark_unread`",
    """CREATE PROCEDURE `sp_notif_mark_unread`(IN p_id CHAR(36), IN p_user_id CHAR(36))
BEGIN
    UPDATE `notification_logs` SET `is_read` = 0
     WHERE `id` = p_id AND `user_id` = p_user_id;
    SELECT COUNT(*) AS updated FROM `notification_logs`
     WHERE `id` = p_id AND `user_id` = p_user_id;
END""",
]


def main():
    with app.app_context():
        for sql in PROCS:
            db.session.execute(text(sql))
        db.session.commit()
        print('sp_notif_list_page, sp_notif_mark_unread: ready')


if __name__ == '__main__':
    main()
