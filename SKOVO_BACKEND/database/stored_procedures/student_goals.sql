-- ============================================================
-- SKOVO stored procedures: student_goals
-- ============================================================
-- One row per student holding the aspiration half of the profile. The upsert
-- COALESCEs, so onboarding can write it in pieces and Profile can edit one
-- field without clearing the rest.
-- ============================================================

DELIMITER $$

DROP PROCEDURE IF EXISTS `sp_student_goals_get`$$
CREATE PROCEDURE `sp_student_goals_get`(IN p_user_id CHAR(36))
BEGIN
    SELECT * FROM `student_goals` WHERE `user_id` = p_user_id LIMIT 1;
END$$

DROP PROCEDURE IF EXISTS `sp_student_goals_upsert`$$
CREATE PROCEDURE `sp_student_goals_upsert`(
    IN p_user_id CHAR(36),
    IN p_target_exams JSON,
    IN p_target_courses JSON,
    IN p_target_states JSON,
    IN p_target_cities JSON,
    IN p_target_college_ids JSON,
    IN p_admission_year INT,
    IN p_reservation_category VARCHAR(20),
    IN p_budget_max INT
)
BEGIN
    DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;
    START TRANSACTION;

    IF EXISTS (SELECT 1 FROM `student_goals` WHERE `user_id` = p_user_id) THEN
        UPDATE `student_goals`
           SET `target_exams`         = COALESCE(p_target_exams, `target_exams`),
               `target_courses`       = COALESCE(p_target_courses, `target_courses`),
               `target_states`        = COALESCE(p_target_states, `target_states`),
               `target_cities`        = COALESCE(p_target_cities, `target_cities`),
               `target_college_ids`   = COALESCE(p_target_college_ids, `target_college_ids`),
               `admission_year`       = COALESCE(p_admission_year, `admission_year`),
               `reservation_category` = COALESCE(p_reservation_category, `reservation_category`),
               `budget_max`           = COALESCE(p_budget_max, `budget_max`),
               `updated_by`           = p_user_id
         WHERE `user_id` = p_user_id;
    ELSE
        INSERT INTO `student_goals`
            (`id`, `user_id`, `target_exams`, `target_courses`, `target_states`, `target_cities`,
             `target_college_ids`, `admission_year`, `reservation_category`, `budget_max`,
             `created_by`, `updated_by`)
        VALUES (UUID(), p_user_id, p_target_exams, p_target_courses, p_target_states, p_target_cities,
                p_target_college_ids, p_admission_year, p_reservation_category, p_budget_max,
                p_user_id, p_user_id);
    END IF;

    COMMIT;
    SELECT * FROM `student_goals` WHERE `user_id` = p_user_id LIMIT 1;
END$$

-- The dream list, resolved — so the goals screen can show college names without
-- the caller making a second round trip per id.
DROP PROCEDURE IF EXISTS `sp_student_goals_colleges`$$
CREATE PROCEDURE `sp_student_goals_colleges`(IN p_user_id CHAR(36))
BEGIN
    SELECT c.`id`, c.`name`, c.`location_city`, c.`location_state`, c.`nirf_ranking`, c.`logo_url`
      FROM `colleges` c
      JOIN `student_goals` g ON g.`user_id` = p_user_id
     WHERE JSON_CONTAINS(COALESCE(g.`target_college_ids`, JSON_ARRAY()), JSON_QUOTE(c.`id`))
       AND c.`is_active` = 1;
END$$

DELIMITER ;
