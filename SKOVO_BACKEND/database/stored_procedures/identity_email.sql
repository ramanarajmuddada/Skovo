-- SKOVO — one place to ask "who already owns this email?"
--
-- Identities live in four tables — users (students), achievers, admins and
-- super_admins — each with its own UNIQUE(email). That stops a duplicate inside
-- one table but says nothing across them, so the same address could be both a
-- student and an achiever. Those are two different people in this product: a
-- student's readiness score, cohort bookings and Pro plan are not an achiever's
-- earnings and payouts, and a shared login makes "who am I signed in as?"
-- ambiguous on a phone where only one session exists.
--
-- Admin and super-admin are deliberately exempt — the same operator holds both,
-- and the portals are separate deployments.
--
-- Returns one row of flags rather than a yes/no, so the caller decides policy
-- and the error message can name the portal the address already belongs to.

DELIMITER $$

DROP PROCEDURE IF EXISTS `sp_identity_email_lookup`$$
CREATE PROCEDURE `sp_identity_email_lookup`(IN p_email VARCHAR(320))
BEGIN
    DECLARE v_email VARCHAR(320);
    SET v_email = LOWER(TRIM(p_email));

    SELECT
        -- Soft-deleted students free their address for re-registration, which is
        -- exactly what uq_users_email_active already encodes.
        (SELECT COUNT(*) FROM `users`
          WHERE LOWER(`email`) = v_email AND `deleted_at` IS NULL)      AS `in_users`,
        (SELECT COUNT(*) FROM `achievers`
          WHERE LOWER(`email`) = v_email)                               AS `in_achievers`,
        (SELECT COUNT(*) FROM `admins`
          WHERE LOWER(`email`) = v_email)                               AS `in_admins`,
        (SELECT COUNT(*) FROM `super_admins`
          WHERE LOWER(`email`) = v_email)                               AS `in_super_admins`;
END$$

DELIMITER ;
