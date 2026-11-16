-- ============================================================
-- SKOVO — Tailored endpoint stored procedures: dashboard
-- ============================================================
-- GET /dashboard — upcoming cohorts joined with achiever + domain (flat rows;
-- the route nests them). Readiness + user come from sp_readiness_score_get /
-- sp_users_get.
-- ============================================================

DELIMITER $$

DROP PROCEDURE IF EXISTS `sp_dashboard_upcoming_cohorts`$$
CREATE PROCEDURE `sp_dashboard_upcoming_cohorts`(IN p_limit INT)
BEGIN
    IF p_limit IS NULL OR p_limit <= 0 THEN SET p_limit = 4; END IF;
    SELECT c.`id`, c.`title`, c.`session_date`, c.`duration_minutes`,
           c.`total_seats`, c.`filled_seats`, c.`price`, c.`status`,
           c.`about`, c.`what_you_learn`, c.`thumbnail_url`,
           d.`id`   AS domain_id,   d.`name` AS domain_name, d.`slug` AS domain_slug,
           a.`id`   AS achiever_id, a.`full_name` AS achiever_name,
           a.`designation` AS achiever_designation, a.`company` AS achiever_company,
           a.`avatar_url`  AS achiever_avatar
      FROM `cohorts` c
      LEFT JOIN `domains`   d ON d.`id` = c.`domain_id`
      LEFT JOIN `achievers` a ON a.`id` = c.`achiever_id`
     WHERE c.`status` = 'upcoming'
     ORDER BY c.`session_date` ASC
     LIMIT p_limit;
END$$

DELIMITER ;
