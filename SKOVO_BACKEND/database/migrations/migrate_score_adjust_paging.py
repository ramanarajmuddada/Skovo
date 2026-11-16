"""
Migration: paging for the Score Engine > Adjust tab.

The student picker stopped at 25 results with no way past them, so with a
hundred students most could only be found by already knowing their name. The
"Recent adjustments" list showed the last 10 with no dates to narrow by.

Adds two paged procedures; the old ones stay for any other caller:

  sp_score_students_page(q, category, limit, offset)
      the picker, a page at a time, with total_rows for the pager
  sp_score_adjustments_page(user, from, to, limit, offset)
      adjustments inside an IST date range, with student and admin names

Idempotent. Run from anywhere:
    venv/Scripts/python.exe database/migrations/migrate_score_adjust_paging.py
"""
import _bootstrap  # noqa: F401 — puts SKOVO_BACKEND on sys.path and cwd
from sqlalchemy import text

from portal import InitApp
from portal.models import db

app = InitApp().app()

PROCS = {
    'sp_score_students_page': """
CREATE PROCEDURE `sp_score_students_page`(
    IN p_q VARCHAR(160), IN p_category VARCHAR(50), IN p_limit INT, IN p_offset INT
)
BEGIN
    DECLARE v_q VARCHAR(200);
    DECLARE v_limit INT;
    DECLARE v_offset INT;
    SET v_q      = CONCAT('%', TRIM(IFNULL(p_q, '')), '%');
    SET v_limit  = LEAST(GREATEST(IFNULL(p_limit, 20), 1), 100);
    SET v_offset = GREATEST(IFNULL(p_offset, 0), 0);

    SELECT u.`id`, u.`full_name`, u.`email`,
           p.`education_category`, p.`degree_type`,
           IFNULL(rs.`score`, 0) AS score, rs.`level`,
           COUNT(*) OVER () AS total_rows
      FROM `users` u
      LEFT JOIN `user_profiles` p ON p.`user_id` = u.`id`
      LEFT JOIN `readiness_scores` rs ON rs.`user_id` = u.`id`
     WHERE u.`deleted_at` IS NULL
       AND (TRIM(IFNULL(p_q, '')) = ''
            OR u.`full_name` LIKE v_q OR u.`email` LIKE v_q)
       AND (p_category IS NULL OR p_category = ''
            OR p.`education_category` = p_category)
     ORDER BY u.`full_name`
     LIMIT v_limit OFFSET v_offset;
END
""",
    'sp_score_adjustments_page': """
CREATE PROCEDURE `sp_score_adjustments_page`(
    IN p_user CHAR(36), IN p_from DATE, IN p_to DATE, IN p_limit INT, IN p_offset INT
)
BEGIN
    -- p_from..p_to are IST calendar days; created_at is UTC. NULL = no bound.
    DECLARE v_from   DATETIME;
    DECLARE v_to     DATETIME;
    DECLARE v_limit  INT;
    DECLARE v_offset INT;
    SET v_from   = IF(p_from IS NULL, NULL, DATE_SUB(p_from, INTERVAL 330 MINUTE));
    SET v_to     = IF(p_to   IS NULL, NULL, DATE_SUB(DATE_ADD(p_to, INTERVAL 1 DAY), INTERVAL 330 MINUTE));
    SET v_limit  = LEAST(GREATEST(IFNULL(p_limit, 20), 1), 100);
    SET v_offset = GREATEST(IFNULL(p_offset, 0), 0);

    SELECT a.`id`, a.`user_id`, a.`admin_id`, a.`delta`, a.`reason`, a.`created_at`,
           u.`full_name`  AS student_name,
           u.`email`      AS student_email,
           ad.`full_name` AS admin_name,
           COUNT(*) OVER () AS total_rows
      FROM `score_adjustments` a
      LEFT JOIN `users`  u  ON u.`id`  = a.`user_id`
      LEFT JOIN `admins` ad ON ad.`id` = a.`admin_id`
     WHERE (p_user IS NULL OR p_user = '' OR a.`user_id` = p_user)
       AND (v_from IS NULL OR a.`created_at` >= v_from)
       AND (v_to   IS NULL OR a.`created_at` <  v_to)
     ORDER BY a.`created_at` DESC
     LIMIT v_limit OFFSET v_offset;
END
""",
}


def main():
    with app.app_context():
        for name, body in PROCS.items():
            db.session.execute(text(f'DROP PROCEDURE IF EXISTS `{name}`'))
            db.session.execute(text(body))
        db.session.commit()
        print('ready: ' + ', '.join(PROCS))


if __name__ == '__main__':
    main()
