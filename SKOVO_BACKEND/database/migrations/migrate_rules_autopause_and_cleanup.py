"""Auto-pause becomes editable, and the four dead point columns go.

TWO THINGS

1. autopause_enabled / autopause_min_points were DB-only
   The nightly job reads both live -- whether to protect students at all, and
   how many points they need before it bothers. Neither appeared on any screen,
   so the only way to change them was to edit the row by hand. That is the same
   gap decay and pauses had before they were surfaced: a setting the engine
   obeys and an admin cannot see.

2. cohort_pts_each / cohort_pts_max / task_pts_each / task_pts_max are dropped
   Nothing reads them. Checked three ways: no Python outside the admin
   passthrough, no JSX outside the form defaults, and the only procedures
   mentioning them are readiness_rules_create/_update writing them back.

   sp_readiness_submit_step looks like a reader and is not -- it has local
   variables called v_cohort_pts and hardcodes `cohorts * 5` capped at 25. That
   is the old v1 assessment path (readiness_assessments: 0 rows), and it writes
   readiness_scores directly rather than through the ledger. Left alone here;
   dropping these columns does not touch it.

   They were the pre-Score-Engine way of setting what a cohort was worth.
   score_event_rules replaced that.

Idempotent. From SKOVO_BACKEND:
    python database/migrations/migrate_rules_autopause_and_cleanup.py
"""
from sqlalchemy import text

import _bootstrap  # noqa: F401
from portal import InitApp
from portal.models import db

app = InitApp().app()

DEAD_COLUMNS = ('cohort_pts_each', 'cohort_pts_max', 'task_pts_each', 'task_pts_max')

CREATE = """
CREATE PROCEDURE `sp_readiness_rules_create`(
    IN p_id CHAR(36),
    IN p_opportunity_unlock_score INT,
    IN p_created_by CHAR(36),
    IN p_updated_by CHAR(36)
)
BEGIN
    IF p_id IS NULL OR p_id = '' THEN SET p_id = UUID(); END IF;
    INSERT INTO `readiness_rules`
        (`id`, `opportunity_unlock_score`, `created_by`, `updated_by`)
    VALUES (p_id, p_opportunity_unlock_score, p_created_by, p_updated_by);
    SELECT * FROM `readiness_rules` WHERE `id` = p_id;
END
"""

# sp_readiness_rules_update is NOT rebuilt here. migrate_remove_autopause.py
# owns the current version, and the copy that used to live here predated
# decay_restore_percent -- so running this migration afterwards silently
# dropped that parameter. A migration should only own what it introduces.

def main():
    with app.app_context():
        # Procedures first: they write the columns, so they must stop before
        # the columns go or every save becomes an error.
        for name, body in (('sp_readiness_rules_create', CREATE),):
            db.session.execute(text(f"DROP PROCEDURE IF EXISTS `{name}`"))
            db.session.execute(text(body.strip()))
            print(f"  rebuilt {name}")
        db.session.commit()

        for col in DEAD_COLUMNS:
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

        cols = db.session.execute(text(
            "SELECT COLUMN_NAME FROM information_schema.COLUMNS "
            "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'readiness_rules' "
            "ORDER BY ORDINAL_POSITION")).fetchall()
        print("  readiness_rules now:", ", ".join(c[0] for c in cols))
        print("Done.")


if __name__ == '__main__':
    main()
