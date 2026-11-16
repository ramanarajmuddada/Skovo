-- SKOVO — colleges procedures.
--
-- Exported from the live schema by export_missing_procedures.py. These were
-- applied to the database by hand and never written back to source, so a
-- rebuild from this repo produced a database missing them.
--
-- Edit here, not in the database.

DELIMITER $$

DROP PROCEDURE IF EXISTS `sp_college_predict`$$
CREATE PROCEDURE `sp_college_predict`(IN `p_exam` varchar(50), IN `p_rank` int, IN `p_category` varchar(40), IN `p_state` varchar(80), IN `p_limit` int)
BEGIN
              SELECT
                college_name, college_city, college_state, college_type,
                branch_name, category, opening_rank, closing_rank, year,
                CASE
                  WHEN closing_rank >= ROUND(p_rank * 1.30) THEN 'safe'
                  WHEN closing_rank >= p_rank               THEN 'target'
                  ELSE 'reach'
                END AS bucket
              FROM cg_college_cutoffs
              WHERE exam_type = p_exam
                AND (p_category IS NULL OR p_category = '' OR category = p_category)
                AND (p_state    IS NULL OR p_state    = '' OR college_state = p_state)
                -- Include admits (rank within closing) plus near-misses (a Reach
                -- sits just above the opening rank), nothing wildly out of range.
                AND (closing_rank >= p_rank OR opening_rank <= ROUND(p_rank * 1.15))
              ORDER BY closing_rank ASC
              LIMIT p_limit;
            END$$

DROP PROCEDURE IF EXISTS `sp_cutoff_coverage`$$
CREATE PROCEDURE `sp_cutoff_coverage`(IN `p_exam` varchar(50), IN `p_state` varchar(80))
BEGIN
              SELECT
                COUNT(*)                        AS rows_total,
                COUNT(DISTINCT college_name)    AS colleges,
                COUNT(DISTINCT branch_name)     AS branches,
                COUNT(DISTINCT category)        AS categories,
                MIN(year)                       AS earliest_year,
                MAX(year)                       AS latest_year
              FROM cg_college_cutoffs
              WHERE exam_type = p_exam
                AND (p_state IS NULL OR p_state = '' OR college_state = p_state);
            END$$

DROP PROCEDURE IF EXISTS `sp_cutoff_exams`$$
CREATE PROCEDURE `sp_cutoff_exams`()
BEGIN
              SELECT exam_type,
                     COUNT(*)                    AS rows_available,
                     COUNT(DISTINCT college_name) AS colleges,
                     MAX(year)                    AS latest_year
                FROM cg_college_cutoffs
               GROUP BY exam_type
               ORDER BY exam_type;
            END$$

DROP PROCEDURE IF EXISTS `sp_saved_colleges_add`$$
CREATE PROCEDURE `sp_saved_colleges_add`(IN `p_id` char(36), IN `p_user` char(36), IN `p_college` char(36), IN `p_note` text)
BEGIN
      IF EXISTS (SELECT 1 FROM saved_colleges WHERE user_id = p_user AND college_id = p_college) THEN
        SELECT 0 AS added, 'already' AS result;
      ELSE
        INSERT INTO saved_colleges (id, user_id, college_id, note)
        VALUES (p_id, p_user, p_college, p_note);
        SELECT 1 AS added, 'saved' AS result;
      END IF;
    END$$

DROP PROCEDURE IF EXISTS `sp_saved_colleges_count`$$
CREATE PROCEDURE `sp_saved_colleges_count`(IN `p_user` char(36))
BEGIN
      SELECT COUNT(*) AS total FROM saved_colleges WHERE user_id = p_user;
    END$$

DROP PROCEDURE IF EXISTS `sp_saved_colleges_list`$$
CREATE PROCEDURE `sp_saved_colleges_list`(IN `p_user` char(36))
BEGIN
      SELECT c.*, sc.created_at AS saved_at, sc.note
        FROM saved_colleges sc
        JOIN colleges c ON c.id = sc.college_id
       WHERE sc.user_id = p_user
       ORDER BY sc.created_at DESC;
    END$$

DROP PROCEDURE IF EXISTS `sp_saved_colleges_remove`$$
CREATE PROCEDURE `sp_saved_colleges_remove`(IN `p_user` char(36), IN `p_college` char(36))
BEGIN
      DELETE FROM saved_colleges WHERE user_id = p_user AND college_id = p_college;
      SELECT ROW_COUNT() AS removed;
    END$$

DELIMITER ;
