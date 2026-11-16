-- SKOVO — consent dpdp procedures.
--
-- Exported from the live schema by export_missing_procedures.py. These were
-- applied to the database by hand and never written back to source, so a
-- rebuild from this repo produced a database missing them.
--
-- Edit here, not in the database.

DELIMITER $$

DROP PROCEDURE IF EXISTS `sp_consent_record`$$
CREATE PROCEDURE `sp_consent_record`(IN `p_id` char(36), IN `p_user` char(36), IN `p_type` varchar(40), IN `p_version` varchar(20), IN `p_granted` tinyint, IN `p_ip` varchar(64))
BEGIN
      INSERT INTO user_consents (id, user_id, consent_type, policy_version, granted, ip)
      VALUES (p_id, p_user, p_type, p_version, p_granted, p_ip);
      SELECT 1 AS ok;
    END$$

DROP PROCEDURE IF EXISTS `sp_parental_consent_confirm`$$
CREATE PROCEDURE `sp_parental_consent_confirm`(IN `p_token` char(36))
BEGIN
      DECLARE v_user CHAR(36); DECLARE v_status VARCHAR(20); DECLARE v_exp DATETIME;
      SELECT user_id, status, expires_at INTO v_user, v_status, v_exp
        FROM parental_consents WHERE token = p_token;

      IF v_user IS NULL THEN
        SELECT 0 AS ok, 'invalid' AS result;
      ELSEIF v_status = 'confirmed' THEN
        SELECT 1 AS ok, 'already' AS result, v_user AS user_id;
      ELSEIF v_status <> 'pending' THEN
        SELECT 0 AS ok, 'superseded' AS result;
      ELSEIF v_exp < UTC_TIMESTAMP() THEN
        SELECT 0 AS ok, 'expired' AS result;
      ELSE
        UPDATE parental_consents SET status = 'confirmed', confirmed_at = UTC_TIMESTAMP()
         WHERE token = p_token;
        UPDATE users SET consent_status = 'granted' WHERE id = v_user;
        INSERT INTO user_consents (id, user_id, consent_type, policy_version, granted)
        VALUES (UUID(), v_user, 'parental', 'v1', 1);
        SELECT 1 AS ok, 'confirmed' AS result, v_user AS user_id;
      END IF;
    END$$

DROP PROCEDURE IF EXISTS `sp_parental_consent_request`$$
CREATE PROCEDURE `sp_parental_consent_request`(IN `p_id` char(36), IN `p_user` char(36), IN `p_email` varchar(160), IN `p_name` varchar(120), IN `p_token` char(36), IN `p_days` int)
BEGIN
      -- Supersede any earlier pending request for this minor.
      UPDATE parental_consents SET status = 'superseded'
       WHERE user_id = p_user AND status = 'pending';

      INSERT INTO parental_consents (id, user_id, parent_email, parent_name, token, expires_at)
      VALUES (p_id, p_user, p_email, p_name, p_token,
              DATE_ADD(UTC_TIMESTAMP(), INTERVAL p_days DAY));

      UPDATE users SET consent_status = 'awaiting_parent' WHERE id = p_user;
      SELECT 1 AS ok, p_token AS token;
    END$$

DROP PROCEDURE IF EXISTS `sp_parental_consent_status`$$
CREATE PROCEDURE `sp_parental_consent_status`(IN `p_user` char(36))
BEGIN
      SELECT u.consent_status,
             pc.parent_email, pc.status AS parent_status, pc.requested_at
        FROM users u
        LEFT JOIN parental_consents pc
          ON pc.user_id = u.id AND pc.status IN ('pending','confirmed')
       WHERE u.id = p_user
       ORDER BY pc.requested_at DESC
       LIMIT 1;
    END$$

DROP PROCEDURE IF EXISTS `sp_user_set_dob`$$
CREATE PROCEDURE `sp_user_set_dob`(IN `p_user` char(36), IN `p_dob` date)
BEGIN
      DECLARE v_age INT DEFAULT 0;
      SET v_age = TIMESTAMPDIFF(YEAR, p_dob, CURDATE());

      -- No age banding. There is no minimum age and no parental-consent
      -- step, so the date of birth is stored as plain profile data and
      -- every account is granted.
      UPDATE users SET date_of_birth = p_dob, consent_status = 'granted'
       WHERE id = p_user;

      SELECT v_age AS age,
             (SELECT consent_status FROM users WHERE id = p_user) AS consent_status;
    END$$

DELIMITER ;
