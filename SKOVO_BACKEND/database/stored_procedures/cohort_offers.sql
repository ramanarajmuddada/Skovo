-- SKOVO stored procedures: public cohort offers (v1 has no coupon codes)
--
-- An achiever sets the offer in Create / Edit cohort; Achiever > Offers lists
-- them and can stop one. The first-N limit is enforced in sp_payment_cohort_hold_offer.

DELIMITER $$

-- Set or clear (all NULL) the offer on the achiever's own cohort. The offer runs
-- from the moment it is saved, so offer_starts_at is cleared.
DROP PROCEDURE IF EXISTS `sp_cohort_offer_set`$$
CREATE PROCEDURE `sp_cohort_offer_set`(
    IN p_id CHAR(36), IN p_achiever CHAR(36),
    IN p_offer_price INT, IN p_offer_percent INT, IN p_label VARCHAR(120),
    IN p_ends DATETIME, IN p_seats INT
)
BEGIN
    UPDATE `cohorts`
       SET offer_price = p_offer_price, offer_percent = p_offer_percent,
           offer_label = p_label, offer_starts_at = NULL,
           offer_ends_at = p_ends, offer_seats = p_seats,
           updated_at = UTC_TIMESTAMP()
     WHERE id = p_id AND achiever_id = p_achiever AND deleted_at IS NULL;
    SELECT ROW_COUNT() AS updated;
END$$

-- Slabs (cohorts.offer_tiers). A new procedure rather than another argument on
-- sp_cohort_offer_set: dev and live share one database, and changing that
-- procedure's arguments would break the running server until the deploy.
DROP PROCEDURE IF EXISTS `sp_cohort_offer_tiers_set`$$
CREATE PROCEDURE `sp_cohort_offer_tiers_set`(IN p_id CHAR(36), IN p_achiever CHAR(36), IN p_tiers JSON)
BEGIN
    UPDATE `cohorts` SET offer_tiers = p_tiers, updated_at = UTC_TIMESTAMP()
     WHERE id = p_id AND achiever_id = p_achiever AND deleted_at IS NULL;
    SELECT ROW_COUNT() AS updated;
END$$

-- Offer places taken: paid (or later refunded: a refund does not give the place
-- back) plus live checkout holds. Expired holds are not counted.
DROP PROCEDURE IF EXISTS `sp_cohort_offer_used`$$
CREATE PROCEDURE `sp_cohort_offer_used`(IN p_cohort CHAR(36))
BEGIN
    SELECT COUNT(*) AS used
      FROM `cohort_enrollments`
     WHERE cohort_id = p_cohort AND offer_applied = 1
       AND (payment_status NOT IN ('pending', 'expired', 'failed')
            OR (payment_status = 'pending' AND expires_at > UTC_TIMESTAMP()));
END$$

-- Achiever > Offers: every cohort of theirs that has, or had, an offer.
DROP PROCEDURE IF EXISTS `sp_achiever_offers_list`$$
CREATE PROCEDURE `sp_achiever_offers_list`(IN p_achiever CHAR(36))
BEGIN
    SELECT c.id, c.title, c.price, c.session_date, c.duration_minutes, c.status,
           c.offer_price, c.offer_percent, c.offer_label, c.offer_starts_at,
           c.offer_ends_at, c.offer_seats, c.offer_tiers,
           (SELECT COUNT(*) FROM `cohort_enrollments` e
             WHERE e.cohort_id = c.id AND e.offer_applied = 1
               AND (e.payment_status NOT IN ('pending', 'expired', 'failed')
                    OR (e.payment_status = 'pending' AND e.expires_at > UTC_TIMESTAMP()))) AS offer_used
      FROM `cohorts` c
     WHERE c.achiever_id = p_achiever AND c.deleted_at IS NULL
       AND (c.offer_price IS NOT NULL OR IFNULL(c.offer_percent, 0) > 0 OR c.offer_tiers IS NOT NULL
            OR EXISTS (SELECT 1 FROM `cohort_enrollments` e2
                        WHERE e2.cohort_id = c.id AND e2.offer_applied = 1))
     ORDER BY c.session_date DESC;
END$$

DELIMITER ;
