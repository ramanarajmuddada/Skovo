-- SKOVO — Tailored endpoint SPs: document_vault (per-user, soft-delete)
DELIMITER $$

DROP PROCEDURE IF EXISTS `sp_docvault_by_user`$$
CREATE PROCEDURE `sp_docvault_by_user`(IN p_user_id CHAR(36), IN p_category VARCHAR(50))
BEGIN
    SELECT * FROM `document_vault`
     WHERE `user_id` = p_user_id AND `is_active` = 1
       AND (p_category IS NULL OR p_category = '' OR `category` = p_category)
     ORDER BY `created_at` DESC;
END$$

DROP PROCEDURE IF EXISTS `sp_docvault_create`$$
CREATE PROCEDURE `sp_docvault_create`(
    IN p_id CHAR(36), IN p_user_id CHAR(36), IN p_name VARCHAR(500),
    IN p_file_url TEXT, IN p_file_type VARCHAR(50), IN p_file_size INT,
    IN p_category VARCHAR(50), IN p_tags JSON)
BEGIN
    IF p_id IS NULL OR p_id = '' THEN SET p_id = UUID(); END IF;
    INSERT INTO `document_vault`
        (`id`,`user_id`,`name`,`file_url`,`file_type`,`file_size`,`category`,`tags`)
    VALUES (p_id, p_user_id, p_name, p_file_url, p_file_type, p_file_size,
            COALESCE(p_category,'general'), p_tags);
    SELECT * FROM `document_vault` WHERE `id` = p_id;
END$$

DROP PROCEDURE IF EXISTS `sp_docvault_update_owner`$$
CREATE PROCEDURE `sp_docvault_update_owner`(
    IN p_id CHAR(36), IN p_user_id CHAR(36),
    IN p_name VARCHAR(500), IN p_category VARCHAR(50), IN p_tags JSON)
BEGIN
    UPDATE `document_vault` SET
        `name`     = COALESCE(p_name, `name`),
        `category` = COALESCE(p_category, `category`),
        `tags`     = COALESCE(p_tags, `tags`)
     WHERE `id` = p_id AND `user_id` = p_user_id AND `is_active` = 1;
    SELECT COUNT(*) AS updated FROM `document_vault`
     WHERE `id` = p_id AND `user_id` = p_user_id AND `is_active` = 1;
END$$

-- Replacing the file behind a document. Deliberately a separate procedure
-- rather than two more arguments on sp_docvault_update_owner: procedures are
-- reloaded straight into the shared RDS, so widening that signature would break
-- every checkout still making the five-argument call. Additive is safe.
DROP PROCEDURE IF EXISTS `sp_docvault_update_file`$$
CREATE PROCEDURE `sp_docvault_update_file`(
    IN p_id CHAR(36), IN p_user_id CHAR(36),
    IN p_file_url TEXT, IN p_file_type VARCHAR(50))
BEGIN
    UPDATE `document_vault` SET
        `file_url`  = COALESCE(NULLIF(p_file_url, ''), `file_url`),
        `file_type` = COALESCE(NULLIF(p_file_type, ''), `file_type`)
     WHERE `id` = p_id AND `user_id` = p_user_id AND `is_active` = 1;
    SELECT COUNT(*) AS updated FROM `document_vault`
     WHERE `id` = p_id AND `user_id` = p_user_id AND `is_active` = 1;
END$$

DROP PROCEDURE IF EXISTS `sp_docvault_delete_owner`$$
CREATE PROCEDURE `sp_docvault_delete_owner`(IN p_id CHAR(36), IN p_user_id CHAR(36))
BEGIN
    UPDATE `document_vault` SET `is_active` = 0
     WHERE `id` = p_id AND `user_id` = p_user_id AND `is_active` = 1;
    SELECT ROW_COUNT() AS deleted;
END$$

DELIMITER ;
