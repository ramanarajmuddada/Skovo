-- Public landing page: the live numbers behind skovoai.com, so what Admin
-- changes is what the homepage says. No session; read-only; nothing personal.

DELIMITER $$

-- The next cohorts open for booking: upcoming, in the future, seats left.
DROP PROCEDURE IF EXISTS `sp_public_upcoming_cohorts`$$
CREATE PROCEDURE `sp_public_upcoming_cohorts`(IN p_limit INT)
BEGIN
    SELECT c.`id`, c.`title`, c.`session_date`, c.`duration_minutes`, c.`price`,
           IFNULL(c.`total_seats`, 0)                                   AS total_seats,
           GREATEST(IFNULL(c.`total_seats`, 0) - IFNULL(c.`filled_seats`, 0), 0) AS seats_left,
           a.`designation`                                               AS host_designation,
           a.`company`                                                   AS host_company
      FROM `cohorts` c
      LEFT JOIN `achievers` a ON a.`id` = c.`achiever_id`
     WHERE c.`deleted_at` IS NULL
       AND c.`status` = 'upcoming'
       AND c.`session_date` > UTC_TIMESTAMP()
       AND IFNULL(c.`total_seats`, 0) > IFNULL(c.`filled_seats`, 0)
     ORDER BY c.`session_date` ASC, c.`price` ASC
     LIMIT p_limit;
END$$

-- Headline counts plus the cheapest upcoming cohort ("Starting from ₹X").
DROP PROCEDURE IF EXISTS `sp_public_counts`$$
CREATE PROCEDURE `sp_public_counts`()
BEGIN
    SELECT
      (SELECT COUNT(*) FROM `achievers`
        WHERE `is_verified` = 1 AND IFNULL(`is_active`, 1) = 1)          AS verified_achievers,
      (SELECT COUNT(*) FROM `users`
        WHERE `deleted_at` IS NULL AND IFNULL(`status`, 'active') = 'active') AS students,
      (SELECT MIN(`price`) FROM `cohorts`
        WHERE `deleted_at` IS NULL AND `status` = 'upcoming'
          AND `session_date` > UTC_TIMESTAMP())                          AS min_upcoming_price,
      (SELECT COUNT(*) FROM `cohorts`
        WHERE `deleted_at` IS NULL AND `status` = 'upcoming'
          AND `session_date` > UTC_TIMESTAMP())                          AS upcoming_cohorts,
      (SELECT COUNT(*) FROM `colleges`
        WHERE `deleted_at` IS NULL AND IFNULL(`is_active`, 1) = 1)       AS colleges,
      (SELECT COUNT(*) FROM `opportunities`
        WHERE `deleted_at` IS NULL AND IFNULL(`status`, 'active') = 'active'
          AND (`deadline` IS NULL OR `deadline` > UTC_TIMESTAMP()))      AS open_opportunities,
      (SELECT COUNT(*) FROM `groups`
        WHERE `deleted_at` IS NULL AND IFNULL(`is_active`, 1) = 1)       AS communities;
END$$

-- The active Score Engine actions that pay points, biggest first.
DROP PROCEDURE IF EXISTS `sp_public_score_rules`$$
CREATE PROCEDURE `sp_public_score_rules`(IN p_limit INT)
BEGIN
    SELECT `event_type`, `label`, `points`, `cap_type`
      FROM `score_event_rules`
     WHERE `is_active` = 1 AND `points` > 0
     ORDER BY `points` DESC, `label` ASC
     LIMIT p_limit;
END$$

DELIMITER ;
