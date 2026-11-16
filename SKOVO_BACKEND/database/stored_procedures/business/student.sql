-- ============================================================
-- SKOVO — STUDENT portal business-flow stored procedures (MySQL 8)
-- ============================================================
-- These encapsulate the *transactional DB* part of each student flow.
-- What still belongs in the app layer (cannot live in SQL):
--   • Cashfree order creation (the webhook verifies, not the client)
--   • Sending email / .ics calendar invites / push / SMS
--   • Issuing the actual gateway refund (call sp_*_cancel first to get the
--     amount, then hit the gateway, both inside one app transaction)
-- Refund % and hours come from refund_rules (snapshotted at pay), not literals.
-- GST rate comes from payment_settings. Invoice numbers from invoice_counters.
-- ============================================================

DELIMITER $$

-- ------------------------------------------------------------
-- Coupon validate (read-only) — mirrors helpers.billing.validate_coupon
-- Returns one row: valid, discount, final_amount, message, coupon_id
-- ------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_student_coupon_validate`$$
CREATE PROCEDURE `sp_student_coupon_validate`(
    IN p_code         VARCHAR(40),
    IN p_user_id      CHAR(36),
    IN p_amount       DECIMAL(10,2),
    IN p_context_type VARCHAR(10),
    IN p_context_id   CHAR(36)
)
BEGIN
    DECLARE v_id CHAR(36); DECLARE v_active TINYINT; DECLARE v_type VARCHAR(10);
    DECLARE v_value DECIMAL(10,2); DECLARE v_maxdisc DECIMAL(10,2);
    DECLARE v_minamt DECIMAL(10,2); DECLARE v_applies VARCHAR(10);
    DECLARE v_maxuses INT; DECLARE v_used INT; DECLARE v_peruser INT;
    DECLARE v_from DATETIME; DECLARE v_until DATETIME;
    DECLARE v_owner CHAR(36);
    DECLARE v_owner_user CHAR(36);
    DECLARE v_listing CHAR(36);
    DECLARE v_userused INT DEFAULT 0;
    DECLARE v_discount DECIMAL(10,2) DEFAULT 0;
    DECLARE v_now DATETIME DEFAULT UTC_TIMESTAMP();
    DECLARE v_ctx VARCHAR(10);
    DECLARE v_applies_ok TINYINT DEFAULT 0;
    DECLARE v_hits INT DEFAULT 0;
    DECLARE v_ambiguous TINYINT DEFAULT 0;

    SET v_ctx = IFNULL(NULLIF(TRIM(p_context_type), ''), 'cohort');

    -- Listing owner from checkout context. Session checkout sends the achiever id.
    IF p_context_id IS NOT NULL AND p_context_id <> '' THEN
        IF v_ctx = 'session' THEN
            SET v_listing = p_context_id;
        ELSEIF v_ctx = 'cohort' THEN
            SELECT achiever_id INTO v_listing FROM `cohorts` WHERE id = p_context_id;
        ELSEIF v_ctx = 'course' THEN
            SELECT achiever_id INTO v_listing FROM `achiever_courses` WHERE id = p_context_id;
        END IF;
    END IF;

    -- Two GATE20s can exist (Mahesh's and Rahul's). Pick the listing owner's
    -- row first; fall back to a platform (NULL owner) code. Bare code with no
    -- listing and more than one active match cannot be redeemed.
    IF v_listing IS NULL THEN
        SELECT COUNT(*) INTO v_hits
          FROM `coupons`
         WHERE `code` = UPPER(TRIM(p_code)) AND `is_active` = 1;
        IF IFNULL(v_hits, 0) > 1 THEN SET v_ambiguous = 1; END IF;
    END IF;

    IF v_ambiguous = 0 THEN
        SELECT id, is_active, discount_type, value, max_discount, min_amount, applies_to,
               max_uses, used_count, per_user_limit, valid_from, valid_until, owner_achiever_id,
               owner_user_id
          INTO v_id, v_active, v_type, v_value, v_maxdisc, v_minamt, v_applies,
               v_maxuses, v_used, v_peruser, v_from, v_until, v_owner,
               v_owner_user
          FROM `coupons`
         WHERE `code` = UPPER(TRIM(p_code)) AND `is_active` = 1
           AND (
                (v_listing IS NOT NULL AND `owner_achiever_id` <=> v_listing)
             OR (`owner_achiever_id` IS NULL)
           )
         ORDER BY (`owner_achiever_id` IS NULL) ASC
         LIMIT 1;
    END IF;

    SET v_applies_ok = (v_applies = v_ctx) OR (v_owner IS NULL AND v_applies = 'all');

    IF v_ambiguous = 1 THEN
        SELECT 0 AS valid, 0 AS discount, p_amount AS final_amount,
               'This code is used by more than one mentor. Open checkout from their page.' AS message,
               NULL AS coupon_id, NULL AS owner_achiever_id;
    ELSEIF v_id IS NULL OR v_active = 0 THEN
        SELECT 0 AS valid, 0 AS discount, p_amount AS final_amount, 'Invalid coupon.' AS message, NULL AS coupon_id, NULL AS owner_achiever_id;
    -- A Refer & Earn prize coupon is for the person who won it.
    ELSEIF v_owner_user IS NOT NULL AND NOT (v_owner_user <=> p_user_id) THEN
        SELECT 0 AS valid, 0 AS discount, p_amount AS final_amount, 'This coupon belongs to another account.' AS message, NULL AS coupon_id, NULL AS owner_achiever_id;
    ELSEIF v_from IS NOT NULL AND v_now < v_from THEN
        SELECT 0 AS valid, 0 AS discount, p_amount AS final_amount, 'Coupon not yet active.' AS message, NULL AS coupon_id, NULL AS owner_achiever_id;
    ELSEIF v_until IS NOT NULL AND v_now > v_until THEN
        SELECT 0 AS valid, 0 AS discount, p_amount AS final_amount, 'Coupon expired.' AS message, NULL AS coupon_id, NULL AS owner_achiever_id;
    ELSEIF v_applies_ok = 0 THEN
        SELECT 0 AS valid, 0 AS discount, p_amount AS final_amount, 'Coupon not valid for this purchase.' AS message, NULL AS coupon_id, NULL AS owner_achiever_id;
    ELSEIF p_amount < IFNULL(v_minamt,0) THEN
        SELECT 0 AS valid, 0 AS discount, p_amount AS final_amount, CONCAT('Minimum order ', v_minamt, ' required.') AS message, NULL AS coupon_id, v_owner AS owner_achiever_id;
    ELSEIF v_maxuses IS NOT NULL AND IFNULL(v_used,0) >= v_maxuses THEN
        SELECT 0 AS valid, 0 AS discount, p_amount AS final_amount, 'Coupon usage limit reached.' AS message, NULL AS coupon_id, v_owner AS owner_achiever_id;
    ELSE
        IF v_peruser IS NOT NULL AND v_peruser > 0 THEN
            SELECT COUNT(*) INTO v_userused FROM `coupon_redemptions`
              WHERE coupon_id = v_id AND user_id = p_user_id;
        END IF;
        IF v_peruser IS NOT NULL AND v_peruser > 0 AND v_userused >= v_peruser THEN
            SELECT 0 AS valid, 0 AS discount, p_amount AS final_amount, 'You have already used this coupon.' AS message, NULL AS coupon_id, v_owner AS owner_achiever_id;
        ELSE
            IF v_type = 'flat' THEN
                SET v_discount = v_value;
            ELSE
                SET v_discount = p_amount * v_value / 100.0;
                IF v_maxdisc IS NOT NULL THEN SET v_discount = LEAST(v_discount, v_maxdisc); END IF;
            END IF;
            SET v_discount = ROUND(LEAST(v_discount, p_amount), 2);
            IF v_discount <= 0 THEN
                SELECT 0 AS valid, 0 AS discount, p_amount AS final_amount, 'Coupon gives no discount on this order.' AS message, NULL AS coupon_id, v_owner AS owner_achiever_id;
            ELSE
                SELECT 1 AS valid, v_discount AS discount, ROUND(p_amount - v_discount, 2) AS final_amount,
                       NULL AS message, v_id AS coupon_id, v_owner AS owner_achiever_id;
            END IF;
        END IF;
    END IF;
END$$

-- ------------------------------------------------------------
-- Free cohort enroll — seat-locked, no oversell
-- ------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_student_cohort_enroll_free`$$
CREATE PROCEDURE `sp_student_cohort_enroll_free`(
    IN p_user_id   CHAR(36),
    IN p_cohort_id CHAR(36)
)
BEGIN
    DECLARE v_price INT; DECLARE v_status VARCHAR(20);
    DECLARE v_total INT; DECLARE v_filled INT; DECLARE v_deleted DATETIME;
    DECLARE v_exists VARCHAR(20) DEFAULT NULL;
    DECLARE v_eid CHAR(36);
    DECLARE v_taken INT DEFAULT 0;
    DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

    START TRANSACTION;
    SELECT price, status, total_seats, filled_seats, deleted_at
      INTO v_price, v_status, v_total, v_filled, v_deleted
      FROM `cohorts` WHERE id = p_cohort_id FOR UPDATE;

    IF v_price IS NULL OR v_deleted IS NOT NULL THEN
        ROLLBACK; SELECT 0 AS ok, 'Cohort not found.' AS message, NULL AS enrollment_id;
    ELSEIF v_status <> 'upcoming' AND NOT EXISTS (SELECT 1 FROM `cohorts` lj WHERE lj.id = p_cohort_id AND lj.status = 'live' AND lj.late_join_minutes > 0 AND UTC_TIMESTAMP() <= lj.session_date + INTERVAL lj.late_join_minutes MINUTE) THEN  -- late joining
        ROLLBACK; SELECT 0 AS ok, 'Enrollment is closed for this cohort.' AS message, NULL AS enrollment_id;
    ELSEIF v_price <> 0 THEN
        ROLLBACK; SELECT 0 AS ok, 'This is a paid cohort — use the paid flow.' AS message, NULL AS enrollment_id;
    ELSE
        SELECT payment_status INTO v_exists FROM `cohort_enrollments`
          WHERE user_id = p_user_id AND cohort_id = p_cohort_id LIMIT 1;
        IF v_exists IN ('paid','free') THEN
            ROLLBACK; SELECT 0 AS ok, 'You are already enrolled in this cohort.' AS message, NULL AS enrollment_id;
        ELSE
            SELECT COUNT(*) INTO v_taken
              FROM `cohort_enrollments`
             WHERE cohort_id = p_cohort_id
               AND (
                    payment_status IN ('paid', 'free')
                 OR (payment_status = 'pending'
                     AND expires_at IS NOT NULL
                     AND expires_at > UTC_TIMESTAMP()
                     AND user_id <> p_user_id)
                   );
        -- Only a positive total_seats is a cap; NULL/0 means unlimited.
        -- Live checkouts occupy a seat (same as 1-on-1 slot block).
        IF v_total IS NOT NULL AND v_total > 0 AND IFNULL(v_taken, 0) >= v_total THEN
            ROLLBACK; SELECT 0 AS ok, 'No seats available.' AS message, NULL AS enrollment_id;
        ELSE
            SET v_eid = UUID();
            INSERT INTO `cohort_enrollments` (id, user_id, cohort_id, payment_status, amount_paid, enrolled_at)
            VALUES (v_eid, p_user_id, p_cohort_id, 'free', 0, UTC_TIMESTAMP())
            ON DUPLICATE KEY UPDATE payment_status = 'free', amount_paid = 0;
            -- LAST_INSERT_ID(id) only works for INT ids — ours are UUIDs, so
            -- re-read the real row id (fresh insert or pre-existing pending row).
            SELECT id INTO v_eid FROM `cohort_enrollments`
              WHERE user_id = p_user_id AND cohort_id = p_cohort_id LIMIT 1;
            UPDATE `cohorts` SET filled_seats = filled_seats + 1 WHERE id = p_cohort_id;
            COMMIT;
            SELECT 1 AS ok, 'Enrolled successfully.' AS message, v_eid AS enrollment_id;
        END IF;
        END IF;
    END IF;
END$$

-- ------------------------------------------------------------
-- Book a 1-on-1 session with an achiever (holds the slot).
-- Free (p_amount=0) -> pending request. Paid -> slot held, payment pending
-- (app then creates the Cashfree order; the webhook confirms it).
-- ------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_student_session_book`$$
CREATE PROCEDURE `sp_student_session_book`(
    IN p_student_id       CHAR(36),
    IN p_mentor_id        CHAR(36),
    IN p_slot_id          CHAR(36),
    IN p_note             TEXT,
    IN p_amount           DECIMAL(10,2),
    IN p_coupon_code      VARCHAR(40),
    IN p_discount_amount  DECIMAL(10,2),
    IN p_payment_order_id VARCHAR(100)
)
BEGIN
    DECLARE v_slot_status VARCHAR(20); DECLARE v_slot_mentor CHAR(36);
    DECLARE v_sid CHAR(36); DECLARE v_pay VARCHAR(20); DECLARE v_cid CHAR(36) DEFAULT NULL;
    DECLARE v_hold INT; DECLARE v_slot_start DATETIME;
    DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

    -- Hold length is operator-configurable, not a literal in this procedure.
    SELECT CAST(setting_value AS UNSIGNED) INTO v_hold
      FROM `payment_settings` WHERE setting_key = 'hold_minutes';

    IF v_hold IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'PAYMENT_SETTINGS_MISSING';
    END IF;

    START TRANSACTION;
    SELECT status, mentor_id, COALESCE(start_utc, DATE_SUB(TIMESTAMP(slot_date, start_time), INTERVAL 330 MINUTE))
      INTO v_slot_status, v_slot_mentor, v_slot_start
      FROM `achiever_slots` WHERE id = p_slot_id FOR UPDATE;

    IF v_slot_status IS NULL THEN
        ROLLBACK; SELECT 0 AS ok, 'Slot not found.' AS message, NULL AS session_id;
    ELSEIF v_slot_status <> 'available' THEN
        ROLLBACK; SELECT 0 AS ok, 'Slot is no longer available.' AS message, NULL AS session_id;
    -- A slot nobody ever booked keeps status='available' for ever, so without
    -- this a student could book a session in the past. The listing endpoint
    -- defaults from_date to today, but that is a client-supplied query
    -- parameter -- backdating it listed old slots and every one of them was
    -- bookable. ST07-008. UTC_TIMESTAMP() matches how sp_student_session_cancel
    -- already reads these columns.
    ELSEIF v_slot_start IS NOT NULL AND v_slot_start < UTC_TIMESTAMP() THEN
        ROLLBACK; SELECT 0 AS ok, 'That time has already passed.' AS message, NULL AS session_id;
    ELSE
        SET v_sid = UUID();
        SET v_pay = IF(IFNULL(p_amount,0) = 0, 'free', 'pending');
        INSERT INTO `achiever_sessions`
            (id, mentor_id, student_id, note, status, amount, payment_status,
             coupon_code, discount_amount, payment_order_id)
        VALUES (v_sid, p_mentor_id, p_student_id, p_note, 'pending', IFNULL(p_amount,0), v_pay,
                p_coupon_code, IFNULL(p_discount_amount,0), p_payment_order_id);
        -- 'held' was written here and released nowhere in the codebase, so
        -- every abandoned paid checkout killed the slot for good. Same word as
        -- the payment_orders flow now ('blocked') and, crucially, a deadline —
        -- sp_payment_expire_holds releases anything past it.
        UPDATE `achiever_slots`
           SET status = IF(IFNULL(p_amount,0)=0,'booked','blocked'),
               blocked_until = IF(IFNULL(p_amount,0)=0, NULL,
                                  DATE_ADD(UTC_TIMESTAMP(), INTERVAL v_hold MINUTE)),
               session_id = v_sid
         WHERE id = p_slot_id;

        -- Free bookings (no seat left pending on the gateway) redeem the coupon
        -- immediately; paid bookings redeem it in sp_student_session_confirm_payment.
        IF v_pay = 'free' AND p_coupon_code IS NOT NULL AND p_coupon_code <> '' THEN
            SELECT id INTO v_cid FROM `coupons` WHERE code = UPPER(TRIM(p_coupon_code)) LIMIT 1;
            IF v_cid IS NOT NULL THEN
                INSERT INTO `coupon_redemptions`
                    (id, coupon_id, code, user_id, context_type, context_id, discount_amount)
                VALUES (UUID(), v_cid, UPPER(TRIM(p_coupon_code)), p_student_id, 'session', v_sid, IFNULL(p_discount_amount,0));
                UPDATE `coupons` SET used_count = IFNULL(used_count,0) + 1 WHERE id = v_cid;
            END IF;
        END IF;

        COMMIT;
        SELECT 1 AS ok, 'Session requested.' AS message, v_sid AS session_id;
    END IF;
END$$

-- ------------------------------------------------------------
-- Lock an achiever slot for booking/reschedule (no internal transaction —
-- relies on the caller's ambient session transaction so the row lock
-- survives across a subsequent gateway HTTP call, exactly like the old
-- ORM `.with_for_update()` did). Returns the slot row, or no rows if it
-- doesn't exist / isn't available / belongs to a different mentor.
-- ------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_achiever_slots_lock_available`$$
CREATE PROCEDURE `sp_achiever_slots_lock_available`(IN p_slot_id CHAR(36), IN p_mentor_id CHAR(36))
BEGIN
    SELECT * FROM `achiever_slots`
     WHERE id = p_slot_id AND mentor_id = p_mentor_id AND status = 'available'
     FOR UPDATE;
END$$

-- ------------------------------------------------------------
-- Release a still-unpaid pending session hold (student dismissed the
-- checkout popup). Frees the slot and deletes the ghost session row.
-- ------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_student_session_release`$$
CREATE PROCEDURE `sp_student_session_release`(
    IN p_session_id CHAR(36),
    IN p_student_id CHAR(36)
)
BEGIN
    DECLARE v_status VARCHAR(20); DECLARE v_pay VARCHAR(20);
    DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

    START TRANSACTION;
    SELECT status, payment_status INTO v_status, v_pay
      FROM `achiever_sessions` WHERE id = p_session_id AND student_id = p_student_id FOR UPDATE;

    IF v_status IS NULL THEN
        ROLLBACK; SELECT 0 AS ok, 'Session not found.' AS message;
    ELSEIF v_status <> 'pending' OR v_pay <> 'pending' THEN
        ROLLBACK; SELECT 0 AS ok, 'This session cannot be released.' AS message;
    ELSE
        UPDATE `achiever_slots` SET status = 'available', session_id = NULL WHERE session_id = p_session_id;
        DELETE FROM `achiever_sessions` WHERE id = p_session_id;
        COMMIT;
        SELECT 1 AS ok, 'Booking released.' AS message;
    END IF;
END$$

-- ------------------------------------------------------------
-- Move a pending/confirmed 1-on-1 to another available slot of the same
-- achiever. Frees the old slot, holds the new one, keeps the payment.
-- ------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_student_session_reschedule`$$
CREATE PROCEDURE `sp_student_session_reschedule`(
    IN p_session_id  CHAR(36),
    IN p_student_id  CHAR(36),
    IN p_new_slot_id CHAR(36)
)
BEGIN
    DECLARE v_status VARCHAR(20); DECLARE v_mentor_id CHAR(36);
    DECLARE v_new_status VARCHAR(20); DECLARE v_new_mentor CHAR(36);
    DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

    START TRANSACTION;
    SELECT status, mentor_id INTO v_status, v_mentor_id
      FROM `achiever_sessions` WHERE id = p_session_id AND student_id = p_student_id FOR UPDATE;

    IF v_status IS NULL THEN
        ROLLBACK; SELECT 0 AS ok, 'Session not found.' AS message;
    ELSEIF v_status NOT IN ('pending','confirmed') THEN
        ROLLBACK; SELECT 0 AS ok, 'This session cannot be rescheduled.' AS message;
    ELSE
        SELECT status, mentor_id INTO v_new_status, v_new_mentor
          FROM `achiever_slots` WHERE id = p_new_slot_id FOR UPDATE;
        IF v_new_status IS NULL OR v_new_status <> 'available' OR v_new_mentor <> v_mentor_id THEN
            ROLLBACK; SELECT 0 AS ok, 'That slot is no longer available.' AS message;
        ELSE
            UPDATE `achiever_slots` SET status = 'available', session_id = NULL WHERE session_id = p_session_id;
            UPDATE `achiever_slots` SET status = 'booked', session_id = p_session_id WHERE id = p_new_slot_id;
            UPDATE `achiever_sessions`
               SET reminder_sent = 0, proposed_slot_id = NULL
             WHERE id = p_session_id;
            COMMIT;
            SELECT 1 AS ok, 'Session rescheduled.' AS message;
        END IF;
    END IF;
END$$

-- Achiever offers a free slot. Holds it (same session_id) without dropping
-- the current time. Student accepts → move; declines → 100% refund.
DROP PROCEDURE IF EXISTS `sp_achiever_session_propose`$$
CREATE PROCEDURE `sp_achiever_session_propose`(
    IN p_session_id  CHAR(36),
    IN p_achiever_id CHAR(36),
    IN p_slot_id     CHAR(36)
)
BEGIN
    DECLARE v_status VARCHAR(20); DECLARE v_mentor CHAR(36);
    DECLARE v_old_prop CHAR(36);
    DECLARE v_new_status VARCHAR(20); DECLARE v_new_mentor CHAR(36);
    DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

    START TRANSACTION;
    SELECT status, mentor_id, proposed_slot_id
      INTO v_status, v_mentor, v_old_prop
      FROM `achiever_sessions` WHERE id = p_session_id FOR UPDATE;

    IF v_status IS NULL OR v_mentor <> p_achiever_id THEN
        ROLLBACK; SELECT 0 AS ok, 'Session not found.' AS message;
    ELSEIF v_status NOT IN ('pending','confirmed') THEN
        ROLLBACK; SELECT 0 AS ok, 'This session cannot be moved.' AS message;
    ELSE
        SELECT status, mentor_id INTO v_new_status, v_new_mentor
          FROM `achiever_slots` WHERE id = p_slot_id FOR UPDATE;
        IF v_new_status IS NULL OR v_new_mentor <> p_achiever_id THEN
            ROLLBACK; SELECT 0 AS ok, 'That slot is not yours.' AS message;
        ELSEIF v_new_status <> 'available' AND NOT (p_slot_id <=> v_old_prop) THEN
            ROLLBACK; SELECT 0 AS ok, 'That slot is no longer available.' AS message;
        ELSE
            IF v_old_prop IS NOT NULL AND v_old_prop <> p_slot_id THEN
                UPDATE `achiever_slots`
                   SET status = 'available', session_id = NULL
                 WHERE id = v_old_prop;
            END IF;
            UPDATE `achiever_slots`
               SET status = 'booked', session_id = p_session_id
             WHERE id = p_slot_id;
            UPDATE `achiever_sessions`
               SET proposed_slot_id = p_slot_id
             WHERE id = p_session_id;
            COMMIT;
            SELECT 1 AS ok, 'New time proposed.' AS message;
        END IF;
    END IF;
END$$

DROP PROCEDURE IF EXISTS `sp_student_session_accept_proposal`$$
CREATE PROCEDURE `sp_student_session_accept_proposal`(
    IN p_session_id CHAR(36),
    IN p_student_id CHAR(36)
)
BEGIN
    DECLARE v_status VARCHAR(20); DECLARE v_owner CHAR(36);
    DECLARE v_prop CHAR(36);
    DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

    START TRANSACTION;
    SELECT status, student_id, proposed_slot_id
      INTO v_status, v_owner, v_prop
      FROM `achiever_sessions` WHERE id = p_session_id FOR UPDATE;

    IF v_status IS NULL OR v_owner <> p_student_id THEN
        ROLLBACK; SELECT 0 AS ok, 'Session not found.' AS message;
    ELSEIF v_status NOT IN ('pending','confirmed') THEN
        ROLLBACK; SELECT 0 AS ok, 'This session cannot be moved.' AS message;
    ELSEIF v_prop IS NULL THEN
        ROLLBACK; SELECT 0 AS ok, 'No new time has been proposed.' AS message;
    ELSE
        UPDATE `achiever_slots`
           SET status = 'available', session_id = NULL
         WHERE session_id = p_session_id AND id <> v_prop;
        UPDATE `achiever_slots`
           SET status = 'booked', session_id = p_session_id
         WHERE id = v_prop;
        UPDATE `achiever_sessions`
           SET proposed_slot_id = NULL, reminder_sent = 0
         WHERE id = p_session_id;
        COMMIT;
        SELECT 1 AS ok, 'New time accepted.' AS message;
    END IF;
END$$

-- ------------------------------------------------------------
-- Cancel a session — computes refund per policy and releases the slot.
-- Returns the refund amount/tier; the APP then issues the gateway refund.
-- (Defaults: 100% if provider-initiated or >=24h before; 50% if >=2h; else 0.)
-- ------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_student_session_cancel`$$
CREATE PROCEDURE `sp_student_session_cancel`(
    IN p_session_id  CHAR(36),
    IN p_student_id  CHAR(36),
    IN p_by_provider TINYINT
)
BEGIN
    DECLARE v_amount DECIMAL(10,2); DECLARE v_pay VARCHAR(20); DECLARE v_status VARCHAR(20);
    DECLARE v_owner CHAR(36);
    DECLARE v_start DATETIME; DECLARE v_hours DECIMAL(10,2);
    DECLARE v_refund DECIMAL(10,2) DEFAULT 0; DECLARE v_tier VARCHAR(10) DEFAULT 'none';
    DECLARE v_snap JSON;
    DECLARE v_actor VARCHAR(20);
    DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

    START TRANSACTION;
    SELECT s.amount, s.payment_status, s.status, s.student_id, s.refund_snapshot,
           COALESCE(sl.start_utc,
                    DATE_SUB(TIMESTAMP(sl.slot_date, sl.start_time), INTERVAL 330 MINUTE))
      INTO v_amount, v_pay, v_status, v_owner, v_snap, v_start
      FROM `achiever_sessions` s
      LEFT JOIN `achiever_slots` sl ON sl.session_id = s.id
        AND (s.proposed_slot_id IS NULL OR sl.id <> s.proposed_slot_id)
     WHERE s.id = p_session_id FOR UPDATE;

    IF v_status IS NULL THEN
        ROLLBACK; SELECT 0 AS ok, 'Session not found.' AS message, 0 AS refund, 'none' AS tier;
    ELSEIF p_by_provider = 0 AND p_student_id IS NOT NULL AND v_owner <> p_student_id THEN
        ROLLBACK; SELECT 0 AS ok, 'Session not found.' AS message, 0 AS refund, 'none' AS tier;
    ELSEIF v_status IN ('cancelled', 'completed') THEN
        ROLLBACK; SELECT 0 AS ok, 'This session can no longer be cancelled.' AS message, 0 AS refund, 'none' AS tier;
    ELSE
        SET v_actor = IF(p_by_provider = 1, 'achiever', 'student');
        SET v_hours = TIMESTAMPDIFF(MINUTE, UTC_TIMESTAMP(), v_start) / 60.0;
        CALL sp_refund_quote_apply(v_hours, IFNULL(v_amount,0), v_actor, v_snap, v_refund, v_tier);
        IF v_start IS NULL AND v_actor = 'achiever' THEN
            SET v_refund = IFNULL(v_amount,0); SET v_tier = 'full';
        END IF;

        UPDATE `achiever_sessions`
           SET status = 'cancelled',
               cancelled_at = UTC_TIMESTAMP(),
               payment_status = IF(v_pay = 'paid' AND v_refund > 0, 'refunded', v_pay)
         WHERE id = p_session_id;
        UPDATE `achiever_slots`
           SET status = 'available', session_id = NULL
         WHERE session_id = p_session_id;
        COMMIT;
        SELECT 1 AS ok, 'Cancelled.' AS message, v_refund AS refund, v_tier AS tier;
    END IF;
END$$

-- ------------------------------------------------------------
-- Mark a course module complete; returns progress + whether the course is done.
-- ------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_student_course_complete_module`$$
CREATE PROCEDURE `sp_student_course_complete_module`(
    IN p_user_id   CHAR(36),
    IN p_course_id CHAR(36),
    IN p_module_id CHAR(36)
)
BEGIN
    DECLARE v_total INT; DECLARE v_done INT;
    INSERT INTO `course_progress` (id, user_id, course_id, module_id, completed_at)
    VALUES (UUID(), p_user_id, p_course_id, p_module_id, UTC_TIMESTAMP())
    ON DUPLICATE KEY UPDATE completed_at = completed_at;

    SELECT COUNT(*) INTO v_total FROM `course_modules`
      WHERE course_id = p_course_id AND is_active = 1;
    SELECT COUNT(*) INTO v_done FROM `course_progress` cp
      JOIN `course_modules` cm ON cm.id = cp.module_id AND cm.is_active = 1
     WHERE cp.user_id = p_user_id AND cp.course_id = p_course_id;

    SELECT v_done AS completed, v_total AS total,
           (v_total > 0 AND v_done >= v_total) AS course_complete;
END$$

-- ------------------------------------------------------------
-- Undo an accidental module-completion tick — deletes only the caller's
-- own progress row (mirror of sp_student_course_complete_module).
-- ------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_student_course_uncomplete_module`$$
CREATE PROCEDURE `sp_student_course_uncomplete_module`(
    IN p_user_id   CHAR(36),
    IN p_course_id CHAR(36),
    IN p_module_id CHAR(36)
)
BEGIN
    DECLARE v_total INT; DECLARE v_done INT;
    DELETE FROM `course_progress`
     WHERE user_id = p_user_id AND course_id = p_course_id AND module_id = p_module_id;

    SELECT COUNT(*) INTO v_total FROM `course_modules`
      WHERE course_id = p_course_id AND is_active = 1;
    SELECT COUNT(*) INTO v_done FROM `course_progress` cp
      JOIN `course_modules` cm ON cm.id = cp.module_id AND cm.is_active = 1
     WHERE cp.user_id = p_user_id AND cp.course_id = p_course_id;

    SELECT v_done AS completed, v_total AS total;
END$$

-- ------------------------------------------------------------
-- Cancel a cohort booking — computes refund per policy, releases the seat.
-- Returns the refund amount/tier + payment_id; the APP then issues the
-- gateway refund. (Defaults: 100% if >=24h before; 50% if >=2h; else 0.)
-- ------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_student_cohort_booking_cancel`$$
CREATE PROCEDURE `sp_student_cohort_booking_cancel`(
    IN p_enrollment_id CHAR(36),
    IN p_user_id        CHAR(36),
    IN p_by_provider    TINYINT
)
BEGIN
    DECLARE v_amount DECIMAL(10,2); DECLARE v_pay VARCHAR(20); DECLARE v_owner CHAR(36);
    DECLARE v_cohort_id CHAR(36); DECLARE v_cohort_status VARCHAR(20); DECLARE v_start DATETIME;
    DECLARE v_payment_id VARCHAR(100); DECLARE v_old_status VARCHAR(20);
    DECLARE v_hours DECIMAL(10,2);
    DECLARE v_refund DECIMAL(10,2) DEFAULT 0; DECLARE v_tier VARCHAR(10) DEFAULT 'none';
    DECLARE v_snap JSON;
    DECLARE v_actor VARCHAR(20);
    DECLARE v_order CHAR(36);
    DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

    START TRANSACTION;
    SELECT e.amount_paid, e.payment_status, e.user_id, e.cohort_id, e.payment_id,
           e.refund_snapshot, e.payment_order_id,
           c.status, c.session_date
      INTO v_amount, v_pay, v_owner, v_cohort_id, v_payment_id,
           v_snap, v_order,
           v_cohort_status, v_start
      FROM `cohort_enrollments` e
      LEFT JOIN `cohorts` c ON c.id = e.cohort_id
     WHERE e.id = p_enrollment_id FOR UPDATE;

    SET v_old_status = v_pay;

    IF v_pay IS NULL THEN
        ROLLBACK; SELECT 0 AS ok, 'Booking not found.' AS message, 0 AS refund, 'none' AS tier, NULL AS old_status, NULL AS payment_id, NULL AS order_id;
    ELSEIF p_by_provider = 0 AND p_user_id IS NOT NULL AND v_owner <> p_user_id THEN
        ROLLBACK; SELECT 0 AS ok, 'Booking not found.' AS message, 0 AS refund, 'none' AS tier, NULL AS old_status, NULL AS payment_id, NULL AS order_id;
    ELSEIF v_cohort_status = 'completed' THEN
        ROLLBACK; SELECT 0 AS ok, 'Cannot cancel a completed cohort.' AS message, 0 AS refund, 'none' AS tier, NULL AS old_status, NULL AS payment_id, NULL AS order_id;
    ELSEIF v_pay NOT IN ('paid', 'free', 'pending') THEN
        ROLLBACK; SELECT 0 AS ok, 'Booking already cancelled or refunded.' AS message, 0 AS refund, 'none' AS tier, NULL AS old_status, NULL AS payment_id, NULL AS order_id;
    ELSE
        SET v_actor = IF(p_by_provider = 1, 'achiever', 'student');
        IF v_pay = 'paid' THEN
            SET v_hours = TIMESTAMPDIFF(MINUTE, UTC_TIMESTAMP(), v_start) / 60.0;
            CALL sp_refund_quote_apply(v_hours, IFNULL(v_amount,0), v_actor, v_snap, v_refund, v_tier);
            UPDATE `cohort_enrollments`
               SET `payment_status` = IF(v_refund > 0, 'refunded', 'paid'),
                   `cancelled_at` = UTC_TIMESTAMP()
             WHERE `id` = p_enrollment_id;
        ELSE
            UPDATE `cohort_enrollments`
               SET `payment_status` = 'cancelled', `cancelled_at` = UTC_TIMESTAMP()
             WHERE `id` = p_enrollment_id;
        END IF;

        IF v_cohort_id IS NOT NULL THEN
            UPDATE `cohorts` SET `filled_seats` = GREATEST(0, IFNULL(filled_seats,1) - 1) WHERE `id` = v_cohort_id;
        END IF;

        COMMIT;
        SELECT 1 AS ok, 'Cancelled.' AS message, v_refund AS refund, v_tier AS tier,
               v_old_status AS old_status, v_payment_id AS payment_id, v_order AS order_id;
    END IF;
END$$

-- ------------------------------------------------------------
-- Free achiever-course enroll — mirrors sp_student_cohort_enroll_free.
-- ------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_student_course_enroll_free`$$
CREATE PROCEDURE `sp_student_course_enroll_free`(
    IN p_user_id   CHAR(36),
    IN p_course_id CHAR(36)
)
BEGIN
    DECLARE v_price INT; DECLARE v_status VARCHAR(20); DECLARE v_is_active TINYINT;
    DECLARE v_deleted DATETIME; DECLARE v_exists VARCHAR(20) DEFAULT NULL;
    DECLARE v_eid CHAR(36);
    DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

    START TRANSACTION;
    SELECT price, status, is_active, deleted_at
      INTO v_price, v_status, v_is_active, v_deleted
      FROM `achiever_courses` WHERE id = p_course_id FOR UPDATE;

    IF v_price IS NULL OR v_deleted IS NOT NULL OR v_is_active = 0 THEN
        ROLLBACK; SELECT 0 AS ok, 'Course not found.' AS message, NULL AS enrollment_id;
    ELSEIF v_status <> 'published' THEN
        ROLLBACK; SELECT 0 AS ok, 'Course not found.' AS message, NULL AS enrollment_id;
    ELSEIF v_price <> 0 THEN
        ROLLBACK; SELECT 0 AS ok, 'This is a paid course — use the paid flow.' AS message, NULL AS enrollment_id;
    ELSE
        SELECT payment_status INTO v_exists FROM `course_enrollments`
          WHERE user_id = p_user_id AND course_id = p_course_id LIMIT 1;
        IF v_exists IN ('paid','free') THEN
            ROLLBACK; SELECT 0 AS ok, 'Already enrolled.' AS message, NULL AS enrollment_id;
        ELSE
            SET v_eid = UUID();
            INSERT INTO `course_enrollments` (id, user_id, course_id, payment_status, amount_paid, platform_fee, achiever_earning, enrolled_at)
            VALUES (v_eid, p_user_id, p_course_id, 'free', 0, 0, 0, UTC_TIMESTAMP())
            ON DUPLICATE KEY UPDATE payment_status = 'free', amount_paid = 0, platform_fee = 0,
                achiever_earning = 0;
            -- LAST_INSERT_ID(id) only works for INT ids — ours are UUIDs, so
            -- re-read the real row id (fresh insert or pre-existing pending row).
            SELECT id INTO v_eid FROM `course_enrollments`
              WHERE user_id = p_user_id AND course_id = p_course_id LIMIT 1;
            UPDATE `achiever_courses` SET enrolled_count = IFNULL(enrolled_count,0) + 1 WHERE id = p_course_id;
            COMMIT;
            SELECT 1 AS ok, 'Enrolled successfully.' AS message, v_eid AS enrollment_id;
        END IF;
    END IF;
END$$

-- ------------------------------------------------------------
-- Skovo Pro cohort enroll — the member's subscription covers the seat, so
-- enrol free regardless of price. Marked coupon_code='SKOVO_PRO' so Pro-
-- covered seats are queryable for achiever revenue-share reconciliation.
-- The route must verify the caller is an active Pro member first.
-- ------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_student_cohort_enroll_pro`$$
CREATE PROCEDURE `sp_student_cohort_enroll_pro`(
    IN p_user_id   CHAR(36),
    IN p_cohort_id CHAR(36)
)
BEGIN
    DECLARE v_status VARCHAR(20); DECLARE v_total INT; DECLARE v_filled INT; DECLARE v_deleted DATETIME;
    DECLARE v_exists VARCHAR(20) DEFAULT NULL; DECLARE v_eid CHAR(36);
    DECLARE v_taken INT DEFAULT 0;
    DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

    START TRANSACTION;
    SELECT status, total_seats, filled_seats, deleted_at
      INTO v_status, v_total, v_filled, v_deleted
      FROM `cohorts` WHERE id = p_cohort_id FOR UPDATE;

    IF v_status IS NULL OR v_deleted IS NOT NULL THEN
        ROLLBACK; SELECT 0 AS ok, 'Cohort not found.' AS message, NULL AS enrollment_id;
    ELSEIF v_status <> 'upcoming' AND NOT EXISTS (SELECT 1 FROM `cohorts` lj WHERE lj.id = p_cohort_id AND lj.status = 'live' AND lj.late_join_minutes > 0 AND UTC_TIMESTAMP() <= lj.session_date + INTERVAL lj.late_join_minutes MINUTE) THEN  -- late joining
        ROLLBACK; SELECT 0 AS ok, 'Enrollment is closed for this cohort.' AS message, NULL AS enrollment_id;
    ELSE
        SELECT payment_status INTO v_exists FROM `cohort_enrollments`
          WHERE user_id = p_user_id AND cohort_id = p_cohort_id LIMIT 1;
        IF v_exists IN ('paid','free') THEN
            ROLLBACK; SELECT 0 AS ok, 'You are already enrolled in this cohort.' AS message, NULL AS enrollment_id;
        ELSE
            SELECT COUNT(*) INTO v_taken
              FROM `cohort_enrollments`
             WHERE cohort_id = p_cohort_id
               AND (
                    payment_status IN ('paid', 'free')
                 OR (payment_status = 'pending'
                     AND expires_at IS NOT NULL
                     AND expires_at > UTC_TIMESTAMP()
                     AND user_id <> p_user_id)
                   );
        IF v_total IS NOT NULL AND v_total > 0 AND IFNULL(v_taken, 0) >= v_total THEN
            ROLLBACK; SELECT 0 AS ok, 'No seats available.' AS message, NULL AS enrollment_id;
        ELSE
            SET v_eid = UUID();
            INSERT INTO `cohort_enrollments`
                (id, user_id, cohort_id, payment_status, amount_paid, coupon_code, enrolled_at)
            VALUES (v_eid, p_user_id, p_cohort_id, 'free', 0, 'SKOVO_PRO', UTC_TIMESTAMP())
            ON DUPLICATE KEY UPDATE payment_status = 'free', amount_paid = 0, coupon_code = 'SKOVO_PRO';
            SELECT id INTO v_eid FROM `cohort_enrollments`
              WHERE user_id = p_user_id AND cohort_id = p_cohort_id LIMIT 1;
            UPDATE `cohorts` SET filled_seats = filled_seats + 1 WHERE id = p_cohort_id;
            COMMIT;
            SELECT 1 AS ok, 'Enrolled with Skovo Pro.' AS message, v_eid AS enrollment_id;
        END IF;
        END IF;
    END IF;
END$$

-- ------------------------------------------------------------
-- Skovo Pro course enroll — subscription covers the course. Marked SKOVO_PRO.
-- ------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_student_course_enroll_pro`$$
CREATE PROCEDURE `sp_student_course_enroll_pro`(
    IN p_user_id   CHAR(36),
    IN p_course_id CHAR(36)
)
BEGIN
    DECLARE v_status VARCHAR(20); DECLARE v_is_active TINYINT; DECLARE v_deleted DATETIME;
    DECLARE v_exists VARCHAR(20) DEFAULT NULL; DECLARE v_eid CHAR(36);
    DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

    START TRANSACTION;
    SELECT status, is_active, deleted_at
      INTO v_status, v_is_active, v_deleted
      FROM `achiever_courses` WHERE id = p_course_id FOR UPDATE;

    IF v_status IS NULL OR v_deleted IS NOT NULL OR v_is_active = 0 THEN
        ROLLBACK; SELECT 0 AS ok, 'Course not found.' AS message, NULL AS enrollment_id;
    ELSEIF v_status <> 'published' THEN
        ROLLBACK; SELECT 0 AS ok, 'Course not found.' AS message, NULL AS enrollment_id;
    ELSE
        SELECT payment_status INTO v_exists FROM `course_enrollments`
          WHERE user_id = p_user_id AND course_id = p_course_id LIMIT 1;
        IF v_exists IN ('paid','free') THEN
            ROLLBACK; SELECT 0 AS ok, 'Already enrolled.' AS message, NULL AS enrollment_id;
        ELSE
            SET v_eid = UUID();
            INSERT INTO `course_enrollments`
                (id, user_id, course_id, payment_status, amount_paid, platform_fee, achiever_earning, coupon_code, enrolled_at)
            VALUES (v_eid, p_user_id, p_course_id, 'free', 0, 0, 0, 'SKOVO_PRO', UTC_TIMESTAMP())
            ON DUPLICATE KEY UPDATE payment_status = 'free', amount_paid = 0, platform_fee = 0,
                achiever_earning = 0, coupon_code = 'SKOVO_PRO';
            SELECT id INTO v_eid FROM `course_enrollments`
              WHERE user_id = p_user_id AND course_id = p_course_id LIMIT 1;
            UPDATE `achiever_courses` SET enrolled_count = IFNULL(enrolled_count,0) + 1 WHERE id = p_course_id;
            COMMIT;
            SELECT 1 AS ok, 'Enrolled with Skovo Pro.' AS message, v_eid AS enrollment_id;
        END IF;
    END IF;
END$$

DELIMITER ;

-- One student, everything an admin needs to look at them.
--
-- WHY ONE PROCEDURE
--     The admin console could list students and block them, and nothing else.
--     "View details" re-rendered the four fields already on the row, so there
--     was no way to see a student's score, what they had joined, or what they
--     had paid -- and on mobile the only action was Block, with nothing to
--     look at first.
--
-- LAST LOGIN
--     `users` has no last_login_at (achievers do). It does not need one: the
--     auth `sessions` table already writes a row per sign-in, so MAX(created_at)
--     is the last login and COUNT(*) is how often they come back. A column
--     would have been a migration AND less information.

DROP PROCEDURE IF EXISTS `sp_admin_student_dossier`$$
CREATE PROCEDURE `sp_admin_student_dossier`(IN p_user_id CHAR(36))
BEGIN
    SELECT
        u.id, u.full_name, u.email, u.phone, u.avatar_url, u.status,
        u.consent_status, u.date_of_birth, u.created_at, u.updated_at,
        u.email_active, u.phone_active,
        -- Students have no last_login_at column (achievers do). The auth
        -- `sessions` table already records a row per sign-in, so the whole
        -- login history is there -- no migration, and better than one column.
        (SELECT MAX(s.created_at) FROM `sessions` s WHERE s.user_id = u.id)  AS last_login_at,
        (SELECT COUNT(*)          FROM `sessions` s WHERE s.user_id = u.id)  AS login_count,
        p.education_level, p.education_category, p.city, p.state,
        p.board, p.stream, p.degree_type, p.branch, p.year_of_study,
        p.school_name, p.college_name, p.exam_target, p.career_interests,
        r.score, r.level, r.base_points, r.decay_points,
        (SELECT COUNT(*) FROM `cohort_enrollments` ce
          WHERE ce.user_id = u.id AND ce.payment_status IN ('paid','free'))          AS cohorts_joined,
        (SELECT COUNT(*) FROM `achiever_sessions` a WHERE a.student_id = u.id) AS sessions_booked,
        (SELECT COUNT(*) FROM `achiever_sessions` a
          WHERE a.student_id = u.id AND a.status = 'completed')              AS sessions_completed,
        (SELECT COUNT(*) FROM `achiever_reviews` ar WHERE ar.user_id = u.id) AS reviews_written,
        (SELECT COUNT(*) FROM `document_vault` d WHERE d.user_id = u.id)     AS documents,
        (SELECT COUNT(*) FROM `group_memberships` g
          WHERE g.user_id = u.id AND g.status = 'active')                    AS communities,
        (SELECT COUNT(*) FROM `opportunity_shortlist` o WHERE o.user_id = u.id) AS shortlisted,
        (SELECT COUNT(*) FROM `opportunity_applications` o WHERE o.user_id = u.id) AS applied,
        (SELECT COUNT(*) FROM `referrals` rf WHERE rf.referrer_id = u.id)    AS referrals_made,
        (SELECT COUNT(*) FROM `referrals` rf
          WHERE rf.referrer_id = u.id AND rf.reward_given = 1)               AS referrals_rewarded,
        (SELECT COUNT(*) FROM `support_issues` si WHERE si.user_id = u.id)   AS support_issues,
        (SELECT s2.plan   FROM `subscriptions` s2 WHERE s2.user_id = u.id
           ORDER BY s2.created_at DESC LIMIT 1)                              AS plan,
        (SELECT s2.status FROM `subscriptions` s2 WHERE s2.user_id = u.id
           ORDER BY s2.created_at DESC LIMIT 1)                              AS plan_status,
        (SELECT s2.expires_at FROM `subscriptions` s2 WHERE s2.user_id = u.id
           ORDER BY s2.created_at DESC LIMIT 1)                              AS plan_expires_at,
        (SELECT IFNULL(SUM(i.total_amount),0) FROM `invoices` i
          WHERE i.user_id = u.id AND i.status = 'paid')                      AS amount_paid,
        (SELECT COUNT(*) FROM `invoices` i WHERE i.user_id = u.id)           AS invoices,
        r.cohorts_completed, r.tasks_completed, r.last_event_at
      FROM `users` u
      LEFT JOIN `user_profiles`    p ON p.user_id = u.id
      LEFT JOIN `readiness_scores` r ON r.user_id = u.id
     WHERE u.id = p_user_id
     LIMIT 1;
END$$
