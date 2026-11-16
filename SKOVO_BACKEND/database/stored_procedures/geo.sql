-- ============================================================
-- SKOVO stored procedures: states + cities
-- ============================================================
-- Geography master data, split out of the generic `masters` table because a
-- state owns cities (and, later, boards and state entrance exams) and a
-- key/label pair cannot express that.
--
-- Reads are what onboarding needs (list states, list/search cities in a state);
-- CRUD is here so the admin panel manages this like every other entity.
-- ============================================================

DELIMITER $$

-- ── states ───────────────────────────────────────────────────────────────────

DROP PROCEDURE IF EXISTS `sp_states_list`$$
CREATE PROCEDURE `sp_states_list`(IN p_only_active TINYINT)
BEGIN
    SELECT `id`, `code`, `name`, `kind`, `region`, `sort_order`, `is_active`
      FROM `states`
     WHERE (p_only_active = 0 OR `is_active` = 1)
     ORDER BY `sort_order`, `name`;
END$$

DROP PROCEDURE IF EXISTS `sp_states_get_by_code`$$
CREATE PROCEDURE `sp_states_get_by_code`(IN p_code VARCHAR(10))
BEGIN
    SELECT * FROM `states` WHERE `code` = p_code LIMIT 1;
END$$

-- ── cities ───────────────────────────────────────────────────────────────────

DROP PROCEDURE IF EXISTS `sp_cities_by_state`$$
CREATE PROCEDURE `sp_cities_by_state`(IN p_state_id CHAR(36), IN p_only_active TINYINT)
BEGIN
    SELECT c.`id`, c.`state_id`, c.`name`, c.`district`, c.`tier`, c.`sort_order`, c.`is_active`,
           s.`code` AS `state_code`, s.`name` AS `state_name`
      FROM `cities` c
      JOIN `states` s ON s.`id` = c.`state_id`
     WHERE c.`state_id` = p_state_id
       AND (p_only_active = 0 OR c.`is_active` = 1)
     ORDER BY c.`sort_order`, c.`name`;
END$$

DROP PROCEDURE IF EXISTS `sp_cities_by_state_code`$$
CREATE PROCEDURE `sp_cities_by_state_code`(IN p_state_code VARCHAR(10), IN p_only_active TINYINT)
BEGIN
    SELECT c.`id`, c.`state_id`, c.`name`, c.`district`, c.`tier`, c.`sort_order`, c.`is_active`,
           s.`code` AS `state_code`, s.`name` AS `state_name`
      FROM `cities` c
      JOIN `states` s ON s.`id` = c.`state_id`
     WHERE s.`code` = p_state_code
       AND (p_only_active = 0 OR c.`is_active` = 1)
     ORDER BY c.`sort_order`, c.`name`;
END$$

DROP PROCEDURE IF EXISTS `sp_cities_search`$$
CREATE PROCEDURE `sp_cities_search`(IN p_query VARCHAR(120), IN p_state_id CHAR(36), IN p_limit INT)
BEGIN
    IF p_limit IS NULL OR p_limit <= 0 THEN SET p_limit = 25; END IF;
    SELECT c.`id`, c.`state_id`, c.`name`, c.`district`, c.`tier`,
           s.`code` AS `state_code`, s.`name` AS `state_name`
      FROM `cities` c
      JOIN `states` s ON s.`id` = c.`state_id`
     WHERE c.`is_active` = 1
       AND (p_state_id IS NULL OR c.`state_id` = p_state_id)
       AND (p_query IS NULL OR p_query = '' OR c.`name` LIKE CONCAT(p_query, '%'))
     ORDER BY (c.`name` = p_query) DESC, c.`tier` IS NULL, c.`tier`, c.`name`
     LIMIT p_limit;
END$$

DROP PROCEDURE IF EXISTS `sp_cities_create`$$
CREATE PROCEDURE `sp_cities_create`(
    IN p_id CHAR(36), IN p_state_id CHAR(36), IN p_name VARCHAR(120),
    IN p_district VARCHAR(120), IN p_tier INT,
    IN p_sort_order INT, IN p_is_active TINYINT(1), IN p_created_by CHAR(36)
)
BEGIN
    IF p_id IS NULL OR p_id = '' THEN SET p_id = UUID(); END IF;
    INSERT INTO `cities` (`id`, `state_id`, `name`, `district`, `tier`, `sort_order`, `is_active`, `created_by`, `updated_by`)
    VALUES (p_id, p_state_id, p_name, p_district, p_tier,
            COALESCE(p_sort_order, 0), COALESCE(p_is_active, 1), p_created_by, p_created_by)
    ON DUPLICATE KEY UPDATE
        `district` = COALESCE(p_district, `district`), `tier` = COALESCE(p_tier, `tier`),
        `sort_order` = COALESCE(p_sort_order, `sort_order`), `is_active` = COALESCE(p_is_active, `is_active`),
        `updated_by` = p_created_by;
    SELECT * FROM `cities` WHERE `state_id` = p_state_id AND `name` = p_name LIMIT 1;
END$$

DROP PROCEDURE IF EXISTS `sp_cities_update`$$
CREATE PROCEDURE `sp_cities_update`(
    IN p_id CHAR(36), IN p_state_id CHAR(36), IN p_name VARCHAR(120),
    IN p_district VARCHAR(120), IN p_tier INT,
    IN p_sort_order INT, IN p_is_active TINYINT(1), IN p_updated_by CHAR(36)
)
BEGIN
    UPDATE `cities`
       SET `state_id`   = COALESCE(p_state_id, `state_id`),
           `name`       = COALESCE(p_name, `name`),
           `district`   = COALESCE(p_district, `district`),
           `tier`       = COALESCE(p_tier, `tier`),
           `sort_order` = COALESCE(p_sort_order, `sort_order`),
           `is_active`  = COALESCE(p_is_active, `is_active`),
           `updated_by` = p_updated_by
     WHERE `id` = p_id;
    SELECT * FROM `cities` WHERE `id` = p_id;
END$$

DROP PROCEDURE IF EXISTS `sp_cities_delete`$$
CREATE PROCEDURE `sp_cities_delete`(IN p_id CHAR(36))
BEGIN
    UPDATE `cities` SET `is_active` = 0 WHERE `id` = p_id;
END$$

DELIMITER ;
