"""
Money-path floor: refund_rules, refunds, invoice counters, GST/payout knobs,
slot UTC instants, refund snapshots, cancelled_at.

Idempotent. From SKOVO_BACKEND:
    python database/migrations/migrate_achiever_money_floor.py
"""
from sqlalchemy import text

import _bootstrap  # noqa: F401

from portal import InitApp
from portal.models import db
from portal.helpers.sql_file import apply_sql_file, add_column

app = InitApp().app()

SQL_FILES = [
    'database/stored_procedures/business/money_floor.sql',
    'database/stored_procedures/business/payments.sql',
    'database/stored_procedures/business/payments_cohort.sql',
    'database/stored_procedures/business/student.sql',
    'database/stored_procedures/business/achiever.sql',
    'database/stored_procedures/achiever_slots.sql',
    'database/stored_procedures/business/admin.sql',
    'database/stored_procedures/business/scheduler.sql',
]


def _table(ddl):
    db.session.execute(text(ddl))
    db.session.commit()


def _seed_setting(key, value, vtype, label, note):
    present = db.session.execute(text(
        "SELECT COUNT(*) FROM `payment_settings` WHERE setting_key = :k"
    ), {'k': key}).scalar()
    if present:
        return
    db.session.execute(text(
        "INSERT INTO `payment_settings` "
        "(setting_key, setting_value, value_type, label, note) "
        "VALUES (:k, :v, :t, :l, :n)"
    ), {'k': key, 'v': value, 't': vtype, 'l': label, 'n': note})
    db.session.commit()
    print(f"  payment_settings: seeded {key} = {value}")


def run():
    with app.app_context():
        _table("""
            CREATE TABLE IF NOT EXISTS `refund_rules` (
              `id` CHAR(36) NOT NULL,
              `rule_set` VARCHAR(40) NOT NULL,
              `version` INT NOT NULL,
              `actor` VARCHAR(20) NOT NULL,
              `min_hours` DECIMAL(10,2) NOT NULL,
              `refund_pct` DECIMAL(5,2) NOT NULL,
              `is_active` TINYINT(1) NOT NULL DEFAULT 1,
              `closed_at` DATETIME NULL,
              `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
              PRIMARY KEY (`id`),
              KEY `ix_refund_rules_active` (`is_active`, `rule_set`, `actor`, `min_hours`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        """)
        print("  [ok] refund_rules")

        _table("""
            CREATE TABLE IF NOT EXISTS `refunds` (
              `id` CHAR(36) NOT NULL,
              `refund_key` VARCHAR(80) NOT NULL,
              `order_id` CHAR(36) NOT NULL,
              `order_no` VARCHAR(40) NOT NULL,
              `amount` DECIMAL(10,2) NOT NULL,
              `status` VARCHAR(20) NOT NULL DEFAULT 'pending',
              `gateway_refund_id` VARCHAR(80) NULL,
              `reason` TEXT NULL,
              `actor_id` CHAR(36) NULL,
              `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
              `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                           ON UPDATE CURRENT_TIMESTAMP,
              PRIMARY KEY (`id`),
              UNIQUE KEY `uq_refunds_refund_key` (`refund_key`),
              KEY `ix_refunds_order` (`order_id`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        """)
        print("  [ok] refunds")

        _table("""
            CREATE TABLE IF NOT EXISTS `invoice_counters` (
              `prefix` VARCHAR(16) NOT NULL,
              `next_number` INT NOT NULL,
              PRIMARY KEY (`prefix`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        """)
        n = db.session.execute(text(
            "SELECT COUNT(*) FROM `invoice_counters` WHERE prefix = 'INV'"
        )).scalar()
        if not n:
            db.session.execute(text(
                "INSERT INTO `invoice_counters` (prefix, next_number) VALUES ('INV', 1)"
            ))
            db.session.commit()
        print("  [ok] invoice_counters")

        for table, col, ddl in (
            ('achiever_slots', 'start_utc',
             'DATETIME NULL'),
            ('achiever_slots', 'end_utc',
             'DATETIME NULL'),
            ('achiever_slots', 'times_are_utc',
             'TINYINT(1) NOT NULL DEFAULT 0'),
            ('achievers', 'refund_template',
             "VARCHAR(20) NOT NULL DEFAULT 'standard'"),
            ('cohorts', 'refund_template',
             "VARCHAR(20) NOT NULL DEFAULT 'standard'"),
            ('cohort_enrollments', 'refund_snapshot',
             'JSON NULL'),
            ('cohort_enrollments', 'cancelled_at',
             'DATETIME NULL'),
            ('achiever_sessions', 'refund_snapshot',
             'JSON NULL'),
            ('achiever_sessions', 'cancelled_at',
             'DATETIME NULL'),
            ('achiever_sessions', 'proposed_slot_id',
             'CHAR(36) NULL'),
            ('payment_orders', 'refunded_amount',
             'DECIMAL(10,2) NOT NULL DEFAULT 0'),
        ):
            if add_column(table, col, ddl):
                print(f"  [ok] added {table}.{col}")
            else:
                print(f"  [ok] {table}.{col} already present")

        # Existing IST wall-clock rows → UTC instants so refund hours are honest.
        db.session.execute(text("""
            UPDATE `achiever_slots`
               SET start_utc = DATE_SUB(TIMESTAMP(slot_date, start_time), INTERVAL 330 MINUTE),
                   end_utc   = DATE_SUB(TIMESTAMP(slot_date, end_time),   INTERVAL 330 MINUTE),
                   times_are_utc = 1
             WHERE start_utc IS NULL
               AND slot_date IS NOT NULL
               AND start_time IS NOT NULL
        """))
        db.session.commit()

        existing = db.session.execute(text(
            "SELECT COUNT(*) FROM `refund_rules` WHERE is_active = 1"
        )).scalar()
        if not existing:
            rows = [
                ('student', 24, 100),
                ('student', 2, 50),
                ('student', 0, 0),
                ('achiever', 0, 100),
                ('admin', 0, 100),
            ]
            for actor, hours, pct in rows:
                db.session.execute(text("""
                    INSERT INTO `refund_rules`
                        (id, rule_set, version, actor, min_hours, refund_pct, is_active)
                    VALUES (UUID(), 'floor', 1, :a, :h, :p, 1)
                """), {'a': actor, 'h': hours, 'p': pct})
            db.session.commit()
            print("  [ok] seeded refund_rules floor v1")
        else:
            print("  [ok] refund_rules already seeded")

        _seed_setting('gst_rate', '18', 'decimal', 'GST rate (%)',
                      'Inclusive GST percent used on invoices. Close and insert to change.')
        _seed_setting('gst_inclusive', '1', 'bool', 'GST inclusive',
                      '1 = listed price already includes GST.')
        _seed_setting('payout_min', '500', 'decimal', 'Minimum payout (₹)',
                      'Achiever cannot request less than this.')
        _seed_setting('invoice_prefix', 'INV', 'string', 'Invoice prefix',
                      'Prefix for invoice_counters.')
        _seed_setting('escrow_backstop_hours', '168', 'int', 'Never-End escrow backstop (hours)',
                      'Hours after session_date+duration before unpaid-End cohort earnings release.')

        db.session.execute(text("""
            UPDATE `master_coupon_applies_to`
               SET is_active = 0
             WHERE `value` IN ('all', 'course')
        """))
        db.session.commit()

        for path in SQL_FILES:
            n = apply_sql_file(path)
            print(f"  [ok] loaded {n} statement(s) from {path}")

        print("Achiever money-floor migration complete.")


if __name__ == '__main__':
    run()
