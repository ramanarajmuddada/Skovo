-- SKOVO — metrics procedures.
--
-- Exported from the live schema by export_missing_procedures.py. These were
-- applied to the database by hand and never written back to source, so a
-- rebuild from this repo produced a database missing them.
--
-- Edit here, not in the database.

DELIMITER $$

DROP PROCEDURE IF EXISTS `sp_metrics_engagement`$$
CREATE PROCEDURE `sp_metrics_engagement`()
BEGIN
      -- score_events is the platform-wide activity ledger, so distinct actors
      -- there are a fair DAU/MAU proxy until a dedicated events table exists.
      SELECT
        (SELECT COUNT(DISTINCT user_id) FROM score_events
          WHERE occurred_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 DAY)) AS dau,
        (SELECT COUNT(DISTINCT user_id) FROM score_events
          WHERE occurred_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY)) AS mau;
    END$$

DROP PROCEDURE IF EXISTS `sp_metrics_hub_application_rate`$$
CREATE PROCEDURE `sp_metrics_hub_application_rate`()
BEGIN
      DECLARE v_floor INT DEFAULT 60;
      SELECT IFNULL(opportunity_unlock_score, 60) INTO v_floor
        FROM readiness_rules ORDER BY created_at ASC LIMIT 1;

      -- Of the students who can browse the hub (score >= floor), how many have
      -- applied at least once.
      SELECT
        COUNT(*) AS unlocked_users,
        SUM(EXISTS (SELECT 1 FROM opportunity_applications ap WHERE ap.user_id = rs.user_id)) AS applied_users
      FROM readiness_scores rs
      WHERE rs.score >= v_floor;
    END$$

DROP PROCEDURE IF EXISTS `sp_metrics_pro`$$
CREATE PROCEDURE `sp_metrics_pro`()
BEGIN
      SELECT
        (SELECT COUNT(*) FROM users WHERE status = 'active') AS total_students,
        (SELECT COUNT(*) FROM subscriptions
          WHERE status = 'active' AND expires_at > UTC_TIMESTAMP()) AS active_pro,
        -- Rough monthly recurring: annual/12 + quarterly/3 + monthly, live subs.
        (SELECT IFNULL(SUM(CASE plan
                  WHEN 'annual' THEN amount / 12
                  WHEN 'quarterly' THEN amount / 3
                  ELSE amount END), 0)
           FROM subscriptions
          WHERE status = 'active' AND expires_at > UTC_TIMESTAMP()) AS mrr_estimate;
    END$$

DROP PROCEDURE IF EXISTS `sp_metrics_score_distribution`$$
CREATE PROCEDURE `sp_metrics_score_distribution`()
BEGIN
      SELECT
        SUM(score BETWEEN 0 AND 19)  AS b0,
        SUM(score BETWEEN 20 AND 39) AS b20,
        SUM(score BETWEEN 40 AND 59) AS b40,
        SUM(score BETWEEN 60 AND 79) AS b60,
        SUM(score BETWEEN 80 AND 100) AS b80,
        COUNT(*) AS total,
        ROUND(AVG(score), 1) AS avg_score
      FROM readiness_scores;
    END$$

DROP PROCEDURE IF EXISTS `sp_metrics_unlock_rate`$$
CREATE PROCEDURE `sp_metrics_unlock_rate`()
BEGIN
      DECLARE v_floor INT DEFAULT 60;
      SELECT IFNULL(opportunity_unlock_score, 60) INTO v_floor
        FROM readiness_rules ORDER BY created_at ASC LIMIT 1;

      -- "Activated" = has any score signal at all, i.e. base_points > 0.
      SELECT
        v_floor AS unlock_floor,
        SUM(base_points > 0) AS activated,
        SUM(score >= v_floor) AS unlocked,
        COUNT(*) AS total
      FROM readiness_scores;
    END$$

DELIMITER ;
