"""Autopause protects anyone who is falling, not only the never-fallen.

THE BUG
    sp_score_autopause_run carried this condition:

        AND rs.decay_points = 0

    decay_points only ever increases -- nothing in the product resets it. So a
    student who has lost a single point is disqualified from auto-pause for
    good.

    That silently cancels the yearly allowance sitting three lines below it:

        AND (SELECT COUNT(*) ... WHERE YEAR(p2.starts_at) = YEAR(UTC_TIMESTAMP())) < v_max

    The token count resets each January. The decay_points check does not. So a
    student who used both pauses and decayed in year one can never be protected
    again in year two, year three, or ever -- the allowance is there, and
    unreachable.

    It also contradicts the job's own stated purpose, from scheduler.py:

        "spend a pause token FOR students who are about to start decaying.
         Losing progress is what makes people quit rather than come back."

    Someone already losing points is exactly who that describes.

THE FIX
    Drop the condition. What remains is the right set of guards:

        past the grace period          they have actually gone quiet
        base_points >= autopause_min   they have something worth protecting (10)
        no live pause                  not already covered
        under the yearly allowance     2 a year, and that now means something

WHAT CHANGES IN PRACTICE
    A student mid-decay gets caught on the next nightly run if they still have
    a token. They lose a point or two before the net catches them rather than
    none -- autopause runs before decay, so it only misses the days already
    gone. Nobody loses anything they would not have lost before; some people
    stop losing sooner.

Idempotent. From SKOVO_BACKEND:
    python database/migrations/migrate_autopause_fix.py
"""
from sqlalchemy import text

import _bootstrap  # noqa: F401
from portal import InitApp
from portal.models import db

app = InitApp().app()

AUTOPAUSE = """
CREATE PROCEDURE `sp_score_autopause_run`()
BEGIN
  DECLARE v_grace INT DEFAULT 7;
  DECLARE v_max   INT DEFAULT 2;
  DECLARE v_days  INT DEFAULT 21;
  DECLARE v_on    TINYINT(1) DEFAULT 1;
  DECLARE v_floor INT DEFAULT 10;
  DECLARE v_hit   INT DEFAULT 0;

  SELECT IFNULL(decay_grace_days,7), IFNULL(pause_tokens_per_year,2),
         IFNULL(pause_days,21), IFNULL(autopause_enabled,1),
         IFNULL(autopause_min_points,10)
    INTO v_grace, v_max, v_days, v_on, v_floor
    FROM readiness_rules ORDER BY created_at ASC LIMIT 1;

  IF v_on = 0 THEN
    SELECT 0 AS paused;
  ELSE
    INSERT INTO score_pause_tokens (id, user_id, starts_at, ends_at, is_auto)
    SELECT UUID(), rs.user_id, UTC_TIMESTAMP(),
           DATE_ADD(UTC_TIMESTAMP(), INTERVAL v_days DAY), 1
      FROM readiness_scores rs
     WHERE rs.last_event_at IS NOT NULL
       AND rs.last_event_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL v_grace DAY)
       -- Worth protecting: enough earned that losing it would sting.
       AND rs.base_points >= v_floor
       -- `AND rs.decay_points = 0` used to sit here. decay_points never
       -- resets, so it disqualified anyone who had ever lost a point -- which
       -- made the yearly allowance below unreachable for exactly the students
       -- this job exists to protect.
       AND rs.decay_points < rs.base_points
       AND NOT EXISTS (
             SELECT 1 FROM score_pause_tokens p
              WHERE p.user_id = rs.user_id
                AND UTC_TIMESTAMP() BETWEEN p.starts_at AND p.ends_at)
       AND (SELECT COUNT(*) FROM score_pause_tokens p2
             WHERE p2.user_id = rs.user_id
               AND YEAR(p2.starts_at) = YEAR(UTC_TIMESTAMP())) < v_max;

    SET v_hit = ROW_COUNT();
    SELECT v_hit AS paused;
  END IF;
END
"""


def main():
    # RETIRED. This migration fixed automatic pause protection, and
    # migrate_remove_autopause.py has since removed the feature entirely --
    # the procedures are dropped and readiness_rules.autopause_enabled /
    # autopause_min_points no longer exist. Students manage their own pauses.
    #
    # Running the original body would bring all of it back. The file is kept
    # for the history it records; the body below is unreachable.
    print("  autopause was removed by migrate_remove_autopause.py - nothing to do")
    return

    with app.app_context():
        before = db.session.execute(text(
            "SELECT COUNT(*) FROM readiness_scores rs "
            " WHERE rs.last_event_at IS NOT NULL"
            "   AND rs.last_event_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 7 DAY)"
            "   AND rs.base_points >= 10"
            "   AND rs.decay_points > 0")).scalar()
        print(f"  students previously locked out of auto-pause: {before}")

        db.session.execute(text("DROP PROCEDURE IF EXISTS `sp_score_autopause_run`"))
        db.session.execute(text(AUTOPAUSE.strip()))
        db.session.commit()
        print("  sp_score_autopause_run: protects anyone falling, not only the never-fallen")

        left = db.session.execute(text(
            "SELECT ROUTINE_NAME FROM information_schema.ROUTINES "
            "WHERE ROUTINE_SCHEMA = DATABASE() "
            "AND ROUTINE_DEFINITION LIKE '%decay_points = 0%'")).fetchall()
        print("  procedures still carrying `decay_points = 0`:",
              [r[0] for r in left] or "none")
        print("Done.")


if __name__ == '__main__':
    main()
