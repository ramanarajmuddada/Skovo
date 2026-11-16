-- SKOVO — Tailored endpoint SPs: college_applications (per-user, hard-delete)
DELIMITER $$

DROP PROCEDURE IF EXISTS `sp_collegeapp_by_user`$$
CREATE PROCEDURE `sp_collegeapp_by_user`(IN p_user_id CHAR(36))
BEGIN
    SELECT * FROM `college_applications`
     WHERE `user_id` = p_user_id ORDER BY `created_at` DESC;
END$$

DROP PROCEDURE IF EXISTS `sp_collegeapp_create`$$
CREATE PROCEDURE `sp_collegeapp_create`(
    IN p_id CHAR(36), IN p_user_id CHAR(36), IN p_college_id CHAR(36),
    IN p_college_name VARCHAR(500), IN p_program_name VARCHAR(300), IN p_exam_type VARCHAR(50),
    IN p_application_date DATE, IN p_deadline_date DATE, IN p_status VARCHAR(30),
    IN p_priority VARCHAR(10), IN p_notes TEXT, IN p_application_url TEXT)
BEGIN
    IF p_id IS NULL OR p_id = '' THEN SET p_id = UUID(); END IF;
    INSERT INTO `college_applications`
        (`id`,`user_id`,`college_id`,`college_name`,`program_name`,`exam_type`,
         `application_date`,`deadline_date`,`status`,`priority`,`notes`,`application_url`)
    VALUES (p_id, p_user_id, p_college_id, p_college_name, p_program_name, p_exam_type,
            p_application_date, p_deadline_date, COALESCE(p_status,'planning'),
            COALESCE(p_priority,'medium'), p_notes, p_application_url);
    SELECT * FROM `college_applications` WHERE `id` = p_id;
END$$

DROP PROCEDURE IF EXISTS `sp_collegeapp_update_owner`$$
CREATE PROCEDURE `sp_collegeapp_update_owner`(
    IN p_id CHAR(36), IN p_user_id CHAR(36),
    IN p_college_name VARCHAR(500), IN p_program_name VARCHAR(300), IN p_exam_type VARCHAR(50),
    IN p_application_date DATE, IN p_deadline_date DATE, IN p_status VARCHAR(30),
    IN p_priority VARCHAR(10), IN p_notes TEXT, IN p_application_url TEXT, IN p_college_id CHAR(36))
BEGIN
    UPDATE `college_applications` SET
        `college_name`     = COALESCE(p_college_name, `college_name`),
        `program_name`     = COALESCE(p_program_name, `program_name`),
        `exam_type`        = COALESCE(p_exam_type, `exam_type`),
        `application_date` = COALESCE(p_application_date, `application_date`),
        `deadline_date`    = COALESCE(p_deadline_date, `deadline_date`),
        `status`           = COALESCE(p_status, `status`),
        `priority`         = COALESCE(p_priority, `priority`),
        `notes`            = COALESCE(p_notes, `notes`),
        `application_url`  = COALESCE(p_application_url, `application_url`),
        `college_id`       = COALESCE(p_college_id, `college_id`)
     WHERE `id` = p_id AND `user_id` = p_user_id;
    SELECT COUNT(*) AS updated FROM `college_applications`
     WHERE `id` = p_id AND `user_id` = p_user_id;
END$$

DROP PROCEDURE IF EXISTS `sp_collegeapp_delete_owner`$$
CREATE PROCEDURE `sp_collegeapp_delete_owner`(IN p_id CHAR(36), IN p_user_id CHAR(36))
BEGIN
    DELETE FROM `college_applications` WHERE `id` = p_id AND `user_id` = p_user_id;
    SELECT ROW_COUNT() AS deleted;
END$$

DELIMITER ;
