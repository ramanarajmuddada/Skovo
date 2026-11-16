"""Coming back gives some of the lost points back -- how much is a setting.

THE PROBLEM
    score = base_points - decay_points

    base_points grows every time a student earns. decay_points only ever went
    up: nothing in the product reduced it. So returning stopped the bleeding
    and healed nothing.

    A student on 40 who went quiet for twenty days sat at 27, came back, earned
    5, and reached 32. To stand where he was in week one he had to earn another
    13 -- punished for having left rather than rewarded for returning.

THE SETTING
    readiness_rules.decay_restore_percent   0-100

        0    nothing comes back        (how it behaved before)
        50   half the lost points      (the default set here)
        100  a clean slate on return

    Defaulting to 50 because the two ends are both wrong on their own. At 0 a
    student who misses a month can never catch up and stops trying. At 100 one
    login erases a month of decay and decay stops meaning anything -- the same
    objection that ruled out refunding every pause.

WHEN IT FIRES
    Once per return, not once per award. The test is the same one the pause
    charge uses: was the student away longer than the grace period? If the gap
    since their last event is inside grace they never really left, and there is
    nothing to restore.

    It reads last_event_at BEFORE sp_score_award updates it, which is why the
    call sits at the top of that procedure next to the pause release.

Idempotent. From SKOVO_BACKEND:
    python database/migrations/migrate_decay_restore.py
"""
from sqlalchemy import text

import _bootstrap  # noqa: F401
from portal import InitApp
from portal.models import db

app = InitApp().app()

RESTORE = """
CREATE PROCEDURE `sp_score_decay_restore`(IN p_user CHAR(36))
BEGIN
    DECLARE v_grace INT DEFAULT 7;
    DECLARE v_pct INT DEFAULT 0;
    DECLARE v_decay INT DEFAULT 0;
    DECLARE v_last DATETIME DEFAULT NULL;
    DECLARE v_gap INT DEFAULT 0;
    DECLARE v_give INT DEFAULT 0;

    SELECT IFNULL(decay_grace_days, 7), IFNULL(decay_restore_percent, 0)
      INTO v_grace, v_pct
      FROM readiness_rules ORDER BY created_at ASC LIMIT 1;

    SELECT IFNULL(`decay_points`, 0), `last_event_at`
      INTO v_decay, v_last
      FROM `readiness_scores` WHERE `user_id` = p_user;

    SET v_gap = IFNULL(TIMESTAMPDIFF(DAY, v_last, UTC_TIMESTAMP()), 0);

    -- Nothing lost, nothing configured, or they never actually went away.
    IF v_pct <= 0 OR v_decay <= 0 OR v_last IS NULL OR v_gap <= v_grace THEN
      -- Session variables, not a result set. This procedure is only ever
      -- called from inside sp_score_award, and in MySQL an inner SELECT leaks
      -- out as an extra result set to the client. That pushed sp_score_award's
      -- own `awarded` row into third place, and every caller reads the first --
      -- so award() saw 'no_active_pause' where it expected a points value, and
      -- its recalc never fired. Set a variable for debugging; say nothing.
        SET @score_decay_restored = 0;
    ELSE
        -- FLOOR so a rounding error can never hand out a point that was not
        -- lost; a student is never better off for having been away.
        SET v_give = LEAST(v_decay, FLOOR(v_decay * v_pct / 100));

        UPDATE `readiness_scores`
           SET `decay_points` = GREATEST(0, `decay_points` - v_give)
         WHERE `user_id` = p_user;

        SET @score_decay_restored = v_give;
    END IF;
END
"""


def main():
    with app.app_context():
        present = db.session.execute(text(
            "SELECT COUNT(*) FROM information_schema.COLUMNS "
            "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'readiness_rules' "
            "AND COLUMN_NAME = 'decay_restore_percent'")).scalar()
        if not present:
            db.session.execute(text(
                "ALTER TABLE `readiness_rules` ADD COLUMN `decay_restore_percent` "
                "INT NOT NULL DEFAULT 50 AFTER `decay_interval_days`"))
            print("  added readiness_rules.decay_restore_percent (default 50)")
        else:
            print("  readiness_rules.decay_restore_percent already there")
        db.session.commit()

        db.session.execute(text("DROP PROCEDURE IF EXISTS `sp_score_decay_restore`"))
        db.session.execute(text(RESTORE.strip()))
        db.session.commit()
        print("  created sp_score_decay_restore")

        # the rules update procedure has to carry the new field
        cur = db.session.execute(text(
            "SELECT ROUTINE_DEFINITION d FROM information_schema.ROUTINES "
            "WHERE ROUTINE_SCHEMA = DATABASE() "
            "AND ROUTINE_NAME = 'sp_readiness_rules_update'")).scalar() or ''
        print("  rules_update already carries it:",
              'decay_restore_percent' in cur)

        row = db.session.execute(text(
            "SELECT decay_grace_days, decay_per_day, decay_interval_days, "
            "decay_restore_percent FROM readiness_rules LIMIT 1")).mappings().first()
        print("  decay now:", dict(row))
        print("Done.")


if __name__ == '__main__':
    main()
