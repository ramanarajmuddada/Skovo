-- One row per BhaAI question. Counts the daily allowance and what the model
-- cost. The question and the reply are never stored: this table is for the
-- bill and the cap, not a transcript of what a student asked.
-- status: pending (reserved, model call in flight), done, failed.
-- A failed call does not count toward the student's allowance.

CREATE TABLE IF NOT EXISTS `bhaai_usage` (
  `id` CHAR(36) NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `model` VARCHAR(100) NULL,
  `status` VARCHAR(10) NOT NULL DEFAULT 'pending',
  `input_tokens` INT NULL,
  `output_tokens` INT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_bhaai_usage_user_day` (`user_id`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
