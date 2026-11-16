-- ============================================================
-- SKOVO — Tailored endpoint SPs: whiteboard (Socket.IO relay backing store)
-- ============================================================
-- Live drawing is broadcast peer-to-peer over Socket.IO and never hits the
-- DB per-stroke. These procs only (a) authorize who may join a board's room
-- and (b) persist/restore a debounced full-canvas snapshot.
-- ============================================================

DELIMITER $$

-- Access check for a cohort-scoped board: is this user the achiever who owns
-- the cohort, or a paid/free-enrolled student of it?
DROP PROCEDURE IF EXISTS `sp_whiteboard_cohort_access`$$
CREATE PROCEDURE `sp_whiteboard_cohort_access`(IN p_cohort_id CHAR(36), IN p_user_id CHAR(36))
BEGIN
    SELECT
        c.achiever_id,
        (c.achiever_id = p_user_id) AS is_achiever,
        EXISTS(
            SELECT 1 FROM `cohort_enrollments` ce
             WHERE ce.cohort_id = p_cohort_id AND ce.user_id = p_user_id
               AND ce.payment_status IN ('paid','free')
        ) AS is_enrolled
    FROM `cohorts` c
    WHERE c.id = p_cohort_id AND c.deleted_at IS NULL;
END$$

-- Fetch the last-saved canvas snapshot for a board (NULL row = never saved yet).
DROP PROCEDURE IF EXISTS `sp_whiteboard_get`$$
CREATE PROCEDURE `sp_whiteboard_get`(IN p_context_type VARCHAR(10), IN p_context_id CHAR(36))
BEGIN
    SELECT * FROM `whiteboard_boards`
     WHERE `context_type` = p_context_type AND `context_id` = p_context_id
     LIMIT 1;
END$$

-- Upsert the full canvas snapshot (client debounces how often this fires).
DROP PROCEDURE IF EXISTS `sp_whiteboard_save`$$
CREATE PROCEDURE `sp_whiteboard_save`(
    IN p_context_type VARCHAR(10),
    IN p_context_id   CHAR(36),
    IN p_canvas_data  LONGTEXT,
    IN p_updated_by   CHAR(36)
)
BEGIN
    INSERT INTO `whiteboard_boards` (`id`, `context_type`, `context_id`, `canvas_data`, `updated_by`)
    VALUES (UUID(), p_context_type, p_context_id, p_canvas_data, p_updated_by)
    ON DUPLICATE KEY UPDATE
        `canvas_data` = p_canvas_data,
        `updated_by`  = p_updated_by;
    SELECT * FROM `whiteboard_boards`
     WHERE `context_type` = p_context_type AND `context_id` = p_context_id
     LIMIT 1;
END$$

DELIMITER ;
