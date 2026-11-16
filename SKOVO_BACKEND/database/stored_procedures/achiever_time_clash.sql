-- SKOVO stored procedures: one achiever cannot teach two things at once.
--
-- Create / Edit cohort asks this before saving. A clash is another of the
-- achiever's cohorts (not cancelled, completed or deleted) or a booked 1-on-1 session
-- whose time overlaps [p_start, p_end). Touching edges (3:00-3:30 and
-- 3:30-4:00) do not clash. Other achievers are never considered.

DELIMITER $$

DROP PROCEDURE IF EXISTS `sp_achiever_time_clash`$$
CREATE PROCEDURE `sp_achiever_time_clash`(
    IN p_achiever CHAR(36), IN p_start DATETIME, IN p_end DATETIME, IN p_exclude_cohort CHAR(36)
)
BEGIN
    SELECT * FROM (
        SELECT 'cohort' AS kind, c.title AS title, c.session_date AS starts_at,
               DATE_ADD(c.session_date, INTERVAL IFNULL(c.duration_minutes, 90) MINUTE) AS ends_at
          FROM `cohorts` c
         WHERE c.achiever_id = p_achiever
           AND c.deleted_at IS NULL
           -- Cancelled never blocks; completed (End session pressed) frees the
           -- rest of its planned time: a class ended at 4:15 of 3:45-4:45 lets
           -- the achiever start another at 4:30.
           AND c.status NOT IN ('cancelled', 'completed')
           AND (p_exclude_cohort IS NULL OR c.id <> p_exclude_cohort)
           AND c.session_date < p_end
           AND DATE_ADD(c.session_date, INTERVAL IFNULL(c.duration_minutes, 90) MINUTE) > p_start

        UNION ALL

        SELECT 'session' AS kind, '1-on-1 session' AS title, s.start_utc AS starts_at, s.end_utc AS ends_at
          FROM `achiever_slots` s
          JOIN `achiever_sessions` x ON x.id = s.session_id
         WHERE s.mentor_id = p_achiever
           AND x.status NOT IN ('cancelled', 'declined', 'rejected', 'expired')
           AND s.start_utc IS NOT NULL
           AND s.start_utc < p_end
           AND s.end_utc > p_start
    ) AS clashes
    ORDER BY starts_at
    LIMIT 1;
END$$

DELIMITER ;
