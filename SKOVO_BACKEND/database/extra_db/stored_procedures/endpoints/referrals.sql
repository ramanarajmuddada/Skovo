-- SKOVO — Tailored endpoint SPs: referrals
DELIMITER $$

DROP PROCEDURE IF EXISTS `sp_referrals_by_referrer`$$
CREATE PROCEDURE `sp_referrals_by_referrer`(IN p_user_id CHAR(36))
BEGIN
    SELECT r.*, u.`full_name` AS referred_name
      FROM `referrals` r
      LEFT JOIN `users` u ON u.`id` = r.`referred_user_id`
     WHERE r.`referrer_id` = p_user_id
     ORDER BY r.`created_at` DESC;
END$$

DROP PROCEDURE IF EXISTS `sp_referrals_send`$$
CREATE PROCEDURE `sp_referrals_send`(
    IN p_id CHAR(36), IN p_referrer_id CHAR(36),
    IN p_email VARCHAR(320), IN p_referral_code VARCHAR(20))
BEGIN
    IF EXISTS (SELECT 1 FROM `referrals`
                WHERE `referrer_id` = p_referrer_id AND `referred_email` = p_email) THEN
        SELECT 0 AS created, NULL AS id;
    ELSE
        INSERT INTO `referrals` (`id`,`referrer_id`,`referred_email`,`referral_code`,`status`)
        VALUES (p_id, p_referrer_id, p_email, p_referral_code, 'pending');
        SELECT 1 AS created, p_id AS id;
    END IF;
END$$

DELIMITER ;
