-- ============================================================
-- SKOVO stored procedures: boards + streams
-- ============================================================
-- A board belongs to a state (or is national) and owns its stream vocabulary.
-- `sp_streams_by_board` falls back to the DEFAULT board's set when a board has
-- no rows of its own, so every student gets sensible options even where we have
-- not mapped that board's exact naming yet.
-- ============================================================

DELIMITER $$

-- ── boards ───────────────────────────────────────────────────────────────────

DROP PROCEDURE IF EXISTS `sp_boards_for_state`$$
CREATE PROCEDURE `sp_boards_for_state`(IN p_state_id CHAR(36))
BEGIN
    -- National boards first, then that state's own board(s). The DEFAULT holder
    -- row is is_active = 0 so it never reaches a picker.
    SELECT b.`id`, b.`code`, b.`name`, b.`state_id`, b.`is_national`, b.`sort_order`
      FROM `boards` b
     WHERE b.`is_active` = 1
       AND (b.`is_national` = 1 OR (p_state_id IS NOT NULL AND b.`state_id` = p_state_id))
     ORDER BY b.`is_national` DESC, b.`sort_order`, b.`name`;
END$$

DROP PROCEDURE IF EXISTS `sp_boards_get_by_code`$$
CREATE PROCEDURE `sp_boards_get_by_code`(IN p_code VARCHAR(20))
BEGIN
    SELECT * FROM `boards` WHERE `code` = p_code LIMIT 1;
END$$

-- ── streams ──────────────────────────────────────────────────────────────────

DROP PROCEDURE IF EXISTS `sp_streams_by_board`$$
CREATE PROCEDURE `sp_streams_by_board`(IN p_board_id CHAR(36))
BEGIN
    DECLARE v_count INT DEFAULT 0;
    DECLARE v_board CHAR(36);

    SELECT COUNT(*) INTO v_count FROM `streams`
     WHERE `board_id` = p_board_id AND `is_active` = 1;

    IF v_count > 0 THEN
        SET v_board = p_board_id;
    ELSE
        -- Board not mapped yet (or none given) → the default vocabulary.
        SELECT `id` INTO v_board FROM `boards` WHERE `code` = 'DEFAULT' LIMIT 1;
    END IF;

    SELECT `id`, `board_id`, `canonical`, `label`, `short_label`, `sort_order`
      FROM `streams`
     WHERE `board_id` = v_board AND `is_active` = 1
     ORDER BY `sort_order`, `short_label`;
END$$

-- Distinct canonical values — what cohort/course targeting must offer, so the
-- audience list and the student's stored value can never drift apart. Also the
-- label source when we have to name a stream without knowing the board.
--
-- The label comes from the DEFAULT board, which carries the neutral national
-- wording (PCM, PCB, Commerce). Picking MIN(short_label) instead would resolve
-- science_pcm to "CS-Maths" purely because Tamil Nadu sorts early — a national
-- fallback should not speak one state's dialect.
DROP PROCEDURE IF EXISTS `sp_streams_canonical_list`$$
CREATE PROCEDURE `sp_streams_canonical_list`()
BEGIN
    SELECT s.`canonical`,
           COALESCE(MAX(CASE WHEN b.`code` = 'DEFAULT' THEN s.`short_label` END),
                    MIN(s.`short_label`)) AS `short_label`,
           MIN(s.`sort_order`) AS `sort_order`
      FROM `streams` s
      JOIN `boards` b ON b.`id` = s.`board_id`
     WHERE s.`is_active` = 1
     GROUP BY s.`canonical`
     ORDER BY `sort_order`, s.`canonical`;
END$$

DELIMITER ;
