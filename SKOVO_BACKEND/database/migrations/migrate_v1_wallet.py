"""SKOVO Wallet, refund choice, advanced refund process (feature-updates.md §15).

Design: SKOVO-refunds-wallet-v1.xlsx. Everything OFF until admin enables it;
every bonus % is 0 until admin sets it.

WHAT CHANGES
    wallet_settings      singleton (enabled 0, bonus %s 0, expiry, cap, windows,
                         Pro self-refund days 0, abuse threshold, retry / SLA, credit-note prefix)
    wallets              one row per student (lock row; balances are derived)
    wallet_ledger        append-only: refund_credit / bonus_credit / spend / restore /
                         expire / bank_payout / goodwill
    wallet_bonus_lots    bonus credit with remaining amount + expiry (spent earliest-expiry first)
    wallet_payout_requests  "send refund money back to bank"
    credit_notes         GST credit note per refund
    chargebacks          bank disputes
    admin_alerts         abuse, failed refunds, refund SLA
    payment_orders     + wallet_amount, wallet_bonus_used, wallet_refund_used, gateway_amount, wallet_restored
    refunds            + destination, bonus_amount, case_key, reason_code, reason_text, arn,
                         retries, next_retry_at, credit_note_no, wallet_part
    cohorts            + prorata_refund
    score_event_rules  -- refund reversals are a direct credit ('refund_reversal'),
                         added to the stage-filtered totals in migrate_v1_stages

Additive, idempotent. From SKOVO_BACKEND:
    python database/migrations/migrate_v1_wallet.py
"""
from sqlalchemy import text

import _bootstrap  # noqa: F401
from portal import InitApp
from portal.models import db

app = InitApp().app()
UTF = "ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"

TABLES = [
f"""CREATE TABLE IF NOT EXISTS `wallet_settings` (
  `id` TINYINT NOT NULL DEFAULT 1,
  `enabled` TINYINT(1) NOT NULL DEFAULT 0,
  `bonus_student_cancel_pct` DECIMAL(5,2) NOT NULL DEFAULT 0,
  `bonus_staff_cancel_pct` DECIMAL(5,2) NOT NULL DEFAULT 0,
  `bonus_expiry_months` INT NOT NULL DEFAULT 6,
  `bonus_cap_pct` INT NOT NULL DEFAULT 50,
  `usable_on` VARCHAR(100) NOT NULL DEFAULT 'cohort,session,subscription',
  `send_to_bank_days` INT NOT NULL DEFAULT 90,
  `reverse_mode` VARCHAR(12) NOT NULL DEFAULT 'full',
  `pro_refund_days` INT NOT NULL DEFAULT 0,
  `abuse_refunds` INT NOT NULL DEFAULT 3,
  `abuse_days` INT NOT NULL DEFAULT 30,
  `refund_retry_max` INT NOT NULL DEFAULT 3,
  `refund_sla_days` INT NOT NULL DEFAULT 7,
  `credit_note_prefix` VARCHAR(12) NOT NULL DEFAULT 'SKV-CN',
  `prorata_min_keep_pct` INT NOT NULL DEFAULT 0,
  `updated_at` DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  `updated_by` CHAR(36) NULL,
  PRIMARY KEY (`id`)
) {UTF}""",

f"""CREATE TABLE IF NOT EXISTS `wallets` (
  `user_id` CHAR(36) NOT NULL, `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`)
) {UTF}""",

f"""CREATE TABLE IF NOT EXISTS `wallet_ledger` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `user_id` CHAR(36) NOT NULL,
  `kind` VARCHAR(8) NOT NULL,
  `type` VARCHAR(16) NOT NULL,
  `amount` DECIMAL(10,2) NOT NULL,
  `order_id` CHAR(36) NULL, `refund_id` CHAR(36) NULL,
  `expires_at` DATETIME NULL,
  `reason` VARCHAR(255) NULL, `actor_id` CHAR(36) NULL,
  `ref` VARCHAR(100) NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_wl_ref` (`user_id`, `type`, `kind`, `ref`),
  KEY `ix_wl_user` (`user_id`, `created_at`)
) {UTF}""",

f"""CREATE TABLE IF NOT EXISTS `wallet_bonus_lots` (
  `id` CHAR(36) NOT NULL, `user_id` CHAR(36) NOT NULL,
  `amount` DECIMAL(10,2) NOT NULL, `remaining` DECIMAL(10,2) NOT NULL,
  `expires_at` DATETIME NOT NULL, `source_ref` VARCHAR(100) NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`), KEY `ix_lot_user` (`user_id`, `expires_at`)
) {UTF}""",

f"""CREATE TABLE IF NOT EXISTS `wallet_payout_requests` (
  `id` CHAR(36) NOT NULL, `user_id` CHAR(36) NOT NULL, `amount` DECIMAL(10,2) NOT NULL,
  `source_order_id` CHAR(36) NOT NULL, `status` VARCHAR(12) NOT NULL DEFAULT 'pending',
  `decided_by` CHAR(36) NULL, `decided_at` DATETIME NULL, `note` VARCHAR(255) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`), KEY `ix_wpr_status` (`status`, `created_at`)
) {UTF}""",

f"""CREATE TABLE IF NOT EXISTS `credit_notes` (
  `id` CHAR(36) NOT NULL, `number` VARCHAR(40) NOT NULL, `refund_id` CHAR(36) NOT NULL,
  `order_id` CHAR(36) NOT NULL, `user_id` CHAR(36) NULL, `amount` DECIMAL(10,2) NOT NULL,
  `destination` VARCHAR(10) NOT NULL, `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`), UNIQUE KEY `uq_cn_number` (`number`), UNIQUE KEY `uq_cn_refund` (`refund_id`)
) {UTF}""",

f"""CREATE TABLE IF NOT EXISTS `chargebacks` (
  `id` CHAR(36) NOT NULL, `order_id` CHAR(36) NOT NULL, `user_id` CHAR(36) NULL,
  `dispute_id` VARCHAR(80) NULL, `status` VARCHAR(10) NOT NULL DEFAULT 'open',
  `amount` DECIMAL(10,2) NULL, `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `closed_at` DATETIME NULL,
  PRIMARY KEY (`id`), UNIQUE KEY `uq_cb_dispute` (`dispute_id`), KEY `ix_cb_order` (`order_id`)
) {UTF}""",

f"""CREATE TABLE IF NOT EXISTS `admin_alerts` (
  `id` CHAR(36) NOT NULL, `kind` VARCHAR(30) NOT NULL, `ref` VARCHAR(100) NOT NULL,
  `message` VARCHAR(500) NOT NULL, `status` VARCHAR(10) NOT NULL DEFAULT 'open',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, `closed_by` CHAR(36) NULL, `closed_at` DATETIME NULL,
  PRIMARY KEY (`id`), UNIQUE KEY `uq_alert_ref` (`kind`, `ref`), KEY `ix_alert_status` (`status`, `created_at`)
) {UTF}""",
]

COLUMNS = [
    ('payment_orders', 'wallet_amount', "DECIMAL(10,2) NOT NULL DEFAULT 0"),
    ('payment_orders', 'wallet_bonus_used', "DECIMAL(10,2) NOT NULL DEFAULT 0"),
    ('payment_orders', 'wallet_refund_used', "DECIMAL(10,2) NOT NULL DEFAULT 0"),
    ('payment_orders', 'gateway_amount', "DECIMAL(10,2) NULL"),
    ('payment_orders', 'wallet_restored', "TINYINT(1) NOT NULL DEFAULT 0"),
    ('refunds', 'destination', "VARCHAR(10) NOT NULL DEFAULT 'original'"),
    ('refunds', 'bonus_amount', "DECIMAL(10,2) NOT NULL DEFAULT 0"),
    ('refunds', 'case_key', "VARCHAR(30) NULL"),
    ('refunds', 'reason_code', "VARCHAR(30) NULL"),
    ('refunds', 'reason_text', "VARCHAR(500) NULL"),
    ('refunds', 'arn', "VARCHAR(80) NULL"),
    ('refunds', 'retries', "INT NOT NULL DEFAULT 0"),
    ('refunds', 'next_retry_at', "DATETIME NULL"),
    ('refunds', 'credit_note_no', "VARCHAR(40) NULL"),
    ('refunds', 'wallet_part', "DECIMAL(10,2) NOT NULL DEFAULT 0"),
    ('cohorts', 'prorata_refund', "TINYINT(1) NOT NULL DEFAULT 0"),
]


def has_column(table, col):
    return db.session.execute(text(
        "SELECT COUNT(*) FROM information_schema.COLUMNS "
        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND COLUMN_NAME = :c"
    ), {'t': table, 'c': col}).scalar() > 0


def main():
    with app.app_context():
        for ddl in TABLES:
            db.session.execute(text(ddl))
        for table, col, ddl in COLUMNS:
            if not has_column(table, col):
                db.session.execute(text(f"ALTER TABLE `{table}` ADD COLUMN `{col}` {ddl}"))
                print(f"  {table}.{col} added")
        db.session.execute(text("INSERT IGNORE INTO wallet_settings (id) VALUES (1)"))
        db.session.commit()
        print("  wallet tables ready (wallet OFF, bonuses 0%)")
        print("Done.")


if __name__ == '__main__':
    main()
