"""Automatic protection is removed. Students pause their own score.

WHY
    Auto-pause and manual pause drew on one allowance of two a year, so the
    system could spend both of a student's pauses without asking and then
    refuse when they actually wanted one. Splitting them would have meant up to
    four pause periods a year -- 84 days where decay cannot touch anyone --
    which is more protection than the score is worth.

    The simpler answer is the one taken here: drop the automatic half. A pause
    is something a student chooses, twice a year, and decay applies otherwise.

WHAT GOES
    sp_score_autopause_run        the nightly protection pass
    sp_score_autopause_recent     the notification feed that followed it
    readiness_rules.autopause_enabled
    readiness_rules.autopause_min_points
    the scheduler hook, the admin card, the route fields

WHAT STAYS
    score_pause_tokens.is_auto and the three rows already marked with it. They
    are history -- the system really did pause those students -- and deleting
    them would remove the record of why a score stood still.

    But they no longer COUNT. The allowance now looks only at pauses a student
    spent themselves:

        AND IFNULL(is_auto, 0) = 0

    Without that, three students would still be carrying a used pause they
    never chose, against a feature that no longer exists.

Idempotent. From SKOVO_BACKEND:
    python database/migrations/migrate_remove_autopause.py
"""
from sqlalchemy import text

import _bootstrap  # noqa: F401
from portal import InitApp
from portal.models import db

app = InitApp().app()

# The pause procedures that used to be rebuilt here have moved to
# migrate_pause_fairness.py, which supersedes them with the signup-anniversary
# window, the charge-only-if-it-helped rule and early release. Rebuilding the
# old versions here made THIS migration destructive when run out of order --
# it silently reverted all three. It now only does what its name says.

RULES_UPDATE = """
CREATE PROCEDURE `sp_readiness_rules_update`(
    IN p_id CHAR(36),
    IN p_opportunity_unlock_score INT,
    IN p_decay_grace_days INT,
    IN p_decay_per_day INT,
    IN p_decay_interval_days INT,
    IN p_decay_restore_percent INT,
    IN p_pause_tokens_per_year INT,
    IN p_pause_days INT,
    IN p_created_by CHAR(36),
    IN p_updated_by CHAR(36)
)
BEGIN
    UPDATE `readiness_rules`
    SET `opportunity_unlock_score` = p_opportunity_unlock_score,
        `decay_grace_days`      = IFNULL(p_decay_grace_days, `decay_grace_days`),
        `decay_per_day`         = IFNULL(p_decay_per_day, `decay_per_day`),
        `decay_interval_days`   = IFNULL(p_decay_interval_days, `decay_interval_days`),
        `decay_restore_percent` = IFNULL(p_decay_restore_percent, `decay_restore_percent`),
        `pause_tokens_per_year` = IFNULL(p_pause_tokens_per_year, `pause_tokens_per_year`),
        `pause_days`            = IFNULL(p_pause_days, `pause_days`),
        `created_by` = p_created_by,
        `updated_by` = p_updated_by
    WHERE `id` = p_id;
    SELECT * FROM `readiness_rules` WHERE `id` = p_id;
END
"""


def main():
    with app.app_context():
        for name in ('sp_score_autopause_run', 'sp_score_autopause_recent'):
            db.session.execute(text(f"DROP PROCEDURE IF EXISTS `{name}`"))
            print(f"  dropped {name}")

        for name, body in (('sp_readiness_rules_update', RULES_UPDATE),):
            db.session.execute(text(f"DROP PROCEDURE IF EXISTS `{name}`"))
            db.session.execute(text(body.strip()))
            print(f"  rebuilt {name}")
        db.session.commit()

        for col in ('autopause_enabled', 'autopause_min_points'):
            present = db.session.execute(text(
                "SELECT COUNT(*) FROM information_schema.COLUMNS "
                "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'readiness_rules' "
                "AND COLUMN_NAME = :c"), {'c': col}).scalar()
            if present:
                db.session.execute(text(
                    f"ALTER TABLE `readiness_rules` DROP COLUMN `{col}`"))
                print(f"  dropped readiness_rules.{col}")
            else:
                print(f"  readiness_rules.{col} already gone")
        db.session.commit()

        kept = db.session.execute(text(
            "SELECT COUNT(*) FROM score_pause_tokens WHERE is_auto = 1")).scalar()
        freed = db.session.execute(text(
            "SELECT COUNT(DISTINCT user_id) FROM score_pause_tokens "
            "WHERE is_auto = 1 AND YEAR(starts_at) = YEAR(UTC_TIMESTAMP())")).scalar()
        cols = db.session.execute(text(
            "SELECT COLUMN_NAME FROM information_schema.COLUMNS "
            "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'readiness_rules' "
            "ORDER BY ORDINAL_POSITION")).fetchall()
        print(f"  auto pause rows kept as history: {kept}")
        print(f"  students who get their allowance back: {freed}")
        print("  readiness_rules now:", ", ".join(c[0] for c in cols))
        print("Done.")


if __name__ == '__main__':
    main()
