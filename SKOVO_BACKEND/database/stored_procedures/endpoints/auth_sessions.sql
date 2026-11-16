-- ============================================================
-- SKOVO — Tailored endpoint stored procedures: auth sessions
-- ============================================================
-- Used by POST /auth/token/refresh and POST /auth/logout across all
-- portals — looks up / revokes a session by JWT jti, or revokes every
-- active session for a user (full logout), without a bounded table scan.
-- ============================================================

DELIMITER $$

DROP PROCEDURE IF EXISTS `sp_sessions_get_by_jti`$$
CREATE PROCEDURE `sp_sessions_get_by_jti`(IN p_jti VARCHAR(64))
BEGIN
    SELECT * FROM `sessions` WHERE `jti` = p_jti LIMIT 1;
END$$

DROP PROCEDURE IF EXISTS `sp_sessions_revoke_by_jti`$$
CREATE PROCEDURE `sp_sessions_revoke_by_jti`(IN p_jti VARCHAR(64), IN p_revoked_at DATETIME)
BEGIN
    UPDATE `sessions` SET `revoked_at` = p_revoked_at WHERE `jti` = p_jti AND `revoked_at` IS NULL;
END$$

DROP PROCEDURE IF EXISTS `sp_sessions_revoke_all_by_user`$$
CREATE PROCEDURE `sp_sessions_revoke_all_by_user`(IN p_user_id CHAR(36), IN p_revoked_at DATETIME)
BEGIN
    UPDATE `sessions` SET `revoked_at` = p_revoked_at WHERE `user_id` = p_user_id AND `revoked_at` IS NULL;
END$$

DELIMITER ;
