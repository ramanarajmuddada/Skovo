-- Registered business details shown on the legal pages, contact page and footer.
-- One row (id = 1), edited in Admin › Support › Company. NULL = not confirmed yet.
CREATE TABLE IF NOT EXISTS `company_details` (
  `id` TINYINT NOT NULL,
  `legal_name` VARCHAR(200) NULL,
  `support_email` VARCHAR(255) NULL,
  `phone` VARCHAR(30) NULL,
  `registered_address` VARCHAR(400) NULL,
  `gstin` VARCHAR(20) NULL,
  `grievance_officer` VARCHAR(120) NULL,
  `grievance_email` VARCHAR(255) NULL,
  `jurisdiction` VARCHAR(200) NULL,
  `support_hours` VARCHAR(120) NULL,
  `updated_by` CHAR(36) NULL,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
