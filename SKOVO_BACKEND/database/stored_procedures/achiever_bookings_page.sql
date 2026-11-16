-- SKOVO — paged, filtered reads for the achiever Bookings screen
--
-- The three tabs were each served by pulling whole tables through the generic
-- CRUD procs and joining them in Python: `sp_achiever_sessions_list(50000)` plus
-- `sp_users_list(50000)` plus `sp_achiever_slots_list(50000)` on EVERY request,
-- then filtering down to one achiever. That is three full table scans and a
-- 50k-row transfer to answer a question about ~50 rows, and it degrades for
-- every achiever as the platform grows, not just the busy ones.
--
-- These procedures do the filtering, joining, ordering and paging in SQL, so the
-- server returns exactly the page the screen draws.
--
-- Each page proc returns `total_rows` via COUNT(*) OVER() — the count of rows
-- matching the filter before the LIMIT — so the caller gets the page and the
-- pagination total in one round trip.
--
-- Date windows are inclusive on both ends and match the screen's own filter:
--   sessions   → the booked slot's datetime, falling back to created_at
--   enrolments → enrolled_at
--   purchases  → enrolled_at
--
-- Search is a case-insensitive substring over the columns the screen shows.
-- An empty/NULL search matches everything rather than nothing.

DELIMITER $$

-- ------------------------------------------------------------
-- 1-on-1 sessions, one page
-- ------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_achiever_bookings_page`$$
CREATE PROCEDURE `sp_achiever_bookings_page`(
    IN p_achiever_id CHAR(36),
    IN p_from        DATE,
    IN p_to          DATE,
    IN p_status      VARCHAR(20),   -- NULL/'' /'all' = every status
    IN p_search      VARCHAR(200),
    IN p_limit       INT,
    IN p_offset      INT
)
BEGIN
    DECLARE v_from DATE; DECLARE v_to DATE;
    DECLARE v_like VARCHAR(202);
    DECLARE v_limit INT; DECLARE v_offset INT;

    SET v_to   = IFNULL(p_to, CURDATE());
    SET v_from = IFNULL(p_from, DATE_SUB(v_to, INTERVAL 30 DAY));
    IF v_from > v_to THEN SET @s = v_from; SET v_from = v_to; SET v_to = @s; END IF;
    SET v_like = CONCAT('%', IFNULL(p_search, ''), '%');
    -- Clamped: a page is between 1 and 200 rows whatever the caller asks for.
    SET v_limit  = LEAST(GREATEST(IFNULL(p_limit, 20), 1), 200);
    SET v_offset = GREATEST(IFNULL(p_offset, 0), 0);

    SELECT
        s.`id`,
        s.`student_id`,
        IFNULL(u.`full_name`, 'Unknown')        AS `student_name`,
        u.`email`                               AS `student_email`,
        s.`note`,
        s.`mentor_notes`,
        s.`status`,
        s.`meeting_link`,
        s.`amount`,
        s.`achiever_earning`,
        s.`platform_fee`,
        s.`payment_status`,
        s.`proposed_slot_id`,
        -- achiever_sessions has no duration column -- duration_minutes lives on
        -- cohorts and mock tests, not on 1-on-1s -- so selecting s.duration_minutes
        -- made this procedure fail outright with 1054 and the Bookings screen show
        -- "We couldn't load this". The booked slot carries the times, exactly as it
        -- carries the date below, so the length comes from there.
        CASE WHEN sl.`start_time` IS NOT NULL AND sl.`end_time` IS NOT NULL
             THEN TIMESTAMPDIFF(MINUTE, sl.`start_time`, sl.`end_time`)
        END                                     AS `duration_minutes`,
        s.`created_at`,
        -- AchieverSessions has no time column; the booked slot carries it.
        CASE WHEN sl.`slot_date` IS NOT NULL AND sl.`start_time` IS NOT NULL
             THEN TIMESTAMP(sl.`slot_date`, sl.`start_time`) END AS `scheduled_at`,
        ps.`slot_date`  AS `proposed_slot_date`,
        ps.`start_time` AS `proposed_slot_start`,
        COUNT(*) OVER () AS `total_rows`
      FROM `achiever_sessions` s
      LEFT JOIN `users` u          ON u.`id` = s.`student_id`
      LEFT JOIN `achiever_slots` sl ON sl.`session_id` = s.`id`
        AND (s.`proposed_slot_id` IS NULL OR sl.`id` <> s.`proposed_slot_id`)
      LEFT JOIN `achiever_slots` ps ON ps.`id` = s.`proposed_slot_id`
     WHERE s.`mentor_id` = p_achiever_id
       -- Filtered on when the booking was MADE, not when it is scheduled. A
       -- session booked today for next week has a future scheduled_at, and the
       -- window cannot end later than today — filtering on that date hid every
       -- upcoming session, which is precisely what this screen exists to show.
       AND DATE(s.`created_at`) BETWEEN v_from AND v_to
       AND (p_status IS NULL OR p_status = '' OR p_status = 'all' OR s.`status` = p_status)
       AND (IFNULL(p_search, '') = ''
            OR u.`full_name` LIKE v_like
            OR u.`email`     LIKE v_like
            OR s.`note`      LIKE v_like)
     ORDER BY COALESCE(TIMESTAMP(sl.`slot_date`, sl.`start_time`), s.`created_at`) DESC
     LIMIT v_limit OFFSET v_offset;
END$$


-- Status tallies for the cards. Scoped to the date window but NOT to the status
-- filter or the search — the cards say what the period holds, and filtering them
-- by the same status they are meant to summarise would make them tautological.
DROP PROCEDURE IF EXISTS `sp_achiever_bookings_stats`$$
CREATE PROCEDURE `sp_achiever_bookings_stats`(
    IN p_achiever_id CHAR(36), IN p_from DATE, IN p_to DATE)
BEGIN
    DECLARE v_from DATE; DECLARE v_to DATE;
    SET v_to   = IFNULL(p_to, CURDATE());
    SET v_from = IFNULL(p_from, DATE_SUB(v_to, INTERVAL 30 DAY));
    IF v_from > v_to THEN SET @s = v_from; SET v_from = v_to; SET v_to = @s; END IF;

    SELECT
        SUM(s.`status` = 'pending')   AS `pending`,
        SUM(s.`status` = 'confirmed') AS `confirmed`,
        SUM(s.`status` = 'completed') AS `completed`,
        COUNT(*)                      AS `total`
      FROM `achiever_sessions` s
      LEFT JOIN `achiever_slots` sl ON sl.`session_id` = s.`id`
     WHERE s.`mentor_id` = p_achiever_id
       -- Filtered on when the booking was MADE, not when it is scheduled. A
       -- session booked today for next week has a future scheduled_at, and the
       -- window cannot end later than today — filtering on that date hid every
       -- upcoming session, which is precisely what this screen exists to show.
       AND DATE(s.`created_at`) BETWEEN v_from AND v_to;
END$$


-- ------------------------------------------------------------
-- Cohort enrolments, one page
-- ------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_achiever_enrollments_page`$$
CREATE PROCEDURE `sp_achiever_enrollments_page`(
    IN p_achiever_id CHAR(36),
    IN p_from        DATE,
    IN p_to          DATE,
    IN p_status      VARCHAR(20),   -- payment_status
    IN p_search      VARCHAR(200),
    IN p_limit       INT,
    IN p_offset      INT
)
BEGIN
    DECLARE v_from DATE; DECLARE v_to DATE;
    DECLARE v_like VARCHAR(202);
    DECLARE v_limit INT; DECLARE v_offset INT;
    SET v_to   = IFNULL(p_to, CURDATE());
    SET v_from = IFNULL(p_from, DATE_SUB(v_to, INTERVAL 30 DAY));
    IF v_from > v_to THEN SET @s = v_from; SET v_from = v_to; SET v_to = @s; END IF;
    SET v_like = CONCAT('%', IFNULL(p_search, ''), '%');
    -- Clamped: a page is between 1 and 200 rows whatever the caller asks for.
    SET v_limit  = LEAST(GREATEST(IFNULL(p_limit, 20), 1), 200);
    SET v_offset = GREATEST(IFNULL(p_offset, 0), 0);

    SELECT
        e.`id`            AS `enrollment_id`,
        e.`user_id`,
        u.`full_name`,
        u.`email`,
        c.`id`            AS `cohort_id`,
        c.`title`         AS `cohort_title`,
        e.`payment_status`,
        e.`amount_paid`,
        e.`achiever_earning`,
        e.`attended`,
        e.`enrolled_at`,
        c.`session_date`     AS `session_date`,
        c.`status`           AS `cohort_status`,
        c.`meeting_link`     AS `meeting_link`,
        c.`duration_minutes` AS `duration_minutes`,
        COUNT(*) OVER ()  AS `total_rows`
      FROM `cohort_enrollments` e
      JOIN `cohorts` c ON c.`id` = e.`cohort_id`
      LEFT JOIN `users` u ON u.`id` = e.`user_id`
     WHERE c.`achiever_id` = p_achiever_id
       AND c.`deleted_at` IS NULL
       AND DATE(e.`enrolled_at`) BETWEEN v_from AND v_to
       AND (p_status IS NULL OR p_status = '' OR p_status = 'all' OR e.`payment_status` = p_status)
       AND (IFNULL(p_search, '') = ''
            OR u.`full_name` LIKE v_like
            OR u.`email`     LIKE v_like
            OR c.`title`     LIKE v_like)
     ORDER BY e.`enrolled_at` DESC
     LIMIT v_limit OFFSET v_offset;
END$$


DROP PROCEDURE IF EXISTS `sp_achiever_enrollments_stats`$$
CREATE PROCEDURE `sp_achiever_enrollments_stats`(
    IN p_achiever_id CHAR(36), IN p_from DATE, IN p_to DATE)
BEGIN
    DECLARE v_from DATE; DECLARE v_to DATE;
    SET v_to   = IFNULL(p_to, CURDATE());
    SET v_from = IFNULL(p_from, DATE_SUB(v_to, INTERVAL 30 DAY));
    IF v_from > v_to THEN SET @s = v_from; SET v_from = v_to; SET v_to = @s; END IF;

    SELECT
        SUM(e.`payment_status` = 'paid') AS `paid`,
        SUM(e.`payment_status` = 'free') AS `free`,
        COUNT(*)                         AS `total`
      FROM `cohort_enrollments` e
      JOIN `cohorts` c ON c.`id` = e.`cohort_id`
     WHERE c.`achiever_id` = p_achiever_id
       AND c.`deleted_at` IS NULL
       AND DATE(e.`enrolled_at`) BETWEEN v_from AND v_to;
END$$


-- ------------------------------------------------------------
-- Course purchases, one page
-- ------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_achiever_purchases_page`$$
CREATE PROCEDURE `sp_achiever_purchases_page`(
    IN p_achiever_id CHAR(36),
    IN p_from        DATE,
    IN p_to          DATE,
    IN p_search      VARCHAR(200),
    IN p_limit       INT,
    IN p_offset      INT
)
BEGIN
    DECLARE v_from DATE; DECLARE v_to DATE;
    DECLARE v_like VARCHAR(202);
    DECLARE v_limit INT; DECLARE v_offset INT;
    SET v_to   = IFNULL(p_to, CURDATE());
    SET v_from = IFNULL(p_from, DATE_SUB(v_to, INTERVAL 30 DAY));
    IF v_from > v_to THEN SET @s = v_from; SET v_from = v_to; SET v_to = @s; END IF;
    SET v_like = CONCAT('%', IFNULL(p_search, ''), '%');
    -- Clamped: a page is between 1 and 200 rows whatever the caller asks for.
    SET v_limit  = LEAST(GREATEST(IFNULL(p_limit, 20), 1), 200);
    SET v_offset = GREATEST(IFNULL(p_offset, 0), 0);

    SELECT
        ce.`id`            AS `enrollment_id`,
        ce.`user_id`,
        u.`full_name`      AS `student_name`,
        u.`email`          AS `student_email`,
        ac.`id`            AS `course_id`,
        ac.`title`         AS `course_title`,
        ce.`payment_status`,
        ce.`amount_paid`,
        ce.`achiever_earning`,
        ce.`enrolled_at`,
        COUNT(*) OVER ()   AS `total_rows`
      FROM `course_enrollments` ce
      JOIN `achiever_courses` ac ON ac.`id` = ce.`course_id`
      LEFT JOIN `users` u ON u.`id` = ce.`user_id`
     WHERE ac.`achiever_id` = p_achiever_id
       AND ce.`payment_status` IN ('paid', 'free')
       AND DATE(ce.`enrolled_at`) BETWEEN v_from AND v_to
       AND (IFNULL(p_search, '') = ''
            OR u.`full_name` LIKE v_like
            OR u.`email`     LIKE v_like
            OR ac.`title`    LIKE v_like)
     ORDER BY ce.`enrolled_at` DESC
     LIMIT v_limit OFFSET v_offset;
END$$


DROP PROCEDURE IF EXISTS `sp_achiever_purchases_stats`$$
CREATE PROCEDURE `sp_achiever_purchases_stats`(
    IN p_achiever_id CHAR(36), IN p_from DATE, IN p_to DATE)
BEGIN
    DECLARE v_from DATE; DECLARE v_to DATE;
    SET v_to   = IFNULL(p_to, CURDATE());
    SET v_from = IFNULL(p_from, DATE_SUB(v_to, INTERVAL 30 DAY));
    IF v_from > v_to THEN SET @s = v_from; SET v_from = v_to; SET v_to = @s; END IF;

    -- Counts paid + free (a free enrolment is still a purchase on this screen);
    -- earnings sum only what was actually paid, which free rows contribute 0 to.
    SELECT
        COUNT(*)                              AS `total`,
        IFNULL(SUM(ce.`achiever_earning`), 0) AS `total_earning`
      FROM `course_enrollments` ce
      JOIN `achiever_courses` ac ON ac.`id` = ce.`course_id`
     WHERE ac.`achiever_id` = p_achiever_id
       AND ce.`payment_status` IN ('paid', 'free')
       AND DATE(ce.`enrolled_at`) BETWEEN v_from AND v_to;
END$$

DELIMITER ;
