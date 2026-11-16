"""Retire readiness_rules.pioneer_min / achiever_min.

WHY
    Levels became rows in `readiness_levels` -- editable names, editable scores,
    any number of them. These two columns are what that replaced: a fixed count
    of three, with the top one called "Achiever", already the mentor role.

    Leaving them in place was not merely untidy. `sp_score_decay_run` still
    WROTE the level from them:

        level = CASE WHEN score >= v_ach THEN 'Achiever'
                     WHEN score >= v_pio THEN 'Pioneer'
                     ELSE 'Explorer' END

    so every nightly decay pass overwrote the configured names on every decayed
    student. An admin could set up Explorer / Builder / Pioneer / Career Ready,
    see it take effect, and find the old three names back the next morning.

WHAT THIS CHANGES
    sp_score_decay_run    level now resolved from readiness_levels
    sp_score_recalc       drops the v_pio/v_ach fallback; falls back to the
                          label already stored, so a lookup miss is stale, never blank
    sp_score_unlocks      stops returning the two columns
    sp_readiness_rules_create / _update
                          two parameters shorter -- callers must be updated in
                          the same deploy
    readiness_rules       both columns dropped; opportunity_unlock_score default
                          corrected 65 -> 60 to match the spec floor the code uses

Idempotent. From SKOVO_BACKEND:
    python database/migrations/migrate_drop_level_min_columns.py
"""
from sqlalchemy import text

import _bootstrap  # noqa: F401
from portal import InitApp
from portal.models import db

app = InitApp().app()

# Resolving the band through the levels table is the whole point of the change,
# so it is written once here and reused by both procedures that need it.
LEVEL_FOR = """IFNULL((SELECT l.label FROM readiness_levels l
                        WHERE l.is_active = 1 AND l.min_score <= {score}
                        ORDER BY l.min_score DESC LIMIT 1), `level`)"""

SCORE_EXPR = "GREATEST(0, LEAST(100, FLOOR(base_points - decay_points)))"

# sp_readiness_rules_update is NOT rebuilt here any more.
# migrate_remove_autopause.py owns the current version. Three migrations
# each kept their own copy, so whichever ran LAST decided the signature --
# and the older copies silently dropped parameters added later
# (decay_interval_days, then decay_restore_percent). One owner per
# procedure, or a re-run in the wrong order quietly undoes work.

# Only sp_score_unlocks below is still owned here. The copies of
# sp_score_recalc, sp_score_decay_run and sp_readiness_rules_create that used to
# sit in this list were superseded by later migrations, and had gone stale:
# re-running this file reverted the direct-credit fix and the decay interval,
# and recreated a rules_create that writes columns which no longer exist.
# A migration should own only what it introduced.

PROCEDURES = [



    ("sp_score_unlocks", """
CREATE PROCEDURE `sp_score_unlocks`(IN p_user CHAR(36))
BEGIN
  DECLARE v_score INT DEFAULT 0;
  SELECT IFNULL(score,0) INTO v_score FROM readiness_scores WHERE user_id = p_user;
  -- The level ladder is built by the caller from readiness_levels; this only
  -- has to hand back the score and the one gate that is not a level.
  SELECT v_score AS score,
         IFNULL(opportunity_unlock_score,60) AS opportunity_unlock_score
    FROM readiness_rules ORDER BY created_at ASC LIMIT 1;
END
"""),


]


def column_exists(name):
    return db.session.execute(text(
        "SELECT COUNT(*) FROM information_schema.COLUMNS "
        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'readiness_rules' "
        "AND COLUMN_NAME = :c"
    ), {'c': name}).scalar() > 0


def main():
    with app.app_context():
        # Procedures first. Dropping the columns while something still selects
        # them turns every score read into an error.
        for name, body in PROCEDURES:
            db.session.execute(text(f"DROP PROCEDURE IF EXISTS `{name}`"))
            db.session.execute(text(body.strip()))
            print(f"  replaced {name}")
        db.session.commit()

        for col in ('pioneer_min', 'achiever_min'):
            if column_exists(col):
                db.session.execute(text(f"ALTER TABLE `readiness_rules` DROP COLUMN `{col}`"))
                print(f"  dropped readiness_rules.{col}")
            else:
                print(f"  readiness_rules.{col} already gone")

        # The column default said 65 while every reader fell back to 60.
        db.session.execute(text(
            "ALTER TABLE `readiness_rules` "
            "MODIFY COLUMN `opportunity_unlock_score` INT NULL DEFAULT 60"))
        db.session.commit()
        print("  opportunity_unlock_score default -> 60")

        left = db.session.execute(text(
            "SELECT ROUTINE_NAME FROM information_schema.ROUTINES "
            "WHERE ROUTINE_SCHEMA = DATABASE() AND ("
            "  ROUTINE_DEFINITION LIKE '%pioneer_min%' OR "
            "  ROUTINE_DEFINITION LIKE '%achiever_min%')"
        )).fetchall()
        print("  procedures still referencing the columns:",
              [r[0] for r in left] or "none")

        cols = db.session.execute(text(
            "SELECT COLUMN_NAME, COLUMN_DEFAULT FROM information_schema.COLUMNS "
            "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'readiness_rules' "
            "ORDER BY ORDINAL_POSITION")).fetchall()
        print("  readiness_rules now:", ", ".join(c[0] for c in cols))
        print("Done.")


if __name__ == '__main__':
    main()
