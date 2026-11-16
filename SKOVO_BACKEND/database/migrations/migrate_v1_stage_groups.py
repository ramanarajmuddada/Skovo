"""Stage groups move from code into a master table (feature-updates.md §2).

WHAT CHANGES
    master_stage_group   value, label, sort_order, is_active + auto_promote
    master_registry      + stage_group -> master_stage_group, so it shows in
                         Admin > Masters and the generic sp_master_* procedures
                         read it like every other master
    sp_stage_auto_promote_candidates
                         reads auto_promote from the table instead of its own
                         IN ('class_10', ...) list

Labels and which stages promote each year now live in one place. The mapping
from a student's education category to a stage (school_11th -> intermediate)
stays in portal/helpers/stages.py: it is promotion logic, not dropdown data,
and a new stage still needs code saying where its students move next.

Additive, idempotent. Seeds only missing rows, so a renamed label or a
retired stage survives a re-run. From SKOVO_BACKEND:
    python database/migrations/migrate_v1_stage_groups.py
"""
import uuid

from sqlalchemy import text

import _bootstrap  # noqa: F401
from portal import InitApp
from portal.models import db

app = InitApp().app()

MASTER_TYPE = 'stage_group'
MASTER_TABLE = 'master_stage_group'
MASTER_LABEL = 'Stage Group'

# value, label, auto_promote (1 = moved up by the yearly job)
SEED = [
    ('class_10', 'Class 10', 1),
    ('intermediate', 'Intermediate', 1),
    ('polytechnic', 'Polytechnic', 1),
    ('iti', 'ITI', 1),
    ('ug', 'UG course', 1),
    ('pg', 'PG', 1),
    ('other', 'Other', 0),
]

TABLE = f"""CREATE TABLE IF NOT EXISTS `{MASTER_TABLE}` (
  `id` CHAR(36) NOT NULL,
  `value` VARCHAR(100) NOT NULL,
  `label` VARCHAR(150) NOT NULL,
  `sort_order` INT DEFAULT 0,
  `is_active` TINYINT(1) DEFAULT 1,
  `auto_promote` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `created_by` CHAR(36) DEFAULT NULL,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `updated_by` CHAR(36) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_{MASTER_TABLE}_value` (`value`),
  KEY `ix_{MASTER_TABLE}_active` (`is_active`, `sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"""

AUTO_PROMOTE_SP = f"""
CREATE PROCEDURE `sp_stage_auto_promote_candidates`(IN p_limit INT)
BEGIN
  -- Students whose active stage started before this academic year began.
  -- The Python job decides what each moves to; this only finds them.
  -- Which stages take part is {MASTER_TABLE}.auto_promote.
  SELECT st.user_id, st.stage_group, st.sub_year, st.education_category, st.started_at
    FROM student_stages st
    JOIN `{MASTER_TABLE}` g ON g.value = st.stage_group AND g.auto_promote = 1 AND g.is_active = 1
   WHERE st.status = 'active'
   ORDER BY st.started_at ASC
   LIMIT p_limit;
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
        for order, (value, label, auto) in enumerate(SEED, start=1):
            res = db.session.execute(text(f"""
                INSERT IGNORE INTO `{MASTER_TABLE}` (id, value, label, sort_order, is_active, auto_promote)
                VALUES (:i, :v, :l, :o, 1, :a)
            """), {'i': str(uuid.uuid4()), 'v': value, 'l': label, 'o': order, 'a': auto})
            added += res.rowcount
        print(f"  [ok] seeded {added} new stage group(s), {len(SEED)} total")

        db.session.execute(text("DROP PROCEDURE IF EXISTS `sp_stage_auto_promote_candidates`"))
        db.session.execute(text(AUTO_PROMOTE_SP))
        print("  [ok] sp_stage_auto_promote_candidates reads auto_promote")

        db.session.commit()
        print("Done.")


if __name__ == '__main__':
    main()
