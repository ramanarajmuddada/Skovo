-- SKOVO — Tailored endpoint SPs: resumes (per-user, soft-delete, many JSON cols)
DELIMITER $$

DROP PROCEDURE IF EXISTS `sp_resumes_by_user`$$
CREATE PROCEDURE `sp_resumes_by_user`(IN p_user_id CHAR(36))
BEGIN
    SELECT * FROM `resumes`
     WHERE `user_id` = p_user_id AND `is_active` = 1
     ORDER BY `updated_at` DESC;
END$$

DROP PROCEDURE IF EXISTS `sp_resumes_get_owner`$$
CREATE PROCEDURE `sp_resumes_get_owner`(IN p_id CHAR(36), IN p_user_id CHAR(36))
BEGIN
    SELECT * FROM `resumes`
     WHERE `id` = p_id AND `user_id` = p_user_id AND `is_active` = 1 LIMIT 1;
END$$

DROP PROCEDURE IF EXISTS `sp_resumes_create`$$
CREATE PROCEDURE `sp_resumes_create`(
    IN p_id CHAR(36), IN p_user_id CHAR(36), IN p_title VARCHAR(300), IN p_template VARCHAR(50),
    IN p_personal_info JSON, IN p_education JSON, IN p_experience JSON, IN p_skills JSON,
    IN p_projects JSON, IN p_certifications JSON, IN p_achievements JSON, IN p_languages JSON,
    IN p_summary TEXT)
BEGIN
    IF p_id IS NULL OR p_id = '' THEN SET p_id = UUID(); END IF;
    INSERT INTO `resumes`
        (`id`,`user_id`,`title`,`template`,`personal_info`,`education`,`experience`,
         `skills`,`projects`,`certifications`,`achievements`,`languages`,`summary`)
    VALUES (p_id, p_user_id, COALESCE(p_title,'My Resume'), COALESCE(p_template,'classic'),
            p_personal_info, p_education, p_experience, p_skills, p_projects,
            p_certifications, p_achievements, p_languages, p_summary);
    SELECT * FROM `resumes` WHERE `id` = p_id;
END$$

DROP PROCEDURE IF EXISTS `sp_resumes_update_owner`$$
CREATE PROCEDURE `sp_resumes_update_owner`(
    IN p_id CHAR(36), IN p_user_id CHAR(36), IN p_title VARCHAR(300), IN p_template VARCHAR(50),
    IN p_personal_info JSON, IN p_education JSON, IN p_experience JSON, IN p_skills JSON,
    IN p_projects JSON, IN p_certifications JSON, IN p_achievements JSON, IN p_languages JSON,
    IN p_summary TEXT)
BEGIN
    UPDATE `resumes` SET
        `title`          = COALESCE(p_title, `title`),
        `template`       = COALESCE(p_template, `template`),
        `personal_info`  = COALESCE(p_personal_info, `personal_info`),
        `education`      = COALESCE(p_education, `education`),
        `experience`     = COALESCE(p_experience, `experience`),
        `skills`         = COALESCE(p_skills, `skills`),
        `projects`       = COALESCE(p_projects, `projects`),
        `certifications` = COALESCE(p_certifications, `certifications`),
        `achievements`   = COALESCE(p_achievements, `achievements`),
        `languages`      = COALESCE(p_languages, `languages`),
        `summary`        = COALESCE(p_summary, `summary`)
     WHERE `id` = p_id AND `user_id` = p_user_id AND `is_active` = 1;
    SELECT COUNT(*) AS updated FROM `resumes`
     WHERE `id` = p_id AND `user_id` = p_user_id AND `is_active` = 1;
END$$

DROP PROCEDURE IF EXISTS `sp_resumes_delete_owner`$$
CREATE PROCEDURE `sp_resumes_delete_owner`(IN p_id CHAR(36), IN p_user_id CHAR(36))
BEGIN
    UPDATE `resumes` SET `is_active` = 0
     WHERE `id` = p_id AND `user_id` = p_user_id AND `is_active` = 1;
    SELECT ROW_COUNT() AS deleted;
END$$

DELIMITER ;
