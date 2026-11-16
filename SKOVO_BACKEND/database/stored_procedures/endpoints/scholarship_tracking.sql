-- SKOVO — Tailored endpoint SPs: scholarship_tracking (per-user, hard-delete)
DELIMITER $$

DROP PROCEDURE IF EXISTS `sp_scholtrack_by_user`$$
CREATE PROCEDURE `sp_scholtrack_by_user`(IN p_user_id CHAR(36))
BEGIN
    SELECT * FROM `scholarship_tracking`
     WHERE `user_id` = p_user_id ORDER BY `created_at` DESC;
END$$

DROP PROCEDURE IF EXISTS `sp_scholtrack_create`$$
CREATE PROCEDURE `sp_scholtrack_create`(
    IN p_id CHAR(36), IN p_user_id CHAR(36), IN p_scholarship_id CHAR(36),
    IN p_scholarship_name VARCHAR(500), IN p_provider VARCHAR(300), IN p_amount INT,
    IN p_deadline_date DATE, IN p_status VARCHAR(30), IN p_applied_at DATE,
    IN p_result VARCHAR(30), IN p_notes TEXT, IN p_application_url TEXT)
BEGIN
    IF p_id IS NULL OR p_id = '' THEN SET p_id = UUID(); END IF;
    INSERT INTO `scholarship_tracking`
        (`id`,`user_id`,`scholarship_id`,`scholarship_name`,`provider`,`amount`,
         `deadline_date`,`status`,`applied_at`,`result`,`notes`,`application_url`)
    VALUES (p_id, p_user_id, p_scholarship_id, p_scholarship_name, p_provider, p_amount,
            p_deadline_date, COALESCE(p_status,'interested'), p_applied_at, p_result,
            p_notes, p_application_url);
    SELECT * FROM `scholarship_tracking` WHERE `id` = p_id;
END$$

DROP PROCEDURE IF EXISTS `sp_scholtrack_update_owner`$$
CREATE PROCEDURE `sp_scholtrack_update_owner`(
    IN p_id CHAR(36), IN p_user_id CHAR(36),
    IN p_scholarship_name VARCHAR(500), IN p_provider VARCHAR(300), IN p_amount INT,
    IN p_deadline_date DATE, IN p_status VARCHAR(30), IN p_applied_at DATE,
    IN p_result VARCHAR(30), IN p_notes TEXT, IN p_application_url TEXT)
BEGIN
    UPDATE `scholarship_tracking` SET
        `scholarship_name` = COALESCE(p_scholarship_name, `scholarship_name`),
        `provider`         = COALESCE(p_provider, `provider`),
        `amount`           = COALESCE(p_amount, `amount`),
        `deadline_date`    = COALESCE(p_deadline_date, `deadline_date`),
        `status`           = COALESCE(p_status, `status`),
        `applied_at`       = COALESCE(p_applied_at, `applied_at`),
        `result`           = COALESCE(p_result, `result`),
        `notes`            = COALESCE(p_notes, `notes`),
        `application_url`  = COALESCE(p_application_url, `application_url`)
     WHERE `id` = p_id AND `user_id` = p_user_id;
    SELECT COUNT(*) AS updated FROM `scholarship_tracking`
     WHERE `id` = p_id AND `user_id` = p_user_id;
END$$

DROP PROCEDURE IF EXISTS `sp_scholtrack_delete_owner`$$
CREATE PROCEDURE `sp_scholtrack_delete_owner`(IN p_id CHAR(36), IN p_user_id CHAR(36))
BEGIN
    DELETE FROM `scholarship_tracking` WHERE `id` = p_id AND `user_id` = p_user_id;
    SELECT ROW_COUNT() AS deleted;
END$$

DELIMITER ;
