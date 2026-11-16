-- How long community chat and sent documents stay.
-- The numbers are edited in Admin → Communities. Nothing in the app hardcodes them.

CREATE TABLE IF NOT EXISTS `community_retention` (
  `id` CHAR(36) NOT NULL,
  `chat_days` INT NOT NULL DEFAULT 21,
  `file_days` INT NOT NULL DEFAULT 7,
  `updated_by` CHAR(36) NULL,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
