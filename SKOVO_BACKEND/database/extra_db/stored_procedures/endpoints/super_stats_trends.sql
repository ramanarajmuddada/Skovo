-- ============================================================
-- SKOVO — Super Admin weekly trend counters (MySQL 8)
-- One COUNT per (metric, week) call, mirroring the prior ORM loop.
-- ============================================================

DELIMITER $$

DROP PROCEDURE IF EXISTS `sp_super_trend_user_registrations`$$
CREATE PROCEDURE `sp_super_trend_user_registrations`(IN p_start DATETIME, IN p_end DATETIME)
BEGIN
    SELECT COUNT(*) AS cnt FROM `users` WHERE `created_at` >= p_start AND `created_at` <= p_end;
END$$

DROP PROCEDURE IF EXISTS `sp_super_trend_cohort_enrollments`$$
CREATE PROCEDURE `sp_super_trend_cohort_enrollments`(IN p_start DATETIME, IN p_end DATETIME)
BEGIN
    SELECT COUNT(*) AS cnt FROM `cohort_enrollments` WHERE `created_at` >= p_start AND `created_at` <= p_end;
END$$

DROP PROCEDURE IF EXISTS `sp_super_trend_opportunity_applications`$$
CREATE PROCEDURE `sp_super_trend_opportunity_applications`(IN p_start DATETIME, IN p_end DATETIME)
BEGIN
    SELECT COUNT(*) AS cnt FROM `opportunity_applications` WHERE `created_at` >= p_start AND `created_at` <= p_end;
END$$

DELIMITER ;
