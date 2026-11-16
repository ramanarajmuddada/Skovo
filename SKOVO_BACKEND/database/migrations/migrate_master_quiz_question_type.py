"""Question builder dropdown moves into masters; the coins-shop master goes.

WHAT CHANGES
    master_quiz_question_type   question builder "Type": mcq / true_false /
                                numeric / fill_blank (values are what the
                                grader acts on; labels are editable)
    master_registry             shop_item_kind unregistered — Skovo v1 has no
                                coins or shop (17 Oct 2026). Its table stays.

Additive, idempotent; seeds only missing rows. From SKOVO_BACKEND:
    python database/migrations/migrate_master_quiz_question_type.py
"""
import uuid

from sqlalchemy import text

import _bootstrap  # noqa: F401
from portal import InitApp
from portal.models import db
app = InitApp().app()


def master_table(name):
    return f"""CREATE TABLE IF NOT EXISTS `{name}` (
  `id` CHAR(36) NOT NULL,
  `value` VARCHAR(100) NOT NULL,
  `label` VARCHAR(150) NOT NULL,
  `sort_order` INT DEFAULT 0,
  `is_active` TINYINT(1) DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `created_by` CHAR(36) DEFAULT NULL,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `updated_by` CHAR(36) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_{name}_value` (`value`),
  KEY `ix_{name}_active` (`is_active`, `sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"""

TABLE, TYPE, LABEL = 'master_quiz_question_type', 'quiz_question_type', 'Quiz — Question Type'
ROWS = [('mcq', 'Multiple choice'), ('true_false', 'True / False'),
        ('numeric', 'Number answer'), ('fill_blank', 'Fill in the blank')]


def main():
    with app.app_context():
        db.session.execute(text(master_table(TABLE)))
        db.session.execute(text("""
            INSERT INTO master_registry (id, type, table_name, label, is_active)
            VALUES (:id, :t, :tbl, :lbl, 1)
            ON DUPLICATE KEY UPDATE table_name = VALUES(table_name), label = VALUES(label), is_active = 1
        """), {'id': str(uuid.uuid4()), 't': TYPE, 'tbl': TABLE, 'lbl': LABEL})
        added = 0
        for order, (value, lbl) in enumerate(ROWS, start=1):
            added += db.session.execute(text(
                f"INSERT IGNORE INTO `{TABLE}` (id, value, label, sort_order, is_active) "
                "VALUES (:i, :v, :l, :o, 1)"),
                {'i': str(uuid.uuid4()), 'v': value, 'l': lbl, 'o': order * 10}).rowcount
        gone = db.session.execute(text("DELETE FROM master_registry WHERE type = 'shop_item_kind'")).rowcount
        db.session.commit()
        print(f"  [ok] {TABLE}: {added} new of {len(ROWS)}; shop_item_kind unregistered: {gone}")


if __name__ == '__main__':
    main()
