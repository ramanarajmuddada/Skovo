-- Community retention and platform moderation.
-- chat_days: text posts and direct messages.
-- file_days: PDFs and documents attached to a post.
-- Both numbers are stored in community_retention and edited from Admin.

DELIMITER $$

DROP PROCEDURE IF EXISTS `sp_community_retention_get`$$
CREATE PROCEDURE `sp_community_retention_get`()
BEGIN
    IF (SELECT COUNT(*) FROM `community_retention`) = 0 THEN
        INSERT INTO `community_retention` (`id`, `chat_days`, `file_days`)
        VALUES (UUID(), 21, 7);
    END IF;
    SELECT `chat_days`, `file_days`, `updated_at`
      FROM `community_retention`
     ORDER BY `updated_at` DESC
     LIMIT 1;
END$$

DROP PROCEDURE IF EXISTS `sp_community_retention_set`$$
CREATE PROCEDURE `sp_community_retention_set`(
    IN p_chat_days INT,
    IN p_file_days INT,
    IN p_actor CHAR(36)
)
BEGIN
    IF (SELECT COUNT(*) FROM `community_retention`) = 0 THEN
        INSERT INTO `community_retention` (`id`, `chat_days`, `file_days`, `updated_by`)
        VALUES (UUID(), p_chat_days, p_file_days, p_actor);
    ELSE
        UPDATE `community_retention`
           SET `chat_days` = p_chat_days,
               `file_days` = p_file_days,
               `updated_by` = p_actor;
    END IF;
    SELECT `chat_days`, `file_days` FROM `community_retention` LIMIT 1;
END$$

-- Files that must leave storage on this sweep.
-- A document past file_days, or any attachment on a post past chat_days.
DROP PROCEDURE IF EXISTS `sp_community_files_due`$$
CREATE PROCEDURE `sp_community_files_due`(
    IN p_chat_days INT,
    IN p_file_days INT
)
BEGIN
    SELECT `id`, `media_url`
      FROM `group_posts`
     WHERE `media_url` IS NOT NULL
       AND `media_url` <> ''
       AND (
            `created_at` < (NOW() - INTERVAL p_chat_days DAY)
         OR (
                `media_url` REGEXP '\\.(docx|doc|pdf)([?#]|$)'
            AND `created_at` < (NOW() - INTERVAL p_file_days DAY)
            )
       );
END$$

-- Drop expired chat rows. A document whose post is still inside the chat
-- window loses its file link here; the object was already removed from storage.
DROP PROCEDURE IF EXISTS `sp_community_purge`$$
CREATE PROCEDURE `sp_community_purge`(
    IN p_chat_days INT,
    IN p_file_days INT
)
BEGIN
    DECLARE v_posts INT DEFAULT 0;
    DECLARE v_messages INT DEFAULT 0;

    UPDATE `group_posts`
       SET `media_url` = NULL
     WHERE `media_url` REGEXP '\\.(docx|doc|pdf)([?#]|$)'
       AND `created_at` < (NOW() - INTERVAL p_file_days DAY)
       AND `created_at` >= (NOW() - INTERVAL p_chat_days DAY);

    DELETE l FROM `group_post_likes` l
      INNER JOIN `group_posts` p ON p.`id` = l.`post_id`
     WHERE p.`created_at` < (NOW() - INTERVAL p_chat_days DAY);

    DELETE FROM `group_posts`
     WHERE `created_at` < (NOW() - INTERVAL p_chat_days DAY);
    SET v_posts = ROW_COUNT();

    DELETE FROM `direct_messages`
     WHERE `created_at` < (NOW() - INTERVAL p_chat_days DAY);
    SET v_messages = ROW_COUNT();

    SELECT v_posts AS posts_removed, v_messages AS messages_removed;
END$$

-- Hide a community and free every member's slot.
-- Posts stay until the retention sweep deletes them, so the record can still
-- be opened from the admin list.
DROP PROCEDURE IF EXISTS `sp_community_close`$$
CREATE PROCEDURE `sp_community_close`(IN p_group_id CHAR(36))
BEGIN
    DECLARE v_deleted DATETIME;

    SELECT `deleted_at` INTO v_deleted FROM `groups` WHERE `id` = p_group_id LIMIT 1;
    IF v_deleted IS NULL AND (SELECT COUNT(*) FROM `groups` WHERE `id` = p_group_id) = 0 THEN
        SELECT 'notfound' AS result;
    ELSE
        UPDATE `groups`
           SET `deleted_at` = NOW(), `is_active` = 0, `member_count` = 0
         WHERE `id` = p_group_id AND `deleted_at` IS NULL;
        UPDATE `group_memberships`
           SET `status` = 'left'
         WHERE `group_id` = p_group_id AND `status` IN ('active', 'pending');
        SELECT 'closed' AS result;
    END IF;
END$$

-- Platform admin may remove any member, including the student who created it.
DROP PROCEDURE IF EXISTS `sp_community_admin_remove_member`$$
CREATE PROCEDURE `sp_community_admin_remove_member`(
    IN p_group_id CHAR(36),
    IN p_user_id CHAR(36)
)
BEGIN
    DECLARE v_status VARCHAR(20);

    SELECT `status` INTO v_status FROM `group_memberships`
     WHERE `group_id` = p_group_id AND `user_id` = p_user_id LIMIT 1;

    IF v_status IS NULL OR v_status <> 'active' THEN
        SELECT 'not_member' AS result;
    ELSE
        UPDATE `group_memberships` SET `status` = 'left'
         WHERE `group_id` = p_group_id AND `user_id` = p_user_id;
        UPDATE `groups` SET `member_count` = GREATEST(`member_count` - 1, 0)
         WHERE `id` = p_group_id AND `deleted_at` IS NULL;
        SELECT 'removed' AS result;
    END IF;
END$$

-- Every community, including ones already closed, so Admin can still track them.
DROP PROCEDURE IF EXISTS `sp_community_admin_list`$$
CREATE PROCEDURE `sp_community_admin_list`()
BEGIN
    SELECT g.*,
           cu.`full_name` AS creator_name,
           (
             SELECT COALESCE(NULLIF(TRIM(u.`full_name`), ''), 'Student')
               FROM `group_memberships` m
               JOIN `users` u ON u.`id` = m.`user_id`
              WHERE m.`group_id` = g.`id`
                AND m.`role` = 'owner'
                AND m.`status` = 'active'
              LIMIT 1
           ) AS owner_name,
           (
             SELECT m.`user_id`
               FROM `group_memberships` m
              WHERE m.`group_id` = g.`id`
                AND m.`role` = 'owner'
                AND m.`status` = 'active'
              LIMIT 1
           ) AS owner_user_id
      FROM `groups` g
      LEFT JOIN `users` cu ON cu.`id` = g.`created_by`
     ORDER BY g.`created_at` DESC
     LIMIT 5000;
END$$

DROP PROCEDURE IF EXISTS `sp_community_track_members`$$
CREATE PROCEDURE `sp_community_track_members`(IN p_group_id CHAR(36))
BEGIN
    SELECT m.`user_id`, m.`role`, m.`status`, m.`joined_at`,
           u.`full_name`, u.`avatar_url`
      FROM `group_memberships` m
      LEFT JOIN `users` u ON u.`id` = m.`user_id`
     WHERE m.`group_id` = p_group_id
     ORDER BY FIELD(m.`status`, 'active', 'pending', 'left'),
              FIELD(m.`role`, 'owner') DESC,
              m.`joined_at` ASC
     LIMIT 500;
END$$

DROP PROCEDURE IF EXISTS `sp_community_track_posts`$$
CREATE PROCEDURE `sp_community_track_posts`(IN p_group_id CHAR(36))
BEGIN
    SELECT p.`id`, p.`user_id`, u.`full_name` AS author_name,
           p.`content`, p.`media_url`, p.`created_at`, p.`deleted_at`
      FROM `group_posts` p
      LEFT JOIN `users` u ON u.`id` = p.`user_id`
     WHERE p.`group_id` = p_group_id
     ORDER BY p.`created_at` DESC
     LIMIT 200;
END$$

-- Direct messages between people who belong to this community.
DROP PROCEDURE IF EXISTS `sp_community_track_messages`$$
CREATE PROCEDURE `sp_community_track_messages`(IN p_group_id CHAR(36))
BEGIN
    SELECT dm.`id`,
           dm.`sender_id`, su.`full_name` AS sender_name,
           dm.`recipient_id`, ru.`full_name` AS recipient_name,
           dm.`body`, dm.`created_at`
      FROM `direct_messages` dm
      LEFT JOIN `users` su ON su.`id` = dm.`sender_id`
      LEFT JOIN `users` ru ON ru.`id` = dm.`recipient_id`
     WHERE EXISTS (
             SELECT 1 FROM `group_memberships` ms
              WHERE ms.`group_id` = p_group_id AND ms.`user_id` = dm.`sender_id`
           )
       AND EXISTS (
             SELECT 1 FROM `group_memberships` mr
              WHERE mr.`group_id` = p_group_id AND mr.`user_id` = dm.`recipient_id`
           )
     ORDER BY dm.`created_at` DESC
     LIMIT 200;
END$$

-- True when this user has any membership row on the community.
DROP PROCEDURE IF EXISTS `sp_community_member_exists`$$
CREATE PROCEDURE `sp_community_member_exists`(
    IN p_group_id CHAR(36),
    IN p_user_id CHAR(36)
)
BEGIN
    SELECT `user_id`, `role`, `status`
      FROM `group_memberships`
     WHERE `group_id` = p_group_id AND `user_id` = p_user_id
     LIMIT 1;
END$$

DELIMITER ;
