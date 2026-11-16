-- SKOVO table: whiteboard_boards
-- One persisted canvas snapshot per 1-on-1 session or cohort, so joining late
-- or reloading the page restores the last drawn state. Live drawing itself is
-- relayed peer-to-peer via Socket.IO and never touches the DB per-stroke.

CREATE TABLE IF NOT EXISTS `whiteboard_boards` (
  `id` CHAR(36) NOT NULL,
  `context_type` VARCHAR(10) NOT NULL,
  `context_id` CHAR(36) NOT NULL,
  `canvas_data` LONGTEXT NULL,
  `updated_by` CHAR(36) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_whiteboard_boards_context` (`context_type`, `context_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
