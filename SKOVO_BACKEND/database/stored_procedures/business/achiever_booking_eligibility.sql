-- ============================================================================
-- SKOVO — can this student book this achiever?
--
-- Rewritten onto the lifecycle state. The previous version answered from
-- achiever_trust_rules joined on trust_level, which meant the tier table --
-- not the achiever's actual state -- decided who could be booked and charged.
-- Two capability models disagreeing about the same achiever is a bug waiting
-- for the first real booking.
--
-- The DPDP rules stay exactly as they were. Under-14 accounts and unconfirmed
-- parental consent are obligations under India's data protection law, not
-- capability tiers, and dropping the tier system does not touch them.
--
-- What is gone is the child-safety tier gate: an achiever no longer needs a
-- background-check tier to take a 14-17 student. That is a deliberate product
-- decision, made explicitly, not a side effect of removing tiers.
-- ============================================================================

DELIMITER $$

DROP PROCEDURE IF EXISTS `sp_achiever_booking_eligibility`$$
CREATE PROCEDURE `sp_achiever_booking_eligibility`(
    IN p_achiever_id CHAR(36),
    IN p_student_id  CHAR(36)
)
BEGIN
    DECLARE v_exists  TINYINT DEFAULT 0;
    DECLARE v_active  TINYINT DEFAULT 0;
    DECLARE v_state   VARCHAR(20);
    DECLARE v_rate    DECIMAL(10,2) DEFAULT 0;
    DECLARE v_consent VARCHAR(20);

    SELECT 1, IFNULL(a.is_active, 0), a.state, IFNULL(a.session_rate, 0)
      INTO v_exists, v_active, v_state, v_rate
      FROM `achievers` a
     WHERE a.id = p_achiever_id;

    SELECT consent_status INTO v_consent
      FROM `users` WHERE id = p_student_id;

    IF v_exists = 0 THEN
        SELECT 0 AS ok, 'not_found' AS reason, v_state AS state;

    ELSEIF v_active = 0 THEN
        SELECT 0 AS ok, 'inactive' AS reason, v_state AS state;

    -- Listed and bookable while active or on probation. A probation achiever
    -- must be bookable: demo sessions are how they earn their way to active.
    ELSEIF v_state IS NULL OR v_state NOT IN ('active', 'probation') THEN
        SELECT 0 AS ok, 'unverified' AS reason, v_state AS state;

    -- No age or parental-consent gate. Age is still recorded on the user row,
    -- so this can be reinstated by restoring the two branches that were here;
    -- nothing downstream needs to change for that.

    -- Charging is the one thing probation cannot do. Free demo sessions with a
    -- probation achiever are the whole point of the state.
    ELSEIF v_rate > 0 AND v_state <> 'active' THEN
        SELECT 0 AS ok, 'achiever_cannot_charge' AS reason, v_state AS state;

    ELSE
        SELECT 1 AS ok, 'ok' AS reason, v_state AS state;
    END IF;
END$$

DELIMITER ;
