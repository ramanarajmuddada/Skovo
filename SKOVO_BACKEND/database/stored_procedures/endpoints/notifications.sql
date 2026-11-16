-- SKOVO — Tailored endpoint SPs: notifications
DELIMITER $$

DROP PROCEDURE IF EXISTS `sp_notif_register_device`$$
CREATE PROCEDURE `sp_notif_register_device`(
    IN p_id CHAR(36), IN p_user_id CHAR(36), IN p_token TEXT, IN p_platform VARCHAR(10))
BEGIN
    IF EXISTS (SELECT 1 FROM `device_tokens` WHERE `token` = p_token) THEN
        UPDATE `device_tokens` SET `user_id` = p_user_id, `platform` = p_platform
         WHERE `token` = p_token;
    ELSE
        INSERT INTO `device_tokens` (`id`,`user_id`,`token`,`platform`)
        VALUES (p_id, p_user_id, p_token, p_platform);
    END IF;
END$$

DROP PROCEDURE IF EXISTS `sp_notif_list`$$
CREATE PROCEDURE `sp_notif_list`(IN p_user_id CHAR(36))
BEGIN
    SELECT * FROM `notification_logs`
     WHERE `user_id` = p_user_id
     ORDER BY `created_at` DESC LIMIT 50;
END$$

-- One page with total_rows, so the screen can offer "Load more".
DROP PROCEDURE IF EXISTS `sp_notif_list_page`$$
CREATE PROCEDURE `sp_notif_list_page`(IN p_user_id CHAR(36), IN p_limit INT, IN p_offset INT)
BEGIN
    SELECT n.*, COUNT(*) OVER() AS total_rows
      FROM `notification_logs` n
     WHERE n.`user_id` = p_user_id
     ORDER BY n.`created_at` DESC
     LIMIT p_limit OFFSET p_offset;
END$$

DROP PROCEDURE IF EXISTS `sp_notif_mark_unread`$$
CREATE PROCEDURE `sp_notif_mark_unread`(IN p_id CHAR(36), IN p_user_id CHAR(36))
BEGIN
    UPDATE `notification_logs` SET `is_read` = 0
     WHERE `id` = p_id AND `user_id` = p_user_id;
    SELECT COUNT(*) AS updated FROM `notification_logs`
     WHERE `id` = p_id AND `user_id` = p_user_id;
END$$

DROP PROCEDURE IF EXISTS `sp_notif_unread_count`$$
CREATE PROCEDURE `sp_notif_unread_count`(IN p_user_id CHAR(36))
BEGIN
    SELECT COUNT(*) AS count FROM `notification_logs`
     WHERE `user_id` = p_user_id AND `is_read` = 0;
END$$

DROP PROCEDURE IF EXISTS `sp_notif_mark_all_read`$$
CREATE PROCEDURE `sp_notif_mark_all_read`(IN p_user_id CHAR(36))
BEGIN
    UPDATE `notification_logs` SET `is_read` = 1
     WHERE `user_id` = p_user_id AND `is_read` = 0;
END$$

DROP PROCEDURE IF EXISTS `sp_notif_mark_read`$$
CREATE PROCEDURE `sp_notif_mark_read`(IN p_id CHAR(36), IN p_user_id CHAR(36))
BEGIN
    UPDATE `notification_logs` SET `is_read` = 1
     WHERE `id` = p_id AND `user_id` = p_user_id;
    SELECT COUNT(*) AS updated FROM `notification_logs`
     WHERE `id` = p_id AND `user_id` = p_user_id;
END$$

-- SSE stream poll: rows newer than p_last_id (NULL = from the start).
DROP PROCEDURE IF EXISTS `sp_notif_stream_after`$$
CREATE PROCEDURE `sp_notif_stream_after`(IN p_user_id CHAR(36), IN p_last_id CHAR(36))
BEGIN
    SELECT * FROM `notification_logs`
     WHERE `user_id` = p_user_id
       AND (p_last_id IS NULL OR `id` > p_last_id)
     ORDER BY `created_at` ASC LIMIT 20;
END$$

DELIMITER ;
