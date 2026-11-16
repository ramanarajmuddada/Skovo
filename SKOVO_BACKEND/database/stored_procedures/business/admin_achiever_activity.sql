-- ============================================================
-- SKOVO — Admin Achievers directory + post-probation activity
-- ============================================================
-- The Achievers screen is the directory of people already on the platform.
-- Documents and Approve live on Achiever Review. This file is everything
-- after that: what they created, who joined, the 1-on-1s, and the reviews.
--
-- Two shapes, on purpose:
--   * directory  — one row per achiever so the table can be scanned
--   * activity   — four calls when a row is opened, so the list stays cheap
-- ============================================================

DELIMITER $$

DROP PROCEDURE IF EXISTS `sp_admin_achievers_directory`$$
CREATE PROCEDURE `sp_admin_achievers_directory`(
    IN p_limit  INT,
    IN p_offset INT
)
BEGIN
    IF p_limit IS NULL OR p_limit <= 0 THEN SET p_limit = 50; END IF;
    IF p_offset IS NULL OR p_offset < 0 THEN SET p_offset = 0; END IF;

    SELECT
        a.*,
        IFNULL(ch.cohorts_created, 0)     AS cohorts_created,
        IFNULL(ch.students_joined, 0)     AS students_joined,
        IFNULL(se.sessions_1on1, 0)       AS sessions_1on1,
        IFNULL(se.sessions_completed, 0)  AS sessions_completed,
        IFNULL(rv.avg_rating, 0)          AS avg_rating,
        IFNULL(rv.review_count, 0)        AS review_count
      FROM `achievers` a
      LEFT JOIN (
            SELECT c.achiever_id,
                   COUNT(DISTINCT c.id) AS cohorts_created,
                   COUNT(DISTINCT CASE
                       WHEN e.payment_status IN ('paid', 'free') THEN e.user_id
                   END) AS students_joined
              FROM `cohorts` c
              LEFT JOIN `cohort_enrollments` e ON e.cohort_id = c.id
             WHERE c.deleted_at IS NULL
             GROUP BY c.achiever_id
      ) ch ON ch.achiever_id = a.id
      LEFT JOIN (
            SELECT mentor_id,
                   COUNT(*) AS sessions_1on1,
                   SUM(status = 'completed') AS sessions_completed
              FROM `achiever_sessions`
             GROUP BY mentor_id
      ) se ON se.mentor_id = a.id
      LEFT JOIN (
            SELECT achiever_id,
                   ROUND(AVG(rating), 1) AS avg_rating,
                   COUNT(*) AS review_count
              FROM `achiever_reviews`
             WHERE is_active = 1
             GROUP BY achiever_id
      ) rv ON rv.achiever_id = a.id
     WHERE a.is_active = 1
     ORDER BY a.created_at DESC
     LIMIT p_limit OFFSET p_offset;
END$$


DROP PROCEDURE IF EXISTS `sp_admin_achiever_activity_summary`$$
CREATE PROCEDURE `sp_admin_achiever_activity_summary`(IN p_achiever_id CHAR(36))
BEGIN
    SELECT
        a.id, a.full_name, a.email, a.phone, a.state, a.standing,
        a.designation, a.company, a.linkedin_url,
        IFNULL(ch.cohorts_created, 0)       AS cohorts_created,
        IFNULL(ch.cohorts_live, 0)          AS cohorts_live,
        IFNULL(ch.cohorts_completed, 0)     AS cohorts_completed,
        IFNULL(ch.students_joined, 0)       AS students_joined,
        IFNULL(ch.students_attended, 0)     AS students_attended,
        IFNULL(se.sessions_total, 0)        AS sessions_total,
        IFNULL(se.sessions_completed, 0)    AS sessions_completed,
        IFNULL(se.sessions_upcoming, 0)     AS sessions_upcoming,
        IFNULL(se.sessions_cancelled, 0)    AS sessions_cancelled,
        IFNULL(rv.avg_rating, 0)            AS avg_rating,
        IFNULL(rv.review_count, 0)          AS review_count
      FROM `achievers` a
      LEFT JOIN (
            SELECT c.achiever_id,
                   COUNT(DISTINCT c.id) AS cohorts_created,
                   COUNT(DISTINCT CASE WHEN c.status = 'live' THEN c.id END) AS cohorts_live,
                   COUNT(DISTINCT CASE WHEN c.status = 'completed' THEN c.id END) AS cohorts_completed,
                   COUNT(DISTINCT CASE
                       WHEN e.payment_status IN ('paid', 'free') THEN e.user_id
                   END) AS students_joined,
                   COUNT(DISTINCT CASE
                       WHEN e.attended = 1 THEN e.user_id
                   END) AS students_attended
              FROM `cohorts` c
              LEFT JOIN `cohort_enrollments` e ON e.cohort_id = c.id
             WHERE c.achiever_id = p_achiever_id
               AND c.deleted_at IS NULL
             GROUP BY c.achiever_id
      ) ch ON ch.achiever_id = a.id
      LEFT JOIN (
            SELECT mentor_id,
                   COUNT(*) AS sessions_total,
                   SUM(status = 'completed') AS sessions_completed,
                   SUM(status IN ('pending', 'confirmed')) AS sessions_upcoming,
                   SUM(status = 'cancelled') AS sessions_cancelled
              FROM `achiever_sessions`
             WHERE mentor_id = p_achiever_id
             GROUP BY mentor_id
      ) se ON se.mentor_id = a.id
      LEFT JOIN (
            SELECT achiever_id,
                   ROUND(AVG(rating), 1) AS avg_rating,
                   COUNT(*) AS review_count
              FROM `achiever_reviews`
             WHERE achiever_id = p_achiever_id AND is_active = 1
             GROUP BY achiever_id
      ) rv ON rv.achiever_id = a.id
     WHERE a.id = p_achiever_id;
END$$


DROP PROCEDURE IF EXISTS `sp_admin_achiever_activity_cohorts`$$
CREATE PROCEDURE `sp_admin_achiever_activity_cohorts`(IN p_achiever_id CHAR(36))
BEGIN
    SELECT
        c.id, c.title, c.status, c.session_date, c.price,
        c.total_seats, c.filled_seats,
        COUNT(DISTINCT CASE
            WHEN e.payment_status IN ('paid', 'free') THEN e.user_id
        END) AS students_joined,
        SUM(CASE WHEN e.attended = 1 THEN 1 ELSE 0 END) AS students_attended
      FROM `cohorts` c
      LEFT JOIN `cohort_enrollments` e ON e.cohort_id = c.id
     WHERE c.achiever_id = p_achiever_id
       AND c.deleted_at IS NULL
     GROUP BY c.id, c.title, c.status, c.session_date, c.price,
              c.total_seats, c.filled_seats, c.created_at
     ORDER BY c.session_date DESC, c.created_at DESC
     LIMIT 100;
END$$


DROP PROCEDURE IF EXISTS `sp_admin_achiever_activity_students`$$
CREATE PROCEDURE `sp_admin_achiever_activity_students`(IN p_achiever_id CHAR(36))
BEGIN
    SELECT
        e.id,
        e.user_id,
        IFNULL(u.full_name, 'Student') AS student_name,
        u.email                        AS student_email,
        c.id                           AS cohort_id,
        c.title                        AS cohort_title,
        e.payment_status,
        e.attended,
        e.enrolled_at
      FROM `cohort_enrollments` e
      JOIN `cohorts` c ON c.id = e.cohort_id
      LEFT JOIN `users` u ON u.id = e.user_id
     WHERE c.achiever_id = p_achiever_id
       AND c.deleted_at IS NULL
       AND e.payment_status IN ('paid', 'free')
     ORDER BY e.enrolled_at DESC
     LIMIT 200;
END$$


DROP PROCEDURE IF EXISTS `sp_admin_achiever_activity_sessions`$$
CREATE PROCEDURE `sp_admin_achiever_activity_sessions`(IN p_achiever_id CHAR(36))
BEGIN
    SELECT
        s.id,
        s.status,
        IFNULL(s.is_demo, 0) AS is_demo,
        s.amount,
        s.payment_status,
        s.student_id,
        IFNULL(u.full_name, 'Student') AS student_name,
        s.created_at,
        CASE WHEN sl.slot_date IS NOT NULL AND sl.start_time IS NOT NULL
             THEN TIMESTAMP(sl.slot_date, sl.start_time) END AS scheduled_at
      FROM `achiever_sessions` s
      LEFT JOIN `users` u ON u.id = s.student_id
      LEFT JOIN `achiever_slots` sl ON sl.session_id = s.id
        AND (s.proposed_slot_id IS NULL OR sl.id <> s.proposed_slot_id)
     WHERE s.mentor_id = p_achiever_id
     ORDER BY COALESCE(TIMESTAMP(sl.slot_date, sl.start_time), s.created_at) DESC
     LIMIT 100;
END$$


DROP PROCEDURE IF EXISTS `sp_admin_achiever_activity_reviews`$$
CREATE PROCEDURE `sp_admin_achiever_activity_reviews`(IN p_achiever_id CHAR(36))
BEGIN
    SELECT
        r.id,
        r.rating,
        r.review_text,
        r.context_type,
        r.context_id,
        r.created_at,
        IFNULL(u.full_name, 'Student') AS student_name
      FROM `achiever_reviews` r
      LEFT JOIN `users` u ON u.id = r.user_id
     WHERE r.achiever_id = p_achiever_id
       AND r.is_active = 1
     ORDER BY r.created_at DESC
     LIMIT 50;
END$$
