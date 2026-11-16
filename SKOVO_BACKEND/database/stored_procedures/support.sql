-- SKOVO stored procedures: Help & support
-- sp_support_contacts_{list,get,create,update,delete}
-- sp_support_issues_{create,list,get,update_status,list_for_user}

DELIMITER $$

DROP PROCEDURE IF EXISTS `sp_support_contacts_list`$$

CREATE PROCEDURE `sp_support_contacts_list`(
    IN p_audience VARCHAR(20),
    IN p_active_only TINYINT
)
BEGIN
    SELECT * FROM `support_contacts`
    WHERE (p_audience IS NULL OR p_audience = '' OR `audience` = p_audience)
      AND (p_active_only IS NULL OR p_active_only = 0 OR `is_active` = 1)
    ORDER BY `sort_order` ASC, `created_at` ASC;
END$$

DROP PROCEDURE IF EXISTS `sp_support_contacts_create`$$

CREATE PROCEDURE `sp_support_contacts_create`(
    IN p_id CHAR(36),
    IN p_audience VARCHAR(20),
    IN p_channel VARCHAR(20),
    IN p_value VARCHAR(255),
    IN p_label VARCHAR(80),
    IN p_hours VARCHAR(120),
    IN p_sort_order INT,
    IN p_is_active TINYINT,
    IN p_created_by CHAR(36)
)
BEGIN
    IF p_id IS NULL OR p_id = '' THEN SET p_id = UUID(); END IF;
    IF p_sort_order IS NULL THEN SET p_sort_order = 0; END IF;
    IF p_is_active IS NULL THEN SET p_is_active = 1; END IF;
    INSERT INTO `support_contacts`
        (`id`, `audience`, `channel`, `value`, `label`, `hours`, `sort_order`, `is_active`, `created_by`)
    VALUES
        (p_id, p_audience, p_channel, p_value, p_label, p_hours, p_sort_order, p_is_active, p_created_by);
    SELECT * FROM `support_contacts` WHERE `id` = p_id;
END$$

DROP PROCEDURE IF EXISTS `sp_support_contacts_update`$$

CREATE PROCEDURE `sp_support_contacts_update`(
    IN p_id CHAR(36),
    IN p_audience VARCHAR(20),
    IN p_channel VARCHAR(20),
    IN p_value VARCHAR(255),
    IN p_label VARCHAR(80),
    IN p_hours VARCHAR(120),
    IN p_sort_order INT,
    IN p_is_active TINYINT
)
BEGIN
    UPDATE `support_contacts`
    SET `audience` = p_audience,
        `channel` = p_channel,
        `value` = p_value,
        `label` = p_label,
        `hours` = p_hours,
        `sort_order` = IFNULL(p_sort_order, `sort_order`),
        `is_active` = IFNULL(p_is_active, `is_active`)
    WHERE `id` = p_id;
    SELECT * FROM `support_contacts` WHERE `id` = p_id;
END$$

DROP PROCEDURE IF EXISTS `sp_support_contacts_get`$$

CREATE PROCEDURE `sp_support_contacts_get`(
    IN p_id CHAR(36)
)
BEGIN
    SELECT * FROM `support_contacts` WHERE `id` = p_id;
END$$

DROP PROCEDURE IF EXISTS `sp_support_contacts_delete`$$

CREATE PROCEDURE `sp_support_contacts_delete`(
    IN p_id CHAR(36)
)
BEGIN
    DELETE FROM `support_contacts` WHERE `id` = p_id;
    SELECT 1 AS ok;
END$$

DROP PROCEDURE IF EXISTS `sp_support_issues_create`$$

CREATE PROCEDURE `sp_support_issues_create`(
    IN p_id CHAR(36),
    IN p_user_id CHAR(36),
    IN p_contact_email VARCHAR(255),
    IN p_portal VARCHAR(20),
    IN p_subject VARCHAR(200),
    IN p_body TEXT,
    IN p_category VARCHAR(40),
    IN p_status VARCHAR(20),
    IN p_reference_type VARCHAR(50),
    IN p_reference_id VARCHAR(36),
    IN p_source VARCHAR(20),
    IN p_created_by CHAR(36)
)
BEGIN
    IF p_id IS NULL OR p_id = '' THEN SET p_id = UUID(); END IF;
    IF p_status IS NULL OR p_status = '' THEN SET p_status = 'open'; END IF;
    IF p_category IS NULL OR p_category = '' THEN SET p_category = 'other'; END IF;
    IF p_source IS NULL OR p_source = '' THEN SET p_source = 'web'; END IF;
    INSERT INTO `support_issues`
        (`id`, `user_id`, `contact_email`, `portal`, `subject`, `body`, `category`, `status`,
         `reference_type`, `reference_id`, `source`, `created_by`)
    VALUES
        (p_id, p_user_id, p_contact_email, p_portal, p_subject, p_body, p_category, p_status,
         p_reference_type, p_reference_id, p_source, p_created_by);
    SELECT * FROM `support_issues` WHERE `id` = p_id;
END$$

DROP PROCEDURE IF EXISTS `sp_support_issues_list`$$

CREATE PROCEDURE `sp_support_issues_list`(
    IN p_portal VARCHAR(20),
    IN p_status VARCHAR(20),
    IN p_category VARCHAR(40),
    IN p_search VARCHAR(80),
    IN p_limit INT,
    IN p_offset INT
)
BEGIN
    IF p_limit IS NULL OR p_limit < 1 THEN SET p_limit = 20; END IF;
    IF p_limit > 100 THEN SET p_limit = 100; END IF;
    IF p_offset IS NULL OR p_offset < 0 THEN SET p_offset = 0; END IF;

    SELECT i.*, COUNT(*) OVER() AS total
    FROM `support_issues` i
    WHERE (p_portal IS NULL OR p_portal = '' OR i.`portal` = p_portal)
      AND (p_status IS NULL OR p_status = '' OR i.`status` = p_status)
      AND (p_category IS NULL OR p_category = '' OR i.`category` = p_category)
      AND (
        p_search IS NULL OR p_search = ''
        OR i.`id` = p_search
        OR i.`subject` LIKE CONCAT('%', p_search, '%')
        OR i.`contact_email` LIKE CONCAT('%', p_search, '%')
        OR MATCH(i.`subject`, i.`body`) AGAINST (p_search IN BOOLEAN MODE)
      )
    ORDER BY i.`created_at` DESC
    LIMIT p_limit OFFSET p_offset;
END$$

DROP PROCEDURE IF EXISTS `sp_support_issues_get`$$

CREATE PROCEDURE `sp_support_issues_get`(
    IN p_id CHAR(36)
)
BEGIN
    SELECT * FROM `support_issues` WHERE `id` = p_id;
END$$

DROP PROCEDURE IF EXISTS `sp_support_issues_update_status`$$

CREATE PROCEDURE `sp_support_issues_update_status`(
    IN p_id CHAR(36),
    IN p_status VARCHAR(20),
    IN p_actor_id CHAR(36)
)
BEGIN
    UPDATE `support_issues`
    SET `status` = p_status,
        `first_response_at` = CASE
            WHEN `first_response_at` IS NULL AND p_status IN ('in_progress', 'solved')
            THEN UTC_TIMESTAMP()
            ELSE `first_response_at`
        END,
        `resolved_at` = CASE WHEN p_status = 'solved' THEN UTC_TIMESTAMP() ELSE NULL END,
        `resolved_by` = CASE WHEN p_status = 'solved' THEN p_actor_id ELSE NULL END
    WHERE `id` = p_id;
    SELECT * FROM `support_issues` WHERE `id` = p_id;
END$$

DROP PROCEDURE IF EXISTS `sp_support_issues_list_for_user`$$

CREATE PROCEDURE `sp_support_issues_list_for_user`(
    IN p_user_id CHAR(36),
    IN p_portal VARCHAR(20)
)
BEGIN
    SELECT * FROM `support_issues`
    WHERE `user_id` = p_user_id
      AND (p_portal IS NULL OR p_portal = '' OR `portal` = p_portal)
    ORDER BY `created_at` DESC
    LIMIT 100;
END$$

DELIMITER ;
