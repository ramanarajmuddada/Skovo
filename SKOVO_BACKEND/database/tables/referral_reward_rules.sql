-- Admin-set Refer & Earn prizes. One row is one gate and one prize.
-- milestone_count NULL means every qualifying friend. A number pays once,
-- when the referrer reaches that many qualifying friends.

CREATE TABLE IF NOT EXISTS `referral_reward_rules` (
  `id` CHAR(36) NOT NULL,
  `trigger_kind` VARCHAR(20) NOT NULL,
  `referrer_audience` VARCHAR(20) NOT NULL DEFAULT 'student',
  `friend_audience` VARCHAR(20) NOT NULL DEFAULT 'student',
  `cohort_count` INT NULL,
  `pro_months` INT NULL,
  `milestone_count` INT NULL,
  `referrer_kind` VARCHAR(20) NOT NULL DEFAULT 'none',
  `referrer_points` INT NULL,
  `referrer_pro_days` INT NULL,
  `referrer_coupon_type` VARCHAR(10) NULL,
  `referrer_coupon_value` DECIMAL(10,2) NULL,
  `referrer_coupon_applies` VARCHAR(10) NULL,
  `referrer_pay_amount` DECIMAL(12,2) NULL,
  `referrer_seats` INT NULL,
  `friend_kind` VARCHAR(20) NOT NULL DEFAULT 'none',
  `friend_points` INT NULL,
  `friend_pro_days` INT NULL,
  `friend_coupon_type` VARCHAR(10) NULL,
  `friend_coupon_value` DECIMAL(10,2) NULL,
  `friend_coupon_applies` VARCHAR(10) NULL,
  `friend_pay_amount` DECIMAL(12,2) NULL,
  `friend_seats` INT NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `updated_by` CHAR(36) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
