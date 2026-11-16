-- ============================================================================
-- SKOVO — manual background check, on the lifecycle model
--
-- sp_achiever_bgv_start refused any achiever below trust_level 2. With tiers
-- gone that guard rejected everybody, which would have made the BGV button
-- fail for every applicant.
--
-- The guard it replaces was about not paying a vendor for someone whose
-- credential had not been checked. The lifecycle equivalent is: the account
-- must exist and not be banned. BGV is manual and part of vetting, so it has
-- to be available while the achiever is still `pending` — that is precisely
-- when the admin is deciding whether to approve them.
-- ============================================================================

DELIMITER $$

DROP PROCEDURE IF EXISTS `sp_achiever_bgv_start`$$
CREATE PROCEDURE `sp_achiever_bgv_start`(
    IN p_achiever_id CHAR(36),
    IN p_ref         VARCHAR(120),
    IN p_actor_id    CHAR(36)
)
BEGIN
    -- No DEFAULT: a missing achiever must leave this NULL so the not_found
    -- branch fires rather than reporting a state that does not exist.
    DECLARE v_state VARCHAR(20);

    SELECT state INTO v_state FROM `achievers` WHERE id = p_achiever_id;

    IF v_state IS NULL THEN
        SELECT 0 AS ok, 'not_found' AS reason;

    ELSEIF v_state = 'banned' THEN
        SELECT 0 AS ok, 'banned' AS reason;

    ELSE
        UPDATE `achievers`
           SET bgv_status = 'pending',
               bgv_ref    = p_ref,
               updated_at = UTC_TIMESTAMP()
         WHERE id = p_achiever_id;

        INSERT INTO `achiever_state_events`
            (id, achiever_id, from_state, to_state, reason, actor_id, actor_role, created_at)
        VALUES
            (UUID(), p_achiever_id, v_state, v_state,
             CONCAT('Background check started — ref ', IFNULL(p_ref, '-')),
             p_actor_id, 'admin', UTC_TIMESTAMP());

        SELECT 1 AS ok, 'pending' AS reason;
    END IF;
END$$

DELIMITER ;
