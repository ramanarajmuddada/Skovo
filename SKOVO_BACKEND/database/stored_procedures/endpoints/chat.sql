-- SKOVO — Tailored endpoint SPs: chat (per-session messaging)
DELIMITER $$

-- Access check: returns the session's student_id + mentor_id (empty if missing).
DROP PROCEDURE IF EXISTS `sp_chat_session_actors`$$
CREATE PROCEDURE `sp_chat_session_actors`(IN p_session_id CHAR(36))
BEGIN
    SELECT `student_id`, `mentor_id` FROM `achiever_sessions` WHERE `id` = p_session_id LIMIT 1;
END$$

-- Mark unread (from the other party) as read, then return the thread ascending.
DROP PROCEDURE IF EXISTS `sp_chat_messages_read_and_list`$$
CREATE PROCEDURE `sp_chat_messages_read_and_list`(IN p_session_id CHAR(36), IN p_user_id CHAR(36))
BEGIN
    UPDATE `session_messages`
       SET `is_read` = 1
     WHERE `session_id` = p_session_id AND `sender_id` <> p_user_id AND `is_read` = 0;
    SELECT * FROM `session_messages`
     WHERE `session_id` = p_session_id
     ORDER BY `created_at` ASC;
END$$

DROP PROCEDURE IF EXISTS `sp_chat_message_create`$$
CREATE PROCEDURE `sp_chat_message_create`(
    IN p_id CHAR(36), IN p_session_id CHAR(36), IN p_sender_id CHAR(36),
    IN p_sender_role VARCHAR(20), IN p_body TEXT)
BEGIN
    IF p_id IS NULL OR p_id = '' THEN SET p_id = UUID(); END IF;
    INSERT INTO `session_messages` (`id`,`session_id`,`sender_id`,`sender_role`,`body`)
    VALUES (p_id, p_session_id, p_sender_id, p_sender_role, p_body);
    SELECT * FROM `session_messages` WHERE `id` = p_id;
END$$

DROP PROCEDURE IF EXISTS `sp_chat_unread_count`$$
CREATE PROCEDURE `sp_chat_unread_count`(IN p_session_id CHAR(36), IN p_user_id CHAR(36))
BEGIN
    SELECT COUNT(*) AS count FROM `session_messages`
     WHERE `session_id` = p_session_id AND `sender_id` <> p_user_id AND `is_read` = 0;
END$$

DELIMITER ;
