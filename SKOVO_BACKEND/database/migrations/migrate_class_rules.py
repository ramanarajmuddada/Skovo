"""
Class-day rules: Start window, missed classes, End session window, automatic
close, the 24-hour complaint window, reminders and achiever strikes.

  * cohorts / achiever_sessions: started_at, ended_at, missed_at,
    rescheduled_at, reminders_sent -- what actually happened, and when.
  * cohort_enrollments / achiever_sessions: earning_hold -- a student's share
    kept back while admin checks a complaint.
  * class_rules (one row) -- every minute and count admin can change.
    `live_from` marks when the rules started: classes created before it keep
    the old behaviour, so no old class is ever marked missed.
  * achiever_strikes, class_issues -- strikes and the admin queue.
  * achievers.classes_paused_at -- new classes and bookings paused.
  * v_achiever_earning_lines -- money is released `release_hours` after End
    session (not at once), and never while a complaint holds it. Classes ended
    before this migration have no ended_at and stay released.

Idempotent. From SKOVO_BACKEND:
    python database/migrations/migrate_class_rules.py
"""
from sqlalchemy import text
import _bootstrap  # noqa: F401 -- puts SKOVO_BACKEND on sys.path and cwd
from portal import InitApp
from portal.models import db

app = InitApp().app()


def _has_col(table, col):
    return bool(db.session.execute(text(
        "SELECT COUNT(*) FROM information_schema.COLUMNS "
        " WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND COLUMN_NAME = :c"
    ), {'t': table, 'c': col}).scalar())


def _add(table, col, ddl):
    if _has_col(table, col):
        print(f"  [ok] {table}.{col} already there")
        return
    db.session.execute(text(f"ALTER TABLE `{table}` ADD COLUMN `{col}` {ddl}"))
    db.session.commit()
    print(f"  [ok] {table}.{col}")


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
    ((c.status = 'completed'
      AND IFNULL(ce.earning_hold, 0) = 0
      AND (c.ended_at IS NULL
           OR TIMESTAMPADD(HOUR, (SELECT release_hours FROM `class_rules` WHERE id = 1), c.ended_at)
              < UTC_TIMESTAMP()))
     OR ce.cancelled_at IS NOT NULL
     OR (IFNULL(ce.earning_hold, 0) = 0
         AND c.ended_at IS NULL
         AND (SELECT CAST(setting_value AS UNSIGNED) FROM `payment_settings`
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
    ((s.status = 'completed'
      AND IFNULL(s.earning_hold, 0) = 0
      AND (s.ended_at IS NULL
           OR TIMESTAMPADD(HOUR, (SELECT release_hours FROM `class_rules` WHERE id = 1), s.ended_at)
              < UTC_TIMESTAMP()))
     OR s.cancelled_at IS NOT NULL)
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
        for t in ('cohorts', 'achiever_sessions'):
            _add(t, 'started_at', 'DATETIME NULL')
            _add(t, 'ended_at', 'DATETIME NULL')
            _add(t, 'missed_at', 'DATETIME NULL')
            _add(t, 'rescheduled_at', 'DATETIME NULL')
            _add(t, 'reminders_sent', "VARCHAR(60) NOT NULL DEFAULT ''")
        _add('cohort_enrollments', 'earning_hold', 'TINYINT(1) NOT NULL DEFAULT 0')
        _add('achiever_sessions', 'earning_hold', 'TINYINT(1) NOT NULL DEFAULT 0')
        _add('achievers', 'classes_paused_at', 'DATETIME NULL')

        db.session.execute(text("""
            CREATE TABLE IF NOT EXISTS `class_rules` (
              `id`                 TINYINT      NOT NULL,
              `start_before_min`   INT          NOT NULL DEFAULT 5,
              `start_after_min`    INT          NOT NULL DEFAULT 5,
              `end_before_min`     INT          NOT NULL DEFAULT 5,
              `auto_close_min`     INT          NOT NULL DEFAULT 60,
              `release_hours`      INT          NOT NULL DEFAULT 24,
              `change_lock_hours`  INT          NOT NULL DEFAULT 24,
              `strike_missed`      INT          NOT NULL DEFAULT 2,
              `strike_late_cancel` INT          NOT NULL DEFAULT 1,
              `strike_left_early`  INT          NOT NULL DEFAULT 1,
              `strike_pause_at`    INT          NOT NULL DEFAULT 3,
              `strike_suspend_at`  INT          NOT NULL DEFAULT 5,
              `strike_days`        INT          NOT NULL DEFAULT 30,
              `reminders_on`       TINYINT(1)   NOT NULL DEFAULT 1,
              `live_from`          DATETIME     NOT NULL,
              `updated_by`         CHAR(36)     NULL,
              `updated_at`         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
              PRIMARY KEY (`id`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        """))
        db.session.execute(text(
            "INSERT IGNORE INTO `class_rules` (id, live_from) VALUES (1, UTC_TIMESTAMP())"))
        db.session.commit()
        print("  [ok] class_rules")

        db.session.execute(text("""
            CREATE TABLE IF NOT EXISTS `achiever_strikes` (
              `id`           CHAR(36)     NOT NULL,
              `achiever_id`  CHAR(36)     NOT NULL,
              `reason`       VARCHAR(30)  NOT NULL,
              `points`       INT          NOT NULL,
              `source_type`  VARCHAR(20)  NULL,
              `source_id`    CHAR(36)     NULL,
              `note`         VARCHAR(500) NULL,
              `created_by`   CHAR(36)     NULL,
              `created_at`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
              `removed_at`   DATETIME     NULL,
              `removed_by`   CHAR(36)     NULL,
              `removed_note` VARCHAR(500) NULL,
              PRIMARY KEY (`id`),
              KEY `ix_strikes_achiever` (`achiever_id`, `removed_at`, `created_at`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        """))
        db.session.execute(text("""
            CREATE TABLE IF NOT EXISTS `class_issues` (
              `id`           CHAR(36)     NOT NULL,
              `kind`         VARCHAR(20)  NOT NULL,
              `source_type`  VARCHAR(20)  NOT NULL,
              `source_id`    CHAR(36)     NOT NULL,
              `booking_id`   CHAR(36)     NULL,
              `achiever_id`  CHAR(36)     NULL,
              `student_id`   CHAR(36)     NULL,
              `reason`       VARCHAR(1000) NULL,
              `status`       VARCHAR(20)  NOT NULL DEFAULT 'open',
              `created_at`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
              `resolved_at`  DATETIME     NULL,
              `resolved_by`  CHAR(36)     NULL,
              `resolution`   VARCHAR(500) NULL,
              PRIMARY KEY (`id`),
              KEY `ix_class_issues_status` (`status`, `created_at`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        """))
        db.session.commit()
        print("  [ok] achiever_strikes, class_issues")

        db.session.execute(text(VIEW))
        db.session.commit()
        print("  [ok] v_achiever_earning_lines (24-hour release, complaint hold)")


if __name__ == '__main__':
    run()
