-- SKOVO table: subscriptions (Skovo Pro membership)
-- One active row per user; history kept as expired/cancelled rows.

CREATE TABLE IF NOT EXISTS `subscriptions` (
  `id` CHAR(36) NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `plan` VARCHAR(30) NOT NULL DEFAULT 'pro',
  `status` VARCHAR(20) NOT NULL DEFAULT 'active',  -- active | expired | cancelled | pending
  `amount` DECIMAL(10,2) NULL DEFAULT 0,
  `started_at` DATETIME NULL,
  `expires_at` DATETIME NULL,
  `payment_order_id` VARCHAR(100) NULL,
  `payment_id` VARCHAR(100) NULL,
  `auto_renew` TINYINT(1) NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `ix_subscriptions_user_id` (`user_id`),
  KEY `ix_subscriptions_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
