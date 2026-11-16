-- SKOVO — Tailored endpoint SPs: gamification (badges, streaks, leaderboard)
DELIMITER $$

DROP PROCEDURE IF EXISTS `sp_badges_list`$$
CREATE PROCEDURE `sp_badges_list`()
BEGIN
    SELECT * FROM `badges` ORDER BY `created_at` DESC;
END$$

DROP PROCEDURE IF EXISTS `sp_badges_create`$$
CREATE PROCEDURE `sp_badges_create`(
    IN p_id CHAR(36), IN p_name VARCHAR(200), IN p_description TEXT, IN p_icon_url TEXT,
    IN p_badge_type VARCHAR(50), IN p_criteria JSON, IN p_points INT)
BEGIN
    IF p_id IS NULL OR p_id = '' THEN SET p_id = UUID(); END IF;
    INSERT INTO `badges` (`id`,`name`,`description`,`icon_url`,`badge_type`,`criteria`,`points`,`is_active`)
    VALUES (p_id, p_name, p_description, p_icon_url, COALESCE(p_badge_type,'achievement'),
            p_criteria, COALESCE(p_points,10), 1);
    SELECT * FROM `badges` WHERE `id` = p_id;
END$$

-- Award a badge: dedups, bumps the user's total_points by the badge value.
DROP PROCEDURE IF EXISTS `sp_badges_award`$$
CREATE PROCEDURE `sp_badges_award`(IN p_badge_id CHAR(36), IN p_user_id CHAR(36))
BEGIN
    DECLARE v_points INT;
    DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;
    SELECT `points` INTO v_points FROM `badges` WHERE `id` = p_badge_id LIMIT 1;
    IF v_points IS NULL THEN
        SELECT 'no_badge' AS result;
    ELSEIF EXISTS (SELECT 1 FROM `user_badges` WHERE `user_id` = p_user_id AND `badge_id` = p_badge_id) THEN
        SELECT 'already' AS result;
    ELSE
        START TRANSACTION;
        INSERT INTO `user_badges` (`id`,`user_id`,`badge_id`,`earned_at`)
        VALUES (UUID(), p_user_id, p_badge_id, UTC_TIMESTAMP());
        UPDATE `user_streaks` SET `total_points` = IFNULL(`total_points`,0) + v_points
         WHERE `user_id` = p_user_id;
        COMMIT;
        SELECT 'ok' AS result;
    END IF;
END$$

DROP PROCEDURE IF EXISTS `sp_my_badges`$$
CREATE PROCEDURE `sp_my_badges`(IN p_user_id CHAR(36))
BEGIN
    SELECT b.*, ub.`earned_at`
      FROM `user_badges` ub
      JOIN `badges` b ON b.`id` = ub.`badge_id`
     WHERE ub.`user_id` = p_user_id
     ORDER BY ub.`earned_at` DESC;
END$$

DROP PROCEDURE IF EXISTS `sp_streak_get_or_create`$$
CREATE PROCEDURE `sp_streak_get_or_create`(IN p_user_id CHAR(36))
BEGIN
    IF NOT EXISTS (SELECT 1 FROM `user_streaks` WHERE `user_id` = p_user_id) THEN
        INSERT INTO `user_streaks` (`id`,`user_id`,`current_streak`,`longest_streak`,`total_points`)
        VALUES (UUID(), p_user_id, 0, 0, 0);
    END IF;
    SELECT * FROM `user_streaks` WHERE `user_id` = p_user_id LIMIT 1;
END$$

-- Record daily activity (p_today = client's today). Keeps/breaks the streak.
DROP PROCEDURE IF EXISTS `sp_streak_record`$$
CREATE PROCEDURE `sp_streak_record`(IN p_user_id CHAR(36), IN p_today DATE)
BEGIN
    DECLARE v_last DATE; DECLARE v_cur INT; DECLARE v_long INT; DECLARE v_pts INT;
    IF NOT EXISTS (SELECT 1 FROM `user_streaks` WHERE `user_id` = p_user_id) THEN
        INSERT INTO `user_streaks`
            (`id`,`user_id`,`current_streak`,`longest_streak`,`last_active_date`,`total_points`)
        VALUES (UUID(), p_user_id, 1, 1, p_today, 1);
        SELECT 'recorded' AS result, 1 AS current_streak, 1 AS total_points;
    ELSE
        SELECT `last_active_date`,`current_streak`,`longest_streak`,`total_points`
          INTO v_last, v_cur, v_long, v_pts
          FROM `user_streaks` WHERE `user_id` = p_user_id;
        IF v_last = p_today THEN
            SELECT 'already' AS result, v_cur AS current_streak, v_pts AS total_points;
        ELSE
            IF v_last = DATE_SUB(p_today, INTERVAL 1 DAY) THEN
                SET v_cur = IFNULL(v_cur,0) + 1;
            ELSE
                SET v_cur = 1;
            END IF;
            SET v_long = GREATEST(IFNULL(v_long,0), v_cur);
            SET v_pts = IFNULL(v_pts,0) + 1;
            UPDATE `user_streaks`
               SET `current_streak` = v_cur, `longest_streak` = v_long,
                   `last_active_date` = p_today, `total_points` = v_pts
             WHERE `user_id` = p_user_id;
            SELECT 'recorded' AS result, v_cur AS current_streak, v_pts AS total_points;
        END IF;
    END IF;
END$$

DROP PROCEDURE IF EXISTS `sp_leaderboard`$$
CREATE PROCEDURE `sp_leaderboard`()
BEGIN
    SELECT s.`user_id`, u.`full_name`, u.`avatar_url`, s.`total_points`, s.`current_streak`
      FROM `user_streaks` s
      LEFT JOIN `users` u ON u.`id` = s.`user_id`
     ORDER BY s.`total_points` DESC
     LIMIT 20;
END$$

DELIMITER ;
