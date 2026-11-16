-- SKOVO — Tailored endpoint SPs: sop_documents (per-user, hard-delete)
DELIMITER $$

DROP PROCEDURE IF EXISTS `sp_sop_by_user`$$
CREATE PROCEDURE `sp_sop_by_user`(IN p_user_id CHAR(36), IN p_doc_type VARCHAR(30))
BEGIN
    SELECT * FROM `sop_documents`
     WHERE `user_id` = p_user_id
       AND (p_doc_type IS NULL OR p_doc_type = '' OR `doc_type` = p_doc_type)
     ORDER BY `updated_at` DESC;
END$$

DROP PROCEDURE IF EXISTS `sp_sop_get_owner`$$
CREATE PROCEDURE `sp_sop_get_owner`(IN p_id CHAR(36), IN p_user_id CHAR(36))
BEGIN
    SELECT * FROM `sop_documents` WHERE `id` = p_id AND `user_id` = p_user_id LIMIT 1;
END$$

DROP PROCEDURE IF EXISTS `sp_sop_create`$$
CREATE PROCEDURE `sp_sop_create`(
    IN p_id CHAR(36), IN p_user_id CHAR(36), IN p_title VARCHAR(500), IN p_doc_type VARCHAR(30),
    IN p_target_institution VARCHAR(500), IN p_target_program VARCHAR(300),
    IN p_content TEXT, IN p_word_count INT, IN p_status VARCHAR(20))
BEGIN
    IF p_id IS NULL OR p_id = '' THEN SET p_id = UUID(); END IF;
    INSERT INTO `sop_documents`
        (`id`,`user_id`,`title`,`doc_type`,`target_institution`,`target_program`,
         `content`,`word_count`,`status`)
    VALUES (p_id, p_user_id, p_title, COALESCE(p_doc_type,'sop'), p_target_institution,
            p_target_program, p_content, p_word_count, COALESCE(p_status,'draft'));
    SELECT * FROM `sop_documents` WHERE `id` = p_id;
END$$

DROP PROCEDURE IF EXISTS `sp_sop_update_owner`$$
CREATE PROCEDURE `sp_sop_update_owner`(
    IN p_id CHAR(36), IN p_user_id CHAR(36), IN p_title VARCHAR(500), IN p_doc_type VARCHAR(30),
    IN p_target_institution VARCHAR(500), IN p_target_program VARCHAR(300),
    IN p_status VARCHAR(20), IN p_content TEXT, IN p_word_count INT)
BEGIN
    UPDATE `sop_documents` SET
        `title`              = COALESCE(p_title, `title`),
        `doc_type`           = COALESCE(p_doc_type, `doc_type`),
        `target_institution` = COALESCE(p_target_institution, `target_institution`),
        `target_program`     = COALESCE(p_target_program, `target_program`),
        `status`             = COALESCE(p_status, `status`),
        `content`            = COALESCE(p_content, `content`),
        `word_count`         = COALESCE(p_word_count, `word_count`)
     WHERE `id` = p_id AND `user_id` = p_user_id;
    SELECT `word_count` AS word_count
      FROM `sop_documents` WHERE `id` = p_id AND `user_id` = p_user_id LIMIT 1;
END$$

DROP PROCEDURE IF EXISTS `sp_sop_delete_owner`$$
CREATE PROCEDURE `sp_sop_delete_owner`(IN p_id CHAR(36), IN p_user_id CHAR(36))
BEGIN
    DELETE FROM `sop_documents` WHERE `id` = p_id AND `user_id` = p_user_id;
    SELECT ROW_COUNT() AS deleted;
END$$

DELIMITER ;
