-- SKOVO stored procedures: achiever_guidelines (admin-editable achiever copy)
-- Table: database/migrations/migrate_v21_achiever_guidelines.py

DELIMITER $$

DROP PROCEDURE IF EXISTS `sp_ach_guidelines_get`$$
CREATE PROCEDURE `sp_ach_guidelines_get`(IN p_state VARCHAR(20))
BEGIN
    SELECT * FROM achiever_guidelines WHERE state = p_state;
END$$

DROP PROCEDURE IF EXISTS `sp_ach_guidelines_list`$$
CREATE PROCEDURE `sp_ach_guidelines_list`()
BEGIN
    SELECT g.*, u.full_name AS updated_by_name
      FROM achiever_guidelines g LEFT JOIN admins u ON u.id = g.updated_by;
END$$

DROP PROCEDURE IF EXISTS `sp_ach_guidelines_set`$$
CREATE PROCEDURE `sp_ach_guidelines_set`(IN p_state VARCHAR(20), IN p_content JSON, IN p_admin CHAR(36))
BEGIN
    INSERT INTO achiever_guidelines (state, content, version, updated_by)
    VALUES (p_state, p_content, 1, p_admin)
    ON DUPLICATE KEY UPDATE content = p_content, version = version + 1, updated_by = p_admin;
    SELECT * FROM achiever_guidelines WHERE state = p_state;
END$$

DROP PROCEDURE IF EXISTS `sp_ach_guidelines_reset`$$
CREATE PROCEDURE `sp_ach_guidelines_reset`(IN p_state VARCHAR(20))
BEGIN
    DELETE FROM achiever_guidelines WHERE state = p_state;
    SELECT ROW_COUNT() AS affected;
END$$

DELIMITER ;
