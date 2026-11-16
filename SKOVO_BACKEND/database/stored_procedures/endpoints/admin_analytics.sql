-- ============================================================
-- SKOVO — Admin platform analytics (MySQL 8)
-- Read-only aggregate reporting for the Admin > Analytics screen.
-- ============================================================

DELIMITER $$

DROP PROCEDURE IF EXISTS `sp_admin_analytics_events`$$
CREATE PROCEDURE `sp_admin_analytics_events`(IN p_since DATETIME)
BEGIN
    SELECT `event_type`, COUNT(*) AS cnt
      FROM `platform_analytics`
     WHERE `created_at` >= p_since
     GROUP BY `event_type`
     ORDER BY cnt DESC
     LIMIT 20;
END$$

DROP PROCEDURE IF EXISTS `sp_admin_analytics_daily_signups`$$
CREATE PROCEDURE `sp_admin_analytics_daily_signups`(IN p_since DATETIME)
BEGIN
    SELECT DATE(`created_at`) AS day, COUNT(*) AS cnt
      FROM `users`
     WHERE `created_at` >= p_since AND `deleted_at` IS NULL
     GROUP BY DATE(`created_at`)
     ORDER BY day;
END$$

DROP PROCEDURE IF EXISTS `sp_admin_analytics_cohort_funnel`$$
CREATE PROCEDURE `sp_admin_analytics_cohort_funnel`()
BEGIN
    SELECT
        (SELECT COUNT(*) FROM `cohorts` WHERE `deleted_at` IS NULL) AS total_cohorts,
        (SELECT COUNT(*) FROM `cohort_enrollments`) AS total_enrollments,
        (SELECT COUNT(*) FROM `cohort_enrollments` WHERE `payment_status` = 'paid') AS paid_enrollments,
        (SELECT COUNT(*) FROM `cohort_enrollments` WHERE `payment_status` = 'free') AS free_enrollments;
END$$

DROP PROCEDURE IF EXISTS `sp_admin_analytics_top_cohorts`$$
CREATE PROCEDURE `sp_admin_analytics_top_cohorts`()
BEGIN
    SELECT c.`id`, c.`title`, COUNT(ce.`id`) AS enrolled
      FROM `cohorts` c
      LEFT JOIN `cohort_enrollments` ce ON ce.`cohort_id` = c.`id`
     WHERE c.`deleted_at` IS NULL
     GROUP BY c.`id`, c.`title`
     ORDER BY enrolled DESC
     LIMIT 5;
END$$

DROP PROCEDURE IF EXISTS `sp_admin_analytics_mentor_utilisation`$$
CREATE PROCEDURE `sp_admin_analytics_mentor_utilisation`()
BEGIN
    SELECT a.`full_name`, COUNT(s.`id`) AS sessions
      FROM `achievers` a
      LEFT JOIN `achiever_sessions` s ON s.`mentor_id` = a.`id`
     WHERE a.`is_active` = 1
     GROUP BY a.`id`, a.`full_name`
     ORDER BY sessions DESC
     LIMIT 10;
END$$

DROP PROCEDURE IF EXISTS `sp_admin_analytics_session_statuses`$$
CREATE PROCEDURE `sp_admin_analytics_session_statuses`()
BEGIN
    SELECT `status`, COUNT(*) AS cnt
      FROM `achiever_sessions`
     GROUP BY `status`;
END$$

DELIMITER ;
