"""Reading the score stops being a write.

THE PROBLEM
    sp_score_recalc runs on every page load -- portal/routes/Readiness/score.py
    and portal/routes/Dashboard/dashboard.py both call it before reading. It
    re-sums the student's entire ledger and writes the result back, so every
    dashboard view is a write.

    That was the right call when the nightly sweep did not rebuild anything: the
    read path was the only thing keeping the number correct. The sweep does
    rebuild now, so the recalculation is a safety net -- but a safety net that
    costs a full aggregate and an UPDATE on every page view is the busiest thing
    in the database at 10,000 students.

    Deleting it outright is worse. A missed sweep, an award whose rebuild
    failed, a rule an admin just retuned -- any of those leave a stale number on
    screen, and a wrong score is a user-visible bug.

THE FIX
    Recalculate only when the cache might actually be stale, and answer from the
    cached row otherwise. Two markers make that decidable without summing
    anything:

      readiness_scores.last_seq        the highest score_events.seq this cache
                                       was built from
      readiness_scores.rules_version   the rule-config version it was built with

    A read is stale when the student has a ledger row newer than last_seq, or
    when the rule configuration has moved on. Both are index lookups against a
    single row -- microseconds, and no write.

    The common case (a student opening their dashboard twice, nothing having
    happened in between) now does no aggregation and no write at all.

WHY A VERSION COUNTER AND NOT A TIMESTAMP
    Switching a rule off changes every student's score without writing a single
    ledger row, so a seq check alone would miss it. readiness_rules.rules_version
    is bumped whenever a rule changes; every cached row built before the bump is
    stale by definition. One integer, compared against one integer.

    Bumping it is deliberately cheap and deliberately blunt: it invalidates
    everybody. A rule change genuinely can affect everybody, and being precise
    about which students would cost more than recalculating them.

Idempotent. From SKOVO_BACKEND:
    python database/migrations/migrate_score_read_path.py
"""
from sqlalchemy import text

import _bootstrap  # noqa: F401
from portal import InitApp
from portal.models import db

app = InitApp().app()

BUMP = """
CREATE PROCEDURE `sp_score_rules_bump`()
BEGIN
  -- Called whenever a rule is created, edited, switched, deleted, or bulk
  -- corrected. Every cached score built before this is now stale.
  UPDATE `readiness_rules`
     SET `rules_version` = IFNULL(`rules_version`, 0) + 1;
  SELECT IFNULL(MAX(`rules_version`), 0) AS rules_version FROM `readiness_rules`;
END
"""

READ = """
CREATE PROCEDURE `sp_score_read`(IN p_user CHAR(36))
BEGIN
  DECLARE v_seq      BIGINT DEFAULT NULL;
  DECLARE v_ver      INT    DEFAULT NULL;
  DECLARE v_max_seq  BIGINT DEFAULT NULL;
  DECLARE v_cur_ver  INT    DEFAULT 0;
  DECLARE v_have     INT    DEFAULT 0;

  SELECT COUNT(*), MAX(`last_seq`), MAX(`rules_version`)
    INTO v_have, v_seq, v_ver
    FROM `readiness_scores` WHERE `user_id` = p_user;

  SELECT IFNULL(MAX(`rules_version`), 0) INTO v_cur_ver FROM `readiness_rules`;

  -- The student's newest ledger row. An index lookup on (user_id, ...), not a
  -- sum -- this is the whole reason the read can stay cheap.
  SELECT MAX(`seq`) INTO v_max_seq FROM `score_events` WHERE `user_id` = p_user;

  IF v_have = 0
     OR v_ver IS NULL OR v_ver <> v_cur_ver
     OR (v_max_seq IS NOT NULL AND (v_seq IS NULL OR v_max_seq > v_seq)) THEN
      CALL sp_score_recalc(p_user);
      UPDATE `readiness_scores`
         SET `last_seq` = v_max_seq, `rules_version` = v_cur_ver
       WHERE `user_id` = p_user;
      SET @score_read_recalculated = 1;
  ELSE
      SET @score_read_recalculated = 0;
  END IF;

  SELECT `score`, `level`, `base_points`, IFNULL(`decay_points`, 0) AS decay_points,
         `cohorts_completed`, `tasks_completed`
    FROM `readiness_scores` WHERE `user_id` = p_user;
END
"""


def has_column(table, col):
    return db.session.execute(text(
        "SELECT COUNT(*) FROM information_schema.COLUMNS "
        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND COLUMN_NAME = :c"
    ), {'t': table, 'c': col}).scalar() > 0


def main():
    with app.app_context():
        for table, col, ddl in (
            ('readiness_scores', 'last_seq',      'BIGINT NULL'),
            ('readiness_scores', 'rules_version', 'INT NULL'),
            ('readiness_rules',  'rules_version', 'INT NOT NULL DEFAULT 0'),
        ):
            if has_column(table, col):
                print(f"  {table}.{col} already there")
                continue
            db.session.execute(text(f"ALTER TABLE `{table}` ADD COLUMN `{col}` {ddl}"))
            print(f"  {table}.{col} added")
        db.session.commit()

        for name, body in (('sp_score_rules_bump', BUMP), ('sp_score_read', READ)):
            db.session.execute(text(f"DROP PROCEDURE IF EXISTS `{name}`"))
            db.session.execute(text(body.strip()))
            print(f"  created {name}")
        db.session.commit()

        # Prove it: the first read may rebuild, the second must not, and both
        # must return the same score.
        user = db.session.execute(text(
            "SELECT user_id FROM readiness_scores LIMIT 1")).scalar()
        if user:
            first = db.session.execute(text("CALL sp_score_read(:u)"),
                                       {'u': user}).mappings().first()
            db.session.commit()
            did1 = db.session.execute(text("SELECT @score_read_recalculated")).scalar()
            second = db.session.execute(text("CALL sp_score_read(:u)"),
                                        {'u': user}).mappings().first()
            db.session.commit()
            did2 = db.session.execute(text("SELECT @score_read_recalculated")).scalar()
            print(f"  first read recalculated: {did1}   second: {did2}")
            print(f"  same answer both times: "
                  f"{dict(first or {}).get('score') == dict(second or {}).get('score')}")

            db.session.execute(text("CALL sp_score_rules_bump()"))
            db.session.commit()
            db.session.execute(text("CALL sp_score_read(:u)"), {'u': user})
            db.session.commit()
            did3 = db.session.execute(text("SELECT @score_read_recalculated")).scalar()
            print(f"  after a rule change, the next read recalculated: {did3}")
        print("Done.")


if __name__ == '__main__':
    main()
