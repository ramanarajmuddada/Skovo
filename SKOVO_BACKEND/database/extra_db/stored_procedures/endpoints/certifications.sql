-- ============================================================
-- SKOVO — Tailored endpoint stored procedures: certifications
-- Per-user CRUD with ownership (id + user_id) on update/delete.
-- ============================================================

DELIMITER $$

DROP PROCEDURE IF EXISTS `sp_certifications_by_user`$$
CREATE PROCEDURE `sp_certifications_by_user`(IN p_user_id CHAR(36))
BEGIN
    SELECT * FROM `user_certifications`
     WHERE `user_id` = p_user_id
     ORDER BY `issue_date` DESC;
END$$

DROP PROCEDURE IF EXISTS `sp_certifications_create`$$
CREATE PROCEDURE `sp_certifications_create`(
    IN p_id CHAR(36), IN p_user_id CHAR(36), IN p_title VARCHAR(500),
    IN p_provider VARCHAR(300), IN p_credential_id VARCHAR(200),
    IN p_issue_date DATE, IN p_expiry_date DATE,
    IN p_certificate_url TEXT, IN p_skills JSON
)
BEGIN
    IF p_id IS NULL OR p_id = '' THEN SET p_id = UUID(); END IF;
    INSERT INTO `user_certifications`
        (`id`,`user_id`,`title`,`provider`,`credential_id`,`issue_date`,
         `expiry_date`,`certificate_url`,`skills`)
    VALUES (p_id, p_user_id, p_title, p_provider, p_credential_id, p_issue_date,
            p_expiry_date, p_certificate_url, p_skills);
    SELECT * FROM `user_certifications` WHERE `id` = p_id;
END$$

DROP PROCEDURE IF EXISTS `sp_certifications_update_owner`$$
CREATE PROCEDURE `sp_certifications_update_owner`(
    IN p_id CHAR(36), IN p_user_id CHAR(36), IN p_title VARCHAR(500),
    IN p_provider VARCHAR(300), IN p_credential_id VARCHAR(200),
    IN p_issue_date DATE, IN p_expiry_date DATE,
    IN p_certificate_url TEXT, IN p_skills JSON
)
BEGIN
    UPDATE `user_certifications` SET
        `title`           = COALESCE(p_title, `title`),
        `provider`        = COALESCE(p_provider, `provider`),
        `credential_id`   = COALESCE(p_credential_id, `credential_id`),
        `issue_date`      = COALESCE(p_issue_date, `issue_date`),
        `expiry_date`     = COALESCE(p_expiry_date, `expiry_date`),
        `certificate_url` = COALESCE(p_certificate_url, `certificate_url`),
        `skills`          = COALESCE(p_skills, `skills`)
     WHERE `id` = p_id AND `user_id` = p_user_id;
    SELECT COUNT(*) AS updated FROM `user_certifications`
     WHERE `id` = p_id AND `user_id` = p_user_id;
END$$

DROP PROCEDURE IF EXISTS `sp_certifications_delete_owner`$$
CREATE PROCEDURE `sp_certifications_delete_owner`(IN p_id CHAR(36), IN p_user_id CHAR(36))
BEGIN
    DELETE FROM `user_certifications` WHERE `id` = p_id AND `user_id` = p_user_id;
    SELECT ROW_COUNT() AS deleted;
END$$

DELIMITER ;
