-- SKOVO table: support_issues
-- Issues raised in the app. user_id is nullable so a v2 public form can land here.

CREATE TABLE IF NOT EXISTS `support_issues` (
  `id` CHAR(36) NOT NULL,
  `user_id` CHAR(36) NULL,
  `contact_email` VARCHAR(255) NULL,
  `portal` VARCHAR(20) NOT NULL,
  `subject` VARCHAR(200) NOT NULL,
  `body` TEXT NOT NULL,
  `category` VARCHAR(40) NOT NULL DEFAULT 'other',
  `status` VARCHAR(20) NOT NULL DEFAULT 'open',
  `reference_type` VARCHAR(50) NULL,
  `reference_id` VARCHAR(36) NULL,
  `source` VARCHAR(20) NOT NULL DEFAULT 'web',
  `first_response_at` DATETIME NULL,
  `resolved_at` DATETIME NULL,
  `resolved_by` CHAR(36) NULL,
  `created_by` CHAR(36) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_support_issues_user` (`user_id`, `portal`, `created_at`),
  KEY `idx_support_issues_admin` (`portal`, `status`, `category`, `created_at`),
  FULLTEXT KEY `ft_support_issues_text` (`subject`, `body`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
