-- One prize payment. milestone_count 0 is a per-friend prize.
-- once_key is what makes a payment happen once: the friend's id for a
-- per-friend prize, 'milestone' for a milestone. A milestone is paid to
-- the referrer once, whichever friend completes the count.

CREATE TABLE IF NOT EXISTS `referral_grants` (
  `id` CHAR(36) NOT NULL,
  `rule_id` CHAR(36) NOT NULL,
  `referrer_id` CHAR(36) NOT NULL,
  `friend_user_id` CHAR(36) NOT NULL,
  `once_key` VARCHAR(40) NOT NULL,
  `milestone_count` INT NOT NULL DEFAULT 0,
  `referrer_summary` VARCHAR(200) NULL,
  `friend_summary` VARCHAR(200) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_referral_grant_once` (`rule_id`, `referrer_id`, `once_key`, `milestone_count`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
