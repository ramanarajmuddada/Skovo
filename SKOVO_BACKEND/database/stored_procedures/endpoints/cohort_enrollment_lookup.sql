-- ============================================================
-- SKOVO — Tailored endpoint stored procedures: cohort enrollment lookup
-- ============================================================
-- Used by GET /cohorts/<id> and POST /cohorts/<id>/enroll — looks up a
-- student's enrollment row for a cohort by (user_id, cohort_id), or by
-- the the gateway order id bound to it during payment verification.
-- ============================================================

DELIMITER $$

DROP PROCEDURE IF EXISTS `sp_cohort_enrollments_get_by_user_cohort`$$
CREATE PROCEDURE `sp_cohort_enrollments_get_by_user_cohort`(IN p_user_id CHAR(36), IN p_cohort_id CHAR(36))
BEGIN
    SELECT * FROM `cohort_enrollments` WHERE `user_id` = p_user_id AND `cohort_id` = p_cohort_id LIMIT 1;
END$$

DELIMITER ;
