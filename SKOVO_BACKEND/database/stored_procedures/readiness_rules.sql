-- SKOVO stored procedures: readiness_rules
-- sp_readiness_rules_create / _list / _update
--
-- Level bands are NOT in here. They are rows in `readiness_levels`, so their
-- names, their scores and how many there are can all be changed without a
-- deploy. The pioneer_min / achiever_min parameters this file used to carry
-- were dropped with the columns -- see
-- database/migrations/migrate_drop_level_min_columns.py.
--
-- This file previously defined sp_readiness_rules_update twice, the second time
-- after `DELIMITER ;` had already been restored, so that copy could not apply
-- cleanly. There is one definition now.

DELIMITER $$

DROP PROCEDURE IF EXISTS `sp_readiness_rules_create`$$

CREATE PROCEDURE `sp_readiness_rules_create`(
    IN p_id CHAR(36),
    IN p_cohort_pts_each INT,
    IN p_cohort_pts_max INT,
    IN p_task_pts_each INT,
    IN p_task_pts_max INT,
    IN p_opportunity_unlock_score INT,
    IN p_created_by CHAR(36),
    IN p_updated_by CHAR(36)
)
BEGIN
    IF p_id IS NULL OR p_id = '' THEN SET p_id = UUID(); END IF;
    INSERT INTO `readiness_rules`
        (`id`, `cohort_pts_each`, `cohort_pts_max`, `task_pts_each`, `task_pts_max`,
         `opportunity_unlock_score`, `created_by`, `updated_by`)
    VALUES (p_id, p_cohort_pts_each, p_cohort_pts_max, p_task_pts_each, p_task_pts_max,
            p_opportunity_unlock_score, p_created_by, p_updated_by);
    SELECT * FROM `readiness_rules` WHERE `id` = p_id;
END$$

DROP PROCEDURE IF EXISTS `sp_readiness_rules_list`$$

CREATE PROCEDURE `sp_readiness_rules_list`(IN p_limit INT, IN p_offset INT)
BEGIN
    IF p_limit IS NULL OR p_limit <= 0 THEN SET p_limit = 50; END IF;
    IF p_offset IS NULL OR p_offset < 0 THEN SET p_offset = 0; END IF;
    SELECT * FROM `readiness_rules` ORDER BY `created_at` DESC LIMIT p_limit OFFSET p_offset;
END$$

DROP PROCEDURE IF EXISTS `sp_readiness_rules_update`$$

CREATE PROCEDURE `sp_readiness_rules_update`(
    IN p_id CHAR(36),
    IN p_cohort_pts_each INT,
    IN p_cohort_pts_max INT,
    IN p_task_pts_each INT,
    IN p_task_pts_max INT,
    IN p_opportunity_unlock_score INT,
    IN p_decay_grace_days INT,
    IN p_decay_per_day INT,
    IN p_pause_tokens_per_year INT,
    IN p_pause_days INT,
    IN p_created_by CHAR(36),
    IN p_updated_by CHAR(36)
)
BEGIN
    UPDATE `readiness_rules`
    SET `cohort_pts_each` = p_cohort_pts_each,
        `cohort_pts_max` = p_cohort_pts_max,
        `task_pts_each` = p_task_pts_each,
        `task_pts_max` = p_task_pts_max,
        `opportunity_unlock_score` = p_opportunity_unlock_score,
        -- Decay and pause were stored and used by the nightly job but no
        -- procedure wrote them, so the only way to change how fast a score fell
        -- was to edit the row by hand. IFNULL keeps a caller that omits them
        -- from blanking the column.
        `decay_grace_days`      = IFNULL(p_decay_grace_days, `decay_grace_days`),
        `decay_per_day`         = IFNULL(p_decay_per_day, `decay_per_day`),
        `pause_tokens_per_year` = IFNULL(p_pause_tokens_per_year, `pause_tokens_per_year`),
        `pause_days`            = IFNULL(p_pause_days, `pause_days`),
        `created_by` = p_created_by,
        `updated_by` = p_updated_by
    WHERE `id` = p_id;
    SELECT * FROM `readiness_rules` WHERE `id` = p_id;
END$$

DELIMITER ;
