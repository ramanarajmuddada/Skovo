-- SKOVO table: pro_free_limits
-- One row. Admin sets the free-tier numbers every student shares.
--
-- NULL in any cap column means UNLIMITED, not "unset". Admin → Subscriptions
-- offers Limited / Unlimited per cap, the same pair the achiever seat control
-- uses, so "no cap" is a choice somebody made rather than an empty box that
-- happened to be left blank.
--
-- `session_credits` was `monthly_session_credits` and reset on the calendar
-- month. It is now counted per subscription period: a member gets N for the
-- term they paid for, and renewing grants a fresh N.

CREATE TABLE IF NOT EXISTS `pro_free_limits` (
  `id` TINYINT NOT NULL,
  `free_paid_cohorts` INT NULL DEFAULT 1,
  `saved_colleges` INT NULL DEFAULT 3,
  `communities` INT NULL DEFAULT 3,
  `vault_docs` INT NULL DEFAULT 5,
  `session_credits` INT NULL DEFAULT 2,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `updated_by` CHAR(36) NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO `pro_free_limits`
  (`id`, `free_paid_cohorts`, `saved_colleges`, `communities`, `vault_docs`, `session_credits`)
VALUES
  (1, 1, 3, 3, 5, 2);
