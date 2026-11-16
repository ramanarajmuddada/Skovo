"""The last scoring values that lived in Python become settings.

WHY
    Three business values were constants in portal/helpers/score.py and
    portal/scheduler.py. Each is something an admin would reasonably want to
    change, and each needed a deploy:

        REACTION_MILESTONE = 5
            how many reactions a post needs before the student is credited

        VAULT_FOLDERS = ('id_proof', 'marksheet', 'certificate', 'resume')
            which document folders must all be filled to count as
            "profile complete". Hardcoded, while master_document_category is a
            master table an admin already edits -- so adding a ninth category
            could never affect this, and renaming one would break it silently.

        scheduler: sweep at 02:30 IST, decay at 03:00 IST
            the order matters (rules must run before decay so a student who
            earned today is not decayed for yesterday) and nothing enforced it.

WHAT CHANGES
    readiness_rules  + reaction_milestone   INT  default 5
                     + rules_run_at         TIME default 02:30
                     + decay_run_at         TIME default 03:00
    master_document_category
                     + counts_for_profile   TINYINT -- ticked for the original
                                            four, so behaviour is unchanged

    The two times are read at startup. Changing them takes effect on the next
    restart, not mid-day -- a scheduler that reschedules itself from a database
    poll is a different and much larger change, and these move about once a year.

WHAT DELIBERATELY STAYS A CONSTANT
    0 and 100. The readiness score is 0-100 by definition of the product, not by
    configuration. There is no setting because there is no decision.

    ('admin_task', 'admin_adjustment', 'referral_bonus'). These three are
    bookkeeping credits with no admin-managed rule, referenced in 12 procedures.
    Adding a fourth is a code change by nature -- something new has to write it
    -- so a settings row would imply a flexibility that does not exist. The
    guard test knows about this list and allows it.

Idempotent. From SKOVO_BACKEND:
    python database/migrations/migrate_score_settings.py
"""
from sqlalchemy import text

import _bootstrap  # noqa: F401
from portal import InitApp
from portal.models import db

app = InitApp().app()

COLUMNS = [
    ('readiness_rules', 'reaction_milestone', "INT NOT NULL DEFAULT 5"),
    ('readiness_rules', 'rules_run_at',       "TIME NOT NULL DEFAULT '02:30:00'"),
    ('readiness_rules', 'decay_run_at',       "TIME NOT NULL DEFAULT '03:00:00'"),
    ('master_document_category', 'counts_for_profile', "TINYINT(1) NOT NULL DEFAULT 0"),
]

# The four the constant named. Ticked here so nothing changes behaviour today;
# an admin can retick them afterwards.
PROFILE_CATEGORIES = ('id_proof', 'marksheet', 'certificate', 'resume')


def has_column(table, col):
    return db.session.execute(text(
        "SELECT COUNT(*) FROM information_schema.COLUMNS "
        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND COLUMN_NAME = :c"
    ), {'t': table, 'c': col}).scalar() > 0


def main():
    with app.app_context():
        for table, col, ddl in COLUMNS:
            if has_column(table, col):
                print(f"  {table}.{col} already there")
                continue
            db.session.execute(text(f"ALTER TABLE `{table}` ADD COLUMN `{col}` {ddl}"))
            print(f"  {table}.{col} added")
        db.session.commit()

        # Tick the four the constant used to name. Only on first run -- an admin
        # who has since changed the selection must not have it reset, which is
        # the same mistake the v1 rule seed made.
        already = db.session.execute(text(
            "SELECT COUNT(*) FROM master_document_category WHERE counts_for_profile = 1"
        )).scalar()
        if already:
            rows = db.session.execute(text(
                "SELECT value FROM master_document_category WHERE counts_for_profile = 1 "
                "ORDER BY sort_order")).scalars().all()
            print(f"  profile categories already chosen: {', '.join(rows)}")
        else:
            db.session.execute(text(
                "UPDATE master_document_category SET counts_for_profile = 1 "
                "WHERE value IN :v").bindparams(v=PROFILE_CATEGORIES))
            db.session.commit()
            print(f"  profile categories seeded: {', '.join(PROFILE_CATEGORIES)}")

        # One procedure so the helper and the scheduler read the same row rather
        # than each holding their own SELECT.
        db.session.execute(text("DROP PROCEDURE IF EXISTS `sp_score_settings`"))
        db.session.execute(text("""
CREATE PROCEDURE `sp_score_settings`()
BEGIN
  SELECT IFNULL(reaction_milestone, 5)   AS reaction_milestone,
         IFNULL(rules_run_at, '02:30:00') AS rules_run_at,
         IFNULL(decay_run_at, '03:00:00') AS decay_run_at,
         IFNULL(decay_grace_days, 7)      AS decay_grace_days,
         IFNULL(decay_per_day, 1)         AS decay_per_day,
         GREATEST(1, IFNULL(decay_interval_days, 1)) AS decay_interval_days,
         IFNULL(decay_restore_percent, 50) AS decay_restore_percent,
         IFNULL(pause_tokens_per_year, 2) AS pause_tokens_per_year,
         IFNULL(pause_days, 21)           AS pause_days,
         IFNULL(opportunity_unlock_score, 60) AS opportunity_unlock_score,
         (SELECT GROUP_CONCAT(value ORDER BY sort_order)
            FROM master_document_category
           WHERE counts_for_profile = 1 AND is_active = 1) AS profile_categories
    FROM readiness_rules ORDER BY created_at ASC LIMIT 1;
END
"""))
        db.session.commit()
        print("  created sp_score_settings")

        row = db.session.execute(text("CALL sp_score_settings()")).mappings().first()
        for k, v in dict(row or {}).items():
            print(f"    {k:<24} {v}")
        print("Done.")


if __name__ == '__main__':
    main()
