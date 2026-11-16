-- BhaAI v1: the daily allowance, and the rows its fact sheet reads.

DELIMITER $$

-- Questions that count today: done, or still in flight. p_since is the start
-- of the student's day (IST) in UTC, worked out by the caller.
DROP PROCEDURE IF EXISTS `sp_bhaai_usage_count`$$
CREATE PROCEDURE `sp_bhaai_usage_count`(IN p_user CHAR(36), IN p_since DATETIME)
BEGIN
    SELECT COUNT(*) AS used
      FROM `bhaai_usage`
     WHERE user_id = p_user AND created_at >= p_since AND status <> 'failed';
END$$

-- Take one question from the allowance before the model is called, so two
-- quick sends cannot both slip under the cap. reserved = 0 means the cap is
-- already reached and nothing was written.
DROP PROCEDURE IF EXISTS `sp_bhaai_usage_reserve`$$
CREATE PROCEDURE `sp_bhaai_usage_reserve`(
    IN p_id CHAR(36), IN p_user CHAR(36), IN p_model VARCHAR(100),
    IN p_since DATETIME, IN p_limit INT
)
BEGIN
    DECLARE v_used INT DEFAULT 0;
    SELECT COUNT(*) INTO v_used
      FROM `bhaai_usage`
     WHERE user_id = p_user AND created_at >= p_since AND status <> 'failed';
    IF v_used < p_limit THEN
        INSERT INTO `bhaai_usage` (id, user_id, model, status, created_at, updated_at)
        VALUES (p_id, p_user, p_model, 'pending', UTC_TIMESTAMP(), UTC_TIMESTAMP());
        SELECT 1 AS reserved, v_used + 1 AS used;
    ELSE
        SELECT 0 AS reserved, v_used AS used;
    END IF;
END$$

DROP PROCEDURE IF EXISTS `sp_bhaai_usage_finish`$$
CREATE PROCEDURE `sp_bhaai_usage_finish`(
    IN p_id CHAR(36), IN p_status VARCHAR(10), IN p_in INT, IN p_out INT
)
BEGIN
    UPDATE `bhaai_usage`
       SET status = p_status, input_tokens = p_in, output_tokens = p_out,
           updated_at = UTC_TIMESTAMP()
     WHERE id = p_id;
    SELECT ROW_COUNT() AS updated;
END$$

-- Cohorts the student is in (paid or free), newest session first. Titles and
-- dates only: the fact sheet never carries meeting links or prices.
DROP PROCEDURE IF EXISTS `sp_bhaai_cohorts`$$
CREATE PROCEDURE `sp_bhaai_cohorts`(IN p_user CHAR(36))
BEGIN
    SELECT c.title, c.session_date, IFNULL(e.attended, 0) AS attended
      FROM `cohort_enrollments` e
      JOIN `cohorts` c ON c.id = e.cohort_id
     WHERE e.user_id = p_user
       AND e.payment_status IN ('paid', 'free')
       AND e.cancelled_at IS NULL
       AND c.deleted_at IS NULL
     ORDER BY c.session_date DESC
     LIMIT 8;
END$$

DELIMITER ;
