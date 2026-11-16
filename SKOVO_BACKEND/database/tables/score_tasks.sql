-- A task Admin adds so a student can earn readiness points.
-- scope all: every student. scope batch: students whose profile matches
-- education_category and/or degree_type. scope student: one account (user_id).
-- Points written on the ledger stay as they were when the task was marked done,
-- and stay counted after the task expires. Expiring stops new payments only.
-- same_as_id: this task repeats that one (the group's root); a group pays once.

CREATE TABLE IF NOT EXISTS `score_tasks` (
  `id` CHAR(36) NOT NULL,
  `label` VARCHAR(160) NOT NULL,
  `points` INT NOT NULL,
  `scope` VARCHAR(12) NOT NULL DEFAULT 'all',
  `user_id` CHAR(36) NULL,
  `education_category` VARCHAR(30) NULL,
  `degree_type` VARCHAR(100) NULL,
  `same_as_id` CHAR(36) NULL,
  `status` VARCHAR(12) NOT NULL DEFAULT 'active',
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_by` CHAR(36) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_score_tasks_user` (`user_id`),
  KEY `idx_score_tasks_active` (`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
