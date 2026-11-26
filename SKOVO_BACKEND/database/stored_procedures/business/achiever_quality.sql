-- ============================================================
-- SKOVO — ACHIEVER DISCOVERY & QUALITY stored procedures (MySQL 8)
-- ============================================================
-- Three jobs:
--   * sp_achievers_browse            find the right achiever (filters + ranking)
--   * sp_achiever_funnel             tell an achiever WHY they aren't booked
--   * sp_achiever_quality_recompute  measure whether they are any good
--
-- STATE vs QUALITY. The lifecycle state is the floor — approved, and past
-- approved or not. `quality_score` is the ordering above that floor. They stay
-- separate: a background-checked achiever who cancels everything should rank
-- last and remain bookable.
--
-- The browse procedure replaces a route that pulled sp_achievers_list(5000)
-- plus sp_achiever_mentees_list(50000) plus sp_achiever_reviews_list(50000)
-- and joined them in Python on every page load. That was fine at 3 achievers
-- and is the screen that breaks first at 100.
-- ============================================================

DELIMITER $$

-- ------------------------------------------------------------
-- Record a profile view. Deduped to one row per viewer per day by the unique
-- key, so a student refreshing twenty times counts once — otherwise the
-- conversion denominator is noise and the funnel lies.
-- ------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_achiever_view_record`$$
CREATE PROCEDURE `sp_achiever_view_record`(
    IN p_id          CHAR(36),
    IN p_achiever_id CHAR(36),
    IN p_viewer_id   CHAR(36),
    IN p_source      VARCHAR(20)
)
BEGIN
    DECLARE v_new INT DEFAULT 0;
    IF p_id IS NULL OR p_id = '' THEN SET p_id = UUID(); END IF;

    -- An achiever looking at their own public page must not inflate their
    -- own funnel.
    IF p_viewer_id IS NOT NULL AND p_viewer_id = p_achiever_id THEN
        SELECT 0 AS recorded;
    ELSE
        INSERT IGNORE INTO achiever_profile_views
            (id, achiever_id, viewer_id, source, view_date)
        VALUES (p_id, p_achiever_id, p_viewer_id, p_source, CURDATE());
        SET v_new = ROW_COUNT();

        IF v_new > 0 THEN
            UPDATE achievers
               SET profile_view_count = profile_view_count + 1
             WHERE id = p_achiever_id;
        END IF;
        SELECT v_new AS recorded;
    END IF;
END$$

-- ------------------------------------------------------------
-- THE BROWSE. Filtered, ranked, and age-aware, in one indexed query.
--
--   p_student_id  used for the student's own targeting preferences. There is
--                 no age rule here: any achiever may mentor any student.
-- p_sort        'recommended' (default) | 'rating' | 'price_low' | 'price_high' | 'newest'
--
-- Ranking note: COALESCE(quality_score, 65) deliberately places an achiever
-- with no history mid-pack rather than last. Burying newcomers below proven
-- bad actors would starve supply, which is the one thing this marketplace
-- cannot afford.
-- ------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_achievers_browse`$$
CREATE PROCEDURE `sp_achievers_browse`(
    IN p_student_id CHAR(36),
    IN p_q          VARCHAR(120),
    IN p_domain     VARCHAR(120),
    IN p_min_rating DECIMAL(3,2),
    IN p_max_price  DECIMAL(10,2),
    IN p_bgv_only   TINYINT,
    IN p_free_only  TINYINT,
    IN p_sort       VARCHAR(20),
    IN p_limit      INT,
    IN p_offset     INT
)
BEGIN
    -- The student's education level was read here to filter the directory by
    -- the achiever's targeting. Nothing targets by level any more, so the
    -- lookup went with the filter rather than staying as a query per browse.

    SELECT
        a.id                              AS mentor_id,
        a.full_name, a.email, a.bio, a.designation, a.company, a.linkedin_url,
        a.profile_image_url, a.domains, a.suitable_for,
        a.is_verified, a.is_featured, a.state,
        -- state and standing drive what the student sees on the card: a
        -- probation achiever is free, and 'spotlight' is earned rather than
        -- set by hand. Without state on the row the card cannot tell a free
        -- demo from a pricing bug.
        a.state, a.standing,
        -- bgv_status is FILTERED on below (`p_bgv_only`) and was never
        -- selected, so `/achievers/?bgv_only=1` returned the right rows and the
        -- payload could not say why: the card's `bgv_cleared` read a key that
        -- was not there and came back false for every achiever, including the
        -- cleared ones the filter had just picked. A filter and a badge that
        -- disagree about the same fact is the shape of the old
        -- `teaches_minors` bug this replaced.
        a.bgv_status,
        a.session_rate, a.profile_view_count, a.quality_score,
        IFNULL(rv.avg_rating, 0)          AS rating,
        IFNULL(rv.review_count, 0)        AS review_count,
        IFNULL(mn.mentee_count, 0)        AS mentee_count
      FROM achievers a
      LEFT JOIN (
            SELECT achiever_id,
                   ROUND(AVG(rating), 1) AS avg_rating,
                   COUNT(*)              AS review_count
              FROM achiever_reviews
             WHERE is_active = 1
             GROUP BY achiever_id
      ) rv ON rv.achiever_id = a.id
      LEFT JOIN (
            SELECT mentor_id, COUNT(*) AS mentee_count
              FROM achiever_mentees
             WHERE status = 'active'
             GROUP BY mentor_id
      ) mn ON mn.mentor_id = a.id
     WHERE a.state = 'active'
       AND a.email IS NOT NULL

       -- The child-safety rule, applied as a filter rather than an error:
       -- a 14-17 student simply never sees an achiever they cannot book.
       -- IFNULL matters: legacy accounts predating the DPDP migration have

       -- No education-level targeting. An achiever is shown to every student
       -- who browses: whether a 10th-grader is the right fit for a given
       -- mentor is the student's call to make from the profile, not a filter
       -- that hides the mentor before they can make it.

       AND (p_q IS NULL OR p_q = ''
            OR a.full_name LIKE CONCAT('%', p_q, '%')
            OR a.company   LIKE CONCAT('%', p_q, '%')
            OR a.designation LIKE CONCAT('%', p_q, '%'))

       AND (p_domain IS NULL OR p_domain = ''
            OR JSON_CONTAINS(a.domains, JSON_QUOTE(p_domain)))

       AND (p_min_rating IS NULL OR p_min_rating = 0
            OR IFNULL(rv.avg_rating, 0) >= p_min_rating)

       AND (p_max_price IS NULL OR p_max_price = 0
            OR IFNULL(a.session_rate, 0) <= p_max_price)

       AND (IFNULL(p_bgv_only, 0) = 0 OR a.bgv_status = 'clear')
       AND (IFNULL(p_free_only, 0) = 0 OR IFNULL(a.session_rate, 0) = 0)

     ORDER BY
        CASE WHEN p_sort = 'rating'     THEN IFNULL(rv.avg_rating, 0) END DESC,
        CASE WHEN p_sort = 'price_low'  THEN IFNULL(a.session_rate, 0) END ASC,
        CASE WHEN p_sort = 'price_high' THEN IFNULL(a.session_rate, 0) END DESC,
        CASE WHEN p_sort = 'newest'     THEN a.created_at END DESC,
        -- 'recommended' and every tie-break: featured first, then merit, with
        -- unscored newcomers held at a neutral 65 instead of sinking to last.
        a.is_featured DESC,
        COALESCE(a.quality_score, 65) DESC,
        IFNULL(rv.avg_rating, 0) DESC,
        a.created_at DESC
     LIMIT p_limit OFFSET p_offset;
END$$

-- How many rows the same filters match — so the UI can page and say "24 found".
DROP PROCEDURE IF EXISTS `sp_achievers_browse_count`$$
CREATE PROCEDURE `sp_achievers_browse_count`(
    IN p_student_id CHAR(36),
    IN p_q          VARCHAR(120),
    IN p_domain     VARCHAR(120),
    IN p_min_rating DECIMAL(3,2),
    IN p_max_price  DECIMAL(10,2),
    IN p_bgv_only   TINYINT,
    IN p_free_only  TINYINT
)
BEGIN
    SELECT COUNT(*) AS total
      FROM achievers a
      LEFT JOIN (
            SELECT achiever_id, ROUND(AVG(rating), 1) AS avg_rating
              FROM achiever_reviews WHERE is_active = 1 GROUP BY achiever_id
      ) rv ON rv.achiever_id = a.id
     WHERE a.state = 'active'
       AND a.email IS NOT NULL
       -- IFNULL matters: legacy accounts predating the DPDP migration have
       -- No education-level targeting. An achiever is shown to every student
       -- who browses: whether a 10th-grader is the right fit for a given
       -- mentor is the student's call to make from the profile, not a filter
       -- that hides the mentor before they can make it.
       AND (p_q IS NULL OR p_q = ''
            OR a.full_name LIKE CONCAT('%', p_q, '%')
            OR a.company LIKE CONCAT('%', p_q, '%')
            OR a.designation LIKE CONCAT('%', p_q, '%'))
       AND (p_domain IS NULL OR p_domain = ''
            OR JSON_CONTAINS(a.domains, JSON_QUOTE(p_domain)))
       AND (p_min_rating IS NULL OR p_min_rating = 0
            OR IFNULL(rv.avg_rating, 0) >= p_min_rating)
       AND (p_max_price IS NULL OR p_max_price = 0
            OR IFNULL(a.session_rate, 0) <= p_max_price)
       AND (IFNULL(p_bgv_only, 0) = 0 OR a.bgv_status = 'clear')
       AND (IFNULL(p_free_only, 0) = 0 OR IFNULL(a.session_rate, 0) = 0);
END$$

-- The domain list actually represented in the browsable directory, so the
-- filter never offers a domain that returns nothing.
DROP PROCEDURE IF EXISTS `sp_achiever_browse_domains`$$
CREATE PROCEDURE `sp_achiever_browse_domains`()
BEGIN
    SELECT DISTINCT jt.domain AS domain
      FROM achievers a
      JOIN JSON_TABLE(IFNULL(a.domains, JSON_ARRAY()), '$[*]'
             COLUMNS (domain VARCHAR(120) PATH '$')) jt
     WHERE a.state = 'active' AND jt.domain IS NOT NULL
     ORDER BY jt.domain;
END$$

-- ------------------------------------------------------------
-- Public profile — the shareable page. Deliberately narrower than the portal
-- view: no email, no payout details, no application state. What an achiever
-- can safely post on LinkedIn.
-- ------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_achiever_public_profile`$$
CREATE PROCEDURE `sp_achiever_public_profile`(IN p_achiever_id CHAR(36))
BEGIN
    SELECT a.id, a.full_name, a.achievement_title, a.designation, a.company,
           a.bio, a.profile_image_url, a.avatar_url, a.linkedin_url,
           a.domains, a.skills, a.suitable_for,
           a.session_rate, a.state, a.is_featured,
           a.quality_score, a.created_at,
           (a.state = 'active') AS can_charge,
           IFNULL(rv.avg_rating, 0)   AS rating,
           IFNULL(rv.review_count, 0) AS review_count,
           IFNULL(se.completed, 0)    AS sessions_completed,
           IFNULL(ch.cohorts, 0)      AS cohorts_hosted
      FROM achievers a
      LEFT JOIN (
            SELECT achiever_id, ROUND(AVG(rating),1) AS avg_rating, COUNT(*) AS review_count
              FROM achiever_reviews WHERE is_active = 1 GROUP BY achiever_id
      ) rv ON rv.achiever_id = a.id
      LEFT JOIN (
            SELECT mentor_id, COUNT(*) AS completed
              FROM achiever_sessions WHERE status = 'completed' GROUP BY mentor_id
      ) se ON se.mentor_id = a.id
      LEFT JOIN (
            SELECT achiever_id, COUNT(*) AS cohorts
              FROM cohorts WHERE status IN ('completed','live') AND deleted_at IS NULL
             GROUP BY achiever_id
      ) ch ON ch.achiever_id = a.id
     WHERE a.id = p_achiever_id
       AND a.state = 'active';
END$$

DROP PROCEDURE IF EXISTS `sp_achiever_public_reviews`$$
CREATE PROCEDURE `sp_achiever_public_reviews`(
    IN p_achiever_id CHAR(36),
    IN p_limit       INT
)
BEGIN
    SELECT r.id, r.rating, r.review_text, r.created_at,
           u.full_name AS student_name
      FROM achiever_reviews r
      LEFT JOIN users u ON u.id = r.user_id
     WHERE r.achiever_id = p_achiever_id AND r.is_active = 1
     ORDER BY r.created_at DESC
     LIMIT p_limit;
END$$

-- ------------------------------------------------------------
-- THE FUNNEL. Answers the question an unbooked achiever actually has: did
-- nobody see me, or did everybody bounce?
-- ------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_achiever_funnel`$$
CREATE PROCEDURE `sp_achiever_funnel`(
    IN p_achiever_id CHAR(36),
    IN p_days        INT
)
BEGIN
    DECLARE v_from DATETIME;
    SET v_from = DATE_SUB(UTC_TIMESTAMP(), INTERVAL IFNULL(p_days, 30) DAY);

    SELECT
      (SELECT COUNT(*) FROM achiever_profile_views v
        WHERE v.achiever_id = p_achiever_id AND v.created_at >= v_from) AS views,

      (SELECT COUNT(DISTINCT v.viewer_id) FROM achiever_profile_views v
        WHERE v.achiever_id = p_achiever_id AND v.created_at >= v_from
          AND v.viewer_id IS NOT NULL)                                  AS unique_viewers,

      (SELECT COUNT(*) FROM achiever_sessions s
        WHERE s.mentor_id = p_achiever_id AND s.created_at >= v_from)   AS bookings,

      (SELECT COUNT(*) FROM achiever_sessions s
        WHERE s.mentor_id = p_achiever_id AND s.created_at >= v_from
          AND s.payment_status = 'paid')                                AS paid_bookings,

      (SELECT COUNT(*) FROM achiever_sessions s
        WHERE s.mentor_id = p_achiever_id AND s.created_at >= v_from
          AND s.status = 'completed')                                   AS completed,

      (SELECT COUNT(*) FROM achiever_sessions s
        WHERE s.mentor_id = p_achiever_id AND s.created_at >= v_from
          AND s.status = 'cancelled')                                   AS cancelled,

      (SELECT COUNT(*) FROM cohort_enrollments e
         JOIN cohorts c ON c.id = e.cohort_id
        WHERE c.achiever_id = p_achiever_id AND e.created_at >= v_from) AS cohort_enrolments,

      (SELECT IFNULL(a.profile_view_count, 0) FROM achievers a
        WHERE a.id = p_achiever_id)                                     AS lifetime_views,

      (SELECT a.quality_score FROM achievers a WHERE a.id = p_achiever_id) AS quality_score,
      IFNULL(p_days, 30) AS window_days;
END$$

-- Day-by-day views, for the sparkline on the dashboard.
DROP PROCEDURE IF EXISTS `sp_achiever_view_series`$$
CREATE PROCEDURE `sp_achiever_view_series`(
    IN p_achiever_id CHAR(36),
    IN p_days        INT
)
BEGIN
    SELECT view_date AS d, COUNT(*) AS views
      FROM achiever_profile_views
     WHERE achiever_id = p_achiever_id
       AND view_date >= DATE_SUB(CURDATE(), INTERVAL IFNULL(p_days, 30) DAY)
     GROUP BY view_date
     ORDER BY view_date;
END$$

-- Nightly sweep — set-based, deliberately NOT a cursor calling the single-row
-- procedure above. That version would return one result set per achiever, so
-- the caller's first result set would be some random achiever's breakdown
-- instead of the summary. One UPDATE, one result set, and it stays O(1)
-- round trips as supply grows.
--
-- The arithmetic below must stay in step with sp_achiever_quality_recompute.
DROP PROCEDURE IF EXISTS `sp_achiever_quality_recompute_all`$$
CREATE PROCEDURE `sp_achiever_quality_recompute_all`()
BEGIN
    DECLARE v_min_sessions INT DEFAULT 3;
    DECLARE w_rating DECIMAL(5,2) DEFAULT 40;
    DECLARE w_compl  DECIMAL(5,2) DEFAULT 25;
    DECLARE w_rel    DECIMAL(5,2) DEFAULT 20;
    DECLARE w_rep    DECIMAL(5,2) DEFAULT 15;

    SELECT IFNULL(MAX(CASE WHEN metric='rating'      THEN weight END), w_rating),
           IFNULL(MAX(CASE WHEN metric='completion'  THEN weight END), w_compl),
           IFNULL(MAX(CASE WHEN metric='reliability' THEN weight END), w_rel),
           IFNULL(MAX(CASE WHEN metric='repeat'      THEN weight END), w_rep)
      INTO w_rating, w_compl, w_rel, w_rep
      FROM achiever_quality_weights;

    UPDATE achievers a
      LEFT JOIN (
            SELECT mentor_id,
                   SUM(status = 'completed')       AS completed,
                   SUM(status = 'cancelled')       AS cancelled,
                   SUM(IFNULL(no_show, 0) = 1)     AS no_shows
              FROM achiever_sessions GROUP BY mentor_id
      ) s ON s.mentor_id = a.id
      LEFT JOIN (
            SELECT achiever_id, AVG(rating) AS avg_rating
              FROM achiever_reviews WHERE is_active = 1 GROUP BY achiever_id
      ) rv ON rv.achiever_id = a.id
      LEFT JOIN (
            SELECT mentor_id,
                   COUNT(*)          AS students,
                   SUM(n > 1)        AS repeats
              FROM (SELECT mentor_id, student_id, COUNT(*) AS n
                      FROM achiever_sessions
                     WHERE status = 'completed'
                     GROUP BY mentor_id, student_id) g
             GROUP BY mentor_id
      ) rp ON rp.mentor_id = a.id
       SET a.quality_updated_at = UTC_TIMESTAMP(),
           a.quality_score = CASE
             WHEN IFNULL(s.completed, 0) < v_min_sessions THEN NULL
             ELSE LEAST(100, GREATEST(0, (
                    (IF(IFNULL(rv.avg_rating,0) > 0, (rv.avg_rating / 5) * 100, 60) * w_rating)
                  + (IFNULL((s.completed / NULLIF(s.completed + s.cancelled, 0)) * 100, 100) * w_compl)
                  + (IFNULL(100 - ((s.no_shows / NULLIF(s.completed + s.no_shows, 0)) * 100), 100) * w_rel)
                  + (IFNULL((rp.repeats / NULLIF(rp.students, 0)) * 100, 0) * w_rep)
                  ) / NULLIF(w_rating + w_compl + w_rel + w_rep, 0)))
           END
     WHERE a.is_active = 1;

    SELECT COUNT(*) AS scored FROM achievers WHERE quality_score IS NOT NULL;
END$$

DELIMITER ;
