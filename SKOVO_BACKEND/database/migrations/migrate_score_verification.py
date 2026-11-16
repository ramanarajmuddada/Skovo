"""Verification at 10,000 students: tag it, never queue it, act in bulk.

THE CONSTRAINT
    Manual review does not survive scale. 10,000 marksheets at 15 seconds each
    is 42 hours of somebody's week, and a queue that long means a student waits
    three weeks for 2 points. So nothing here asks an admin to look at anything.

WHAT IS PROVABLE AND WHAT IS NOT
    The platform can prove, exactly, that a student joined a cohort, wrote a
    post, saved a college. Those awards are facts.

    It cannot prove that a PDF is really this student's marksheet. The format
    and duplicate checks at upload (migrate_docvault_integrity) catch the blank
    page and the shared file; the content is unknowable without OCR.

    So `score_metrics.is_provable` marks the difference, per metric, as data
    rather than as a rule buried in code. documents_uploaded is 0; everything
    else is 1.

WHY THERE IS NO `verified` COLUMN ON THE LEDGER
    Whether an award is *provable* is a property of the metric, not of the row.
    Storing it per row would mean 3 million copies of a fact that lives in one
    place, and flipping is_provable later would leave every old row lying.

    What IS per row is whether a human has actually looked -- so that is what is
    stored: checked_at / checked_by, NULL until someone does. "Needs a look" is
    then derived: an unprovable metric, not yet checked.

    Most rows will stay NULL forever, and that is the intended outcome.

ACTING WITHOUT REVIEWING
    sp_score_awards_search    find awards by rule, date and checked state
    sp_score_awards_check     mark a batch as looked at, in one call
    sp_score_bulk_adjust      one audited correction per affected student

    The point of the tag is not a daily chore. It is that six months from now,
    when a rule turns out to have been gameable, the damage can be found by
    filter and corrected in one action instead of 200 clicks.

Idempotent. From SKOVO_BACKEND:
    python database/migrations/migrate_score_verification.py
"""
from sqlalchemy import text

import _bootstrap  # noqa: F401
from portal import InitApp
from portal.models import db

app = InitApp().app()

# Metrics whose *content* a machine cannot confirm. Seeded once; an admin
# retick is respected on later runs, same discipline as the v1 rule seed.
UNPROVABLE = ('documents_uploaded',)

SEARCH = """
CREATE PROCEDURE `sp_score_awards_search`(
    IN p_event_type VARCHAR(50),
    IN p_needs_look TINYINT,
    IN p_since      DATETIME,
    IN p_until      DATETIME,
    IN p_limit      INT,
    IN p_offset     INT
)
BEGIN
  SELECT e.`id`, e.`user_id`, u.`full_name`, e.`event_type`,
         IFNULL(r.`label`, e.`event_type`) AS rule_label,
         e.`points`, e.`ref_id`, e.`occurred_at`,
         e.`checked_at`, e.`checked_by`,
         -- Derived, never stored: an award is worth a look when its metric is
         -- one a machine cannot confirm and nobody has confirmed it either.
         (IFNULL(m.`is_provable`, 1) = 0 AND e.`checked_at` IS NULL) AS needs_look
    FROM `score_events` e
    JOIN `users` u ON u.`id` = e.`user_id` AND u.`deleted_at` IS NULL
    LEFT JOIN `score_event_rules` r ON r.`event_type` = e.`event_type`
    LEFT JOIN `score_metrics` m ON m.`value` = r.`metric_key`
   WHERE (p_event_type IS NULL OR p_event_type = '' OR e.`event_type` = p_event_type)
     AND (p_since IS NULL OR e.`occurred_at` >= p_since)
     AND (p_until IS NULL OR e.`occurred_at` <= p_until)
     AND (IFNULL(p_needs_look, 0) = 0
          OR (IFNULL(m.`is_provable`, 1) = 0 AND e.`checked_at` IS NULL))
   ORDER BY e.`occurred_at` DESC, e.`seq` DESC
   LIMIT p_limit OFFSET p_offset;
END
"""

CHECK = """
CREATE PROCEDURE `sp_score_awards_check`(
    IN p_ids   TEXT,
    IN p_admin CHAR(36)
)
BEGIN
  -- A comma-separated list rather than one call per row: the whole point is
  -- that an admin acts on a filtered page at once.
  UPDATE `score_events`
     SET `checked_at` = UTC_TIMESTAMP(), `checked_by` = p_admin
   WHERE FIND_IN_SET(`id`, p_ids)
     AND `checked_at` IS NULL;

  SELECT ROW_COUNT() AS checked;
END
"""

BULK = """
CREATE PROCEDURE `sp_score_bulk_adjust`(
    IN p_event_type VARCHAR(50),
    IN p_since      DATETIME,
    IN p_until      DATETIME,
    IN p_admin      CHAR(36),
    IN p_reason     TEXT
)
BEGIN
  DECLARE v_n INT DEFAULT 0;

  IF p_event_type IS NULL OR p_event_type = ''
     OR p_reason IS NULL OR TRIM(p_reason) = '' THEN
      -- A bulk correction with no reason is unauditable, and one with no rule
      -- named would reverse the whole ledger. Refuse both.
      SELECT 0 AS students, 'need_rule_and_reason' AS result;
  ELSE
      DROP TEMPORARY TABLE IF EXISTS `tmp_score_bulk`;
      CREATE TEMPORARY TABLE `tmp_score_bulk` (
          `user_id` CHAR(36) NOT NULL,
          `amount`  DECIMAL(7,2) NOT NULL,
          PRIMARY KEY (`user_id`)
      ) ENGINE=MEMORY;

      INSERT INTO `tmp_score_bulk` (`user_id`, `amount`)
      SELECT e.`user_id`, SUM(e.`points`)
        FROM `score_events` e
        JOIN `users` u ON u.`id` = e.`user_id` AND u.`deleted_at` IS NULL
       WHERE e.`event_type` = p_event_type
         AND (p_since IS NULL OR e.`occurred_at` >= p_since)
         AND (p_until IS NULL OR e.`occurred_at` <= p_until)
       GROUP BY e.`user_id`
      HAVING SUM(e.`points`) > 0;

      -- Audited exactly like a single adjustment, because it is one: the same
      -- table, the same mandatory reason, one row per student.
      INSERT INTO `score_adjustments` (`id`, `user_id`, `admin_id`, `delta`, `reason`)
      SELECT UUID(), b.`user_id`, p_admin, -b.`amount`, p_reason
        FROM `tmp_score_bulk` b;

      INSERT INTO `score_events` (`id`, `user_id`, `event_type`, `points`, `ref_id`, `meta`)
      SELECT UUID(), b.`user_id`, 'admin_adjustment', -b.`amount`,
             -- One reversal per rule per student, ever. A second run of the
             -- same correction is swallowed instead of doubling it.
             CONCAT('bulk:', p_event_type),
             CONCAT('bulk correction: ', LEFT(p_reason, 180))
        FROM `tmp_score_bulk` b
      ON DUPLICATE KEY UPDATE `meta` = `meta`;

      SELECT COUNT(*) INTO v_n FROM `tmp_score_bulk`;
      DROP TEMPORARY TABLE IF EXISTS `tmp_score_bulk`;

      -- Rebuild everyone touched. sp_score_recalc_bulk reads tmp_score_touched.
      DROP TEMPORARY TABLE IF EXISTS `tmp_score_touched`;
      CREATE TEMPORARY TABLE `tmp_score_touched` (
          `user_id` CHAR(36) NOT NULL, PRIMARY KEY (`user_id`)
      ) ENGINE=MEMORY;
      INSERT IGNORE INTO `tmp_score_touched` (`user_id`)
      SELECT DISTINCT `user_id` FROM `score_adjustments`
       WHERE `admin_id` = p_admin AND `reason` = p_reason;
      CALL sp_score_recalc_bulk('touched');
      DROP TEMPORARY TABLE IF EXISTS `tmp_score_touched`;

      SELECT v_n AS students, 'ok' AS result;
  END IF;
END
"""

# What the admin sees before pressing anything -- the delete/bulk warning.
IMPACT = """
CREATE PROCEDURE `sp_score_rule_impact`(IN p_event_type VARCHAR(50))
BEGIN
  -- "This moves 4,312 students and removes 8,624 points." Shown before a rule
  -- is deleted or switched off, because both are silent and immediate for
  -- every student at once.
  SELECT IFNULL(r.`label`, p_event_type) AS rule_label,
         COUNT(DISTINCT e.`user_id`) AS students,
         COUNT(*)                    AS awards,
         IFNULL(SUM(e.`points`), 0)  AS points,
         MIN(e.`occurred_at`)        AS first_award,
         MAX(e.`occurred_at`)        AS last_award
    FROM `score_events` e
    JOIN `users` u ON u.`id` = e.`user_id` AND u.`deleted_at` IS NULL
    LEFT JOIN `score_event_rules` r ON r.`event_type` = e.`event_type`
   WHERE e.`event_type` = p_event_type;
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
            ('score_events',  'checked_at', 'DATETIME NULL'),
            ('score_events',  'checked_by', 'CHAR(36) NULL'),
            ('score_metrics', 'is_provable', 'TINYINT(1) NOT NULL DEFAULT 1'),
        ):
            if has_column(table, col):
                print(f"  {table}.{col} already there")
                continue
            db.session.execute(text(f"ALTER TABLE `{table}` ADD COLUMN `{col}` {ddl}"))
            print(f"  {table}.{col} added")
        db.session.commit()

        # Seed once. An admin who later marks something else unprovable -- or
        # marks documents provable because they added OCR -- keeps their choice.
        already = db.session.execute(text(
            "SELECT COUNT(*) FROM score_metrics WHERE is_provable = 0")).scalar()
        if already:
            rows = db.session.execute(text(
                "SELECT value FROM score_metrics WHERE is_provable = 0")).scalars().all()
            print(f"  unprovable metrics already chosen: {', '.join(rows)}")
        else:
            db.session.execute(text(
                "UPDATE score_metrics SET is_provable = 0 WHERE value IN :v"
            ).bindparams(v=UNPROVABLE))
            db.session.commit()
            print(f"  unprovable metrics seeded: {', '.join(UNPROVABLE)}")

        for name, body in (('sp_score_awards_search', SEARCH),
                           ('sp_score_awards_check',  CHECK),
                           ('sp_score_bulk_adjust',   BULK),
                           ('sp_score_rule_impact',   IMPACT)):
            db.session.execute(text(f"DROP PROCEDURE IF EXISTS `{name}`"))
            db.session.execute(text(body.strip()))
            print(f"  created {name}")
        db.session.commit()

        needs = db.session.execute(text(
            "SELECT COUNT(*) FROM score_events e "
            "LEFT JOIN score_event_rules r ON r.event_type = e.event_type "
            "LEFT JOIN score_metrics m ON m.value = r.metric_key "
            "WHERE IFNULL(m.is_provable, 1) = 0 AND e.checked_at IS NULL")).scalar()
        print(f"  awards currently worth a look: {needs}")
        print("Done.")


if __name__ == '__main__':
    main()
