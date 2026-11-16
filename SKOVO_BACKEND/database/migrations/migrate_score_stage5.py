"""Audit, deadlines, and fractional task points.

RULE CHANGES ARE AUDITED
    Adjustments have been audited from the start -- who, when, how much, why.
    Rule edits were not: score_event_rules carried an `updated_at` and nothing
    else, so "who changed this from 5 to 50?" had no answer.

    That is the more dangerous of the two. A single adjustment moves one
    student; changing a rule's points moves every student who ever triggered it,
    silently, on the next recalculation.

    score_rule_audit records the before and the after of every field, per
    change, with the admin who made it. Written by sp_score_rule_audit_log,
    which the API calls around an edit -- not a trigger, because a trigger
    cannot see which admin is logged in.

TASKS EXPIRE
    score_tasks had no deadline, so "Upload your marksheet before Friday" stayed
    claimable forever. expires_at closes it, and the same `expired` answer
    sp_score_task_complete already gives for an inactive task covers it -- no
    new state for the front end to learn.

TASK POINTS CARRY TWO DECIMALS
    score_tasks.points was INT while rule points were DECIMAL(5,2). An admin
    could say 0.25 for a rule and not for a task, which is the kind of
    inconsistency that reads as a bug. Widening is lossless.

Idempotent. From SKOVO_BACKEND:
    python database/migrations/migrate_score_stage5.py
"""
from sqlalchemy import text

import _bootstrap  # noqa: F401
from portal import InitApp
from portal.models import db

app = InitApp().app()

AUDIT_DDL = """
CREATE TABLE IF NOT EXISTS `score_rule_audit` (
  `id`         CHAR(36)     NOT NULL,
  `rule_key`   VARCHAR(50)  NOT NULL,
  `admin_id`   CHAR(36)     NULL,
  `action`     VARCHAR(12)  NOT NULL,      -- created | updated | deleted
  `field`      VARCHAR(40)  NULL,
  `old_value`  VARCHAR(255) NULL,
  `new_value`  VARCHAR(255) NULL,
  `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_rule_audit_rule` (`rule_key`, `created_at`),
  KEY `idx_rule_audit_admin` (`admin_id`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
"""

# Fields worth recording a change to. Cosmetic ones are left out so the log
# stays readable -- an audit nobody reads is not an audit.
AUDITED = [
    'label', 'points', 'is_active', 'cap_type', 'cap_value', 'metric_key',
    'metric_filter', 'rule_test', 'threshold', 'since_at', 'until_at',
    'shape', 'require_count', 'tier_points', 'streak_days', 'expires_days',
    'segment_education', 'segment_degree', 'segment_state',
]

LOG = """
CREATE PROCEDURE `sp_score_rule_audit_log`(
    IN p_key    VARCHAR(50),
    IN p_admin  CHAR(36),
    IN p_action VARCHAR(12)
)
BEGIN
  -- Diffs the rule against the snapshot the caller took before editing, which
  -- it left in the temporary table tmp_score_rule_before. One row per field
  -- that actually moved; an edit that changed nothing records nothing.
  IF p_action = 'updated' THEN
      INSERT INTO `score_rule_audit`
             (`id`, `rule_key`, `admin_id`, `action`, `field`, `old_value`, `new_value`)
      SELECT UUID(), p_key, p_admin, 'updated', b.`field`, b.`value`, a.`value`
        FROM `tmp_score_rule_before` b
        JOIN `tmp_score_rule_after`  a ON a.`field` = b.`field`
       WHERE NOT (b.`value` <=> a.`value`);
  ELSE
      INSERT INTO `score_rule_audit`
             (`id`, `rule_key`, `admin_id`, `action`)
      VALUES (UUID(), p_key, p_admin, p_action);
  END IF;

  SET @score_rule_audit_rows = ROW_COUNT();
END
"""


def snapshot_proc(table_name):
    """sp_score_rule_snapshot_before / _after -- the rule flattened to field rows.

    Field-per-row rather than a copy of the table, so adding a rule column never
    needs this rewriting and the diff stays one join.
    """
    cols = "\n        UNION ALL ".join(
        f"SELECT '{c}' AS `field`, CAST(`{c}` AS CHAR) AS `value` "
        f"FROM `score_event_rules` WHERE `event_type` = p_key"
        for c in AUDITED)
    return f"""
CREATE PROCEDURE `sp_score_rule_snapshot_{table_name}`(IN p_key VARCHAR(50))
BEGIN
  DROP TEMPORARY TABLE IF EXISTS `tmp_score_rule_{table_name}`;
  CREATE TEMPORARY TABLE `tmp_score_rule_{table_name}` (
      `field` VARCHAR(40)  NOT NULL,
      `value` VARCHAR(255) NULL,
      PRIMARY KEY (`field`)
  ) ENGINE=MEMORY;

  INSERT INTO `tmp_score_rule_{table_name}` (`field`, `value`)
  {cols};
END
"""


AUDIT_LIST = """
CREATE PROCEDURE `sp_score_rule_audit_list`(
    IN p_key   VARCHAR(50),
    IN p_limit INT
)
BEGIN
  SELECT a.`id`, a.`rule_key`,
         IFNULL(r.`label`, a.`rule_key`) AS rule_label,
         a.`admin_id`, u.`full_name` AS admin_name,
         a.`action`, a.`field`, a.`old_value`, a.`new_value`, a.`created_at`
    FROM `score_rule_audit` a
    LEFT JOIN `score_event_rules` r ON r.`event_type` = a.`rule_key`
    -- The admin may have left since. The change still happened, so a missing
    -- row must not drop it from the log.
    LEFT JOIN `users` u ON u.`id` = a.`admin_id`
   WHERE (p_key IS NULL OR p_key = '' OR a.`rule_key` = p_key)
   ORDER BY a.`created_at` DESC
   LIMIT p_limit;
END
"""


def has_column(table, col):
    return db.session.execute(text(
        "SELECT COUNT(*) FROM information_schema.COLUMNS "
        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND COLUMN_NAME = :c"
    ), {'t': table, 'c': col}).scalar() > 0


def main():
    with app.app_context():
        db.session.execute(text(AUDIT_DDL))
        print("  score_rule_audit ready")

        if not has_column('score_tasks', 'expires_at'):
            db.session.execute(text(
                "ALTER TABLE `score_tasks` ADD COLUMN `expires_at` DATETIME NULL"))
            print("  score_tasks.expires_at added")
        else:
            print("  score_tasks.expires_at already there")

        col = db.session.execute(text(
            "SELECT COLUMN_TYPE FROM information_schema.COLUMNS "
            "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'score_tasks' "
            "AND COLUMN_NAME = 'points'")).scalar()
        if 'decimal' not in (col or '').lower():
            db.session.execute(text(
                "ALTER TABLE `score_tasks` MODIFY COLUMN `points` DECIMAL(5,2) "
                "NOT NULL DEFAULT 0.00"))
            print(f"  score_tasks.points: {col} -> decimal(5,2)")
        else:
            print(f"  score_tasks.points already {col}")
        db.session.commit()

        procs = [
            ('sp_score_rule_snapshot_before', snapshot_proc('before')),
            ('sp_score_rule_snapshot_after',  snapshot_proc('after')),
            ('sp_score_rule_audit_log',       LOG),
            ('sp_score_rule_audit_list',      AUDIT_LIST),
        ]
        for name, body in procs:
            db.session.execute(text(f"DROP PROCEDURE IF EXISTS `{name}`"))
            db.session.execute(text(body.strip()))
            print(f"  created {name}")
        db.session.commit()

        # Widening is lossless -- prove it rather than assume it.
        odd = db.session.execute(text(
            "SELECT COUNT(*) FROM score_tasks WHERE points <> ROUND(points, 0)")).scalar()
        print(f"  task rows whose points changed value: {odd}")
        print(f"  fields under audit: {len(AUDITED)}")
        print("Done.")


if __name__ == '__main__':
    main()
