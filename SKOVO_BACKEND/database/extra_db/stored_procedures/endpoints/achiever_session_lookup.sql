-- ============================================================
-- SKOVO — Tailored endpoint stored procedures: achiever session lookup
-- ============================================================
-- Used by POST /achievers/<id>/book (step 2) to bind a verified the gateway
-- payment back to the pending session it was created for.
-- ============================================================

DELIMITER $$

DROP PROCEDURE IF EXISTS `sp_achiever_sessions_get_by_order`$$
CREATE PROCEDURE `sp_achiever_sessions_get_by_order`(IN p_order_id VARCHAR(100), IN p_student_id CHAR(36))
BEGIN
    SELECT * FROM `achiever_sessions`
     WHERE `payment_order_id` = p_order_id AND `student_id` = p_student_id
     LIMIT 1;
END$$

DELIMITER ;
