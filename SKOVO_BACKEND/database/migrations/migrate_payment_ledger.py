"""
Migration: payment orders, webhook events, an append-only ledger, and
configurable commission.

Four tables and one column, all additive — nothing existing is dropped or
rewritten, so this is safe to run against a live database while the old
gateway flow keeps working.

  payment_orders    one row per checkout attempt, created before the gateway is
                    called, carrying a snapshot of the commission rate
  payment_events    every webhook received, unique on the gateway's event id so
                    a retry cannot book twice
  ledger_entries    append-only money record; a refund is a new reversing row,
                    never an edit
  commission_rules  replaces PLATFORM_FEE_RATIO = 0.30 in helpers/helpers.py

  achiever_slots.blocked_until   when a hold lapses and the slot frees itself

The global commission rule is seeded at 0.30 so behaviour is identical to the
hardcoded constant until someone deliberately changes it.

Idempotent — safe to re-run. Run from SKOVO_BACKEND:
    python database/migrations/migrate_payment_ledger.py
"""
from sqlalchemy import text

import _bootstrap  # noqa: F401 — puts SKOVO_BACKEND on sys.path and cwd

from portal import InitApp
from portal.models import db
from portal.helpers.sql_file import apply_sql_file

app = InitApp().app()

SP_FILE = 'database/stored_procedures/business/payments.sql'

DDL = [
    ("payment_orders", """
        CREATE TABLE IF NOT EXISTS `payment_orders` (
          `id` CHAR(36) NOT NULL,
          `order_no` VARCHAR(40) NOT NULL,
          `kind` VARCHAR(20) NOT NULL,
          `student_id` CHAR(36) NOT NULL,
          `achiever_id` CHAR(36) NULL,
          `slot_id` CHAR(36) NULL,
          `ref_id` CHAR(36) NULL,
          `currency` VARCHAR(3) NOT NULL DEFAULT 'INR',
          `gross` DECIMAL(10,2) NOT NULL,
          `discount` DECIMAL(10,2) NOT NULL DEFAULT 0,
          `coupon_code` VARCHAR(40) NULL,
          `commission_rate` DECIMAL(5,4) NOT NULL,
          `platform_fee` DECIMAL(10,2) NOT NULL DEFAULT 0,
          `achiever_earning` DECIMAL(10,2) NOT NULL DEFAULT 0,
          `status` VARCHAR(20) NOT NULL DEFAULT 'created',
          `provider` VARCHAR(20) NULL,
          `provider_order_id` VARCHAR(80) NULL,
          `provider_payment_id` VARCHAR(80) NULL,
          `failure_reason` TEXT NULL,
          `expires_at` DATETIME NULL,
          `paid_at` DATETIME NULL,
          `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                       ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (`id`),
          UNIQUE KEY `uq_payment_orders_order_no` (`order_no`),
          KEY `ix_payment_orders_student` (`student_id`),
          KEY `ix_payment_orders_achiever` (`achiever_id`),
          KEY `ix_payment_orders_slot` (`slot_id`),
          KEY `ix_payment_orders_status` (`status`),
          KEY `ix_payment_orders_expires` (`expires_at`),
          KEY `ix_payment_orders_provider_order` (`provider_order_id`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """),

    ("payment_events", """
        CREATE TABLE IF NOT EXISTS `payment_events` (
          `id` CHAR(36) NOT NULL,
          `provider` VARCHAR(20) NOT NULL,
          `provider_event_id` VARCHAR(120) NOT NULL,
          `event_type` VARCHAR(60) NULL,
          `order_id` CHAR(36) NULL,
          `provider_order_id` VARCHAR(80) NULL,
          `raw_payload` BLOB NULL,
          `signature_ok` TINYINT(1) NOT NULL DEFAULT 0,
          `processed` TINYINT(1) NOT NULL DEFAULT 0,
          `process_error` TEXT NULL,
          `received_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          `processed_at` DATETIME NULL,
          PRIMARY KEY (`id`),
          UNIQUE KEY `uq_payment_events_provider_event` (`provider_event_id`),
          KEY `ix_payment_events_order` (`order_id`),
          KEY `ix_payment_events_processed` (`processed`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """),

    ("ledger_entries", """
        CREATE TABLE IF NOT EXISTS `ledger_entries` (
          `id` CHAR(36) NOT NULL,
          `account_type` VARCHAR(20) NOT NULL,
          `account_id` CHAR(36) NULL,
          `entry_type` VARCHAR(30) NOT NULL,
          `amount` DECIMAL(12,2) NOT NULL,
          `currency` VARCHAR(3) NOT NULL DEFAULT 'INR',
          `order_id` CHAR(36) NULL,
          `session_id` CHAR(36) NULL,
          `payout_id` CHAR(36) NULL,
          `reverses_id` CHAR(36) NULL,
          `note` TEXT NULL,
          `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          `created_by` CHAR(36) NULL,
          PRIMARY KEY (`id`),
          KEY `ix_ledger_account` (`account_type`, `account_id`),
          KEY `ix_ledger_entry_type` (`entry_type`),
          KEY `ix_ledger_order` (`order_id`),
          KEY `ix_ledger_session` (`session_id`),
          KEY `ix_ledger_created` (`created_at`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """),

    ("payment_settings", """
        CREATE TABLE IF NOT EXISTS `payment_settings` (
          `setting_key` VARCHAR(60) NOT NULL,
          `setting_value` VARCHAR(255) NOT NULL,
          `value_type` VARCHAR(20) NOT NULL DEFAULT 'string',
          `label` VARCHAR(120) NULL,
          `note` TEXT NULL,
          `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                       ON UPDATE CURRENT_TIMESTAMP,
          `updated_by` CHAR(36) NULL,
          PRIMARY KEY (`setting_key`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """),

    ("commission_rules", """
        CREATE TABLE IF NOT EXISTS `commission_rules` (
          `id` CHAR(36) NOT NULL,
          `scope` VARCHAR(20) NOT NULL DEFAULT 'global',
          `scope_id` VARCHAR(36) NULL,
          `kind` VARCHAR(20) NULL,
          `rate` DECIMAL(5,4) NOT NULL,
          `effective_from` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          `effective_to` DATETIME NULL,
          `is_active` TINYINT(1) NOT NULL DEFAULT 1,
          `note` TEXT NULL,
          `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          `created_by` CHAR(36) NULL,
          PRIMARY KEY (`id`),
          KEY `ix_commission_scope` (`scope`, `scope_id`),
          KEY `ix_commission_kind` (`kind`),
          KEY `ix_commission_active` (`is_active`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """),
]


def _column_exists(conn, table, column):
    return conn.execute(text(
        "SELECT COUNT(*) FROM information_schema.COLUMNS "
        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND COLUMN_NAME = :c"
    ), {'t': table, 'c': column}).scalar() > 0


def main():
    with app.app_context():
        conn = db.session

        for name, ddl in DDL:
            conn.execute(text(ddl))
            print(f"  table ready: {name}")

        # The hold deadline. payment_orders.expires_at is authoritative, but
        # carrying it on the slot too lets the availability query filter stale
        # holds without joining orders on every read.
        if not _column_exists(conn, 'achiever_slots', 'blocked_until'):
            conn.execute(text(
                "ALTER TABLE `achiever_slots` "
                "ADD COLUMN `blocked_until` DATETIME NULL AFTER `status`"
            ))
            print("  achiever_slots.blocked_until: added")
        else:
            print("  achiever_slots.blocked_until: already present")

        # Operational knobs. sp_payment_order_open raises PAYMENT_SETTINGS_MISSING
        # rather than assuming any of these, so the rows are load-bearing.
        SETTINGS = [
            ('hold_minutes', '10', 'int',
             'Slot hold (minutes)',
             'How long a slot stays blocked while the student pays. Too short and '
             'slow UPI payers lose the slot; too long and one abandoned checkout '
             'blocks everyone else.'),
            ('currency', 'INR', 'string',
             'Currency',
             'ISO code stamped onto new orders. Existing orders keep the code they '
             'were created with.'),
            ('payment_provider', 'cashfree', 'string',
             'Active gateway',
             'The gateway in use. Switching is a data change, not a deploy.'),
            ('order_no_prefix', 'SKV', 'string',
             'Order number prefix',
             'Human-readable prefix on order numbers, for support and reconciliation.'),
        ]

        for key, value, vtype, label, note in SETTINGS:
            present = conn.execute(text(
                "SELECT COUNT(*) FROM `payment_settings` WHERE setting_key = :k"
            ), {'k': key}).scalar()
            if present == 0:
                conn.execute(text(
                    "INSERT INTO `payment_settings` "
                    "(setting_key, setting_value, value_type, label, note) "
                    "VALUES (:k, :v, :t, :l, :n)"
                ), {'k': key, 'v': value, 't': vtype, 'l': label, 'n': note})
                print(f"  payment_settings: seeded {key} = {value}")
            else:
                print(f"  payment_settings: {key} already set")

        # Seed the mandatory global rule at the rate the constant used, so this
        # migration changes no prices. sp_payment_order_open refuses to price an
        # order when no rule resolves, which makes this row load-bearing.
        existing = conn.execute(text(
            "SELECT COUNT(*) FROM `commission_rules` "
            "WHERE scope = 'global' AND kind IS NULL AND is_active = 1"
        )).scalar()

        if existing == 0:
            conn.execute(text(
                "INSERT INTO `commission_rules` "
                "(id, scope, scope_id, kind, rate, effective_from, is_active, note) "
                "VALUES (UUID(), 'global', NULL, NULL, 0.3000, UTC_TIMESTAMP(), 1, "
                "'Seeded from PLATFORM_FEE_RATIO = 0.30')"
            ))
            print("  commission_rules: seeded global rule at 30%")
        else:
            print(f"  commission_rules: global rule already present ({existing})")

        conn.commit()

        # Procedures load after the tables they reference, and through
        # apply_sql_file so the DELIMITER blocks are split the same way every
        # other business SP file is.
        procs = apply_sql_file(SP_FILE)
        print(f"  procedures: loaded {procs} statement(s) from {SP_FILE}")

        print()
        print("verifying:")
        for name, _ in DDL:
            n = conn.execute(text(
                "SELECT COUNT(*) FROM information_schema.TABLES "
                "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t"
            ), {'t': name}).scalar()
            print(f"  {name:<20} {'OK' if n else 'MISSING'}")

        rate = conn.execute(text(
            "SELECT rate FROM `commission_rules` "
            "WHERE scope = 'global' AND kind IS NULL AND is_active = 1 LIMIT 1"
        )).scalar()
        print(f"  global rate          {rate}")

        for proc in ('sp_commission_rate_resolve', 'sp_payment_order_open',
                     'sp_payment_order_mark_paid', 'sp_payment_expire_holds',
                     'sp_payment_order_refund', 'sp_achiever_balance'):
            n = conn.execute(text(
                "SELECT COUNT(*) FROM information_schema.ROUTINES "
                "WHERE ROUTINE_SCHEMA = DATABASE() AND ROUTINE_NAME = :r"
            ), {'r': proc}).scalar()
            print(f"  {proc:<28} {'OK' if n else 'MISSING'}")

        print()
        print("done")


if __name__ == '__main__':
    main()
