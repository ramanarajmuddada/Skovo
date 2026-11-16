-- ============================================================
-- SKOVO — Tailored endpoint stored procedures: readiness
-- ============================================================
-- Re-codes portal/helpers/helpers.score_from_assessment_steps() and the
-- POST /readiness/assessment flow in SQL (MySQL 8 — uses JSON_TABLE / ->>).
--   Step 1 skills:     +2 per skill, max 20
--   Step 2 experience: +10 internship, +5/project (max 3) -> max 25
--   Step 3 career goal set -> 20
--   Step 4 engagement: +5 in_groups, +5 cohorts_attended>0 -> max 10
--   assessment cap 75; + cohort_pts (cohorts_completed*5, max 25); score cap 100
-- ============================================================

DELIMITER $$

-- GET helpers -----------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_readiness_steps`$$
CREATE PROCEDURE `sp_readiness_steps`(IN p_user_id CHAR(36))
BEGIN
    SELECT `step`, `is_complete`, `step_data`
      FROM `readiness_assessments` WHERE `user_id` = p_user_id;
END$$

DROP PROCEDURE IF EXISTS `sp_readiness_score_get`$$
CREATE PROCEDURE `sp_readiness_score_get`(IN p_user_id CHAR(36))
BEGIN
    SELECT * FROM `readiness_scores` WHERE `user_id` = p_user_id LIMIT 1;
END$$

-- POST /readiness/assessment — upsert step, sync skills, recompute score ------
DROP PROCEDURE IF EXISTS `sp_readiness_submit_step`$$
CREATE PROCEDURE `sp_readiness_submit_step`(
    IN p_user_id   CHAR(36),
    IN p_step      INT,
    IN p_step_data JSON
)
BEGIN
    DECLARE v_sd1 JSON; DECLARE v_sd2 JSON; DECLARE v_sd3 JSON; DECLARE v_sd4 JSON;
    DECLARE v_p1 INT DEFAULT 0; DECLARE v_p2 INT DEFAULT 0;
    DECLARE v_p3 INT DEFAULT 0; DECLARE v_p4 INT DEFAULT 0;
    DECLARE v_assess INT DEFAULT 0; DECLARE v_cohorts INT DEFAULT 0;
    DECLARE v_cohort_pts INT DEFAULT 0; DECLARE v_score INT DEFAULT 0;
    DECLARE v_level VARCHAR(20); DECLARE v_steps_done INT DEFAULT 0;
    DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

    START TRANSACTION;

    -- upsert this step (no unique constraint on user_id+step, so branch manually)
    IF EXISTS (SELECT 1 FROM `readiness_assessments` WHERE `user_id`=p_user_id AND `step`=p_step) THEN
        UPDATE `readiness_assessments` SET `step_data`=p_step_data, `is_complete`=1
         WHERE `user_id`=p_user_id AND `step`=p_step;
    ELSE
        INSERT INTO `readiness_assessments` (`id`,`user_id`,`step`,`step_data`,`is_complete`)
        VALUES (UUID(), p_user_id, p_step, p_step_data, 1);
    END IF;

    -- step 1: re-sync selected skills to user_skills
    IF p_step = 1 THEN
        DELETE FROM `user_skills` WHERE `user_id` = p_user_id;
        INSERT INTO `user_skills` (`id`,`user_id`,`skill_name`)
        SELECT UUID(), p_user_id, TRIM(j.skill)
          FROM JSON_TABLE(JSON_EXTRACT(p_step_data,'$.skills'), '$[*]'
                          COLUMNS (skill VARCHAR(100) PATH '$')) j
         WHERE j.skill IS NOT NULL AND TRIM(j.skill) <> '';
    END IF;

    -- recompute assessment points from all complete steps
    SELECT `step_data` INTO v_sd1 FROM `readiness_assessments` WHERE `user_id`=p_user_id AND `step`=1 AND `is_complete`=1 LIMIT 1;
    SELECT `step_data` INTO v_sd2 FROM `readiness_assessments` WHERE `user_id`=p_user_id AND `step`=2 AND `is_complete`=1 LIMIT 1;
    SELECT `step_data` INTO v_sd3 FROM `readiness_assessments` WHERE `user_id`=p_user_id AND `step`=3 AND `is_complete`=1 LIMIT 1;
    SELECT `step_data` INTO v_sd4 FROM `readiness_assessments` WHERE `user_id`=p_user_id AND `step`=4 AND `is_complete`=1 LIMIT 1;

    SET v_p1 = IF(v_sd1 IS NULL, 0, LEAST(IFNULL(JSON_LENGTH(JSON_EXTRACT(v_sd1,'$.skills')),0) * 2, 20));
    SET v_p2 = IF(v_sd2 IS NULL, 0,
                  LEAST( IF(v_sd2->>'$.has_internship' IN ('true','1'), 10, 0)
                       + LEAST(CAST(IFNULL(v_sd2->>'$.projects_count','0') AS UNSIGNED) * 5, 15), 25));
    SET v_p3 = IF(v_sd3 IS NULL, 0, IF(TRIM(IFNULL(v_sd3->>'$.career_goal','')) <> '', 20, 0));
    SET v_p4 = IF(v_sd4 IS NULL, 0,
                  LEAST( IF(v_sd4->>'$.in_groups' IN ('true','1'), 5, 0)
                       + IF(CAST(IFNULL(v_sd4->>'$.cohorts_attended','0') AS UNSIGNED) > 0, 5, 0), 10));
    SET v_assess = LEAST(v_p1 + v_p2 + v_p3 + v_p4, 75);

    -- cohort points from existing readiness row
    SELECT IFNULL(`cohorts_completed`,0) INTO v_cohorts FROM `readiness_scores` WHERE `user_id`=p_user_id LIMIT 1;
    SET v_cohort_pts = LEAST(v_cohorts * 5, 25);
    SET v_score = LEAST(100, v_assess + v_cohort_pts);
    IF v_score >= 65 THEN SET v_level='Achiever';
    ELSEIF v_score >= 30 THEN SET v_level='Pioneer';
    ELSE SET v_level='Explorer'; END IF;

    SELECT COUNT(*) INTO v_steps_done FROM `readiness_assessments` WHERE `user_id`=p_user_id AND `is_complete`=1;

    INSERT INTO `readiness_scores` (`id`,`user_id`,`score`,`level`,`cohorts_completed`,`assessment_completed`)
    VALUES (UUID(), p_user_id, v_score, v_level, v_cohorts, v_steps_done >= 4)
    ON DUPLICATE KEY UPDATE `score`=v_score, `level`=v_level, `assessment_completed`=(v_steps_done >= 4);

    COMMIT;

    SELECT v_steps_done AS steps_completed, v_assess AS assessment_points,
           v_cohort_pts AS cohort_points, v_score AS current_score,
           v_level AS level, (v_steps_done >= 4) AS assessment_complete;
END$$

DELIMITER ;
