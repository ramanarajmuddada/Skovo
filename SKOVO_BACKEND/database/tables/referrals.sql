-- Referrals by a student or an achiever. A row stays pending until the friend
-- finishes signup with this person's link; completed_at is that moment.
-- A rule only pays for friends who completed after the rule was created.
-- Prizes live in referral_grants.

CREATE TABLE IF NOT EXISTS `referrals` (
  `id` CHAR(36) NOT NULL,
  `referrer_id` CHAR(36) NOT NULL,
  `referrer_audience` VARCHAR(20) NOT NULL DEFAULT 'student',
  `friend_audience` VARCHAR(20) NOT NULL DEFAULT 'student',
  `referred_email` VARCHAR(320) NOT NULL,
  `referred_user_id` CHAR(36) NULL,
  `referral_code` VARCHAR(40) NULL,
  `status` VARCHAR(20) NULL DEFAULT 'pending',
  `reward_given` TINYINT(1) NULL DEFAULT 0,
  `completed_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_referrals_referral_code` (`referral_code`),
  KEY `ix_referrals_referrer` (`referrer_id`),
  KEY `ix_referrals_friend` (`referred_user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
