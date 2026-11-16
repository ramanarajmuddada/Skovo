-- ============================================================================
-- SKOVO — admin approval
--
--     PENDING -> ACTIVE -> SUSPENDED
--                  ^________|
--
-- Only a super-admin moves an admin between states. The API enforces that; the
-- procedures record who did it either way, because an audit row written only
-- when someone remembers to write it is not an audit trail.
-- ============================================================================

DELIMITER $$

-- ---------------------------------------------------------------------------
-- The single way an admin's state changes.
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_admin_set_state`$$
CREATE PROCEDURE `sp_admin_set_state`(
    IN p_admin_id   CHAR(36),
    IN p_to_state   VARCHAR(20),
    IN p_reason     TEXT,
    IN p_actor_id   CHAR(36),
    IN p_actor_role VARCHAR(20)
)
BEGIN
    DECLARE v_from VARCHAR(20);

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    IF p_to_state NOT IN ('pending','active','suspended') THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'INVALID_STATE';
    END IF;

    START TRANSACTION;

    SELECT state INTO v_from FROM `admins` WHERE id = p_admin_id FOR UPDATE;

    IF v_from IS NULL THEN
        ROLLBACK;
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ADMIN_NOT_FOUND';
    END IF;

    UPDATE `admins`
       SET state            = p_to_state,
           state_reason     = p_reason,
           state_changed_at = UTC_TIMESTAMP(),
           state_changed_by = p_actor_id,
           -- `status` predates this and still gates older queries; keeping the
           -- two consistent stops a suspended admin slipping through a screen
           -- that has not been migrated yet.
           status           = IF(p_to_state = 'active', 'active', 'inactive'),
           updated_at       = UTC_TIMESTAMP()
     WHERE id = p_admin_id;

    INSERT INTO `admin_state_events`
        (id, admin_id, from_state, to_state, reason, actor_id, actor_role, created_at)
    VALUES
        (UUID(), p_admin_id, v_from, p_to_state, p_reason, p_actor_id, p_actor_role,
         UTC_TIMESTAMP());

    COMMIT;

    SELECT p_admin_id AS admin_id, v_from AS from_state, p_to_state AS to_state;
END$$


-- ---------------------------------------------------------------------------
-- Admins awaiting a decision, plus a short history for context.
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_admin_approval_queue`$$
CREATE PROCEDURE `sp_admin_approval_queue`(
    IN p_state VARCHAR(20)
)
BEGIN
    SELECT a.id, a.full_name, a.email, a.state, a.state_reason,
           a.created_at, a.state_changed_at,
           (SELECT COUNT(*) FROM `admin_state_events` e WHERE e.admin_id = a.id) AS event_count
      FROM `admins` a
     WHERE (p_state IS NULL OR p_state = '' OR a.state = p_state)
     ORDER BY (a.state = 'pending') DESC, a.created_at DESC
     LIMIT 500;
END$$


-- ---------------------------------------------------------------------------
-- Whether this admin may act, and whether they are the bootstrap account.
--
-- The first admin is exempt from approval: requiring a super-admin to approve
-- the very first admin on an empty database deadlocks the platform, and after
-- a data wipe there is no super-admin either.
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_admin_capabilities`$$
CREATE PROCEDURE `sp_admin_capabilities`(
    IN p_admin_id CHAR(36)
)
BEGIN
    -- can_operate is `state = 'active'`, with no exceptions.
    --
    -- This used to read (state = 'active' OR a.id = <first admin>), a bootstrap
    -- escape hatch letting the earliest-created admin work without approval. It
    -- meant the very first person to register got the whole console — students,
    -- payments, moderation — while still showing as `pending` to the owner who
    -- had approved nobody.
    --
    -- There was no deadlock to escape: the super admin does the approving and
    -- exists independently of any admin, so an unapproved admin can always be
    -- let in by the person who is supposed to decide.
    SELECT
        a.state,
        a.state_reason,
        (a.state = 'active')  AS can_operate,
        (a.state = 'pending') AS awaiting_approval
      FROM `admins` a
     WHERE a.id = p_admin_id;
END$$

DELIMITER ;

-- ---------------------------------------------------------------------------
-- One admin's access history, newest first.
--
-- The approvals screen shows who is waiting; this is what backs the decision.
-- "Suspended once before and reinstated" is the fact that changes an approval
-- from routine to worth reading, and a count alone cannot carry it — you need
-- to see what happened and why.
--
-- Bounded: an account with hundreds of state changes has a bigger problem than
-- a truncated list.
-- ---------------------------------------------------------------------------
DELIMITER $$

DROP PROCEDURE IF EXISTS `sp_admin_state_history`$$
CREATE PROCEDURE `sp_admin_state_history`(
    IN p_admin_id CHAR(36)
)
BEGIN
    SELECT e.id,
           e.from_state,
           e.to_state,
           e.reason,
           e.actor_role,
           e.created_at,
           COALESCE(sa.full_name, ad.full_name) AS actor_name
      FROM `admin_state_events` e
      LEFT JOIN `super_admins` sa ON sa.id = e.actor_id
      LEFT JOIN `admins`       ad ON ad.id = e.actor_id
     WHERE e.admin_id = p_admin_id
     ORDER BY e.created_at DESC
     LIMIT 50;
END$$

DELIMITER ;
