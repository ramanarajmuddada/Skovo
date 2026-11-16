-- ============================================================
-- SKOVO — SUPER-ADMIN portal business-flow stored procedures (MySQL 8)
-- ============================================================
-- Platform-owner tier: cross-tenant metrics and the unified audit view.
-- ============================================================

DELIMITER $$

-- ------------------------------------------------------------
-- Platform-wide metrics (one summary row) for the SuperDashboard.
-- ------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_super_platform_metrics`$$
CREATE PROCEDURE `sp_super_platform_metrics`()
BEGIN
    SELECT
        (SELECT COUNT(*) FROM `users` WHERE deleted_at IS NULL)               AS total_students,
        (SELECT COUNT(*) FROM `achievers`)                                    AS total_achievers,
        (SELECT COUNT(*) FROM `admins`)                                       AS total_admins,
        (SELECT COUNT(*) FROM `super_admins`)                                 AS total_super_admins,
        (SELECT COUNT(*) FROM `cohorts` WHERE deleted_at IS NULL)             AS total_cohorts,
        (SELECT COUNT(*) FROM `achiever_courses` WHERE deleted_at IS NULL)    AS total_courses,
        (SELECT COUNT(*) FROM `groups` WHERE deleted_at IS NULL)              AS total_communities,
        (SELECT COUNT(*) FROM `colleges` WHERE deleted_at IS NULL)            AS total_colleges,
        (SELECT COUNT(*) FROM `opportunities` WHERE deleted_at IS NULL)       AS total_opportunities,
        (SELECT COUNT(DISTINCT institution_subdomain) FROM `colleges`
           WHERE institution_subdomain IS NOT NULL AND institution_subdomain <> '') AS total_tenants,
        (SELECT IFNULL(SUM(total_amount),0) FROM `invoices` WHERE status='paid')     AS gross_revenue,
        (SELECT IFNULL(SUM(gst_amount),0)   FROM `invoices` WHERE status='paid')     AS gst_collected,
        (SELECT COUNT(*) FROM `payout_requests` WHERE status='pending')       AS pending_payouts,
        (SELECT IFNULL(SUM(amount),0) FROM `payout_requests` WHERE status='paid') AS total_paid_out;
END$$

-- ------------------------------------------------------------
-- Unified audit log — resolves the actor name across users / admins /
-- super_admins (the actor id can come from any of the three).
-- ------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_super_audit_log`$$
CREATE PROCEDURE `sp_super_audit_log`(
    IN p_limit  INT,
    IN p_offset INT
)
BEGIN
    IF p_limit IS NULL OR p_limit <= 0 THEN SET p_limit = 50; END IF;
    IF p_offset IS NULL OR p_offset < 0 THEN SET p_offset = 0; END IF;
    SELECT a.id, a.action, a.resource_type, a.resource_id, a.ip_address, a.created_at, a.meta,
           a.user_id AS actor_id,
           COALESCE(u.full_name, ad.full_name, sa.full_name, 'Unknown') AS actor_name,
           COALESCE(u.email, ad.email, sa.email)                        AS actor_email,
           CASE
               WHEN sa.id IS NOT NULL THEN 'super_admin'
               WHEN ad.id IS NOT NULL THEN 'admin'
               WHEN u.id  IS NOT NULL THEN 'user'
               ELSE 'unknown'
           END AS actor_role
      FROM `audit_logs` a
      LEFT JOIN `users`        u  ON u.id  = a.user_id
      LEFT JOIN `admins`       ad ON ad.id = a.user_id
      LEFT JOIN `super_admins` sa ON sa.id = a.user_id
     ORDER BY a.created_at DESC
     LIMIT p_limit OFFSET p_offset;
END$$

DELIMITER ;
