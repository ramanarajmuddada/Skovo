-- ============================================================
-- SKOVO — money-path helpers (invoices, coupons, refund quotes)
-- Called from mark_paid / cancel. No hardcoded 24 / 50 / 2 / 18.
-- ============================================================

DELIMITER $$

-- Next invoice number from a counter row (FOR UPDATE). Never MAX()+1.
DROP PROCEDURE IF EXISTS `sp_invoice_next_number`$$
CREATE PROCEDURE `sp_invoice_next_number`(
    IN p_prefix VARCHAR(16),
    OUT p_number VARCHAR(40)
)
BEGIN
    DECLARE v_seq INT;
    DECLARE v_prefix VARCHAR(16);

    SET v_prefix = IFNULL(NULLIF(TRIM(p_prefix), ''), 'INV');

    INSERT INTO `invoice_counters` (prefix, next_number)
    VALUES (v_prefix, 1)
    ON DUPLICATE KEY UPDATE prefix = prefix;

    SELECT next_number INTO v_seq
      FROM `invoice_counters`
     WHERE prefix = v_prefix
       FOR UPDATE;

    UPDATE `invoice_counters`
       SET next_number = next_number + 1
     WHERE prefix = v_prefix;

    SET p_number = CONCAT(v_prefix, '-', LPAD(v_seq, 6, '0'));
END$$


-- GST-inclusive invoice for a paid order. No transaction of its own.
DROP PROCEDURE IF EXISTS `sp_invoice_issue_for_order`$$
CREATE PROCEDURE `sp_invoice_issue_for_order`(
    IN p_order_id      CHAR(36),
    IN p_context_type  VARCHAR(10),
    IN p_context_id    CHAR(36),
    IN p_description   TEXT
)
BEGIN
    DECLARE v_student  CHAR(36);
    DECLARE v_gross    DECIMAL(10,2);
    DECLARE v_discount DECIMAL(10,2);
    DECLARE v_coupon   VARCHAR(40);
    DECLARE v_gst_pct  DECIMAL(5,2);
    DECLARE v_prefix   VARCHAR(16);
    DECLARE v_number   VARCHAR(40);
    DECLARE v_base     DECIMAL(10,2);
    DECLARE v_gst      DECIMAL(10,2);
    DECLARE v_exists   CHAR(36);

    SELECT id INTO v_exists FROM `invoices`
     WHERE payment_id = p_order_id LIMIT 1;
    IF v_exists IS NOT NULL THEN
        -- Idempotent: webhook retry must not mint a second number.
        SET v_exists = v_exists;
    ELSE
        SELECT student_id, gross, discount, coupon_code
          INTO v_student, v_gross, v_discount, v_coupon
          FROM `payment_orders` WHERE id = p_order_id;

        SELECT CAST(setting_value AS DECIMAL(5,2)) INTO v_gst_pct
          FROM `payment_settings` WHERE setting_key = 'gst_rate';
        SELECT setting_value INTO v_prefix
          FROM `payment_settings` WHERE setting_key = 'invoice_prefix';

        IF v_gst_pct IS NULL THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'PAYMENT_SETTINGS_MISSING';
        END IF;

        SET v_prefix = IFNULL(v_prefix, 'INV');
        -- Listed price is GST-inclusive. Taxable = total / (1 + rate/100).
        SET v_base = ROUND(IFNULL(v_gross, 0) / (1 + v_gst_pct / 100), 2);
        SET v_gst  = ROUND(IFNULL(v_gross, 0) - v_base, 2);

        CALL sp_invoice_next_number(v_prefix, v_number);

        INSERT INTO `invoices`
            (id, invoice_number, user_id, context_type, context_id, description,
             base_amount, discount_amount, gst_rate, gst_amount, total_amount,
             payment_id, coupon_code, status)
        VALUES
            (UUID(), v_number, v_student, p_context_type, p_context_id, p_description,
             v_base, IFNULL(v_discount, 0), v_gst_pct, v_gst, IFNULL(v_gross, 0),
             p_order_id, v_coupon, 'paid');
    END IF;
END$$


DROP PROCEDURE IF EXISTS `sp_coupon_redeem_for_order`$$
CREATE PROCEDURE `sp_coupon_redeem_for_order`(
    IN p_order_id     CHAR(36),
    IN p_context_type VARCHAR(10),
    IN p_context_id   CHAR(36)
)
BEGIN
    DECLARE v_code     VARCHAR(40);
    DECLARE v_student  CHAR(36);
    DECLARE v_discount DECIMAL(10,2);
    DECLARE v_cid      CHAR(36);
    DECLARE v_dup      INT DEFAULT 0;

    SELECT coupon_code, student_id, discount
      INTO v_code, v_student, v_discount
      FROM `payment_orders` WHERE id = p_order_id;

    IF v_code IS NOT NULL AND v_code <> '' THEN
        SELECT id INTO v_cid FROM `coupons` WHERE code = UPPER(TRIM(v_code)) LIMIT 1;
        IF v_cid IS NOT NULL THEN
            SELECT COUNT(*) INTO v_dup FROM `coupon_redemptions`
             WHERE coupon_id = v_cid AND user_id = v_student
               AND context_type = p_context_type AND context_id = p_context_id;
            IF v_dup = 0 THEN
                INSERT INTO `coupon_redemptions`
                    (id, coupon_id, code, user_id, context_type, context_id, discount_amount)
                VALUES (UUID(), v_cid, UPPER(TRIM(v_code)), v_student,
                        p_context_type, p_context_id, IFNULL(v_discount, 0));
                UPDATE `coupons` SET used_count = IFNULL(used_count, 0) + 1 WHERE id = v_cid;
            END IF;
        END IF;
    END IF;
END$$


-- Restore a use after a *full* refund of the order that consumed it.
DROP PROCEDURE IF EXISTS `sp_coupon_restore_for_order`$$
CREATE PROCEDURE `sp_coupon_restore_for_order`(
    IN p_order_id CHAR(36)
)
BEGIN
    DECLARE v_code VARCHAR(40);
    DECLARE v_student CHAR(36);
    DECLARE v_cid CHAR(36);

    SELECT coupon_code, student_id INTO v_code, v_student
      FROM `payment_orders` WHERE id = p_order_id;

    IF v_code IS NOT NULL AND v_code <> '' THEN
        SELECT id INTO v_cid FROM `coupons` WHERE code = UPPER(TRIM(v_code)) LIMIT 1;
        IF v_cid IS NOT NULL THEN
            DELETE FROM `coupon_redemptions`
             WHERE coupon_id = v_cid AND user_id = v_student
             ORDER BY created_at DESC LIMIT 1;
            UPDATE `coupons`
               SET used_count = GREATEST(IFNULL(used_count, 1) - 1, 0)
             WHERE id = v_cid;
        END IF;
    END IF;
END$$


-- Hours × amount × actor × optional snapshot → refund rupees.
DROP PROCEDURE IF EXISTS `sp_refund_quote_apply`$$
CREATE PROCEDURE `sp_refund_quote_apply`(
    IN  p_hours   DECIMAL(10,4),
    IN  p_amount  DECIMAL(10,2),
    IN  p_actor   VARCHAR(20),
    IN  p_snapshot JSON,
    OUT p_refund  DECIMAL(10,2),
    OUT p_tier    VARCHAR(20)
)
BEGIN
    DECLARE v_pct   DECIMAL(5,2) DEFAULT NULL;
    DECLARE v_hours DECIMAL(10,4);
    DECLARE v_actor VARCHAR(20);

    SET v_hours = IFNULL(p_hours, 0);
    SET v_actor = IFNULL(p_actor, 'student');

    IF p_snapshot IS NOT NULL THEN
        SELECT t.pct INTO v_pct
          FROM JSON_TABLE(p_snapshot, '$[*]' COLUMNS (
                   actor     VARCHAR(20) COLLATE utf8mb4_unicode_ci PATH '$.actor',
                   min_hours DECIMAL(10,2)   PATH '$.min_hours',
                   pct       DECIMAL(5,2)    PATH '$.pct'
               )) AS t
         WHERE t.actor = v_actor
           AND t.min_hours <= GREATEST(v_hours, 0)
         ORDER BY t.min_hours DESC
         LIMIT 1;
    END IF;

    IF v_pct IS NULL THEN
        SET v_pct = 0;
        SELECT refund_pct INTO v_pct
          FROM `refund_rules`
         WHERE is_active = 1
           AND rule_set = 'floor'
           AND actor = v_actor
           AND min_hours <= GREATEST(v_hours, 0)
         ORDER BY min_hours DESC
         LIMIT 1;
        IF v_pct IS NULL THEN SET v_pct = 0; END IF;
    END IF;

    SET p_refund = ROUND(IFNULL(p_amount, 0) * v_pct / 100, 2);
    SET p_tier = CASE
        WHEN v_pct >= 100 THEN 'full'
        WHEN v_pct > 0    THEN 'partial'
        ELSE 'none' END;
END$$


DROP PROCEDURE IF EXISTS `sp_refund_preview_cohort`$$
CREATE PROCEDURE `sp_refund_preview_cohort`(
    IN p_enrollment_id CHAR(36),
    IN p_user_id       CHAR(36),
    IN p_actor         VARCHAR(20)
)
BEGIN
    DECLARE v_amount DECIMAL(10,2);
    DECLARE v_pay VARCHAR(20);
    DECLARE v_owner CHAR(36);
    DECLARE v_start DATETIME;
    DECLARE v_snap JSON;
    DECLARE v_order CHAR(36);
    DECLARE v_hours DECIMAL(10,4);
    DECLARE v_refund DECIMAL(10,2);
    DECLARE v_tier VARCHAR(20);
    DECLARE v_status VARCHAR(20);

    SELECT e.amount_paid, e.payment_status, e.user_id, e.payment_order_id,
           e.refund_snapshot, c.session_date, c.status
      INTO v_amount, v_pay, v_owner, v_order, v_snap, v_start, v_status
      FROM `cohort_enrollments` e
      LEFT JOIN `cohorts` c ON c.id = e.cohort_id
     WHERE e.id = p_enrollment_id;

    IF v_pay IS NULL THEN
        SELECT 0 AS ok, 'Booking not found.' AS message, 0 AS refund, 'none' AS tier,
               NULL AS old_status, NULL AS order_id, 0 AS hours_until;
    ELSEIF p_user_id IS NOT NULL AND v_owner <> p_user_id AND IFNULL(p_actor,'student') = 'student' THEN
        SELECT 0 AS ok, 'Booking not found.' AS message, 0 AS refund, 'none' AS tier,
               NULL AS old_status, NULL AS order_id, 0 AS hours_until;
    ELSEIF v_status = 'completed' THEN
        SELECT 0 AS ok, 'Cannot cancel a completed cohort.' AS message, 0 AS refund, 'none' AS tier,
               v_pay AS old_status, v_order AS order_id, 0 AS hours_until;
    ELSE
        SET v_hours = TIMESTAMPDIFF(MINUTE, UTC_TIMESTAMP(), v_start) / 60.0;
        CALL sp_refund_quote_apply(v_hours, v_amount, IFNULL(p_actor,'student'), v_snap, v_refund, v_tier);
        IF IFNULL(p_actor,'student') <> 'student' THEN
            CALL sp_refund_quote_apply(v_hours, v_amount, p_actor, v_snap, v_refund, v_tier);
        END IF;
        SELECT 1 AS ok, 'ok' AS message, IFNULL(v_refund,0) AS refund, IFNULL(v_tier,'none') AS tier,
               v_pay AS old_status, v_order AS order_id, v_hours AS hours_until;
    END IF;
END$$


DROP PROCEDURE IF EXISTS `sp_refund_preview_session`$$
CREATE PROCEDURE `sp_refund_preview_session`(
    IN p_session_id CHAR(36),
    IN p_user_id    CHAR(36),
    IN p_actor      VARCHAR(20)
)
BEGIN
    DECLARE v_amount DECIMAL(10,2);
    DECLARE v_pay VARCHAR(20);
    DECLARE v_owner CHAR(36);
    DECLARE v_start DATETIME;
    DECLARE v_snap JSON;
    DECLARE v_order VARCHAR(100);
    DECLARE v_hours DECIMAL(10,4);
    DECLARE v_refund DECIMAL(10,2);
    DECLARE v_tier VARCHAR(20);
    DECLARE v_status VARCHAR(20);

    SELECT s.amount, s.payment_status, s.student_id, s.payment_order_id,
           s.refund_snapshot, s.status,
           COALESCE(sl.start_utc,
                    DATE_SUB(TIMESTAMP(sl.slot_date, sl.start_time), INTERVAL 330 MINUTE))
      INTO v_amount, v_pay, v_owner, v_order, v_snap, v_status, v_start
      FROM `achiever_sessions` s
      LEFT JOIN `achiever_slots` sl ON sl.session_id = s.id
        AND (s.proposed_slot_id IS NULL OR sl.id <> s.proposed_slot_id)
     WHERE s.id = p_session_id;

    IF v_status IS NULL THEN
        SELECT 0 AS ok, 'Session not found.' AS message, 0 AS refund, 'none' AS tier,
               NULL AS old_status, NULL AS order_id, 0 AS hours_until;
    ELSEIF p_user_id IS NOT NULL AND v_owner <> p_user_id AND IFNULL(p_actor,'student') = 'student' THEN
        SELECT 0 AS ok, 'Session not found.' AS message, 0 AS refund, 'none' AS tier,
               NULL AS old_status, NULL AS order_id, 0 AS hours_until;
    ELSEIF v_status IN ('cancelled', 'completed') THEN
        SELECT 0 AS ok, 'This session can no longer be cancelled.' AS message, 0 AS refund, 'none' AS tier,
               v_pay AS old_status, v_order AS order_id, 0 AS hours_until;
    ELSE
        SET v_hours = TIMESTAMPDIFF(MINUTE, UTC_TIMESTAMP(), v_start) / 60.0;
        CALL sp_refund_quote_apply(v_hours, v_amount, IFNULL(p_actor,'student'), v_snap, v_refund, v_tier);
        SELECT 1 AS ok, 'ok' AS message, IFNULL(v_refund,0) AS refund, IFNULL(v_tier,'none') AS tier,
               v_pay AS old_status, v_order AS order_id, v_hours AS hours_until;
    END IF;
END$$


DELIMITER ;
