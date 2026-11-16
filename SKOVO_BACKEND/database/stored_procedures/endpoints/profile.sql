-- ============================================================
-- SKOVO — Tailored endpoint stored procedures: profile
-- ============================================================
-- GET /profile reads (users + user_profiles + user_skills + readiness_scores);
-- PATCH /profile upserts users(full_name,avatar) + user_profiles (partial),
-- deriving legacy education_level from education_category (the _CAT_TO_LEVEL map).
-- ============================================================

DELIMITER $$

DROP PROCEDURE IF EXISTS `sp_profile_get_by_user`$$
CREATE PROCEDURE `sp_profile_get_by_user`(IN p_user_id CHAR(36))
BEGIN
    SELECT * FROM `user_profiles` WHERE `user_id` = p_user_id LIMIT 1;
END$$

DROP PROCEDURE IF EXISTS `sp_user_skills_by_user`$$
CREATE PROCEDURE `sp_user_skills_by_user`(IN p_user_id CHAR(36))
BEGIN
    SELECT `id`, `skill_name` FROM `user_skills` WHERE `user_id` = p_user_id;
END$$

DROP PROCEDURE IF EXISTS `sp_profile_upsert`$$
CREATE PROCEDURE `sp_profile_upsert`(
    IN p_user_id                   CHAR(36),
    IN p_full_name                 TEXT,
    IN p_avatar_url                TEXT,
    IN p_phone                     TEXT,
    IN p_city                      VARCHAR(100),
    IN p_state                     VARCHAR(100),
    IN p_career_interests          JSON,
    IN p_education_level           VARCHAR(50),
    IN p_education_category        VARCHAR(30),
    IN p_school_name               VARCHAR(200),
    IN p_stream                    VARCHAR(30),
    IN p_iti_trade                 VARCHAR(100),
    IN p_college_name              VARCHAR(200),
    IN p_degree_category           VARCHAR(50),
    IN p_degree_type               VARCHAR(100),
    IN p_branch                    VARCHAR(100),
    IN p_year_of_study             VARCHAR(30),
    IN p_professional_course_type  VARCHAR(20),
    IN p_professional_course_level VARCHAR(30),
    IN p_exam_target               VARCHAR(50),
    IN p_working_industry          VARCHAR(100),
    IN p_working_experience        VARCHAR(20),
    IN p_working_role              VARCHAR(100),
    -- Appended, not inserted mid-list: the caller passes positionally.
    IN p_board                     VARCHAR(100)
)
BEGIN
    DECLARE v_edu_level VARCHAR(50);
    DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

    -- derive legacy education_level from education_category when level not given
    SET v_edu_level = COALESCE(
        p_education_level,
        CASE p_education_category
            WHEN 'school_10th'         THEN '10th'
            WHEN 'school_11th'         THEN '11th_12th'
            WHEN 'school_12th'         THEN '12th'
            WHEN 'iti'                 THEN 'diploma'
            WHEN 'polytechnic'         THEN 'diploma'
            WHEN 'ug'                  THEN 'ug'
            WHEN 'professional_course' THEN 'ug'
            WHEN 'pg'                  THEN 'graduated'
            WHEN 'phd'                 THEN 'graduated'
            WHEN 'working'             THEN 'graduated'
            WHEN 'govt_exam'           THEN 'ug'
            WHEN 'entrance_exam'       THEN '12th'
            ELSE p_education_category
        END
    );

    START TRANSACTION;

    IF p_full_name IS NOT NULL AND p_full_name <> '' THEN
        UPDATE `users` SET `full_name` = p_full_name WHERE `id` = p_user_id;
    END IF;
    IF p_avatar_url IS NOT NULL THEN
        UPDATE `users` SET `avatar_url` = p_avatar_url WHERE `id` = p_user_id;
    END IF;

    -- Three-state contract on every stage-scoped field:
    --   NULL          -> not sent, keep what is stored
    --   ''            -> sent empty, clear it
    --   a value       -> store it
    -- Without the empty case a field could never be cleared, so a student who
    -- switched from a degree to 10th kept B.Tech / CSE / 2nd Year on their row
    -- and the profile contradicted itself.
    IF EXISTS (SELECT 1 FROM `user_profiles` WHERE `user_id` = p_user_id) THEN
        UPDATE `user_profiles` SET
            `phone`                     = COALESCE(p_phone, `phone`),
            `city`                      = COALESCE(p_city, `city`),
            `state`                     = COALESCE(p_state, `state`),
            `career_interests`          = COALESCE(p_career_interests, `career_interests`),
            `education_level`           = COALESCE(v_edu_level, `education_level`),
            `education_category`        = COALESCE(p_education_category, `education_category`),
            `school_name`               = CASE WHEN p_school_name = '' THEN NULL ELSE COALESCE(p_school_name, `school_name`) END,
            `stream`                    = CASE WHEN p_stream = '' THEN NULL ELSE COALESCE(p_stream, `stream`) END,
            `iti_trade`                 = CASE WHEN p_iti_trade = '' THEN NULL ELSE COALESCE(p_iti_trade, `iti_trade`) END,
            `college_name`              = CASE WHEN p_college_name = '' THEN NULL ELSE COALESCE(p_college_name, `college_name`) END,
            `degree_category`           = CASE WHEN p_degree_category = '' THEN NULL ELSE COALESCE(p_degree_category, `degree_category`) END,
            `degree_type`               = CASE WHEN p_degree_type = '' THEN NULL ELSE COALESCE(p_degree_type, `degree_type`) END,
            `branch`                    = CASE WHEN p_branch = '' THEN NULL ELSE COALESCE(p_branch, `branch`) END,
            `year_of_study`             = CASE WHEN p_year_of_study = '' THEN NULL ELSE COALESCE(p_year_of_study, `year_of_study`) END,
            `professional_course_type`  = CASE WHEN p_professional_course_type = '' THEN NULL ELSE COALESCE(p_professional_course_type, `professional_course_type`) END,
            `professional_course_level` = CASE WHEN p_professional_course_level = '' THEN NULL ELSE COALESCE(p_professional_course_level, `professional_course_level`) END,
            `exam_target`               = CASE WHEN p_exam_target = '' THEN NULL ELSE COALESCE(p_exam_target, `exam_target`) END,
            `working_industry`          = CASE WHEN p_working_industry = '' THEN NULL ELSE COALESCE(p_working_industry, `working_industry`) END,
            `working_experience`        = CASE WHEN p_working_experience = '' THEN NULL ELSE COALESCE(p_working_experience, `working_experience`) END,
            `working_role`              = CASE WHEN p_working_role = '' THEN NULL ELSE COALESCE(p_working_role, `working_role`) END,
            `board`                     = CASE WHEN p_board = '' THEN NULL ELSE COALESCE(p_board, `board`) END
        WHERE `user_id` = p_user_id;
    ELSE
        INSERT INTO `user_profiles`
            (`id`,`user_id`,`phone`,`city`,`state`,`career_interests`,`education_level`,
             `education_category`,`school_name`,`stream`,`iti_trade`,`college_name`,
             `degree_category`,`degree_type`,`branch`,`year_of_study`,
             `professional_course_type`,`professional_course_level`,`exam_target`,
             `working_industry`,`working_experience`,`working_role`,`board`)
        VALUES
            (UUID(), p_user_id, p_phone, p_city, p_state, p_career_interests, v_edu_level,
             p_education_category, p_school_name, p_stream, p_iti_trade, p_college_name,
             p_degree_category, p_degree_type, p_branch, p_year_of_study,
             p_professional_course_type, p_professional_course_level, p_exam_target,
             p_working_industry, p_working_experience, p_working_role, p_board);
    END IF;

    COMMIT;
    SELECT * FROM `user_profiles` WHERE `user_id` = p_user_id LIMIT 1;
END$$

DELIMITER ;
