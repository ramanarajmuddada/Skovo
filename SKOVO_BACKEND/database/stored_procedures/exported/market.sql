-- SKOVO — market procedures.
--
-- Exported from the live schema by export_missing_procedures.py. These were
-- applied to the database by hand and never written back to source, so a
-- rebuild from this repo produced a database missing them.
--
-- Edit here, not in the database.

DELIMITER $$

DROP PROCEDURE IF EXISTS `sp_market_categories`$$
CREATE PROCEDURE `sp_market_categories`()
BEGIN
      SELECT category, COUNT(*) AS total FROM market_deals
       WHERE is_active = 1 AND category IS NOT NULL AND category <> ''
         AND (starts_at IS NULL OR starts_at <= UTC_TIMESTAMP())
         AND (ends_at   IS NULL OR ends_at   >= UTC_TIMESTAMP())
       GROUP BY category ORDER BY total DESC;
    END$$

DROP PROCEDURE IF EXISTS `sp_market_deal_click`$$
CREATE PROCEDURE `sp_market_deal_click`(IN `p_id` char(36), IN `p_deal` char(36), IN `p_user` char(36))
BEGIN
      INSERT INTO market_deal_clicks (id, deal_id, user_id) VALUES (p_id, p_deal, p_user);
      UPDATE market_deals SET click_count = click_count + 1 WHERE id = p_deal;
      SELECT deal_url, coupon_code FROM market_deals WHERE id = p_deal;
    END$$

DROP PROCEDURE IF EXISTS `sp_market_deals_create`$$
CREATE PROCEDURE `sp_market_deals_create`(IN `p_id` char(36), IN `p_title` varchar(200), IN `p_brand` varchar(120), IN `p_description` text, IN `p_category` varchar(60), IN `p_image_url` text, IN `p_deal_url` text, IN `p_coupon_code` varchar(60), IN `p_discount_label` varchar(60), IN `p_is_pro_only` tinyint, IN `p_starts_at` datetime, IN `p_ends_at` datetime, IN `p_is_active` tinyint, IN `p_sort_order` int, IN `p_commission_rate` decimal(5,2), IN `p_is_featured` tinyint, IN `p_featured_until` datetime)
BEGIN
      INSERT INTO market_deals (id, title, brand, description, category, image_url, deal_url,
                                coupon_code, discount_label, is_pro_only, starts_at, ends_at,
                                is_active, sort_order, commission_rate, is_featured, featured_until)
      VALUES (p_id, p_title, p_brand, p_description, p_category, p_image_url, p_deal_url,
              p_coupon_code, p_discount_label, p_is_pro_only, p_starts_at, p_ends_at,
              p_is_active, p_sort_order, p_commission_rate, p_is_featured, p_featured_until);
      SELECT * FROM market_deals WHERE id = p_id;
    END$$

DROP PROCEDURE IF EXISTS `sp_market_deals_delete`$$
CREATE PROCEDURE `sp_market_deals_delete`(IN `p_id` char(36))
BEGIN
      DELETE FROM market_deal_clicks WHERE deal_id = p_id;
      DELETE FROM market_deals WHERE id = p_id;
      SELECT ROW_COUNT() AS deleted;
    END$$

DROP PROCEDURE IF EXISTS `sp_market_deals_get`$$
CREATE PROCEDURE `sp_market_deals_get`(IN `p_id` char(36))
BEGIN
      SELECT * FROM market_deals WHERE id = p_id;
    END$$

DROP PROCEDURE IF EXISTS `sp_market_deals_list_admin`$$
CREATE PROCEDURE `sp_market_deals_list_admin`(IN `p_limit` int, IN `p_offset` int)
BEGIN
      SELECT d.*,
             (SELECT COUNT(*) FROM market_deal_clicks c WHERE c.deal_id = d.id) AS clicks
        FROM market_deals d
       ORDER BY d.is_active DESC, d.sort_order DESC, d.created_at DESC
       LIMIT p_limit OFFSET p_offset;
    END$$

DROP PROCEDURE IF EXISTS `sp_market_deals_list_public`$$
CREATE PROCEDURE `sp_market_deals_list_public`(IN `p_category` varchar(60), IN `p_search` varchar(120), IN `p_limit` int, IN `p_offset` int)
BEGIN
      SELECT *,
             (is_featured = 1 AND (featured_until IS NULL OR featured_until >= UTC_TIMESTAMP())) AS featured_live
        FROM market_deals
       WHERE is_active = 1
         AND (starts_at IS NULL OR starts_at <= UTC_TIMESTAMP())
         AND (ends_at   IS NULL OR ends_at   >= UTC_TIMESTAMP())
         AND (p_category IS NULL OR p_category = '' OR category = p_category)
         AND (p_search IS NULL OR p_search = ''
              OR title LIKE CONCAT('%', p_search, '%')
              OR brand LIKE CONCAT('%', p_search, '%'))
       ORDER BY featured_live DESC, sort_order DESC, created_at DESC, id DESC
       LIMIT p_limit OFFSET p_offset;
    END$$

DROP PROCEDURE IF EXISTS `sp_market_deals_update`$$
CREATE PROCEDURE `sp_market_deals_update`(IN `p_id` char(36), IN `p_title` varchar(200), IN `p_brand` varchar(120), IN `p_description` text, IN `p_category` varchar(60), IN `p_image_url` text, IN `p_deal_url` text, IN `p_coupon_code` varchar(60), IN `p_discount_label` varchar(60), IN `p_is_pro_only` tinyint, IN `p_starts_at` datetime, IN `p_ends_at` datetime, IN `p_is_active` tinyint, IN `p_sort_order` int, IN `p_commission_rate` decimal(5,2), IN `p_is_featured` tinyint, IN `p_featured_until` datetime)
BEGIN
      UPDATE market_deals SET
        title = COALESCE(p_title, title), brand = p_brand, description = p_description,
        category = p_category, image_url = p_image_url,
        deal_url = COALESCE(p_deal_url, deal_url), coupon_code = p_coupon_code,
        discount_label = p_discount_label, is_pro_only = COALESCE(p_is_pro_only, is_pro_only),
        starts_at = p_starts_at, ends_at = p_ends_at,
        is_active = COALESCE(p_is_active, is_active),
        sort_order = COALESCE(p_sort_order, sort_order),
        commission_rate = p_commission_rate,
        is_featured = COALESCE(p_is_featured, is_featured),
        featured_until = p_featured_until
      WHERE id = p_id;
      SELECT * FROM market_deals WHERE id = p_id;
    END$$

DELIMITER ;
