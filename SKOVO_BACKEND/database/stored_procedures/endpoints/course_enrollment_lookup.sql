-- ============================================================
-- SKOVO — Tailored endpoint stored procedures: course enrollment lookup
-- ============================================================
-- Used by POST /achiever-courses/<id>/enroll — looks up a student's
-- enrollment row for a course by (user_id, course_id), or by the the gateway
-- order id bound to it during payment verification.
-- ============================================================

DELIMITER $$

DROP PROCEDURE IF EXISTS `sp_course_enrollments_get_by_user_course`$$
CREATE PROCEDURE `sp_course_enrollments_get_by_user_course`(IN p_user_id CHAR(36), IN p_course_id CHAR(36))
BEGIN
    SELECT * FROM `course_enrollments` WHERE `user_id` = p_user_id AND `course_id` = p_course_id LIMIT 1;
END$$

DELIMITER ;
