-- ============================================================
-- SKOVO — multi-session cohorts (cohort_sessions endpoint procs)
-- Additive: a cohort with no rows here stays a single-session cohort.
-- ============================================================

DELIMITER $$

-- All sessions for a cohort, in schedule order.
DROP PROCEDURE IF EXISTS `sp_cohort_sessions_list`$$
CREATE PROCEDURE `sp_cohort_sessions_list`(IN p_cohort_id CHAR(36))
BEGIN
    SELECT id, cohort_id, title, session_date, duration_minutes, meeting_link,
           sort_order, status, created_at
      FROM `cohort_sessions`
     WHERE cohort_id = p_cohort_id AND deleted_at IS NULL
     ORDER BY sort_order ASC, session_date ASC;
END$$

DROP PROCEDURE IF EXISTS `sp_cohort_sessions_create`$$
CREATE PROCEDURE `sp_cohort_sessions_create`(
    IN p_id CHAR(36), IN p_cohort_id CHAR(36), IN p_title VARCHAR(300),
    IN p_session_date DATETIME, IN p_duration INT, IN p_meeting_link VARCHAR(500),
    IN p_sort_order INT
)
BEGIN
    IF p_id IS NULL OR p_id = '' THEN SET p_id = UUID(); END IF;
    INSERT INTO `cohort_sessions`
        (id, cohort_id, title, session_date, duration_minutes, meeting_link, sort_order, status)
    VALUES (p_id, p_cohort_id, p_title, p_session_date, IFNULL(p_duration,90),
            p_meeting_link, IFNULL(p_sort_order,0), 'upcoming');
    SELECT p_id AS id;
END$$

DROP PROCEDURE IF EXISTS `sp_cohort_sessions_update`$$
CREATE PROCEDURE `sp_cohort_sessions_update`(
    IN p_id CHAR(36), IN p_cohort_id CHAR(36), IN p_title VARCHAR(300),
    IN p_session_date DATETIME, IN p_duration INT, IN p_meeting_link VARCHAR(500),
    IN p_sort_order INT
)
BEGIN
    UPDATE `cohort_sessions`
       SET title = p_title, session_date = p_session_date,
           duration_minutes = IFNULL(p_duration,90), meeting_link = p_meeting_link,
           sort_order = IFNULL(p_sort_order, sort_order)
     WHERE id = p_id AND cohort_id = p_cohort_id AND deleted_at IS NULL;
    SELECT ROW_COUNT() AS updated;
END$$

DROP PROCEDURE IF EXISTS `sp_cohort_sessions_delete`$$
CREATE PROCEDURE `sp_cohort_sessions_delete`(IN p_id CHAR(36), IN p_cohort_id CHAR(36))
BEGIN
    UPDATE `cohort_sessions` SET deleted_at = UTC_TIMESTAMP()
     WHERE id = p_id AND cohort_id = p_cohort_id;
    SELECT ROW_COUNT() AS deleted;
END$$

DELIMITER ;
