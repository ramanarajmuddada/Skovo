"""Last admin dropdowns move into masters (Admin > Masters).

WHAT CHANGES
    master_task_late_policy     Platform v1: how a late task submission pays
    master_tournament_status    Leaderboard: Diamond tournament open / closed
(Referrals reuses master_coupon_discount_type: percent / flat.)

Additive, idempotent; seeds only missing rows. From SKOVO_BACKEND:
    python database/migrations/migrate_v1_admin_masters.py
"""
import uuid

from sqlalchemy import text

import _bootstrap  # noqa: F401
from portal import InitApp
from portal.models import db

app = InitApp().app()

MASTERS = [
    ('master_task_late_policy', 'task_late_policy', 'Task — Late Submissions',
     [('full', 'Pay like on time'), ('none', 'Pay nothing')]),
    ('master_tournament_status', 'tournament_status', 'Tournament Status',
     [('open', 'Open'), ('closed', 'Closed')]),
]


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


def main():
    with app.app_context():
        for table, mtype, label, rows in MASTERS:
            db.session.execute(text(master_table(table)))
            db.session.execute(text("""
                INSERT INTO master_registry (id, type, table_name, label, is_active)
                VALUES (:id, :t, :tbl, :lbl, 1)
                ON DUPLICATE KEY UPDATE table_name = VALUES(table_name), label = VALUES(label), is_active = 1
            """), {'id': str(uuid.uuid4()), 't': mtype, 'tbl': table, 'lbl': label})
            added = 0
            for order, (value, lbl) in enumerate(rows, start=1):
                added += db.session.execute(text(
                    f"INSERT IGNORE INTO `{table}` (id, value, label, sort_order, is_active) "
                    "VALUES (:i, :v, :l, :o, 1)"),
                    {'i': str(uuid.uuid4()), 'v': value, 'l': lbl, 'o': order * 10}).rowcount
            print(f"  [ok] {table}: {added} new of {len(rows)}")
        db.session.commit()
        print("Done.")


if __name__ == '__main__':
    main()
