"""Bookings dropdowns: 1-on-1 session status master, and "expired" for payments.

WHAT CHANGES
    master_session_status   1-on-1 session status filter: pending / confirmed /
                            completed / cancelled (values the session code uses)
    master_payment_status   + expired (a checkout that timed out; enrollments
                            carry it, so the Bookings filter needs it)

Additive, idempotent; seeds only missing rows. From SKOVO_BACKEND:
    python database/migrations/migrate_master_session_status.py
"""
import uuid

from sqlalchemy import text

import _bootstrap  # noqa: F401
from portal import InitApp
from portal.models import db

app = InitApp().app()

SESSION = ('master_session_status', 'session_status', '1-on-1 Session — Status',
           [('pending', 'Pending'), ('confirmed', 'Confirmed'), ('completed', 'Completed'), ('cancelled', 'Cancelled')])


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


def seed(table, rows, start_order=10):
    added = 0
    for order, (value, lbl) in enumerate(rows, start=1):
        added += db.session.execute(text(
            f"INSERT IGNORE INTO `{table}` (id, value, label, sort_order, is_active) VALUES (:i, :v, :l, :o, 1)"),
            {'i': str(uuid.uuid4()), 'v': value, 'l': lbl, 'o': start_order + order * 10}).rowcount
    return added


def main():
    with app.app_context():
        table, mtype, label, rows = SESSION
        db.session.execute(text(master_table(table)))
        db.session.execute(text("""
            INSERT INTO master_registry (id, type, table_name, label, is_active)
            VALUES (:id, :t, :tbl, :lbl, 1)
            ON DUPLICATE KEY UPDATE table_name = VALUES(table_name), label = VALUES(label), is_active = 1
        """), {'id': str(uuid.uuid4()), 't': mtype, 'tbl': table, 'lbl': label})
        a = seed(table, rows)
        b = seed('master_payment_status', [('expired', 'Expired')], start_order=90)
        db.session.commit()
        print(f"  [ok] {table}: {a} new; master_payment_status: {b} new")


if __name__ == '__main__':
    main()
