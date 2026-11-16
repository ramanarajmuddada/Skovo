-- SKOVO stored procedures: college browse (student portal)
--
-- WHY THESE EXIST
--   `GET /v1/colleges` used to build its page in Python: it called
--   sp_colleges_list(5000, 0, 1) and sp_college_courses_list(50000, 0) on every
--   single request, then searched, filtered, sorted and sliced the result in
--   the route. Both of those procedures are the auto-generated CRUD ones and
--   both `SELECT *` — so every keystroke-free page load dragged up to 5,000
--   college rows (including the `about`, `admission_process`, `facilities`,
--   `top_recruiters` and `achievements` TEXT/JSON blobs) and up to 50,000
--   course rows across the wire from RDS, to render twenty rows of a table
--   that needs twelve short columns.
--
--   These two do the same work in SQL and return only what the list renders.
--
-- WHAT STAYED IN PYTHON, AND WHY
--   Degree matching. `_degree_key()` in the route collapses 'B.Tech', 'b.tech'
--   and 'btech' onto one key and expands aliases (B.E. counts as B.Tech, 'MD /
--   MS' covers two course codes). That policy lives in one place in Python and
--   is shared with the predictor; duplicating it in SQL would give it a second
--   copy to drift. The route expands the student's degree into every acceptable
--   key and passes them as a CSV, so only the *membership test* moved here.

DELIMITER $$

DROP PROCEDURE IF EXISTS `sp_colleges_browse`$$

-- One page of the browse list, filtered and ordered in SQL.
--
-- `total_count` rides along on every row as a window function rather than
-- coming back as a second result set: call_proc() reads only the first result
-- set, and a COUNT() round trip of its own would undo half the saving.
-- Window functions are evaluated before ORDER BY / LIMIT, so it is the count of
-- everything that matched, not of the page.
--
-- p_search / p_state arrive already escaped for LIKE (the route escapes \, %
-- and _), because the Python this replaces treated them as plain substrings —
-- a student searching for "100%" should not get a wildcard.
--
-- p_degree_csv empty or NULL = no personalised filter (Browse All, or a student
-- whose profile does not name a degree).
CREATE PROCEDURE `sp_colleges_browse`(
    IN p_search     VARCHAR(255),
    IN p_type       VARCHAR(20),
    IN p_state      VARCHAR(100),
    IN p_degree_csv TEXT,
    IN p_limit      INT,
    IN p_offset     INT
)
BEGIN
    IF p_limit  IS NULL OR p_limit  <= 0   THEN SET p_limit  = 20;  END IF;
    IF p_limit  > 200                      THEN SET p_limit  = 200; END IF;
    IF p_offset IS NULL OR p_offset < 0    THEN SET p_offset = 0;   END IF;

    SELECT
        c.`id`,
        c.`name`,
        c.`type`,
        c.`location_city`,
        c.`location_state`,
        c.`nirf_ranking`,
        c.`naac_grade`,
        c.`annual_fees_min`,
        c.`annual_fees_max`,
        c.`placement_rate`,
        c.`avg_package`,
        c.`logo_url`,
        COUNT(*) OVER () AS `total_count`
    FROM `colleges` c
    WHERE c.`deleted_at` IS NULL
      AND c.`is_active` = 1
      AND (p_type  IS NULL OR p_type  = '' OR c.`type` = p_type)
      AND (p_state IS NULL OR p_state = '' OR c.`location_state` LIKE CONCAT('%', p_state, '%'))
      AND (p_search IS NULL OR p_search = ''
           OR c.`name`           LIKE CONCAT('%', p_search, '%')
           OR c.`location_city`  LIKE CONCAT('%', p_search, '%')
           OR c.`location_state` LIKE CONCAT('%', p_search, '%'))
      AND (p_degree_csv IS NULL OR p_degree_csv = '' OR EXISTS (
              SELECT 1 FROM `college_courses` cc
               WHERE cc.`college_id` = c.`id`
                 AND FIND_IN_SET(REGEXP_REPLACE(LOWER(cc.`degree_type`), '[^a-z]', ''),
                                 p_degree_csv)))
    -- Ranked colleges first, best rank first; unranked last.
    --
    -- This reverses the previous behaviour, which was inherited rather than
    -- chosen: MySQL sorts NULLs first under a plain ASC, so every college
    -- without a NIRF rank outranked IIT Madras. The column is a rank where 1 is
    -- best, and "we hold no rank for this college" is not the same fact as
    -- "rank 0" - a student scanning the list expects the ranked ones at the top.
    -- Written as an explicit expression so the intent survives, rather than
    -- resting on the engine's default null ordering. Cost: the leading term is
    -- no longer a bare column, so idx_colleges_browse is used for filtering but
    -- not to read the ordering for free. With 0 rows in production today and a
    -- 20-row page, that is not measurable; revisit with the index if it ever is.
    --
    -- The tie-break is not cosmetic. Most colleges have no NIRF rank, so they
    -- are one enormous tie, and a tie MySQL is free to break differently on
    -- each call means page 2 can repeat or skip rows from page 1 — LIMIT/OFFSET
    -- over an unstable sort. created_at DESC is what the old path effectively
    -- produced (sp_colleges_list's ordering, preserved by Python's stable sort);
    -- id is the final tie-break, because created_at can collide on bulk imports.
    ORDER BY (c.`nirf_ranking` IS NULL) ASC, c.`nirf_ranking` ASC,
             c.`created_at` DESC, c.`id` ASC
    LIMIT p_limit OFFSET p_offset;
END$$

DROP PROCEDURE IF EXISTS `sp_college_courses_by_ids`$$

-- Course names for the colleges on one page — twenty ids, not the whole table.
--
-- p_ids is a JSON array of college ids, taken as TEXT and cast inside: a JSON
-- IN parameter is fussy about how drivers bind a Python string, and TEXT + CAST
-- behaves the same everywhere. JSON_TABLE turns it into rows so the join can
-- use the college_id index instead of FIND_IN_SET, which cannot.
--
-- The COLLATE on j.cid is required, not decorative. A routine *parameter*
-- compares against a column happily — a variable is weakly coercible, so the
-- column's collation wins — which is why every other procedure here gets away
-- with p_foo = some_column. A JSON_TABLE column is not a variable: it is as
-- strongly coercible as a real column, and it comes out utf8mb4_0900_ai_ci
-- (the server default) while these tables are utf8mb4_unicode_ci. Two columns,
-- two collations, neither yielding: "Illegal mix of collations" (errno 1305)
-- on every call. Naming the table's collation on the JSON side settles it and
-- leaves cc.college_id untouched, so the index is still used.
CREATE PROCEDURE `sp_college_courses_by_ids`(IN p_ids TEXT)
BEGIN
    IF p_ids IS NULL OR p_ids = '' THEN SET p_ids = '[]'; END IF;

    SELECT cc.`college_id`, cc.`course_name`
    FROM JSON_TABLE(CAST(p_ids AS JSON), '$[*]' COLUMNS (`cid` CHAR(36) PATH '$')) j
    JOIN `college_courses` cc
      ON cc.`college_id` = j.`cid` COLLATE utf8mb4_unicode_ci
    ORDER BY cc.`college_id`, cc.`created_at` DESC;
END$$

DELIMITER ;
