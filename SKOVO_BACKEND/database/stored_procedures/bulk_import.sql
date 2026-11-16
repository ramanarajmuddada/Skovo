-- ============================================================
-- SKOVO stored procedures: bulk import (colleges, courses, cutoffs)
-- ============================================================
-- Idempotent upserts keyed on the natural identity of each row, so re-importing
-- a corrected file updates rather than duplicates. That matters more here than
-- anywhere else: this data arrives as spreadsheets that get fixed and re-sent.
--
-- Cutoffs additionally carry a source and a verified date. A student will plan
-- around a closing rank, so every row has to be able to say where it came from
-- and when it was last checked.
-- ============================================================

DELIMITER $$

-- ── colleges ─────────────────────────────────────────────────────────────────
-- Identity is (name, location_city): the same college name recurs across cities.
DROP PROCEDURE IF EXISTS `sp_college_import_upsert`$$
CREATE PROCEDURE `sp_college_import_upsert`(
    IN p_name VARCHAR(255), IN p_type VARCHAR(20),
    IN p_city VARCHAR(128), IN p_state VARCHAR(128),
    IN p_nirf INT, IN p_naac VARCHAR(8),
    IN p_fees_min DECIMAL(12,2), IN p_fees_max DECIMAL(12,2),
    IN p_website TEXT, IN p_about TEXT,
    IN p_established_year INT, IN p_user_id CHAR(36)
)
BEGIN
    DECLARE v_id CHAR(36);

    SELECT `id` INTO v_id FROM `colleges`
     WHERE `name` = p_name AND (`location_city` <=> p_city) LIMIT 1;

    IF v_id IS NULL THEN
        SET v_id = UUID();
        INSERT INTO `colleges`
            (`id`, `name`, `type`, `location_city`, `location_state`, `nirf_ranking`,
             `naac_grade`, `annual_fees_min`, `annual_fees_max`, `website_url`, `about`,
             `established_year`, `is_active`, `created_by`, `updated_by`)
        VALUES (v_id, p_name, p_type, p_city, p_state, p_nirf, p_naac,
                p_fees_min, p_fees_max, p_website, p_about, p_established_year, 1,
                p_user_id, p_user_id);
        SELECT v_id AS id, 'created' AS outcome;
    ELSE
        -- COALESCE so a sparse file never blanks a column that already has data.
        UPDATE `colleges`
           SET `type`             = COALESCE(p_type, `type`),
               `location_state`   = COALESCE(p_state, `location_state`),
               `nirf_ranking`     = COALESCE(p_nirf, `nirf_ranking`),
               `naac_grade`       = COALESCE(p_naac, `naac_grade`),
               `annual_fees_min`  = COALESCE(p_fees_min, `annual_fees_min`),
               `annual_fees_max`  = COALESCE(p_fees_max, `annual_fees_max`),
               `website_url`      = COALESCE(p_website, `website_url`),
               `about`            = COALESCE(p_about, `about`),
               `established_year` = COALESCE(p_established_year, `established_year`),
               `is_active`        = 1,
               `updated_by`       = p_user_id
         WHERE `id` = v_id;
        SELECT v_id AS id, 'updated' AS outcome;
    END IF;
END$$

-- ── college courses ──────────────────────────────────────────────────────────
-- Identity is (college, course_name, branch_code).
DROP PROCEDURE IF EXISTS `sp_college_course_import_upsert`$$
CREATE PROCEDURE `sp_college_course_import_upsert`(
    IN p_college_name VARCHAR(255), IN p_city VARCHAR(128),
    IN p_course_name VARCHAR(200), IN p_branch_code VARCHAR(30),
    IN p_degree_type VARCHAR(50), IN p_duration_years FLOAT,
    IN p_total_seats INT, IN p_annual_fee DECIMAL(12,2), IN p_user_id CHAR(36)
)
BEGIN
    DECLARE v_college CHAR(36);
    DECLARE v_id CHAR(36);

    SELECT `id` INTO v_college FROM `colleges`
     WHERE `name` = p_college_name AND (p_city IS NULL OR `location_city` = p_city)
     LIMIT 1;

    IF v_college IS NULL THEN
        -- Reported per row rather than raised: one unknown college must not
        -- abort a 5,000-row file.
        SELECT NULL AS id, 'college_not_found' AS outcome;
    ELSE
        SELECT `id` INTO v_id FROM `college_courses`
         WHERE `college_id` = v_college AND `course_name` = p_course_name
           AND (`branch_code` <=> p_branch_code) LIMIT 1;

        IF v_id IS NULL THEN
            SET v_id = UUID();
            INSERT INTO `college_courses`
                (`id`, `college_id`, `course_name`, `branch_code`, `duration_years`,
                 `degree_type`, `total_seats`, `annual_fee`, `created_by`, `updated_by`)
            VALUES (v_id, v_college, p_course_name, p_branch_code, p_duration_years,
                    p_degree_type, p_total_seats, p_annual_fee, p_user_id, p_user_id);
            SELECT v_id AS id, 'created' AS outcome;
        ELSE
            UPDATE `college_courses`
               SET `duration_years` = COALESCE(p_duration_years, `duration_years`),
                   `degree_type`    = COALESCE(p_degree_type, `degree_type`),
                   `total_seats`    = COALESCE(p_total_seats, `total_seats`),
                   `annual_fee`     = COALESCE(p_annual_fee, `annual_fee`),
                   `updated_by`     = p_user_id
             WHERE `id` = v_id;
            SELECT v_id AS id, 'updated' AS outcome;
        END IF;
    END IF;
END$$

-- ── cutoffs ──────────────────────────────────────────────────────────────────
-- Identity is (college, branch, exam, year, category, gender) — one closing rank
-- per combination per year.
DROP PROCEDURE IF EXISTS `sp_cutoff_import_upsert`$$
CREATE PROCEDURE `sp_cutoff_import_upsert`(
    IN p_college_name VARCHAR(255), IN p_city VARCHAR(128), IN p_state VARCHAR(128),
    IN p_college_type VARCHAR(30), IN p_branch_code VARCHAR(30), IN p_branch_name VARCHAR(200),
    IN p_exam_type VARCHAR(50), IN p_year INT, IN p_category VARCHAR(40), IN p_gender VARCHAR(20),
    IN p_opening_rank INT, IN p_closing_rank INT, IN p_total_seats INT,
    IN p_source VARCHAR(255), IN p_user_id CHAR(36)
)
BEGIN
    DECLARE v_id CHAR(36);

    SELECT `id` INTO v_id FROM `cg_college_cutoffs`
     WHERE `college_name` = p_college_name
       AND (`branch_name` <=> p_branch_name)
       AND `exam_type` = p_exam_type
       AND `year` = p_year
       AND (`category` <=> p_category)
       AND (`gender` <=> p_gender)
     LIMIT 1;

    IF v_id IS NULL THEN
        SET v_id = UUID();
        INSERT INTO `cg_college_cutoffs`
            (`id`, `college_name`, `college_city`, `college_state`, `college_type`,
             `branch_code`, `branch_name`, `exam_type`, `year`, `category`, `gender`,
             `opening_rank`, `closing_rank`, `total_seats`, `source`, `verified_at`,
             `created_by`, `updated_by`)
        VALUES (v_id, p_college_name, p_city, p_state, p_college_type,
                p_branch_code, p_branch_name, p_exam_type, p_year, p_category, p_gender,
                p_opening_rank, p_closing_rank, p_total_seats, p_source, NOW(),
                p_user_id, p_user_id);
        SELECT v_id AS id, 'created' AS outcome;
    ELSE
        UPDATE `cg_college_cutoffs`
           SET `college_city`  = COALESCE(p_city, `college_city`),
               `college_state` = COALESCE(p_state, `college_state`),
               `college_type`  = COALESCE(p_college_type, `college_type`),
               `branch_code`   = COALESCE(p_branch_code, `branch_code`),
               `opening_rank`  = COALESCE(p_opening_rank, `opening_rank`),
               `closing_rank`  = COALESCE(p_closing_rank, `closing_rank`),
               `total_seats`   = COALESCE(p_total_seats, `total_seats`),
               `source`        = COALESCE(p_source, `source`),
               `verified_at`   = NOW(),
               `updated_by`    = p_user_id
         WHERE `id` = v_id;
        SELECT v_id AS id, 'updated' AS outcome;
    END IF;
END$$

DELIMITER ;
