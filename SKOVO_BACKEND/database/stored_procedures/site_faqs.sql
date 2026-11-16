-- Landing-page FAQs: public list + Admin add / edit / hide / delete / reorder.

DELIMITER $$

-- Public: active FAQs in display order.
DROP PROCEDURE IF EXISTS `sp_site_faqs_public`$$
CREATE PROCEDURE `sp_site_faqs_public`()
BEGIN
    SELECT `id`, `question`, `answer`
      FROM `site_faqs`
     WHERE `deleted_at` IS NULL AND `is_active` = 1
     ORDER BY `sort_order` ASC, `created_at` ASC;
END$$

-- Admin: every FAQ that is not deleted, hidden ones included.
DROP PROCEDURE IF EXISTS `sp_site_faqs_admin_list`$$
CREATE PROCEDURE `sp_site_faqs_admin_list`()
BEGIN
    SELECT `id`, `question`, `answer`, `sort_order`, `is_active`, `updated_at`
      FROM `site_faqs`
     WHERE `deleted_at` IS NULL
     ORDER BY `sort_order` ASC, `created_at` ASC;
END$$

-- Admin: add at the end of the list.
DROP PROCEDURE IF EXISTS `sp_site_faq_create`$$
CREATE PROCEDURE `sp_site_faq_create`(IN p_id CHAR(36), IN p_question VARCHAR(300),
                                      IN p_answer TEXT, IN p_active TINYINT, IN p_admin CHAR(36))
BEGIN
    DECLARE v_next INT DEFAULT 0;
    SELECT IFNULL(MAX(`sort_order`), 0) + 1 INTO v_next FROM `site_faqs` WHERE `deleted_at` IS NULL;
    INSERT INTO `site_faqs` (`id`, `question`, `answer`, `sort_order`, `is_active`, `created_by`, `updated_by`)
    VALUES (p_id, p_question, p_answer, v_next, IFNULL(p_active, 1), p_admin, p_admin);
    SELECT `id`, `question`, `answer`, `sort_order`, `is_active`, `updated_at` FROM `site_faqs` WHERE `id` = p_id;
END$$

-- Admin: edit text and visibility. NULL leaves a field as it is.
DROP PROCEDURE IF EXISTS `sp_site_faq_update`$$
CREATE PROCEDURE `sp_site_faq_update`(IN p_id CHAR(36), IN p_question VARCHAR(300),
                                      IN p_answer TEXT, IN p_active TINYINT, IN p_admin CHAR(36))
BEGIN
    UPDATE `site_faqs`
       SET `question`   = IFNULL(p_question, `question`),
           `answer`     = IFNULL(p_answer, `answer`),
           `is_active`  = IFNULL(p_active, `is_active`),
           `updated_by` = p_admin
     WHERE `id` = p_id AND `deleted_at` IS NULL;
    SELECT `id`, `question`, `answer`, `sort_order`, `is_active`, `updated_at`
      FROM `site_faqs` WHERE `id` = p_id AND `deleted_at` IS NULL;
END$$

-- Admin: soft delete.
DROP PROCEDURE IF EXISTS `sp_site_faq_delete`$$
CREATE PROCEDURE `sp_site_faq_delete`(IN p_id CHAR(36), IN p_admin CHAR(36))
BEGIN
    UPDATE `site_faqs` SET `deleted_at` = UTC_TIMESTAMP(), `updated_by` = p_admin
     WHERE `id` = p_id AND `deleted_at` IS NULL;
    SELECT ROW_COUNT() AS deleted;
END$$

-- Admin: swap with the neighbour above (-1) or below (+1).
DROP PROCEDURE IF EXISTS `sp_site_faq_move`$$
CREATE PROCEDURE `sp_site_faq_move`(IN p_id CHAR(36), IN p_dir INT, IN p_admin CHAR(36))
BEGIN
    DECLARE v_mine INT DEFAULT NULL;
    DECLARE v_other_id CHAR(36) DEFAULT NULL;
    DECLARE v_other INT DEFAULT NULL;
    SELECT `sort_order` INTO v_mine FROM `site_faqs` WHERE `id` = p_id AND `deleted_at` IS NULL;
    IF p_dir < 0 THEN
        SELECT `id`, `sort_order` INTO v_other_id, v_other FROM `site_faqs`
         WHERE `deleted_at` IS NULL AND `sort_order` < v_mine ORDER BY `sort_order` DESC LIMIT 1;
    ELSE
        SELECT `id`, `sort_order` INTO v_other_id, v_other FROM `site_faqs`
         WHERE `deleted_at` IS NULL AND `sort_order` > v_mine ORDER BY `sort_order` ASC LIMIT 1;
    END IF;
    IF v_other_id IS NOT NULL THEN
        UPDATE `site_faqs` SET `sort_order` = v_other, `updated_by` = p_admin WHERE `id` = p_id;
        UPDATE `site_faqs` SET `sort_order` = v_mine,  `updated_by` = p_admin WHERE `id` = v_other_id;
    END IF;
    SELECT IF(v_other_id IS NULL, 0, 1) AS moved;
END$$

DELIMITER ;
