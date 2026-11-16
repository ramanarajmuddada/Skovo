"""Score rule "When it pays" options move from the frontend into a master.

WHAT CHANGES
    master_score_rule_test   value, label, sort_order, is_active + any_metric
    master_registry          + score_rule_test -> master_score_rule_test, so the
                             labels are edited in Admin > Masters
    sp_score_rule_tests_any  the tests every metric can take (any_metric = 1)

Before this the labels lived in MetricRuleForm.jsx (TEST_LABEL), the score list
repeated them in lower case (TEST_PHRASE), and the two tests any metric can
take were a third list (EXTRA_TESTS). Now one table holds all three.

The values themselves stay fixed: the score engine computes on them
(admin_score_rules.TESTS). Renaming or switching off a label is safe; a new
value needs scoring code too.

Additive, idempotent; seeds only missing rows. From SKOVO_BACKEND:
    python database/migrations/migrate_v1_score_rule_tests.py
"""
import uuid

from sqlalchemy import text

import _bootstrap  # noqa: F401
from portal import InitApp
from portal.models import db

app = InitApp().app()

MASTER_TYPE = 'score_rule_test'
MASTER_TABLE = 'master_score_rule_test'
MASTER_LABEL = 'Score Rule — When It Pays'

# value, label, any_metric (1 = offered for every metric, not only those that declare it)
SEED = [
    ('each', 'Each time', 0),
    ('reaches', 'When it reaches', 0),
    ('every', 'Every', 0),
    ('becomes_active', 'When it starts', 0),
    ('tiered', 'Worth less each time', 1),
    ('streak', 'Days in a row', 1),
]

TABLE = f"""CREATE TABLE IF NOT EXISTS `{MASTER_TABLE}` (
  `id` CHAR(36) NOT NULL,
  `value` VARCHAR(100) NOT NULL,
  `label` VARCHAR(150) NOT NULL,
  `sort_order` INT DEFAULT 0,
  `is_active` TINYINT(1) DEFAULT 1,
  `any_metric` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `created_by` CHAR(36) DEFAULT NULL,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `updated_by` CHAR(36) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_{MASTER_TABLE}_value` (`value`),
  KEY `ix_{MASTER_TABLE}_active` (`is_active`, `sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"""

ANY_SP = f"""
CREATE PROCEDURE `sp_score_rule_tests_any`()
BEGIN
  SELECT `value` FROM `{MASTER_TABLE}`
   WHERE `any_metric` = 1 AND `is_active` = 1
   ORDER BY `sort_order`, `label`;
END"""


def main():
    with app.app_context():
        db.session.execute(text(TABLE))
        db.session.execute(text("""
            INSERT INTO master_registry (id, type, table_name, label, is_active)
            VALUES (:id, :t, :tbl, :lbl, 1)
            ON DUPLICATE KEY UPDATE table_name = VALUES(table_name), label = VALUES(label), is_active = 1
        """), {'id': str(uuid.uuid4()), 't': MASTER_TYPE, 'tbl': MASTER_TABLE, 'lbl': MASTER_LABEL})
        print(f"  [ok] registered '{MASTER_TYPE}' -> {MASTER_TABLE}")

        added = 0
        for order, (value, label, any_metric) in enumerate(SEED, start=1):
            res = db.session.execute(text(f"""
                INSERT IGNORE INTO `{MASTER_TABLE}` (id, value, label, sort_order, is_active, any_metric)
                VALUES (:i, :v, :l, :o, 1, :a)
            """), {'i': str(uuid.uuid4()), 'v': value, 'l': label, 'o': order * 10, 'a': any_metric})
            added += res.rowcount
        print(f"  [ok] seeded {added} new option(s), {len(SEED)} total")

        db.session.execute(text("DROP PROCEDURE IF EXISTS `sp_score_rule_tests_any`"))
        db.session.execute(text(ANY_SP))
        print("  [ok] sp_score_rule_tests_any")

        db.session.commit()
        print("Done.")


if __name__ == '__main__':
    main()
