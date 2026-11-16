-- SKOVO stored procedures: admin view of one achiever's cohorts
-- (Admin > Achievers > an achiever > Cohorts / Demos / Reviews)

DELIMITER $$

-- Every cohort the achiever created, with seats, money and rating.
DROP PROCEDURE IF EXISTS `sp_admin_achiever_cohorts`$$
CREATE PROCEDURE `sp_admin_achiever_cohorts`(IN p_achiever CHAR(36))
BEGIN
    SELECT c.id, c.title, c.session_date, c.duration_minutes, c.status, c.price, c.is_demo,
           c.total_seats, c.filled_seats,
           (SELECT COUNT(*) FROM cohort_enrollments e
             WHERE e.cohort_id = c.id AND e.payment_status IN ('paid', 'free')) AS joined,
           (SELECT COUNT(*) FROM cohort_enrollments e
             WHERE e.cohort_id = c.id AND e.payment_status IN ('paid', 'free') AND e.attended = 1) AS attended,
           (SELECT IFNULL(SUM(e.amount_paid), 0) FROM cohort_enrollments e
             WHERE e.cohort_id = c.id AND e.payment_status = 'paid') AS collected,
           (SELECT IFNULL(SUM(e.achiever_earning), 0) FROM cohort_enrollments e
             WHERE e.cohort_id = c.id AND e.payment_status = 'paid') AS earned,
           (SELECT ROUND(AVG(r.rating), 1) FROM achiever_reviews r
             WHERE r.context_type = 'cohort' AND r.context_id = c.id) AS avg_rating,
           (SELECT COUNT(*) FROM achiever_reviews r
             WHERE r.context_type = 'cohort' AND r.context_id = c.id) AS reviews
      FROM cohorts c
     WHERE c.achiever_id = p_achiever AND c.deleted_at IS NULL
     ORDER BY c.session_date DESC;
END$$

-- One cohort: every student who joined, their payment and their review.
DROP PROCEDURE IF EXISTS `sp_admin_achiever_cohort_students`$$
CREATE PROCEDURE `sp_admin_achiever_cohort_students`(IN p_achiever CHAR(36), IN p_cohort CHAR(36))
BEGIN
    SELECT e.id AS enrollment_id, e.user_id, u.full_name, u.email, e.enrolled_at, e.attended, e.payment_status,
           c.price, e.coupon_code, e.discount_amount, e.offer_applied, e.amount_paid, e.achiever_earning, e.platform_fee,
           e.cancelled_at, r.rating, r.review_text
      FROM cohort_enrollments e
      JOIN cohorts c ON c.id = e.cohort_id AND c.achiever_id = p_achiever
      JOIN users u ON u.id = e.user_id
      LEFT JOIN achiever_reviews r ON r.context_type = 'cohort' AND r.context_id = e.cohort_id
                                  AND r.user_id = e.user_id
     WHERE e.cohort_id = p_cohort
     ORDER BY u.full_name;
END$$

-- Admin > Bookings > Cohort bookings: one row per class that has bookings,
-- across every achiever. Search matches the class, the achiever, or any
-- student who booked it (name or email), so support can still find a person.
DROP PROCEDURE IF EXISTS `sp_admin_cohort_bookings`$$
CREATE PROCEDURE `sp_admin_cohort_bookings`(IN p_search VARCHAR(120))
BEGIN
    DECLARE v_like VARCHAR(130);
    SET v_like = CONCAT('%', IFNULL(p_search, ''), '%');
    SELECT * FROM (
        -- Classes, deleted ones included: a booking stays listed while money may
        -- still be owed on it.
        SELECT c.id, c.title, c.session_date, c.duration_minutes, c.status, c.price, c.is_demo,
               c.total_seats, c.achiever_id, a.full_name AS achiever_name,
               (c.deleted_at IS NOT NULL) AS deleted, 0 AS gone,
               (SELECT COUNT(*) FROM cohort_enrollments e
                 WHERE e.cohort_id = c.id AND e.payment_status IN ('paid', 'free')) AS joined,
               (SELECT COUNT(*) FROM cohort_enrollments e
                 WHERE e.cohort_id = c.id AND e.payment_status IN ('paid', 'free') AND e.attended = 1) AS attended,
               (SELECT IFNULL(SUM(e.amount_paid), 0) FROM cohort_enrollments e
                 WHERE e.cohort_id = c.id AND e.payment_status = 'paid') AS collected,
               (SELECT IFNULL(SUM(e.achiever_earning), 0) FROM cohort_enrollments e
                 WHERE e.cohort_id = c.id AND e.payment_status = 'paid') AS earned,
               (SELECT IFNULL(SUM(e.amount_paid), 0) FROM cohort_enrollments e
                 WHERE e.cohort_id = c.id AND e.payment_status = 'refunded') AS refunded,
               (SELECT ROUND(AVG(r.rating), 1) FROM achiever_reviews r
                 WHERE r.context_type = 'cohort' AND r.context_id = c.id) AS avg_rating,
               (SELECT COUNT(*) FROM achiever_reviews r
                 WHERE r.context_type = 'cohort' AND r.context_id = c.id) AS reviews,
               (SELECT COUNT(*) FROM cohort_enrollments e WHERE e.cohort_id = c.id) AS bookings
          FROM `cohorts` c
          LEFT JOIN `achievers` a ON a.id = c.achiever_id
         WHERE EXISTS (SELECT 1 FROM cohort_enrollments e0 WHERE e0.cohort_id = c.id)
           AND (p_search IS NULL OR p_search = ''
                OR c.title LIKE v_like OR a.full_name LIKE v_like
                OR EXISTS (SELECT 1 FROM cohort_enrollments e1 JOIN users u1 ON u1.id = e1.user_id
                            WHERE e1.cohort_id = c.id AND (u1.full_name LIKE v_like OR u1.email LIKE v_like)))

        UNION ALL

        -- Bookings whose cohort row is gone altogether: one row per lost cohort.
        SELECT e.cohort_id, 'Deleted cohort', NULL, NULL, 'cancelled', 0, 0,
               NULL, NULL, NULL, 1, 1,
               SUM(e.payment_status IN ('paid', 'free')),
               SUM(e.payment_status IN ('paid', 'free') AND e.attended = 1),
               IFNULL(SUM(CASE WHEN e.payment_status = 'paid' THEN e.amount_paid END), 0),
               IFNULL(SUM(CASE WHEN e.payment_status = 'paid' THEN e.achiever_earning END), 0),
               IFNULL(SUM(CASE WHEN e.payment_status = 'refunded' THEN e.amount_paid END), 0),
               NULL, 0, COUNT(*)
          FROM cohort_enrollments e
          LEFT JOIN `cohorts` c ON c.id = e.cohort_id
          LEFT JOIN `users` u ON u.id = e.user_id
         WHERE c.id IS NULL
           AND (p_search IS NULL OR p_search = '' OR 'Deleted cohort' LIKE v_like
                OR u.full_name LIKE v_like OR u.email LIKE v_like)
         GROUP BY e.cohort_id
    ) AS x
    ORDER BY (x.session_date IS NULL), x.session_date DESC
    LIMIT 1000;
END$$

DELIMITER ;
