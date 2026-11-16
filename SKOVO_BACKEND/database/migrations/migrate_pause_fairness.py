"""Pauses: a year that starts when you joined, and you only pay if it saved you.

THREE CHANGES

1. The allowance year runs from SIGNUP, not from January
       joined 10 Dec 2026  ->  2 pauses until 9 Dec 2027, then 2 more

   Calendar year gave a December joiner two pauses in three weeks and two more
   on 1 January, while a January joiner got two for twelve months. Same rules,
   very different deal. Worse, a pause started on 28 December kept protecting
   into January while no longer counting, so the student was covered AND shown
   a full allowance.

2. Returning ENDS the pause
       There is nothing to protect once a student is active again, and leaving
       it running blocks them from pausing when they next need it.

3. A pause is only CHARGED if it actually saved them from decay
       Back inside the grace period  ->  free
       Back after the grace period   ->  costs one

   The threshold is the grace period itself, not an arbitrary number: inside
   grace no decay was going to happen, so the pause protected nothing and
   charging for it would be charging for air.

   This cannot be gamed. A refund only happens when the student returned before
   any decay was due -- and a student who keeps returning that quickly is
   simply active, never idle past grace, and would never have decayed anyway.

NEW COLUMNS on score_pause_tokens
    idle_since   where the student's quiet spell began, captured when the pause
                 starts. Total idle time is measured from here, so someone
                 already quiet five days who pauses and returns four days later
                 is correctly charged -- decay was due on day eight.
    charged      0 once refunded. The row stays as history either way.
    released_at  when returning ended it early.

Idempotent. From SKOVO_BACKEND:
    python database/migrations/migrate_pause_fairness.py
"""
from sqlalchemy import text

import _bootstrap  # noqa: F401
from portal import InitApp
from portal.models import db

app = InitApp().app()

NEW_COLUMNS = [
    ('idle_since',  'DATETIME NULL'),
    ('charged',     'TINYINT(1) NOT NULL DEFAULT 1'),
    ('released_at', 'DATETIME NULL'),
]

# The student's own allowance window: the most recent anniversary of signup.
# Everything else counts pauses inside it.
WINDOW = """(SELECT DATE_ADD(u.`created_at`,
                 INTERVAL TIMESTAMPDIFF(YEAR, u.`created_at`, UTC_TIMESTAMP()) YEAR)
               FROM `users` u WHERE u.`id` = {user})"""

# Only pauses the student spent themselves, in this window, that were charged.
COUNTED = """`user_id` = {user}
       AND IFNULL(`is_auto`, 0) = 0
       AND IFNULL(`charged`, 1) = 1
       AND `starts_at` >= """

PROCEDURES = [

    ("sp_score_pause_release", """
CREATE PROCEDURE `sp_score_pause_release`(IN p_user CHAR(36))
BEGIN
    -- Called when a student earns again: they are back, so the pause ends.
    -- Whether it costs them depends on whether it did any work.
    DECLARE v_grace INT DEFAULT 7;
    DECLARE v_id CHAR(36) DEFAULT NULL;
    DECLARE v_since DATETIME DEFAULT NULL;
    DECLARE v_idle INT DEFAULT 0;

    SELECT IFNULL(decay_grace_days, 7) INTO v_grace
      FROM readiness_rules ORDER BY created_at ASC LIMIT 1;

    SELECT `id`, IFNULL(`idle_since`, `starts_at`) INTO v_id, v_since
      FROM `score_pause_tokens`
     WHERE `user_id` = p_user
       AND UTC_TIMESTAMP() BETWEEN `starts_at` AND `ends_at`
     ORDER BY `starts_at` DESC LIMIT 1;

    IF v_id IS NULL THEN
      -- Session variables, not a result set. This procedure is only ever
      -- called from inside sp_score_award, and in MySQL an inner SELECT leaks
      -- out as an extra result set to the client. That pushed sp_score_award's
      -- own `awarded` row into third place, and every caller reads the first --
      -- so award() saw 'no_active_pause' where it expected a points value, and
      -- its recalc never fired. Set a variable for debugging; say nothing.
        SET @score_pause_release = 'no_active_pause';
    ELSE
        SET v_idle = TIMESTAMPDIFF(DAY, v_since, UTC_TIMESTAMP());

        UPDATE `score_pause_tokens`
           SET `ends_at`     = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 SECOND),
               `released_at` = UTC_TIMESTAMP(),
               -- Charged only if the quiet spell outlasted the grace period,
               -- which is exactly when decay would have started biting.
               `charged`     = IF(v_idle > v_grace, 1, 0)
         WHERE `id` = v_id;

        SET @score_pause_release = IF(v_idle > v_grace, 'charged', 'refunded');
    END IF;
END
"""),

    ("sp_score_pause_status", """
CREATE PROCEDURE `sp_score_pause_status`(IN p_user CHAR(36))
BEGIN
  DECLARE v_max INT DEFAULT 2;
  DECLARE v_days INT DEFAULT 21;
  DECLARE v_grace INT DEFAULT 7;
  SELECT IFNULL(pause_tokens_per_year,2), IFNULL(pause_days,21),
         IFNULL(decay_grace_days,7)
    INTO v_max, v_days, v_grace
    FROM readiness_rules ORDER BY created_at ASC LIMIT 1;

  SELECT v_max AS max_tokens, v_days AS pause_days, v_grace AS grace_days,
         (SELECT COUNT(*) FROM `score_pause_tokens`
           WHERE """ + COUNTED.format(user='p_user') + WINDOW.format(user='p_user') + """
         ) AS used_this_year,
         (SELECT `ends_at` FROM `score_pause_tokens`
           WHERE `user_id` = p_user AND UTC_TIMESTAMP() BETWEEN `starts_at` AND `ends_at`
           ORDER BY `ends_at` DESC LIMIT 1) AS active_until,
         -- When their allowance comes back. The student can be told a date
         -- instead of just "none left".
         (SELECT DATE_ADD(u.`created_at`,
                   INTERVAL TIMESTAMPDIFF(YEAR, u.`created_at`, UTC_TIMESTAMP()) + 1 YEAR)
            FROM `users` u WHERE u.`id` = p_user) AS resets_on;
END
"""),

    ("sp_score_pause_start", """
CREATE PROCEDURE `sp_score_pause_start`(IN p_id CHAR(36), IN p_user CHAR(36))
BEGIN
  DECLARE v_max INT DEFAULT 2;
  DECLARE v_days INT DEFAULT 21;
  DECLARE v_used INT DEFAULT 0;
  DECLARE v_active INT DEFAULT 0;
  DECLARE v_last DATETIME DEFAULT NULL;

  SELECT IFNULL(pause_tokens_per_year,2), IFNULL(pause_days,21) INTO v_max, v_days
    FROM readiness_rules ORDER BY created_at ASC LIMIT 1;

  SELECT COUNT(*) INTO v_used FROM `score_pause_tokens`
   WHERE """ + COUNTED.format(user='p_user') + WINDOW.format(user='p_user') + """;

  SELECT COUNT(*) INTO v_active FROM `score_pause_tokens`
   WHERE `user_id` = p_user AND UTC_TIMESTAMP() BETWEEN `starts_at` AND `ends_at`;

  IF v_active > 0 THEN
    SELECT 0 AS ok, 'Your score is already paused.' AS message,
           v_used AS used, v_max AS max_tokens;
  ELSEIF v_used >= v_max THEN
    SELECT 0 AS ok,
           CONCAT('You have used all ', v_max, ' score pauses for this year.') AS message,
           v_used AS used, v_max AS max_tokens;
  ELSE
    -- Where the quiet spell actually began. Someone already idle for days
    -- before pausing should be measured from then, not from now.
    SELECT `last_event_at` INTO v_last FROM `readiness_scores` WHERE `user_id` = p_user;

    INSERT INTO `score_pause_tokens`
        (`id`, `user_id`, `starts_at`, `ends_at`, `is_auto`, `idle_since`, `charged`)
    VALUES (p_id, p_user, UTC_TIMESTAMP(),
            DATE_ADD(UTC_TIMESTAMP(), INTERVAL v_days DAY), 0,
            IFNULL(v_last, UTC_TIMESTAMP()), 1);

    SELECT 1 AS ok,
           CONCAT('Score paused for ', v_days, ' days.') AS message,
           v_used + 1 AS used, v_max AS max_tokens;
  END IF;
END
"""),
]


def main():
    with app.app_context():
        for col, ddl in NEW_COLUMNS:
            present = db.session.execute(text(
                "SELECT COUNT(*) FROM information_schema.COLUMNS "
                "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'score_pause_tokens' "
                "AND COLUMN_NAME = :c"), {'c': col}).scalar()
            if not present:
                db.session.execute(text(
                    f"ALTER TABLE `score_pause_tokens` ADD COLUMN `{col}` {ddl}"))
                print(f"  added score_pause_tokens.{col}")
            else:
                print(f"  score_pause_tokens.{col} already there")
        db.session.commit()

        for name, body in PROCEDURES:
            db.session.execute(text(f"DROP PROCEDURE IF EXISTS `{name}`"))
            db.session.execute(text(body.strip()))
            print(f"  created {name}")
        db.session.commit()

        row = db.session.execute(text(
            "SELECT u.full_name, u.created_at, "
            "  DATE_ADD(u.created_at, INTERVAL TIMESTAMPDIFF(YEAR, u.created_at, UTC_TIMESTAMP()) YEAR) AS win_start, "
            "  DATE_ADD(u.created_at, INTERVAL TIMESTAMPDIFF(YEAR, u.created_at, UTC_TIMESTAMP()) + 1 YEAR) AS resets "
            "FROM users u LIMIT 1")).mappings().first()
        if row:
            print(f"  {row['full_name']}: window {row['win_start']} -> resets {row['resets']}")
        print("Done.")


if __name__ == '__main__':
    main()
