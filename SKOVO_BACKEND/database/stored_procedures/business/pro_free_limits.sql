-- SKOVO — free-tier caps for Skovo Pro, one row, admin-editable.
--
-- Three states per cap, and the update procedure has to tell them apart:
--
--   a number >= 0   set that cap
--   -1              set the cap to UNLIMITED (stored as NULL)
--   NULL            leave this cap as it is
--
-- NULL already meant "not supplied, keep current" before unlimited existed and
-- callers rely on it, so -1 carries the new meaning rather than overloading
-- NULL with both.

DELIMITER $$

DROP PROCEDURE IF EXISTS `sp_pro_free_limits_get`$$
CREATE PROCEDURE `sp_pro_free_limits_get`()
BEGIN
    INSERT IGNORE INTO `pro_free_limits`
      (`id`, `free_paid_cohorts`, `saved_colleges`, `communities`, `vault_docs`, `session_credits`)
    VALUES
      (1, 1, 3, 3, 5, 2);

    SELECT `id`, `free_paid_cohorts`, `saved_colleges`, `communities`,
           `vault_docs`, `session_credits`, `updated_at`, `updated_by`
      FROM `pro_free_limits`
     WHERE `id` = 1;
END$$


DROP PROCEDURE IF EXISTS `sp_pro_free_limits_update`$$
CREATE PROCEDURE `sp_pro_free_limits_update`(
    IN p_free_paid_cohorts INT,
    IN p_saved_colleges INT,
    IN p_communities INT,
    IN p_vault_docs INT,
    IN p_session_credits INT,
    IN p_updated_by CHAR(36)
)
BEGIN
    INSERT IGNORE INTO `pro_free_limits` (`id`) VALUES (1);

    UPDATE `pro_free_limits`
       SET `free_paid_cohorts` =
             CASE WHEN p_free_paid_cohorts IS NULL THEN `free_paid_cohorts`
                  WHEN p_free_paid_cohorts < 0     THEN NULL
                  ELSE LEAST(20, p_free_paid_cohorts) END,
           `saved_colleges` =
             CASE WHEN p_saved_colleges IS NULL THEN `saved_colleges`
                  WHEN p_saved_colleges < 0     THEN NULL
                  ELSE LEAST(50, p_saved_colleges) END,
           `communities` =
             CASE WHEN p_communities IS NULL THEN `communities`
                  WHEN p_communities < 0     THEN NULL
                  ELSE LEAST(50, p_communities) END,
           `vault_docs` =
             CASE WHEN p_vault_docs IS NULL THEN `vault_docs`
                  WHEN p_vault_docs < 0     THEN NULL
                  ELSE LEAST(50, p_vault_docs) END,
           `session_credits` =
             CASE WHEN p_session_credits IS NULL THEN `session_credits`
                  WHEN p_session_credits < 0     THEN NULL
                  ELSE LEAST(20, p_session_credits) END,
           `updated_by` = p_updated_by,
           `updated_at` = UTC_TIMESTAMP()
     WHERE `id` = 1;

    SELECT `id`, `free_paid_cohorts`, `saved_colleges`, `communities`,
           `vault_docs`, `session_credits`, `updated_at`, `updated_by`
      FROM `pro_free_limits`
     WHERE `id` = 1;
END$$

DELIMITER ;
