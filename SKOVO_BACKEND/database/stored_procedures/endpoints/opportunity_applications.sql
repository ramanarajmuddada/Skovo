-- ============================================================
-- SKOVO — Tailored endpoint stored procedures: opportunity applications
-- ============================================================
-- The generic sp_opportunity_applications_create/_update procs don't expose
-- `applied_at`/`status_updated_at` (auto-timestamp columns skipped by the
-- generator), but the application flow needs explicit control over them on
-- re-apply and status transitions.
-- ============================================================

DELIMITER $$

DROP PROCEDURE IF EXISTS `sp_opportunity_applications_get_by_user_opp`$$
CREATE PROCEDURE `sp_opportunity_applications_get_by_user_opp`(IN p_user_id CHAR(36), IN p_opportunity_id CHAR(36))
BEGIN
    SELECT * FROM `opportunity_applications`
     WHERE `user_id` = p_user_id AND `opportunity_id` = p_opportunity_id
     LIMIT 1;
END$$

DROP PROCEDURE IF EXISTS `sp_opportunity_application_reapply`$$
CREATE PROCEDURE `sp_opportunity_application_reapply`(
    IN p_id CHAR(36), IN p_resume_link TEXT, IN p_cover_note TEXT
)
BEGIN
    UPDATE `opportunity_applications`
       SET `status` = 'applied',
           `applied_at` = UTC_TIMESTAMP(),
           `status_updated_at` = UTC_TIMESTAMP(),
           `resume_link` = COALESCE(p_resume_link, `resume_link`),
           `cover_note` = COALESCE(p_cover_note, `cover_note`)
     WHERE `id` = p_id;
    SELECT * FROM `opportunity_applications` WHERE `id` = p_id;
END$$

DROP PROCEDURE IF EXISTS `sp_opportunity_application_set_status`$$
CREATE PROCEDURE `sp_opportunity_application_set_status`(IN p_id CHAR(36), IN p_status VARCHAR(20))
BEGIN
    UPDATE `opportunity_applications`
       SET `status` = p_status, `status_updated_at` = UTC_TIMESTAMP()
     WHERE `id` = p_id;
    SELECT * FROM `opportunity_applications` WHERE `id` = p_id;
END$$

DELIMITER ;
