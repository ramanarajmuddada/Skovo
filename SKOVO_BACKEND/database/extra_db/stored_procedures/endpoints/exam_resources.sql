-- SKOVO — Tailored endpoint SPs: exam_resources
DELIMITER $$

DROP PROCEDURE IF EXISTS `sp_examres_list_all`$$
CREATE PROCEDURE `sp_examres_list_all`()
BEGIN
    SELECT * FROM `exam_resources` ORDER BY `created_at` DESC;
END$$

DROP PROCEDURE IF EXISTS `sp_examres_student_list`$$
CREATE PROCEDURE `sp_examres_student_list`(IN p_exam_type VARCHAR(50), IN p_resource_type VARCHAR(30))
BEGIN
    SELECT * FROM `exam_resources`
     WHERE `is_active` = 1
       AND (p_exam_type IS NULL OR p_exam_type = '' OR `exam_type` = p_exam_type)
       AND (p_resource_type IS NULL OR p_resource_type = '' OR `resource_type` = p_resource_type)
     ORDER BY `downloads` DESC;
END$$

DROP PROCEDURE IF EXISTS `sp_examres_create`$$
CREATE PROCEDURE `sp_examres_create`(
    IN p_id CHAR(36), IN p_title VARCHAR(500), IN p_description TEXT, IN p_exam_type VARCHAR(50),
    IN p_subject VARCHAR(100), IN p_resource_type VARCHAR(30), IN p_file_url TEXT,
    IN p_external_url TEXT, IN p_thumbnail_url TEXT, IN p_tags JSON,
    IN p_is_free TINYINT, IN p_is_active TINYINT, IN p_created_by CHAR(36))
BEGIN
    IF p_id IS NULL OR p_id = '' THEN SET p_id = UUID(); END IF;
    INSERT INTO `exam_resources`
        (`id`,`title`,`description`,`exam_type`,`subject`,`resource_type`,`file_url`,
         `external_url`,`thumbnail_url`,`tags`,`is_free`,`is_active`,`created_by`)
    VALUES (p_id, p_title, p_description, p_exam_type, p_subject, COALESCE(p_resource_type,'notes'),
            p_file_url, p_external_url, p_thumbnail_url, p_tags,
            COALESCE(p_is_free,1), COALESCE(p_is_active,1), p_created_by);
    SELECT p_id AS id;
END$$

DROP PROCEDURE IF EXISTS `sp_examres_update`$$
CREATE PROCEDURE `sp_examres_update`(
    IN p_id CHAR(36), IN p_title VARCHAR(500), IN p_description TEXT, IN p_exam_type VARCHAR(50),
    IN p_subject VARCHAR(100), IN p_resource_type VARCHAR(30), IN p_file_url TEXT,
    IN p_external_url TEXT, IN p_thumbnail_url TEXT, IN p_tags JSON,
    IN p_is_active TINYINT, IN p_is_free TINYINT, IN p_updated_by CHAR(36))
BEGIN
    UPDATE `exam_resources` SET
        `title`         = COALESCE(p_title, `title`),
        `description`   = COALESCE(p_description, `description`),
        `exam_type`     = COALESCE(p_exam_type, `exam_type`),
        `subject`       = COALESCE(p_subject, `subject`),
        `resource_type` = COALESCE(p_resource_type, `resource_type`),
        `file_url`      = COALESCE(p_file_url, `file_url`),
        `external_url`  = COALESCE(p_external_url, `external_url`),
        `thumbnail_url` = COALESCE(p_thumbnail_url, `thumbnail_url`),
        `tags`          = COALESCE(p_tags, `tags`),
        `is_active`     = COALESCE(p_is_active, `is_active`),
        `is_free`       = COALESCE(p_is_free, `is_free`),
        `updated_by`    = COALESCE(p_updated_by, `updated_by`)
     WHERE `id` = p_id;
    SELECT COUNT(*) AS updated FROM `exam_resources` WHERE `id` = p_id;
END$$

DROP PROCEDURE IF EXISTS `sp_examres_soft_delete`$$
CREATE PROCEDURE `sp_examres_soft_delete`(IN p_id CHAR(36))
BEGIN
    UPDATE `exam_resources` SET `is_active` = 0 WHERE `id` = p_id;
    SELECT COUNT(*) AS deleted FROM `exam_resources` WHERE `id` = p_id;
END$$

-- Download: result 'notfound' | 'premium' | 'ok' (+ file_url, external_url)
DROP PROCEDURE IF EXISTS `sp_examres_download`$$
CREATE PROCEDURE `sp_examres_download`(IN p_id CHAR(36))
BEGIN
    DECLARE v_free TINYINT; DECLARE v_file TEXT; DECLARE v_ext TEXT;
    IF NOT EXISTS (SELECT 1 FROM `exam_resources` WHERE `id` = p_id AND `is_active` = 1) THEN
        SELECT 'notfound' AS result, NULL AS file_url, NULL AS external_url;
    ELSE
        SELECT `is_free`, `file_url`, `external_url` INTO v_free, v_file, v_ext
          FROM `exam_resources` WHERE `id` = p_id AND `is_active` = 1 LIMIT 1;
        IF v_free = 0 THEN
            SELECT 'premium' AS result, NULL AS file_url, NULL AS external_url;
        ELSE
            UPDATE `exam_resources` SET `downloads` = IFNULL(`downloads`,0) + 1 WHERE `id` = p_id;
            SELECT 'ok' AS result, v_file AS file_url, v_ext AS external_url;
        END IF;
    END IF;
END$$

DELIMITER ;
