"""Wallet dropdowns move into masters (Admin > Masters).

WHAT CHANGES
    master_wallet_reverse_mode   points taken back on a refund: full / proportional
    master_wallet_credit_kind    a manual wallet credit: bonus / refund
    master_refund_destination    where a refund goes: original / wallet

The values are what the wallet code acts on, so they stay fixed; labels can be
renamed and an option switched off in Masters.

Additive, idempotent; seeds only missing rows. From SKOVO_BACKEND:
    python database/migrations/migrate_v1_wallet_masters.py
"""
import uuid

from sqlalchemy import text

import _bootstrap  # noqa: F401
from portal import InitApp
from portal.models import db

app = InitApp().app()

MASTERS = [
    ('master_wallet_reverse_mode', 'wallet_reverse_mode', 'Wallet — Points Taken Back on Refund',
     [('full', "All of the purchase's points"), ('proportional', 'By refunded share')]),
    ('master_wallet_credit_kind', 'wallet_credit_kind', 'Wallet — Credit Type',
     [('bonus', 'Bonus credit (expires)'), ('refund', 'Refund money')]),
    ('master_refund_destination', 'refund_destination', 'Refund Destination',
     [('original', 'Original payment method'), ('wallet', 'SKOVO Wallet')]),
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
