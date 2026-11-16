"""Migration: admin Bookings list in one query (search, status, paging, revenue).

The list used to pull 50,000 enrollments, 50,000 users and 5,000 cohorts into
Python and join them there -- and it skipped any booking whose student or
cohort no longer existed. A paid booking whose student deleted their account
simply vanished from admin, refund owed and all. LEFT JOINs keep every
booking; the screen labels the missing side "Deleted student" / "Deleted cohort".

  sp_admin_bookings_page     one page of cohort bookings + total_rows + paid revenue (all matches)
  sp_admin_sessions_page     one page of 1-on-1 mentor sessions, same shape (they had no admin screen)

Read-only; idempotent.
    venv/Scripts/python.exe database/migrations/migrate_admin_bookings_page.py
"""
import _bootstrap  # noqa: F401 — puts SKOVO_BACKEND on sys.path and cwd
from sqlalchemy import text

from portal import InitApp
from portal.models import db

app = InitApp().app()

PROCS = {}
PROCS['sp_admin_bookings_page'] = """
CREATE PROCEDURE `sp_admin_bookings_page`(IN p_q VARCHAR(100), IN p_status VARCHAR(20),
                                          IN p_limit INT, IN p_offset INT)
BEGIN
  SET p_q = NULLIF(TRIM(p_q), ''), p_status = NULLIF(p_status, '');
  SELECT e.id, e.user_id, e.cohort_id, e.payment_status, e.payment_order_id, e.payment_id,
         e.amount_paid, e.attended, e.enrolled_at, e.created_at,
         u.full_name AS user_name, u.email AS user_email, (u.id IS NULL OR u.deleted_at IS NOT NULL) AS user_gone,
         c.title AS cohort_title, c.status AS cohort_status, c.session_date,
         (c.id IS NULL OR c.deleted_at IS NOT NULL) AS cohort_gone,
         COUNT(*) OVER () AS total_rows,
         SUM(IF(e.payment_status = 'paid', e.amount_paid, 0)) OVER () AS total_revenue
    FROM `cohort_enrollments` e
    LEFT JOIN `users` u   ON u.id = e.user_id
    LEFT JOIN `cohorts` c ON c.id = e.cohort_id
   WHERE (p_status IS NULL OR e.payment_status = p_status)
     AND (p_q IS NULL OR u.full_name LIKE CONCAT('%', p_q, '%') OR u.email LIKE CONCAT('%', p_q, '%')
          OR c.title LIKE CONCAT('%', p_q, '%'))
   ORDER BY COALESCE(e.enrolled_at, e.created_at) DESC
   LIMIT p_limit OFFSET p_offset;
END"""

PROCS['sp_admin_sessions_page'] = """
CREATE PROCEDURE `sp_admin_sessions_page`(IN p_q VARCHAR(100), IN p_status VARCHAR(20),
                                          IN p_limit INT, IN p_offset INT)
BEGIN
  SET p_q = NULLIF(TRIM(p_q), ''), p_status = NULLIF(p_status, '');
  SELECT s.id, s.status, s.payment_status, s.amount, s.is_demo, s.no_show, s.payment_order_id,
         s.created_at, s.cancelled_at, s.note,
         COALESCE(sl.start_utc, DATE_SUB(TIMESTAMP(sl.slot_date, sl.start_time), INTERVAL 330 MINUTE)) AS starts_at,
         s.student_id, u.full_name AS student_name, u.email AS student_email,
         (u.id IS NULL OR u.deleted_at IS NOT NULL) AS student_gone,
         s.mentor_id, a.full_name AS mentor_name, (a.id IS NULL) AS mentor_gone,
         COUNT(*) OVER () AS total_rows,
         SUM(IF(s.payment_status = 'paid', s.amount, 0)) OVER () AS total_revenue
    FROM `achiever_sessions` s
    LEFT JOIN `achiever_slots` sl ON sl.session_id = s.id
         AND (s.proposed_slot_id IS NULL OR sl.id <> s.proposed_slot_id)
    LEFT JOIN `users` u     ON u.id = s.student_id
    LEFT JOIN `achievers` a ON a.id = s.mentor_id
   WHERE (p_status IS NULL OR s.status = p_status)
     AND (p_q IS NULL OR u.full_name LIKE CONCAT('%', p_q, '%') OR u.email LIKE CONCAT('%', p_q, '%')
          OR a.full_name LIKE CONCAT('%', p_q, '%'))
   ORDER BY s.created_at DESC
   LIMIT p_limit OFFSET p_offset;
END"""


def main():
    with app.app_context():
        for name, body in PROCS.items():
            db.session.execute(text(f'DROP PROCEDURE IF EXISTS `{name}`'))
            db.session.execute(text(body))
        db.session.commit()
        print('admin bookings procedures ready:', ', '.join(PROCS))


if __name__ == '__main__':
    main()
