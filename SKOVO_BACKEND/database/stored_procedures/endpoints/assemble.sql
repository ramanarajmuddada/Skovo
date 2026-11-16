-- SKOVO — Tailored endpoint SPs: assemble (groups, memberships, posts, likes)
DELIMITER $$

DROP PROCEDURE IF EXISTS `sp_assemble_groups_count`$$
CREATE PROCEDURE `sp_assemble_groups_count`(IN p_category VARCHAR(50), IN p_type VARCHAR(20), IN p_search VARCHAR(200))
BEGIN
    SELECT COUNT(*) AS total FROM `groups` g
     WHERE g.`is_active` = 1 AND g.`deleted_at` IS NULL
       AND (p_category IS NULL OR p_category = '' OR g.`category` = p_category)
       AND (p_type IS NULL OR p_type = '' OR g.`group_type` = p_type)
       AND (p_search IS NULL OR p_search = ''
            OR g.`name` LIKE CONCAT('%', p_search, '%')
            OR g.`description` LIKE CONCAT('%', p_search, '%'));
END$$

DROP PROCEDURE IF EXISTS `sp_assemble_groups_list`$$
CREATE PROCEDURE `sp_assemble_groups_list`(
    IN p_user_id CHAR(36), IN p_category VARCHAR(50), IN p_type VARCHAR(20),
    IN p_search VARCHAR(200), IN p_limit INT, IN p_offset INT)
BEGIN
    SELECT g.*, m.`status` AS membership_status, m.`role` AS my_role
      FROM `groups` g
      LEFT JOIN `group_memberships` m ON m.`group_id` = g.`id` AND m.`user_id` = p_user_id
     WHERE g.`is_active` = 1 AND g.`deleted_at` IS NULL
       AND (p_category IS NULL OR p_category = '' OR g.`category` = p_category)
       AND (p_type IS NULL OR p_type = '' OR g.`group_type` = p_type)
       AND (p_search IS NULL OR p_search = ''
            OR g.`name` LIKE CONCAT('%', p_search, '%')
            OR g.`description` LIKE CONCAT('%', p_search, '%'))
     ORDER BY g.`member_count` DESC
     LIMIT p_limit OFFSET p_offset;
END$$

DROP PROCEDURE IF EXISTS `sp_assemble_group_get`$$
CREATE PROCEDURE `sp_assemble_group_get`(IN p_group_id CHAR(36))
BEGIN
    SELECT * FROM `groups` WHERE `id` = p_group_id AND `deleted_at` IS NULL LIMIT 1;
END$$

DROP PROCEDURE IF EXISTS `sp_assemble_membership_status`$$
CREATE PROCEDURE `sp_assemble_membership_status`(IN p_user_id CHAR(36), IN p_group_id CHAR(36))
BEGIN
    SELECT `status`, `role` FROM `group_memberships`
     WHERE `user_id` = p_user_id AND `group_id` = p_group_id LIMIT 1;
END$$

-- Join / re-join. result: notfound|already_member|already_pending|full|rejoined|joined (+ status)
DROP PROCEDURE IF EXISTS `sp_assemble_group_join`$$
CREATE PROCEDURE `sp_assemble_group_join`(IN p_user_id CHAR(36), IN p_group_id CHAR(36))
BEGIN
    DECLARE v_deleted DATETIME; DECLARE v_join VARCHAR(20); DECLARE v_max INT;
    DECLARE v_count INT; DECLARE v_status VARCHAR(20); DECLARE v_new VARCHAR(20);
    DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

    SELECT `deleted_at`, `join_type`, `max_members`, `member_count`
      INTO v_deleted, v_join, v_max, v_count
      FROM `groups` WHERE `id` = p_group_id AND `is_active` = 1 LIMIT 1;

    IF v_join IS NULL OR v_deleted IS NOT NULL THEN
        SELECT 'notfound' AS result, NULL AS status;
    ELSE
        SELECT `status` INTO v_status FROM `group_memberships`
         WHERE `user_id` = p_user_id AND `group_id` = p_group_id LIMIT 1;

        IF v_status = 'active' THEN
            SELECT 'already_member' AS result, 'active' AS status;
        ELSEIF v_status = 'pending' THEN
            SELECT 'already_pending' AS result, 'pending' AS status;
        ELSEIF v_status IN ('rejected', 'left') THEN
            SET v_new = IF(v_join = 'open', 'active', 'pending');
            START TRANSACTION;
            UPDATE `group_memberships`
               SET `status` = v_new, `role` = 'member',
                   `joined_at` = IF(v_new = 'active', UTC_TIMESTAMP(), NULL)
             WHERE `user_id` = p_user_id AND `group_id` = p_group_id;
            IF v_new = 'active' THEN
                UPDATE `groups` SET `member_count` = `member_count` + 1 WHERE `id` = p_group_id;
            END IF;
            COMMIT;
            SELECT 'rejoined' AS result, v_new AS status;
        ELSEIF v_max IS NOT NULL AND v_count >= v_max THEN
            SELECT 'full' AS result, NULL AS status;
        ELSE
            SET v_new = IF(v_join = 'open', 'active', 'pending');
            START TRANSACTION;
            INSERT INTO `group_memberships` (`id`,`user_id`,`group_id`,`role`,`status`,`joined_at`)
            VALUES (UUID(), p_user_id, p_group_id, 'member', v_new,
                    IF(v_new = 'active', UTC_TIMESTAMP(), NULL));
            IF v_new = 'active' THEN
                UPDATE `groups` SET `member_count` = `member_count` + 1 WHERE `id` = p_group_id;
            END IF;
            COMMIT;
            SELECT 'joined' AS result, v_new AS status;
        END IF;
    END IF;
END$$

DROP PROCEDURE IF EXISTS `sp_assemble_group_posts_count`$$
CREATE PROCEDURE `sp_assemble_group_posts_count`(IN p_group_id CHAR(36))
BEGIN
    SELECT COUNT(*) AS total FROM `group_posts`
     WHERE `group_id` = p_group_id AND `deleted_at` IS NULL;
END$$

DROP PROCEDURE IF EXISTS `sp_assemble_group_posts_list`$$
CREATE PROCEDURE `sp_assemble_group_posts_list`(
    IN p_user_id CHAR(36), IN p_group_id CHAR(36), IN p_limit INT, IN p_offset INT)
BEGIN
    SELECT gp.*, u.`full_name` AS author_name, u.`avatar_url` AS author_avatar,
           (gl.`id` IS NOT NULL) AS is_liked
      FROM `group_posts` gp
      LEFT JOIN `users` u ON u.`id` = gp.`user_id`
      LEFT JOIN `group_post_likes` gl ON gl.`post_id` = gp.`id` AND gl.`user_id` = p_user_id
     WHERE gp.`group_id` = p_group_id AND gp.`deleted_at` IS NULL
     ORDER BY gp.`is_pinned` DESC, gp.`created_at` DESC
     LIMIT p_limit OFFSET p_offset;
END$$

DROP PROCEDURE IF EXISTS `sp_assemble_post_create`$$
CREATE PROCEDURE `sp_assemble_post_create`(
    IN p_id CHAR(36), IN p_group_id CHAR(36), IN p_user_id CHAR(36), IN p_post_type VARCHAR(20),
    IN p_content TEXT, IN p_link_url TEXT, IN p_link_title TEXT, IN p_media_url TEXT)
BEGIN
    IF p_id IS NULL OR p_id = '' THEN SET p_id = UUID(); END IF;
    INSERT INTO `group_posts`
        (`id`,`group_id`,`user_id`,`post_type`,`content`,`link_url`,`link_title`,`media_url`)
    VALUES (p_id, p_group_id, p_user_id, COALESCE(p_post_type,'general'),
            p_content, p_link_url, p_link_title, p_media_url);
    SELECT gp.*, u.`full_name` AS author_name, u.`avatar_url` AS author_avatar, 0 AS is_liked
      FROM `group_posts` gp
      LEFT JOIN `users` u ON u.`id` = gp.`user_id`
     WHERE gp.`id` = p_id;
END$$

-- Toggle like. result: notfound | liked | unliked (+ likes_count)
DROP PROCEDURE IF EXISTS `sp_assemble_post_like_toggle`$$
CREATE PROCEDURE `sp_assemble_post_like_toggle`(IN p_post_id CHAR(36), IN p_user_id CHAR(36))
BEGIN
    DECLARE v_deleted DATETIME; DECLARE v_exists INT DEFAULT 0;
    DECLARE v_count INT DEFAULT 0; DECLARE v_action VARCHAR(10);
    DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

    SELECT `deleted_at` INTO v_deleted FROM `group_posts` WHERE `id` = p_post_id LIMIT 1;
    IF NOT EXISTS (SELECT 1 FROM `group_posts` WHERE `id` = p_post_id) OR v_deleted IS NOT NULL THEN
        SELECT 'notfound' AS result, 0 AS likes_count;
    ELSE
        START TRANSACTION;
        SELECT COUNT(*) INTO v_exists FROM `group_post_likes`
         WHERE `post_id` = p_post_id AND `user_id` = p_user_id;
        IF v_exists > 0 THEN
            DELETE FROM `group_post_likes` WHERE `post_id` = p_post_id AND `user_id` = p_user_id;
            UPDATE `group_posts` SET `likes_count` = GREATEST(IFNULL(`likes_count`,0) - 1, 0) WHERE `id` = p_post_id;
            SET v_action = 'unliked';
        ELSE
            INSERT INTO `group_post_likes` (`id`,`post_id`,`user_id`) VALUES (UUID(), p_post_id, p_user_id);
            UPDATE `group_posts` SET `likes_count` = IFNULL(`likes_count`,0) + 1 WHERE `id` = p_post_id;
            SET v_action = 'liked';
        END IF;
        SELECT `likes_count` INTO v_count FROM `group_posts` WHERE `id` = p_post_id;
        COMMIT;
        SELECT v_action AS result, IFNULL(v_count,0) AS likes_count;
    END IF;
END$$

-- ─────────────────────────────────────────────────────────────────────────────
-- Student-created communities.
--
-- The creator becomes an `owner` member in the same transaction, so a group can
-- never exist with nobody in it and `member_count` is right from the first read.
-- That also means creating a community consumes one of the free tier's three
-- membership slots — the cap is "be in at most 3", counted one way, rather than
-- two budgets that have to be kept in step.
-- ─────────────────────────────────────────────────────────────────────────────
DROP PROCEDURE IF EXISTS `sp_assemble_group_create`$$
CREATE PROCEDURE `sp_assemble_group_create`(
    IN p_id          CHAR(36),
    IN p_user_id     CHAR(36),
    IN p_name        TEXT,
    IN p_description TEXT,
    IN p_category    VARCHAR(50),
    IN p_group_type  VARCHAR(20),
    IN p_join_type   VARCHAR(20),
    IN p_icon_color  VARCHAR(20),
    IN p_max_members INT
)
BEGIN
    DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

    IF p_id IS NULL OR p_id = '' THEN SET p_id = UUID(); END IF;

    START TRANSACTION;

    INSERT INTO `groups`
        (`id`, `name`, `description`, `category`, `group_type`, `icon_color`,
         `min_members`, `max_members`, `join_type`, `member_count`,
         `created_by`, `updated_by`, `is_active`)
    VALUES
        (p_id, p_name, p_description, p_category, p_group_type, p_icon_color,
         0, p_max_members, p_join_type, 1,
         p_user_id, p_user_id, 1);

    INSERT INTO `group_memberships`
        (`id`, `user_id`, `group_id`, `role`, `status`, `joined_at`, `created_by`)
    VALUES
        (UUID(), p_user_id, p_id, 'owner', 'active', UTC_TIMESTAMP(), p_user_id);

    COMMIT;

    SELECT * FROM `groups` WHERE `id` = p_id;
END$$


-- ─────────────────────────────────────────────────────────────────────────────
-- The two below already existed in the live database but had never been written
-- back to source, so a rebuild from this repo produced a schema where joining a
-- community and pinning a post both 500'd. Captured from the running schema.
-- ─────────────────────────────────────────────────────────────────────────────
DROP PROCEDURE IF EXISTS `sp_assemble_my_group_count`$$
CREATE PROCEDURE `sp_assemble_my_group_count`(IN p_user CHAR(36))
BEGIN
    SELECT COUNT(*) AS total FROM `group_memberships`
     WHERE `user_id` = p_user AND `status` = 'active';
END$$


DROP PROCEDURE IF EXISTS `sp_assemble_post_pin_toggle`$$
CREATE PROCEDURE `sp_assemble_post_pin_toggle`(IN p_post CHAR(36), IN p_user CHAR(36))
BEGIN
    DECLARE v_owner CHAR(36); DECLARE v_pinned TINYINT DEFAULT 0;
    SELECT `user_id`, `is_pinned` INTO v_owner, v_pinned FROM `group_posts` WHERE `id` = p_post;
    IF v_owner IS NULL THEN
        SELECT 'notfound' AS result, 0 AS is_pinned;
    ELSEIF v_owner <> p_user THEN
        SELECT 'not_owner' AS result, v_pinned AS is_pinned;
    ELSE
        UPDATE `group_posts` SET `is_pinned` = IF(v_pinned = 1, 0, 1) WHERE `id` = p_post;
        SELECT IF(v_pinned = 1, 'unpinned', 'pinned') AS result,
               IF(v_pinned = 1, 0, 1) AS is_pinned;
    END IF;
END$$

-- ─────────────────────────────────────────────────────────────────────────────
-- Community moderation — what the owner of a group can do.
--
-- Ownership is `group_memberships.role = 'owner'`, set when the group is
-- created. Every procedure below is written to be safe if called with a
-- non-owner: the route checks the role first, and these re-check the pieces
-- that matter (capacity, owner-immunity) so a stale UI cannot corrupt counts.
-- ─────────────────────────────────────────────────────────────────────────────

-- Pending join requests, newest first.
DROP PROCEDURE IF EXISTS `sp_assemble_group_requests_list`$$
CREATE PROCEDURE `sp_assemble_group_requests_list`(
    IN p_group_id CHAR(36), IN p_limit INT, IN p_offset INT)
BEGIN
    SELECT m.`user_id`, m.`requested_at`, m.`created_at`,
           u.`full_name`, u.`avatar_url`
      FROM `group_memberships` m
      LEFT JOIN `users` u ON u.`id` = m.`user_id`
     WHERE m.`group_id` = p_group_id AND m.`status` = 'pending'
     ORDER BY m.`requested_at` DESC, m.`created_at` DESC
     LIMIT p_limit OFFSET p_offset;
END$$

DROP PROCEDURE IF EXISTS `sp_assemble_group_requests_count`$$
CREATE PROCEDURE `sp_assemble_group_requests_count`(IN p_group_id CHAR(36))
BEGIN
    SELECT COUNT(*) AS total FROM `group_memberships`
     WHERE `group_id` = p_group_id AND `status` = 'pending';
END$$

-- Approve (p_approve = 1) or reject a pending request.
-- result: notfound | not_pending | full | approved | rejected
DROP PROCEDURE IF EXISTS `sp_assemble_request_decide`$$
CREATE PROCEDURE `sp_assemble_request_decide`(
    IN p_group_id CHAR(36), IN p_user_id CHAR(36), IN p_approve TINYINT(1))
BEGIN
    DECLARE v_status VARCHAR(20); DECLARE v_max INT; DECLARE v_count INT;
    DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

    SELECT `status` INTO v_status FROM `group_memberships`
     WHERE `group_id` = p_group_id AND `user_id` = p_user_id LIMIT 1;

    IF v_status IS NULL THEN
        SELECT 'notfound' AS result;
    ELSEIF v_status <> 'pending' THEN
        SELECT 'not_pending' AS result;
    ELSEIF p_approve = 0 THEN
        UPDATE `group_memberships` SET `status` = 'rejected'
         WHERE `group_id` = p_group_id AND `user_id` = p_user_id;
        SELECT 'rejected' AS result;
    ELSE
        SELECT `max_members`, `member_count` INTO v_max, v_count
          FROM `groups` WHERE `id` = p_group_id LIMIT 1;
        IF v_max IS NOT NULL AND v_count >= v_max THEN
            SELECT 'full' AS result;
        ELSE
            START TRANSACTION;
            UPDATE `group_memberships`
               SET `status` = 'active', `joined_at` = UTC_TIMESTAMP()
             WHERE `group_id` = p_group_id AND `user_id` = p_user_id;
            UPDATE `groups` SET `member_count` = `member_count` + 1 WHERE `id` = p_group_id;
            COMMIT;
            SELECT 'approved' AS result;
        END IF;
    END IF;
END$$

-- Active members of a group.
DROP PROCEDURE IF EXISTS `sp_assemble_members_list`$$
CREATE PROCEDURE `sp_assemble_members_list`(
    IN p_group_id CHAR(36), IN p_limit INT, IN p_offset INT)
BEGIN
    SELECT m.`user_id`, m.`role`, m.`joined_at`,
           u.`full_name`, u.`avatar_url`
      FROM `group_memberships` m
      LEFT JOIN `users` u ON u.`id` = m.`user_id`
     WHERE m.`group_id` = p_group_id AND m.`status` = 'active'
     ORDER BY FIELD(m.`role`, 'owner') DESC, m.`joined_at` ASC
     LIMIT p_limit OFFSET p_offset;
END$$

-- Remove a member. result: notfound | not_member | is_owner | removed
-- The owner cannot be removed — a group with no owner has no one who can
-- moderate it, and nothing else in the product can reassign ownership.
DROP PROCEDURE IF EXISTS `sp_assemble_member_remove`$$
CREATE PROCEDURE `sp_assemble_member_remove`(
    IN p_group_id CHAR(36), IN p_user_id CHAR(36))
BEGIN
    DECLARE v_status VARCHAR(20); DECLARE v_role VARCHAR(20);
    DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

    SELECT `status`, `role` INTO v_status, v_role FROM `group_memberships`
     WHERE `group_id` = p_group_id AND `user_id` = p_user_id LIMIT 1;

    IF v_status IS NULL THEN
        SELECT 'notfound' AS result;
    ELSEIF v_role = 'owner' THEN
        SELECT 'is_owner' AS result;
    ELSEIF v_status <> 'active' THEN
        SELECT 'not_member' AS result;
    ELSE
        START TRANSACTION;
        UPDATE `group_memberships` SET `status` = 'left'
         WHERE `group_id` = p_group_id AND `user_id` = p_user_id;
        UPDATE `groups` SET `member_count` = GREATEST(`member_count` - 1, 0)
         WHERE `id` = p_group_id;
        COMMIT;
        SELECT 'removed' AS result;
    END IF;
END$$

-- Soft-delete a post. Allowed for its author, or for the owner of the group it
-- was posted in. result: notfound | not_allowed | deleted
DROP PROCEDURE IF EXISTS `sp_assemble_post_delete`$$
CREATE PROCEDURE `sp_assemble_post_delete`(
    IN p_post_id CHAR(36), IN p_user_id CHAR(36))
BEGIN
    DECLARE v_author CHAR(36); DECLARE v_group CHAR(36); DECLARE v_role VARCHAR(20);

    SELECT `user_id`, `group_id` INTO v_author, v_group
      FROM `group_posts` WHERE `id` = p_post_id AND `deleted_at` IS NULL LIMIT 1;

    IF v_author IS NULL THEN
        SELECT 'notfound' AS result;
    ELSE
        SELECT `role` INTO v_role FROM `group_memberships`
         WHERE `group_id` = v_group AND `user_id` = p_user_id AND `status` = 'active' LIMIT 1;

        IF v_author <> p_user_id AND IFNULL(v_role, '') <> 'owner' THEN
            SELECT 'not_allowed' AS result;
        ELSE
            UPDATE `group_posts` SET `deleted_at` = UTC_TIMESTAMP() WHERE `id` = p_post_id;
            SELECT 'deleted' AS result;
        END IF;
    END IF;
END$$


DELIMITER ;
