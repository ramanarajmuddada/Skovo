-- SKOVO — achiever earnings over time
--
-- The dashboard's line chart and every "x% from last period" needs a series, and
-- nothing returned one: the earnings endpoint reports totals only. Without this
-- those tiles can only be filled with invented numbers.
--
-- The three revenue lines each keep their own `achiever_earning` and a paid-on
-- date, so the series is a UNION of them bucketed by day. Only rows that were
-- actually paid count — a pending enrolment is not earnings.
--
-- The window is an explicit from/to rather than "N days back", so the dashboard
-- can offer a real date-range picker. Both bounds are inclusive: a user who picks
-- 1 Mar – 31 Mar means March, not March minus its last day.
--
-- Returns one row per (day, source) that has money; days with none are absent.
-- The caller fills the gaps, because a chart needs every day present and SQL
-- has no calendar table here.
--
-- sp_achiever_earnings_series  — daily buckets across [from, to]
-- sp_achiever_earnings_totals  — that window vs the equal-length one before it

DELIMITER $$

DROP PROCEDURE IF EXISTS `sp_achiever_earnings_series`$$
CREATE PROCEDURE `sp_achiever_earnings_series`(
    IN p_achiever_id CHAR(36), IN p_from DATE, IN p_to DATE)
BEGIN
    DECLARE v_from DATE;
    DECLARE v_to   DATE;

    SET v_to   = IFNULL(p_to, CURDATE());
    SET v_from = IFNULL(p_from, DATE_SUB(v_to, INTERVAL 30 DAY));

    -- A reversed range is a picker mistake, not a query with no answer.
    IF v_from > v_to THEN
        SET @swap = v_from; SET v_from = v_to; SET v_to = @swap;
    END IF;

    SELECT `day`, `source`, SUM(`earned`) AS `earned`
      FROM (
        -- Cohort seats
        SELECT DATE(e.`enrolled_at`) AS `day`, 'cohorts' AS `source`,
               IFNULL(e.`achiever_earning`, 0) AS `earned`
          FROM `cohort_enrollments` e
          JOIN `cohorts` c ON c.`id` = e.`cohort_id`
         WHERE c.`achiever_id` = p_achiever_id
           AND e.`payment_status` = 'paid'
           AND DATE(e.`enrolled_at`) BETWEEN v_from AND v_to

        UNION ALL

        -- Course sales
        SELECT DATE(ce.`enrolled_at`), 'courses',
               IFNULL(ce.`achiever_earning`, 0)
          FROM `course_enrollments` ce
          JOIN `achiever_courses` cc ON cc.`id` = ce.`course_id`
         WHERE cc.`achiever_id` = p_achiever_id
           AND ce.`payment_status` = 'paid'
           AND DATE(ce.`enrolled_at`) BETWEEN v_from AND v_to

        UNION ALL

        -- 1-on-1 sessions
        SELECT DATE(s.`created_at`), 'sessions',
               IFNULL(s.`achiever_earning`, 0)
          FROM `achiever_sessions` s
         WHERE s.`mentor_id` = p_achiever_id
           AND s.`payment_status` = 'paid'
           AND DATE(s.`created_at`) BETWEEN v_from AND v_to
      ) x
     GROUP BY `day`, `source`
     ORDER BY `day`, `source`;
END$$


-- The chosen window against the equal-length window immediately before it, so
-- "1 Mar – 31 Mar" is compared with the 31 days that preceded 1 Mar. Two numbers
-- per side, so the tile shows a real delta instead of a decorative arrow.
DROP PROCEDURE IF EXISTS `sp_achiever_earnings_totals`$$
CREATE PROCEDURE `sp_achiever_earnings_totals`(
    IN p_achiever_id CHAR(36), IN p_from DATE, IN p_to DATE)
BEGIN
    DECLARE v_from DATE;
    DECLARE v_to   DATE;
    DECLARE v_span INT;
    DECLARE v_prev DATE;

    SET v_to   = IFNULL(p_to, CURDATE());
    SET v_from = IFNULL(p_from, DATE_SUB(v_to, INTERVAL 30 DAY));
    IF v_from > v_to THEN
        SET @swap = v_from; SET v_from = v_to; SET v_to = @swap;
    END IF;

    -- Inclusive span: 1 Mar–31 Mar is 31 days, so the comparison window is the
    -- 31 days ending the day before v_from.
    SET v_span = DATEDIFF(v_to, v_from) + 1;
    SET v_prev = DATE_SUB(v_from, INTERVAL v_span DAY);

    SELECT
        SUM(CASE WHEN `day` >= v_from THEN `earned` ELSE 0 END)  AS `current_earned`,
        SUM(CASE WHEN `day` <  v_from THEN `earned` ELSE 0 END)  AS `previous_earned`,
        SUM(CASE WHEN `day` >= v_from THEN `cnt`    ELSE 0 END)  AS `current_count`,
        SUM(CASE WHEN `day` <  v_from THEN `cnt`    ELSE 0 END)  AS `previous_count`
      FROM (
        SELECT DATE(e.`enrolled_at`) AS `day`, IFNULL(e.`achiever_earning`,0) AS `earned`, 1 AS `cnt`
          FROM `cohort_enrollments` e
          JOIN `cohorts` c ON c.`id` = e.`cohort_id`
         WHERE c.`achiever_id` = p_achiever_id AND e.`payment_status` = 'paid'
           AND DATE(e.`enrolled_at`) BETWEEN v_prev AND v_to
        UNION ALL
        SELECT DATE(ce.`enrolled_at`), IFNULL(ce.`achiever_earning`,0), 1
          FROM `course_enrollments` ce
          JOIN `achiever_courses` cc ON cc.`id` = ce.`course_id`
         WHERE cc.`achiever_id` = p_achiever_id AND ce.`payment_status` = 'paid'
           AND DATE(ce.`enrolled_at`) BETWEEN v_prev AND v_to
        UNION ALL
        SELECT DATE(s.`created_at`), IFNULL(s.`achiever_earning`,0), 1
          FROM `achiever_sessions` s
         WHERE s.`mentor_id` = p_achiever_id AND s.`payment_status` = 'paid'
           AND DATE(s.`created_at`) BETWEEN v_prev AND v_to
      ) y;
END$$

DELIMITER ;
