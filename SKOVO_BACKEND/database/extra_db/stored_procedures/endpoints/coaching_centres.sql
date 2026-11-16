-- SKOVO — Tailored endpoint SPs: coaching_centres
DELIMITER $$

DROP PROCEDURE IF EXISTS `sp_coaching_count`$$
CREATE PROCEDURE `sp_coaching_count`(IN p_search VARCHAR(200), IN p_category VARCHAR(100), IN p_city VARCHAR(100))
BEGIN
    SELECT COUNT(*) AS total FROM `coaching_centres`
     WHERE `is_active` = 1 AND `deleted_at` IS NULL
       AND (p_search IS NULL OR p_search = ''
            OR `name` LIKE CONCAT('%', p_search, '%') OR `city` LIKE CONCAT('%', p_search, '%'))
       AND (p_category IS NULL OR p_category = '' OR JSON_CONTAINS(`categories`, JSON_QUOTE(p_category)))
       AND (p_city IS NULL OR p_city = '' OR `city` LIKE CONCAT('%', p_city, '%'));
END$$

DROP PROCEDURE IF EXISTS `sp_coaching_list`$$
CREATE PROCEDURE `sp_coaching_list`(
    IN p_search VARCHAR(200), IN p_category VARCHAR(100), IN p_city VARCHAR(100),
    IN p_limit INT, IN p_offset INT)
BEGIN
    SELECT * FROM `coaching_centres`
     WHERE `is_active` = 1 AND `deleted_at` IS NULL
       AND (p_search IS NULL OR p_search = ''
            OR `name` LIKE CONCAT('%', p_search, '%') OR `city` LIKE CONCAT('%', p_search, '%'))
       AND (p_category IS NULL OR p_category = '' OR JSON_CONTAINS(`categories`, JSON_QUOTE(p_category)))
       AND (p_city IS NULL OR p_city = '' OR `city` LIKE CONCAT('%', p_city, '%'))
     ORDER BY `created_at` DESC
     LIMIT p_limit OFFSET p_offset;
END$$

DROP PROCEDURE IF EXISTS `sp_coaching_get`$$
CREATE PROCEDURE `sp_coaching_get`(IN p_id CHAR(36))
BEGIN
    SELECT * FROM `coaching_centres` WHERE `id` = p_id AND `is_active` = 1 LIMIT 1;
END$$

-- Enquiry -> audit_logs row. result: 'notfound' | 'ok' (+ centre_name)
DROP PROCEDURE IF EXISTS `sp_coaching_enquire`$$
CREATE PROCEDURE `sp_coaching_enquire`(
    IN p_audit_id CHAR(36), IN p_user_id CHAR(36), IN p_centre_id CHAR(36),
    IN p_student_name VARCHAR(255), IN p_student_email VARCHAR(255), IN p_message TEXT)
BEGIN
    DECLARE v_name TEXT;
    SELECT `name` INTO v_name FROM `coaching_centres` WHERE `id` = p_centre_id AND `is_active` = 1 LIMIT 1;
    IF v_name IS NULL THEN
        SELECT 'notfound' AS result, NULL AS centre_name;
    ELSE
        INSERT INTO `audit_logs` (`id`,`user_id`,`action`,`resource_type`,`resource_id`,`meta`)
        VALUES (p_audit_id, p_user_id, 'coaching_enquiry', 'coaching_centre', p_centre_id,
                JSON_OBJECT('student_name', p_student_name, 'student_email', p_student_email,
                            'message', p_message, 'centre_name', v_name));
        SELECT 'ok' AS result, v_name AS centre_name;
    END IF;
END$$

DELIMITER ;
