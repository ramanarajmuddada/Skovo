"""
Payout line items, one earnings basis, and a visible clawback.

Three things the money floor left open:

  * `payout_request_lines` — what a payout was made of, frozen at request time.
    Without it a paid-out achiever has an amount and no way to check it.
  * `v_achiever_earning_lines` — ONE definition of "released". The release
    predicate (cohort ended / student forfeit / escrow backstop) used to be
    written out twice, in sp_achiever_earnings_summary and again in
    sp_achiever_payout_request. Two copies of the rule that decides who gets
    paid is how the balance and the lines drift apart. Both now read the view.
  * The clamp — `available_balance` was `released - paid - pending` with no
    floor, so a refund after a payout rendered a negative number on the
    Earnings screen. It is now GREATEST(0, ...) with the shortfall surfaced
    separately as `clawback_due`.

Idempotent. From SKOVO_BACKEND:
    python database/migrations/migrate_achiever_payout_lines.py
"""
from sqlalchemy import text

import _bootstrap  # noqa: F401 — puts SKOVO_BACKEND on sys.path and cwd

from portal import InitApp
from portal.models import db
from portal.helpers.sql_file import apply_sql_file

app = InitApp().app()

SQL_FILES = [
    'database/stored_procedures/business/achiever.sql',
]

# Courses are delivered on purchase, so a course line is released the moment it
# is paid. Cohorts and sessions wait for delivery — or for the backstop, so a
# class the achiever never tapped End on cannot trap the money forever.
VIEW = """
CREATE OR REPLACE VIEW `v_achiever_earning_lines` AS
SELECT
    c.achiever_id                              AS achiever_id,
    'cohort'                                   AS source_type,
    ce.id                                      AS source_id,
    c.id                                       AS parent_id,
    IFNULL(c.title, 'Cohort')                  AS title,
    IFNULL(ce.achiever_earning, 0)             AS amount,
    IFNULL(ce.amount_paid, 0)                  AS gross,
    IFNULL(ce.platform_fee, 0)                 AS platform_fee,
    c.session_date                             AS occurred_at,
    (c.status = 'completed'
     OR ce.cancelled_at IS NOT NULL
     OR ((SELECT CAST(setting_value AS UNSIGNED) FROM `payment_settings`
           WHERE setting_key = 'escrow_backstop_hours') IS NOT NULL
         AND c.session_date IS NOT NULL
         AND TIMESTAMPADD(HOUR,
               (SELECT CAST(setting_value AS UNSIGNED) FROM `payment_settings`
                 WHERE setting_key = 'escrow_backstop_hours'),
               TIMESTAMPADD(MINUTE, IFNULL(c.duration_minutes, 0), c.session_date))
             < UTC_TIMESTAMP()))                AS is_released
  FROM `cohort_enrollments` ce
  JOIN `cohorts` c ON c.id = ce.cohort_id
 WHERE ce.payment_status = 'paid'

UNION ALL

SELECT
    s.mentor_id,
    'session',
    s.id,
    s.id,
    '1-on-1 session',
    IFNULL(s.achiever_earning, 0),
    IFNULL(s.amount, 0),
    IFNULL(s.platform_fee, 0),
    s.created_at,
    (s.status = 'completed' OR s.cancelled_at IS NOT NULL)
  FROM `achiever_sessions` s
 WHERE s.payment_status = 'paid'

UNION ALL

SELECT
    ac.achiever_id,
    'course',
    cen.id,
    ac.id,
    IFNULL(ac.title, 'Course'),
    IFNULL(cen.achiever_earning, 0),
    IFNULL(cen.amount_paid, 0),
    IFNULL(cen.platform_fee, 0),
    cen.enrolled_at,
    1
  FROM `course_enrollments` cen
  JOIN `achiever_courses` ac ON ac.id = cen.course_id
 WHERE cen.payment_status = 'paid'
"""


def run():
    with app.app_context():
        db.session.execute(text("""
            CREATE TABLE IF NOT EXISTS `payout_request_lines` (
              `id`          CHAR(36)      NOT NULL,
              `request_id`  CHAR(36)      NOT NULL,
              `source_type` VARCHAR(20)   NOT NULL,
              `source_id`   CHAR(36)      NULL,
              `title`       VARCHAR(255)  NULL,
              `amount`      DECIMAL(12,2) NOT NULL DEFAULT 0,
              `occurred_at` DATETIME      NULL,
              `created_at`  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
              PRIMARY KEY (`id`),
              KEY `ix_payout_lines_request` (`request_id`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        """))
        db.session.commit()
        print("  [ok] payout_request_lines")

        db.session.execute(text(VIEW))
        db.session.commit()
        print("  [ok] v_achiever_earning_lines")

        for path in SQL_FILES:
            count = apply_sql_file(path)
            db.session.commit()
            print(f"  [ok] {path} ({count} statement(s))")


if __name__ == '__main__':
    run()
    print("payout lines migration complete.")
