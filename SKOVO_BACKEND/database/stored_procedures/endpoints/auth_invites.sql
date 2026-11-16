-- ============================================================
-- SKOVO — Tailored endpoint stored procedures: invite acceptance
-- ============================================================
-- Used by GET/POST /auth/invite/<token> — invitations.token is looked
-- up directly (no generic get-by-id proc covers it), and acceptance is
-- a single-column update scoped to that token.
-- ============================================================

DELIMITER $$

DROP PROCEDURE IF EXISTS `sp_invitations_get_by_token`$$
CREATE PROCEDURE `sp_invitations_get_by_token`(IN p_token VARCHAR(64))
BEGIN
    SELECT * FROM `invitations` WHERE `token` = p_token LIMIT 1;
END$$

DROP PROCEDURE IF EXISTS `sp_invitations_mark_accepted`$$
CREATE PROCEDURE `sp_invitations_mark_accepted`(
    IN p_token VARCHAR(64),
    IN p_accepted_at DATETIME,
    IN p_accepted_by_id VARCHAR(36)
)
BEGIN
    UPDATE `invitations`
    SET `accepted_at` = p_accepted_at, `accepted_by_id` = p_accepted_by_id
    WHERE `token` = p_token;
END$$

DELIMITER ;
