-- SKOVO — assemble dm procedures.
--
-- Exported from the live schema by export_missing_procedures.py. These were
-- applied to the database by hand and never written back to source, so a
-- rebuild from this repo produced a database missing them.
--
-- Edit here, not in the database.

DELIMITER $$

DROP PROCEDURE IF EXISTS `sp_dm_block`$$
CREATE PROCEDURE `sp_dm_block`(IN `p_id` char(36), IN `p_user` char(36), IN `p_blocked` char(36))
BEGIN
      INSERT IGNORE INTO dm_blocks (id, user_id, blocked_user_id)
      VALUES (p_id, p_user, p_blocked);
      SELECT 1 AS ok, 'Member blocked.' AS message;
    END$$

DROP PROCEDURE IF EXISTS `sp_dm_conversations`$$
CREATE PROCEDURE `sp_dm_conversations`(IN `p_me` char(36))
BEGIN
      SELECT t.other_id,
             (SELECT m.body FROM direct_messages m
               WHERE (m.sender_id = p_me AND m.recipient_id = t.other_id)
                  OR (m.sender_id = t.other_id AND m.recipient_id = p_me)
               ORDER BY m.created_at DESC LIMIT 1) AS last_body,
             t.last_at, t.unread
        FROM (SELECT CASE WHEN sender_id = p_me THEN recipient_id ELSE sender_id END AS other_id,
                     MAX(created_at) AS last_at,
                     SUM(CASE WHEN recipient_id = p_me AND is_read = 0 THEN 1 ELSE 0 END) AS unread
                FROM direct_messages
               WHERE sender_id = p_me OR recipient_id = p_me
               GROUP BY other_id) t
       ORDER BY t.last_at DESC;
    END$$

DROP PROCEDURE IF EXISTS `sp_dm_report`$$
CREATE PROCEDURE `sp_dm_report`(IN `p_id` char(36), IN `p_reporter` char(36), IN `p_reported` char(36), IN `p_message_id` char(36), IN `p_reason` text)
BEGIN
      INSERT INTO dm_reports (id, reporter_id, reported_user_id, message_id, reason)
      VALUES (p_id, p_reporter, p_reported, p_message_id, p_reason);
      SELECT 1 AS ok, 'Report submitted. Our team will review it.' AS message;
    END$$

DROP PROCEDURE IF EXISTS `sp_dm_report_resolve`$$
CREATE PROCEDURE `sp_dm_report_resolve`(IN `p_id` char(36), IN `p_status` varchar(20))
BEGIN
      UPDATE dm_reports SET status = p_status WHERE id = p_id;
      SELECT ROW_COUNT() AS updated;
    END$$

DROP PROCEDURE IF EXISTS `sp_dm_reports_counts`$$
CREATE PROCEDURE `sp_dm_reports_counts`()
BEGIN
      SELECT
        SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open_count,
        SUM(CASE WHEN status <> 'open' THEN 1 ELSE 0 END) AS closed_count,
        COUNT(*) AS total
      FROM dm_reports;
    END$$

DROP PROCEDURE IF EXISTS `sp_dm_reports_list`$$
CREATE PROCEDURE `sp_dm_reports_list`(IN `p_status` varchar(20), IN `p_limit` int, IN `p_offset` int)
BEGIN
      SELECT r.id, r.reporter_id, r.reported_user_id, r.message_id, r.reason,
             r.status, r.created_at,
             ru.full_name AS reporter_name, tu.full_name AS reported_name,
             (SELECT m.body FROM direct_messages m WHERE m.id = r.message_id) AS message_body
        FROM dm_reports r
        LEFT JOIN users ru ON ru.id = r.reporter_id
        LEFT JOIN users tu ON tu.id = r.reported_user_id
       WHERE (p_status IS NULL OR p_status = '' OR r.status = p_status)
       ORDER BY (r.status = 'open') DESC, r.created_at DESC
       LIMIT p_limit OFFSET p_offset;
    END$$

DROP PROCEDURE IF EXISTS `sp_dm_send`$$
CREATE PROCEDURE `sp_dm_send`(IN `p_id` char(36), IN `p_sender` char(36), IN `p_recipient` char(36), IN `p_body` text)
BEGIN
      -- A block cuts both directions.
      IF EXISTS (SELECT 1 FROM dm_blocks
                  WHERE (user_id = p_recipient AND blocked_user_id = p_sender)
                     OR (user_id = p_sender AND blocked_user_id = p_recipient)) THEN
        SELECT 0 AS ok, 'You can no longer message this member.' AS message, NULL AS id;
      ELSE
        INSERT INTO direct_messages (id, sender_id, recipient_id, body)
        VALUES (p_id, p_sender, p_recipient, p_body);
        SELECT 1 AS ok, 'Sent.' AS message, p_id AS id;
      END IF;
    END$$

DROP PROCEDURE IF EXISTS `sp_dm_shared_group`$$
CREATE PROCEDURE `sp_dm_shared_group`(IN `p_a` char(36), IN `p_b` char(36))
BEGIN
      SELECT COUNT(*) AS shared
        FROM group_memberships ga
        JOIN group_memberships gb ON ga.group_id = gb.group_id
       WHERE ga.user_id = p_a AND gb.user_id = p_b
         AND ga.status = 'active' AND gb.status = 'active';
    END$$

DROP PROCEDURE IF EXISTS `sp_dm_thread`$$
CREATE PROCEDURE `sp_dm_thread`(IN `p_me` char(36), IN `p_other` char(36), IN `p_limit` int)
BEGIN
      UPDATE direct_messages SET is_read = 1
       WHERE recipient_id = p_me AND sender_id = p_other AND is_read = 0;

      SELECT id, sender_id, recipient_id, body, is_read, created_at
        FROM direct_messages
       WHERE (sender_id = p_me AND recipient_id = p_other)
          OR (sender_id = p_other AND recipient_id = p_me)
       ORDER BY created_at ASC
       LIMIT p_limit;
    END$$

DROP PROCEDURE IF EXISTS `sp_dm_unblock`$$
CREATE PROCEDURE `sp_dm_unblock`(IN `p_user` char(36), IN `p_blocked` char(36))
BEGIN
      DELETE FROM dm_blocks WHERE user_id = p_user AND blocked_user_id = p_blocked;
      SELECT 1 AS ok, 'Member unblocked.' AS message;
    END$$

DELIMITER ;
