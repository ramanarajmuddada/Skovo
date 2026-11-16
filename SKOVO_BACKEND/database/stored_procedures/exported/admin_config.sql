-- SKOVO — admin config procedures.
--
-- Exported from the live schema by export_missing_procedures.py. These were
-- applied to the database by hand and never written back to source, so a
-- rebuild from this repo produced a database missing them.
--
-- Edit here, not in the database.

DELIMITER $$

DROP PROCEDURE IF EXISTS `sp_subscription_plan_update`$$
CREATE PROCEDURE `sp_subscription_plan_update`(IN `p_key` varchar(30), IN `p_price` int, IN `p_offer_price` int, IN `p_offer_percent` int, IN `p_offer_label` varchar(120), IN `p_offer_starts` datetime, IN `p_offer_ends` datetime, IN `p_is_active` tinyint)
BEGIN
      UPDATE subscription_plans
         SET price           = COALESCE(p_price, price),
             offer_price     = p_offer_price,
             offer_percent   = p_offer_percent,
             offer_label     = p_offer_label,
             offer_starts_at = p_offer_starts,
             offer_ends_at   = p_offer_ends,
             is_active       = COALESCE(p_is_active, is_active)
       WHERE plan_key = p_key;
      SELECT ROW_COUNT() AS updated;
    END$$

DROP PROCEDURE IF EXISTS `sp_subscription_plans_list`$$
CREATE PROCEDURE `sp_subscription_plans_list`(IN `p_active_only` tinyint)
BEGIN
      SELECT id, plan_key, label, price, months, offer_price, offer_percent, offer_label,
             offer_starts_at, offer_ends_at, is_active, sort_order
        FROM subscription_plans
       WHERE (p_active_only = 0 OR is_active = 1)
       ORDER BY sort_order, months;
    END$$

DELIMITER ;
