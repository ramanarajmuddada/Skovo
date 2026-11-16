-- SKOVO table: support_contacts
-- Emails and phones Admin types. Audience decides who sees each row.

CREATE TABLE IF NOT EXISTS `support_contacts` (
  `id` CHAR(36) NOT NULL,
  `audience` VARCHAR(20) NOT NULL,
  `channel` VARCHAR(20) NOT NULL,
  `value` VARCHAR(255) NOT NULL,
  `label` VARCHAR(80) NOT NULL,
  `hours` VARCHAR(120) NULL,
  `sort_order` INT NOT NULL DEFAULT 0,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_by` CHAR(36) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_support_contacts_audience` (`audience`, `is_active`, `sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
