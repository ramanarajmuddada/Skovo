-- SKOVO — cohorts courses procedures.
--
-- Exported from the live schema by export_missing_procedures.py. These were
-- applied to the database by hand and never written back to source, so a
-- rebuild from this repo produced a database missing them.
--
-- Edit here, not in the database.

DELIMITER $$

DROP PROCEDURE IF EXISTS `sp_achiever_coupon_create`$$
CREATE PROCEDURE `sp_achiever_coupon_create`(IN `p_id` char(36), IN `p_owner` char(36), IN `p_code` varchar(40), IN `p_type` varchar(10), IN `p_value` decimal(10,2), IN `p_max_discount` decimal(10,2), IN `p_min_amount` decimal(10,2), IN `p_applies` varchar(10), IN `p_max_uses` int, IN `p_per_user` int, IN `p_from` datetime, IN `p_until` datetime)
BEGIN
        IF EXISTS (
            SELECT 1 FROM coupons
             WHERE code = UPPER(TRIM(p_code))
               AND owner_achiever_id <=> p_owner
        ) THEN
            SELECT 0 AS ok, 'You already have this coupon code.' AS message, NULL AS id;
        ELSE
            INSERT INTO coupons (id, code, discount_type, value, max_discount, min_amount, applies_to,
                                 max_uses, per_user_limit, valid_from, valid_until, is_active, owner_achiever_id, created_by)
            VALUES (p_id, UPPER(TRIM(p_code)), COALESCE(p_type,'percent'), IFNULL(p_value,0), p_max_discount,
                    IFNULL(p_min_amount,0), COALESCE(p_applies,'all'), p_max_uses, IFNULL(p_per_user,1),
                    p_from, p_until, 1, p_owner, p_owner);
            SELECT 1 AS ok, 'Coupon created.' AS message, p_id AS id;
        END IF;
    END$$

DROP PROCEDURE IF EXISTS `sp_achiever_coupon_deactivate`$$
CREATE PROCEDURE `sp_achiever_coupon_deactivate`(IN `p_id` char(36), IN `p_owner` char(36))
BEGIN
        UPDATE coupons SET is_active = 0 WHERE id = p_id AND owner_achiever_id = p_owner;
        SELECT ROW_COUNT() AS updated;
    END$$

DROP PROCEDURE IF EXISTS `sp_achiever_coupon_list`$$
CREATE PROCEDURE `sp_achiever_coupon_list`(IN `p_owner` char(36))
BEGIN
        SELECT id, code, discount_type, value, max_discount, min_amount, applies_to, max_uses, used_count,
               per_user_limit, valid_from, valid_until, is_active, created_at
          FROM coupons WHERE owner_achiever_id = p_owner ORDER BY created_at DESC;
    END$$

DROP PROCEDURE IF EXISTS `sp_attendance_code_active`$$
CREATE PROCEDURE `sp_attendance_code_active`(IN `p_cohort` char(36))
BEGIN
              SELECT id, cohort_id, code, revealed_at, expires_at,
                     (expires_at > UTC_TIMESTAMP()) AS is_valid
                FROM cohort_attendance_codes
               WHERE cohort_id = p_cohort AND is_active = 1
               ORDER BY revealed_at DESC
               LIMIT 1;
            END$$

DROP PROCEDURE IF EXISTS `sp_attendance_code_redeem`$$
CREATE PROCEDURE `sp_attendance_code_redeem`(IN `p_cohort` char(36), IN `p_user` char(36), IN `p_code` varchar(8))
BEGIN
              DECLARE v_code       VARCHAR(8) DEFAULT NULL;
              DECLARE v_expires    DATETIME   DEFAULT NULL;
              DECLARE v_enrollment CHAR(36)   DEFAULT NULL;
              DECLARE v_attended   TINYINT(1) DEFAULT 0;

              SELECT code, expires_at INTO v_code, v_expires
                FROM cohort_attendance_codes
               WHERE cohort_id = p_cohort AND is_active = 1
               ORDER BY revealed_at DESC
               LIMIT 1;

              SELECT id, attended INTO v_enrollment, v_attended
                FROM cohort_enrollments
               WHERE cohort_id = p_cohort AND user_id = p_user
                 AND payment_status IN ('paid', 'free')
               LIMIT 1;

              IF v_enrollment IS NULL THEN
                SELECT 0 AS ok, 'not_enrolled' AS reason, NULL AS enrollment_id, 0 AS newly_marked;
              ELSEIF v_code IS NULL THEN
                SELECT 0 AS ok, 'no_active_code' AS reason, v_enrollment AS enrollment_id, 0 AS newly_marked;
              ELSEIF v_expires <= UTC_TIMESTAMP() THEN
                SELECT 0 AS ok, 'expired' AS reason, v_enrollment AS enrollment_id, 0 AS newly_marked;
              ELSEIF v_code <> p_code THEN
                SELECT 0 AS ok, 'wrong_code' AS reason, v_enrollment AS enrollment_id, 0 AS newly_marked;
              ELSE
                UPDATE cohort_enrollments
                   SET attended = 1, updated_at = UTC_TIMESTAMP()
                 WHERE id = v_enrollment;
                SELECT 1 AS ok, 'ok' AS reason, v_enrollment AS enrollment_id,
                       IF(v_attended = 1, 0, 1) AS newly_marked;
              END IF;
            END$$

DROP PROCEDURE IF EXISTS `sp_attendance_code_reveal`$$
CREATE PROCEDURE `sp_attendance_code_reveal`(IN `p_id` char(36), IN `p_cohort` char(36), IN `p_code` varchar(8), IN `p_by` char(36), IN `p_minutes` int)
BEGIN
              UPDATE cohort_attendance_codes
                 SET is_active = 0
               WHERE cohort_id = p_cohort AND is_active = 1;

              INSERT INTO cohort_attendance_codes
                     (id, cohort_id, code, revealed_by, revealed_at, expires_at, is_active)
              VALUES (p_id, p_cohort, p_code, p_by, UTC_TIMESTAMP(),
                      DATE_ADD(UTC_TIMESTAMP(), INTERVAL p_minutes MINUTE), 1);

              SELECT p_id AS id, p_code AS code,
                     DATE_ADD(UTC_TIMESTAMP(), INTERVAL p_minutes MINUTE) AS expires_at;
            END$$

DROP PROCEDURE IF EXISTS `sp_cohort_set_offer`$$
CREATE PROCEDURE `sp_cohort_set_offer`(IN `p_id` char(36), IN `p_achiever_id` char(36), IN `p_offer_price` int, IN `p_offer_percent` int, IN `p_offer_label` varchar(120), IN `p_offer_starts` datetime, IN `p_offer_ends` datetime)
BEGIN
      UPDATE cohorts
         SET offer_price = p_offer_price, offer_percent = p_offer_percent,
             offer_label = p_offer_label, offer_starts_at = p_offer_starts, offer_ends_at = p_offer_ends
       WHERE id = p_id AND achiever_id = p_achiever_id AND deleted_at IS NULL;
      SELECT ROW_COUNT() AS updated;
    END$$

DROP PROCEDURE IF EXISTS `sp_course_set_offer`$$
CREATE PROCEDURE `sp_course_set_offer`(IN `p_id` char(36), IN `p_achiever_id` char(36), IN `p_offer_price` int, IN `p_offer_percent` int, IN `p_offer_label` varchar(120), IN `p_offer_starts` datetime, IN `p_offer_ends` datetime)
BEGIN
      UPDATE achiever_courses
         SET offer_price = p_offer_price, offer_percent = p_offer_percent,
             offer_label = p_offer_label, offer_starts_at = p_offer_starts, offer_ends_at = p_offer_ends
       WHERE id = p_id AND achiever_id = p_achiever_id AND deleted_at IS NULL;
      SELECT ROW_COUNT() AS updated;
    END$$

DELIMITER ;
