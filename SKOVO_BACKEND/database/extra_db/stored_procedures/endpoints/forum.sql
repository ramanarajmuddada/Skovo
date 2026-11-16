-- SKOVO — Tailored endpoint SPs: forum (posts, replies, upvotes)
DELIMITER $$

DROP PROCEDURE IF EXISTS `sp_forum_posts_list`$$
CREATE PROCEDURE `sp_forum_posts_list`(IN p_user_id CHAR(36), IN p_category VARCHAR(50))
BEGIN
    SELECT p.*, u.`full_name` AS author_name,
           (uv.`id` IS NOT NULL) AS upvoted
      FROM `forum_posts` p
      LEFT JOIN `users` u ON u.`id` = p.`user_id`
      LEFT JOIN `forum_post_upvotes` uv ON uv.`post_id` = p.`id` AND uv.`user_id` = p_user_id
     WHERE p.`is_active` = 1 AND p.`deleted_at` IS NULL
       AND (p_category IS NULL OR p_category = '' OR p.`category` = p_category)
     ORDER BY p.`is_pinned` DESC, p.`created_at` DESC;
END$$

DROP PROCEDURE IF EXISTS `sp_forum_post_create`$$
CREATE PROCEDURE `sp_forum_post_create`(
    IN p_id CHAR(36), IN p_user_id CHAR(36), IN p_title VARCHAR(500),
    IN p_content TEXT, IN p_category VARCHAR(50), IN p_tags JSON)
BEGIN
    IF p_id IS NULL OR p_id = '' THEN SET p_id = UUID(); END IF;
    INSERT INTO `forum_posts` (`id`,`user_id`,`title`,`content`,`category`,`tags`)
    VALUES (p_id, p_user_id, p_title, p_content, COALESCE(p_category,'general'), p_tags);
    SELECT p_id AS id;
END$$

-- Detail: bump views, return post (+author, +upvoted-by-caller).
DROP PROCEDURE IF EXISTS `sp_forum_post_get`$$
CREATE PROCEDURE `sp_forum_post_get`(IN p_post_id CHAR(36), IN p_user_id CHAR(36))
BEGIN
    UPDATE `forum_posts` SET `views` = IFNULL(`views`,0) + 1
     WHERE `id` = p_post_id AND `is_active` = 1 AND `deleted_at` IS NULL;
    SELECT p.*, u.`full_name` AS author_name,
           (uv.`id` IS NOT NULL) AS upvoted
      FROM `forum_posts` p
      LEFT JOIN `users` u ON u.`id` = p.`user_id`
      LEFT JOIN `forum_post_upvotes` uv ON uv.`post_id` = p.`id` AND uv.`user_id` = p_user_id
     WHERE p.`id` = p_post_id AND p.`is_active` = 1 AND p.`deleted_at` IS NULL
     LIMIT 1;
END$$

DROP PROCEDURE IF EXISTS `sp_forum_post_replies`$$
CREATE PROCEDURE `sp_forum_post_replies`(IN p_post_id CHAR(36))
BEGIN
    SELECT r.*, u.`full_name` AS author_name
      FROM `forum_replies` r
      LEFT JOIN `users` u ON u.`id` = r.`user_id`
     WHERE r.`post_id` = p_post_id AND r.`is_active` = 1 AND r.`deleted_at` IS NULL
     ORDER BY r.`is_accepted` DESC, r.`upvotes` DESC;
END$$

DROP PROCEDURE IF EXISTS `sp_forum_post_update_owner`$$
CREATE PROCEDURE `sp_forum_post_update_owner`(
    IN p_id CHAR(36), IN p_user_id CHAR(36), IN p_title VARCHAR(500),
    IN p_content TEXT, IN p_category VARCHAR(50), IN p_tags JSON)
BEGIN
    UPDATE `forum_posts` SET
        `title`    = COALESCE(p_title, `title`),
        `content`  = COALESCE(p_content, `content`),
        `category` = COALESCE(p_category, `category`),
        `tags`     = COALESCE(p_tags, `tags`)
     WHERE `id` = p_id AND `user_id` = p_user_id AND `deleted_at` IS NULL;
    SELECT COUNT(*) AS updated FROM `forum_posts`
     WHERE `id` = p_id AND `user_id` = p_user_id AND `deleted_at` IS NULL;
END$$

DROP PROCEDURE IF EXISTS `sp_forum_post_delete_owner`$$
CREATE PROCEDURE `sp_forum_post_delete_owner`(IN p_id CHAR(36), IN p_user_id CHAR(36))
BEGIN
    UPDATE `forum_posts` SET `deleted_at` = UTC_TIMESTAMP(), `is_active` = 0
     WHERE `id` = p_id AND `user_id` = p_user_id AND `deleted_at` IS NULL;
    SELECT ROW_COUNT() AS deleted;
END$$

-- Toggle upvote. result: 'notfound' | 'ok' (+ upvotes, upvoted).
DROP PROCEDURE IF EXISTS `sp_forum_post_upvote_toggle`$$
CREATE PROCEDURE `sp_forum_post_upvote_toggle`(IN p_post_id CHAR(36), IN p_user_id CHAR(36))
BEGIN
    DECLARE v_up INT; DECLARE v_count INT DEFAULT 0; DECLARE v_upvoted TINYINT;
    DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;
    IF NOT EXISTS (SELECT 1 FROM `forum_posts` WHERE `id` = p_post_id AND `is_active` = 1) THEN
        SELECT 'notfound' AS result, 0 AS upvotes, 0 AS upvoted;
    ELSE
        START TRANSACTION;
        SELECT COUNT(*) INTO v_count FROM `forum_post_upvotes`
         WHERE `post_id` = p_post_id AND `user_id` = p_user_id;
        IF v_count > 0 THEN
            DELETE FROM `forum_post_upvotes` WHERE `post_id` = p_post_id AND `user_id` = p_user_id;
            UPDATE `forum_posts` SET `upvotes` = GREATEST(IFNULL(`upvotes`,0) - 1, 0) WHERE `id` = p_post_id;
            SET v_upvoted = 0;
        ELSE
            INSERT INTO `forum_post_upvotes` (`id`,`post_id`,`user_id`) VALUES (UUID(), p_post_id, p_user_id);
            UPDATE `forum_posts` SET `upvotes` = IFNULL(`upvotes`,0) + 1 WHERE `id` = p_post_id;
            SET v_upvoted = 1;
        END IF;
        SELECT `upvotes` INTO v_up FROM `forum_posts` WHERE `id` = p_post_id;
        COMMIT;
        SELECT 'ok' AS result, IFNULL(v_up,0) AS upvotes, v_upvoted AS upvoted;
    END IF;
END$$

-- Add a reply. result: 'notfound' | 'ok' (+ id).
DROP PROCEDURE IF EXISTS `sp_forum_reply_create`$$
CREATE PROCEDURE `sp_forum_reply_create`(
    IN p_id CHAR(36), IN p_post_id CHAR(36), IN p_user_id CHAR(36), IN p_content TEXT)
BEGIN
    DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;
    IF NOT EXISTS (SELECT 1 FROM `forum_posts`
                    WHERE `id` = p_post_id AND `is_active` = 1 AND `deleted_at` IS NULL) THEN
        SELECT 'notfound' AS result, NULL AS id;
    ELSE
        IF p_id IS NULL OR p_id = '' THEN SET p_id = UUID(); END IF;
        START TRANSACTION;
        INSERT INTO `forum_replies` (`id`,`post_id`,`user_id`,`content`)
        VALUES (p_id, p_post_id, p_user_id, p_content);
        UPDATE `forum_posts` SET `replies_count` = IFNULL(`replies_count`,0) + 1 WHERE `id` = p_post_id;
        COMMIT;
        SELECT 'ok' AS result, p_id AS id;
    END IF;
END$$

-- Accept a reply (post owner only). result: 'no_reply' | 'not_owner' | 'ok'.
DROP PROCEDURE IF EXISTS `sp_forum_reply_accept`$$
CREATE PROCEDURE `sp_forum_reply_accept`(IN p_reply_id CHAR(36), IN p_user_id CHAR(36))
BEGIN
    DECLARE v_post_id CHAR(36); DECLARE v_owner INT DEFAULT 0;
    DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;
    SELECT `post_id` INTO v_post_id FROM `forum_replies` WHERE `id` = p_reply_id LIMIT 1;
    IF v_post_id IS NULL THEN
        SELECT 'no_reply' AS result;
    ELSE
        SELECT COUNT(*) INTO v_owner FROM `forum_posts`
         WHERE `id` = v_post_id AND `user_id` = p_user_id;
        IF v_owner = 0 THEN
            SELECT 'not_owner' AS result;
        ELSE
            START TRANSACTION;
            UPDATE `forum_replies` SET `is_accepted` = 0 WHERE `post_id` = v_post_id;
            UPDATE `forum_replies` SET `is_accepted` = 1 WHERE `id` = p_reply_id;
            UPDATE `forum_posts` SET `is_solved` = 1 WHERE `id` = v_post_id;
            COMMIT;
            SELECT 'ok' AS result;
        END IF;
    END IF;
END$$

DELIMITER ;
