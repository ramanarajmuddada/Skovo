-- Company details (single row id = 1): public read, Admin edit.

DELIMITER $$

DROP PROCEDURE IF EXISTS `sp_company_details_get`$$
CREATE PROCEDURE `sp_company_details_get`()
BEGIN
    SELECT `legal_name`, `support_email`, `phone`, `registered_address`, `gstin`,
           `grievance_officer`, `grievance_email`, `jurisdiction`, `support_hours`, `updated_at`
      FROM `company_details` WHERE `id` = 1;
END$$

-- Every argument is the new value; '' clears a field back to "not confirmed".
DROP PROCEDURE IF EXISTS `sp_company_details_update`$$
CREATE PROCEDURE `sp_company_details_update`(
    IN p_legal_name VARCHAR(200), IN p_support_email VARCHAR(255), IN p_phone VARCHAR(30),
    IN p_address VARCHAR(400), IN p_gstin VARCHAR(20), IN p_officer VARCHAR(120),
    IN p_grievance_email VARCHAR(255), IN p_jurisdiction VARCHAR(200), IN p_hours VARCHAR(120),
    IN p_admin CHAR(36))
BEGIN
    INSERT INTO `company_details` (`id`) VALUES (1) ON DUPLICATE KEY UPDATE `id` = `id`;
    UPDATE `company_details`
       SET `legal_name`         = NULLIF(TRIM(p_legal_name), ''),
           `support_email`      = NULLIF(TRIM(p_support_email), ''),
           `phone`              = NULLIF(TRIM(p_phone), ''),
           `registered_address` = NULLIF(TRIM(p_address), ''),
           `gstin`              = NULLIF(UPPER(TRIM(p_gstin)), ''),
           `grievance_officer`  = NULLIF(TRIM(p_officer), ''),
           `grievance_email`    = NULLIF(TRIM(p_grievance_email), ''),
           `jurisdiction`       = NULLIF(TRIM(p_jurisdiction), ''),
           `support_hours`      = NULLIF(TRIM(p_hours), ''),
           `updated_by`         = p_admin
     WHERE `id` = 1;
    CALL `sp_company_details_get`();
END$$

DELIMITER ;
