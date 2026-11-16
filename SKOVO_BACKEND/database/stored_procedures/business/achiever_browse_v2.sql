-- Find Achievers with a price RANGE (min and max). New names, so the live
-- site keeps using sp_achievers_browse until this code is deployed.
-- Same rules as sp_achievers_browse; only p_min_price is added.
DELIMITER $$

DROP PROCEDURE IF EXISTS `sp_achievers_browse_v2`$$
CREATE PROCEDURE `sp_achievers_browse_v2`(
    IN p_student_id CHAR(36),
    IN p_q          VARCHAR(120),
    IN p_domain     VARCHAR(120),
    IN p_min_rating DECIMAL(3,2),
    IN p_max_price  DECIMAL(10,2),
    IN p_min_price  DECIMAL(10,2),
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
     WHERE a.state IN ('active','probation')
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
       AND (p_min_price IS NULL OR p_min_price = 0
            OR IFNULL(a.session_rate, 0) >= p_min_price)

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

DROP PROCEDURE IF EXISTS `sp_achievers_browse_count_v2`$$
CREATE PROCEDURE `sp_achievers_browse_count_v2`(
    IN p_student_id CHAR(36),
    IN p_q          VARCHAR(120),
    IN p_domain     VARCHAR(120),
    IN p_min_rating DECIMAL(3,2),
    IN p_max_price  DECIMAL(10,2),
    IN p_min_price  DECIMAL(10,2),
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
     WHERE a.state IN ('active','probation')
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
       AND (p_min_price IS NULL OR p_min_price = 0
            OR IFNULL(a.session_rate, 0) >= p_min_price)
       AND (IFNULL(p_bgv_only, 0) = 0 OR a.bgv_status = 'clear')
       AND (IFNULL(p_free_only, 0) = 0 OR IFNULL(a.session_rate, 0) = 0);
END$$

-- The slider's ends: lowest and highest 1-on-1 price among bookable achievers.
DROP PROCEDURE IF EXISTS `sp_achievers_price_bounds`$$
CREATE PROCEDURE `sp_achievers_price_bounds`()
BEGIN
    SELECT IFNULL(MIN(IFNULL(session_rate, 0)), 0) AS min_price,
           IFNULL(MAX(IFNULL(session_rate, 0)), 0) AS max_price
      FROM `achievers`
     WHERE state IN ('active', 'probation') AND email IS NOT NULL;
END$$

DELIMITER ;
