"""How OFTEN decay bites becomes a setting, not a fixed daily hit.

WHY
    Decay was hardcoded to once a day. After the grace period a student lost a
    point every single day, so four weeks of silence wiped a whole score and
    there was no way to soften it except turning the rate down to a fraction.

    That is one policy, not the only sensible one. "Take a point, then leave
    them alone for a week, then take another" is gentler and just as honest --
    but it was not expressible.

WHAT THIS ADDS
    readiness_rules.decay_interval_days -- the gap between cuts.

        1   a point every day        (what it did before; still the default)
        7   a point every week
        30  a point a month

    Combined with the two settings already there:

        grace     how long they can be quiet before anything happens
        per cut   how much comes off each time
        interval  how long until the next cut          <- new

    So "7 day grace, 1 point, every 7 days" reads: quiet for a week, lose a
    point, quiet another week, lose another.

THE FLOOR IS UNCHANGED
    score = GREATEST(0, LEAST(100, FLOOR(base_points - decay_points)))

    It already stops at 0 and can never go negative, and decay stops adding
    once decay_points reaches base_points. Nothing here changes that.

BACKWARD COMPATIBLE
    Default 1 reproduces the old behaviour exactly: `last_decay_on <=
    CURDATE() - INTERVAL 1 DAY` is the same set as `last_decay_on < CURDATE()`.

Idempotent. From SKOVO_BACKEND:
    python database/migrations/migrate_decay_interval.py
"""
from sqlalchemy import text

import _bootstrap  # noqa: F401
from portal import InitApp
from portal.models import db

app = InitApp().app()

DECAY_RUN = """
CREATE PROCEDURE `sp_score_decay_run`()
BEGIN
  DECLARE v_grace INT DEFAULT 7;
  DECLARE v_per INT DEFAULT 1;
  DECLARE v_every INT DEFAULT 1;
  DECLARE v_hit INT DEFAULT 0;

  SELECT IFNULL(decay_grace_days, 7), IFNULL(decay_per_day, 1),
         GREATEST(1, IFNULL(decay_interval_days, 1))
    INTO v_grace, v_per, v_every
    FROM readiness_rules ORDER BY created_at ASC LIMIT 1;

  UPDATE readiness_scores rs
     SET rs.decay_points = rs.decay_points + v_per,
         rs.last_decay_on = CURDATE()
   WHERE (rs.last_decay_on IS NULL
          -- The gap between cuts. At the default of 1 this is the same set as
          -- `last_decay_on < CURDATE()`, so nothing changes for anyone who
          -- has not touched the setting.
          OR rs.last_decay_on <= DATE_SUB(CURDATE(), INTERVAL v_every DAY))
     AND rs.last_event_at IS NOT NULL
     AND rs.last_event_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL v_grace DAY)
     AND rs.decay_points < rs.base_points
     AND NOT EXISTS (
           SELECT 1 FROM score_pause_tokens p
            WHERE p.user_id = rs.user_id
              AND UTC_TIMESTAMP() BETWEEN p.starts_at AND p.ends_at);

  SET v_hit = ROW_COUNT();

  -- Floor at 0, never negative. The band comes from readiness_levels.
  UPDATE readiness_scores
     SET score = GREATEST(0, LEAST(100, FLOOR(base_points - decay_points))),
         `level` = IFNULL((SELECT l.label FROM readiness_levels l
                            WHERE l.is_active = 1
                              AND l.min_score <= GREATEST(0, LEAST(100, FLOOR(base_points - decay_points)))
                            ORDER BY l.min_score DESC LIMIT 1), `level`)
   WHERE decay_points > 0;

  SELECT v_hit AS decayed;
END
"""

# sp_readiness_rules_update is NOT rebuilt here any more.
# migrate_remove_autopause.py owns the current version. Three migrations
# each kept their own copy, so whichever ran LAST decided the signature --
# and the older copies silently dropped parameters added later
# (decay_interval_days, then decay_restore_percent). One owner per
# procedure, or a re-run in the wrong order quietly undoes work.


def main():
    with app.app_context():
        exists = db.session.execute(text(
            "SELECT COUNT(*) FROM information_schema.COLUMNS "
            "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'readiness_rules' "
            "AND COLUMN_NAME = 'decay_interval_days'")).scalar()
        if not exists:
            db.session.execute(text(
                "ALTER TABLE `readiness_rules` "
                "ADD COLUMN `decay_interval_days` INT NOT NULL DEFAULT 1 AFTER `decay_per_day`"))
            print("  added readiness_rules.decay_interval_days (default 1 = daily)")
        else:
            print("  readiness_rules.decay_interval_days already there")
        db.session.commit()

        for name, body in (('sp_score_decay_run', DECAY_RUN),):
            db.session.execute(text(f"DROP PROCEDURE IF EXISTS `{name}`"))
            db.session.execute(text(body.strip()))
            print(f"  created {name}")
        db.session.commit()

        row = db.session.execute(text(
            "SELECT decay_grace_days, decay_per_day, decay_interval_days, "
            "pause_tokens_per_year, pause_days FROM readiness_rules LIMIT 1")).mappings().first()
        print("  decay now:", dict(row))
        print("Done.")


if __name__ == '__main__':
    main()
