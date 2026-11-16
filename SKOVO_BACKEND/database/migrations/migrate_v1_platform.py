"""Platform pieces for Version 1 (feature-updates.md §16).

WHAT CHANGES
    master_support_category  + refund, wallet, points_dispute, streak_restore
    user_profiles            + lang VARCHAR(5) DEFAULT 'en' (Telugu / English messages)
    account_deletions        log of deletion requests (DPDP), what happened to the wallet
    institution_aliases      variant spelling -> canonical school / college name
    platform_settings        singleton: rank-data yearly review date (MM-DD) and last review

Additive, idempotent. From SKOVO_BACKEND:
    python database/migrations/migrate_v1_platform.py
"""
import uuid

from sqlalchemy import text

import _bootstrap  # noqa: F401
from portal import InitApp
from portal.models import db

app = InitApp().app()
UTF = "ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"

TABLES = [
f"""CREATE TABLE IF NOT EXISTS `account_deletions` (
  `id` CHAR(36) NOT NULL, `user_id` CHAR(36) NOT NULL, `requested_by` VARCHAR(10) NOT NULL DEFAULT 'student',
  `wallet_refund_money` DECIMAL(10,2) NOT NULL DEFAULT 0, `wallet_bonus` DECIMAL(10,2) NOT NULL DEFAULT 0,
  `forfeited_wallet` TINYINT(1) NOT NULL DEFAULT 0, `status` VARCHAR(12) NOT NULL DEFAULT 'completed',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`), KEY `ix_ad_user` (`user_id`)
) {UTF}""",
f"""CREATE TABLE IF NOT EXISTS `institution_aliases` (
  `variant` VARCHAR(200) NOT NULL, `canonical` VARCHAR(200) NOT NULL,
  `created_by` CHAR(36) NULL, `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`variant`)
) {UTF}""",
f"""CREATE TABLE IF NOT EXISTS `platform_settings` (
  `id` TINYINT NOT NULL DEFAULT 1,
  `rank_data_due` CHAR(5) NOT NULL DEFAULT '07-15',
  `rank_data_reviewed_on` DATE NULL,
  `updated_at` DATETIME NULL ON UPDATE CURRENT_TIMESTAMP, `updated_by` CHAR(36) NULL,
  PRIMARY KEY (`id`)
) {UTF}""",
]

CATEGORIES = [('refund', 'Refund'), ('wallet', 'SKOVO Wallet'), ('points_dispute', 'Points dispute'),
              ('streak_restore', 'Streak restore')]


def has_column(table, col):
    return db.session.execute(text(
        "SELECT COUNT(*) FROM information_schema.COLUMNS "
        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND COLUMN_NAME = :c"
    ), {'t': table, 'c': col}).scalar() > 0


def main():
    with app.app_context():
        for ddl in TABLES:
            db.session.execute(text(ddl))
        if not has_column('user_profiles', 'lang'):
            db.session.execute(text("ALTER TABLE user_profiles ADD COLUMN lang VARCHAR(5) NOT NULL DEFAULT 'en'"))
            print("  user_profiles.lang added")
        db.session.execute(text("INSERT IGNORE INTO platform_settings (id) VALUES (1)"))
        for v, l in CATEGORIES:
            exists = db.session.execute(text("SELECT COUNT(*) FROM master_support_category WHERE value = :v"),
                                        {'v': v}).scalar()
            if not exists:
                sort = db.session.execute(text("SELECT IFNULL(MAX(sort_order), 0) + 1 FROM master_support_category")).scalar()
                db.session.execute(text(
                    "INSERT INTO master_support_category (id, value, label, sort_order, is_active, created_at) "
                    "VALUES (:i, :v, :l, :o, 1, UTC_TIMESTAMP())"), {'i': str(uuid.uuid4()), 'v': v, 'l': l, 'o': sort})
                print(f"  support category {v} added")
        db.session.commit()
        print("Done.")


if __name__ == '__main__':
    main()
