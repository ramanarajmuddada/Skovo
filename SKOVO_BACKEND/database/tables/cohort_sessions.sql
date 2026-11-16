-- SKOVO table: cohort_sessions
-- Child sessions of a multi-week cohort. A cohort with zero rows here is a
-- single-session cohort (uses cohorts.session_date) — fully backward compatible.

CREATE TABLE IF NOT EXISTS `cohort_sessions` (
  `id` CHAR(36) NOT NULL,
  `cohort_id` CHAR(36) NOT NULL,
  `title` VARCHAR(300) NULL,
  `session_date` DATETIME NOT NULL,
  `duration_minutes` INT NULL DEFAULT 90,
  `meeting_link` VARCHAR(500) NULL,
  `sort_order` INT NULL DEFAULT 0,
  `status` VARCHAR(20) NULL DEFAULT 'upcoming',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  KEY `ix_cohort_sessions_cohort_id` (`cohort_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
