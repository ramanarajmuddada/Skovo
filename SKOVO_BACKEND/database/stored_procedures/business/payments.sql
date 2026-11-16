-- ============================================================================
-- SKOVO — payment procedures
--
-- The aggregator model: the student pays SKOVO, SKOVO owes the achiever a
-- share, and that share is settled later out of SKOVO's own bank account. The
-- achiever is never a party to the card transaction, so nothing here splits
-- money at payment time — it only records what is owed.
--
-- Every procedure that touches a slot or an order takes a row lock first. The
-- booking path had none before this file, so two students clicking the same
-- slot simultaneously could both be told yes.
-- ============================================================================

DELIMITER $$

-- sp_commission_rate_resolve now lives in commission_rules.sql, together with
-- the per-achiever set/clear procedures that go with it. It was defined here
-- too, and two definitions of one procedure in two files means whichever
-- file was applied last silently wins — which is how the tier scope would
-- have come back after being removed.


-- ---------------------------------------------------------------------------
-- Hold a slot and open an order, in one transaction.
--
-- This is the procedure that makes double-booking impossible. SELECT ... FOR
-- UPDATE takes an exclusive row lock on the slot: a second caller blocks until
-- the first commits, then reads status = 'blocked' and is turned away.
--
-- The hold is a lease, not a booking. If payment never completes,
-- sp_payment_expire_holds puts the slot back.
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_payment_order_open`$$
CREATE PROCEDURE `sp_payment_order_open`(
    IN p_order_id    CHAR(36),
    IN p_order_no    VARCHAR(40),
    IN p_kind        VARCHAR(20),
    IN p_student_id  CHAR(36),
    IN p_achiever_id CHAR(36),
    IN p_slot_id     CHAR(36),
    IN p_ref_id      CHAR(36),
    IN p_gross       DECIMAL(10,2),
    IN p_discount    DECIMAL(10,2),
    IN p_coupon      VARCHAR(40),
    IN p_hold_minutes INT
)
BEGIN
    DECLARE v_status   VARCHAR(20);
    DECLARE v_rate     DECIMAL(5,4);
    DECLARE v_fee      DECIMAL(10,2);
    DECLARE v_earning  DECIMAL(10,2);
    DECLARE v_expires  DATETIME;
    DECLARE v_hold     INT;
    DECLARE v_currency VARCHAR(3);

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    START TRANSACTION;

    -- Lock the slot before reading its status. Reading first and locking after
    -- is the classic race: both callers see 'available'.
    IF p_slot_id IS NOT NULL THEN
        SELECT status INTO v_status
          FROM `achiever_slots`
         WHERE id = p_slot_id
           FOR UPDATE;

        IF v_status IS NULL THEN
            ROLLBACK;
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'SLOT_NOT_FOUND';
        END IF;

        IF v_status <> 'available' THEN
            ROLLBACK;
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'SLOT_UNAVAILABLE';
        END IF;
    END IF;

    -- Inlined rather than CALLed: a procedure cannot read another's result set,
    -- and the rate must be resolved inside this transaction so a rule change
    -- mid-flight cannot price the order differently from what was quoted.
    --
    -- Kept in step with sp_commission_rate_resolve deliberately. The `tier`
    -- scope is gone: it matched on trust_level, which is no longer maintained,
    -- so a tier rule would have applied to every achiever at level 0 — which
    -- is now all of them. An achiever's own rate beats the global one.
    SELECT rate INTO v_rate
      FROM `commission_rules`
     WHERE is_active = 1
       AND effective_from <= UTC_TIMESTAMP()
       AND (effective_to IS NULL OR effective_to > UTC_TIMESTAMP())
       AND (kind IS NULL OR kind = p_kind)
       AND (
             (scope = 'achiever' AND scope_id = p_achiever_id)
          OR (scope = 'global')
           )
     ORDER BY
        CASE scope WHEN 'achiever' THEN 1 ELSE 2 END,
        CASE WHEN kind IS NULL THEN 2 ELSE 1 END,
        effective_from DESC
     LIMIT 1;

    IF v_rate IS NULL THEN
        ROLLBACK;
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'NO_COMMISSION_RULE';
    END IF;

    -- Operational values come from payment_settings, never from literals here.
    -- A caller may still override the hold explicitly; what it may not do is
    -- rely on this procedure inventing one.
    SELECT CAST(setting_value AS UNSIGNED) INTO v_hold
      FROM `payment_settings` WHERE setting_key = 'hold_minutes';

    SELECT setting_value INTO v_currency
      FROM `payment_settings` WHERE setting_key = 'currency';

    IF v_currency IS NULL OR (p_hold_minutes IS NULL AND v_hold IS NULL) THEN
        ROLLBACK;
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'PAYMENT_SETTINGS_MISSING';
    END IF;

    SET v_hold = IFNULL(p_hold_minutes, v_hold);

    SET v_fee     = ROUND(p_gross * v_rate, 2);
    SET v_earning = ROUND(p_gross - v_fee, 2);
    SET v_expires = DATE_ADD(UTC_TIMESTAMP(), INTERVAL v_hold MINUTE);

    INSERT INTO `payment_orders`
        (id, order_no, kind, student_id, achiever_id, slot_id, ref_id,
         currency, gross, discount, coupon_code,
         commission_rate, platform_fee, achiever_earning,
         status, expires_at, created_at, updated_at)
    VALUES
        (p_order_id, p_order_no, p_kind, p_student_id, p_achiever_id, p_slot_id, p_ref_id,
         v_currency, p_gross, IFNULL(p_discount, 0), p_coupon,
         v_rate, v_fee, v_earning,
         'created', v_expires, UTC_TIMESTAMP(), UTC_TIMESTAMP());

    IF p_slot_id IS NOT NULL THEN
        UPDATE `achiever_slots`
           SET status = 'blocked',
               blocked_until = v_expires,
               updated_at = UTC_TIMESTAMP()
         WHERE id = p_slot_id;
    END IF;

    COMMIT;

    SELECT p_order_id AS order_id, v_rate AS commission_rate,
           v_fee AS platform_fee, v_earning AS achiever_earning,
           v_expires AS expires_at;
END$$


-- ---------------------------------------------------------------------------
-- Mark an order paid: confirm the slot, create the session, write the ledger.
--
-- Called only from the webhook handler, and safe to call repeatedly — the
-- gateway retries until it gets a 2xx, so this runs more than once for the
-- same payment as a matter of course. The order row is locked and re-checked
-- inside the transaction; a second call sees status = 'paid' and does nothing.
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_payment_order_mark_paid`$$
CREATE PROCEDURE `sp_payment_order_mark_paid`(
    IN p_order_id    CHAR(36),
    IN p_provider    VARCHAR(20),
    IN p_provider_payment_id VARCHAR(80),
    IN p_session_id  CHAR(36)
)
BEGIN
    DECLARE v_status     VARCHAR(20);
    DECLARE v_slot       CHAR(36);
    DECLARE v_slot_state VARCHAR(20);
    DECLARE v_kind       VARCHAR(20);
    DECLARE v_student    CHAR(36);
    DECLARE v_achiever   CHAR(36);
    DECLARE v_gross      DECIMAL(10,2);
    DECLARE v_fee        DECIMAL(10,2);
    DECLARE v_earning    DECIMAL(10,2);
    DECLARE v_currency   VARCHAR(3);
    DECLARE v_discount   DECIMAL(10,2);
    DECLARE v_coupon     VARCHAR(40);
    DECLARE v_note       TEXT;
    DECLARE v_session    CHAR(36);
    DECLARE v_tpl        VARCHAR(20);
    DECLARE v_snap       JSON;

    -- p_session_id is ignored. The session id is minted here so every caller
    -- (webhook, poll, reconcile) lands the same INSERT with payment_status=paid.

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    START TRANSACTION;

    SELECT status, slot_id, kind, student_id, achiever_id,
           gross, platform_fee, achiever_earning, currency, discount, coupon_code
      INTO v_status, v_slot, v_kind, v_student, v_achiever,
           v_gross, v_fee, v_earning, v_currency, v_discount, v_coupon
      FROM `payment_orders`
     WHERE id = p_order_id
       FOR UPDATE;

    IF v_status IS NULL THEN
        ROLLBACK;
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ORDER_NOT_FOUND';
    END IF;

    IF v_status = 'paid' OR v_status = 'settled' THEN
        COMMIT;
        SELECT p_order_id AS order_id, 'already_paid' AS result;
    ELSE
        IF v_slot IS NOT NULL THEN
            SELECT status INTO v_slot_state
              FROM `achiever_slots` WHERE id = v_slot FOR UPDATE;

            IF v_slot_state IS NULL THEN
                ROLLBACK;
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'SLOT_ROW_MISSING';
            END IF;

            IF v_slot_state = 'booked' THEN
                UPDATE `payment_orders`
                   SET status = 'paid',
                       provider = p_provider,
                       provider_payment_id = p_provider_payment_id,
                       paid_at = UTC_TIMESTAMP(),
                       failure_reason = 'SLOT_TAKEN_REFUND_REQUIRED',
                       updated_at = UTC_TIMESTAMP()
                 WHERE id = p_order_id;
                COMMIT;
                SELECT p_order_id AS order_id, 'slot_taken_refund_required' AS result;
            ELSE
                SET v_session = UUID();

                SELECT refund_template INTO v_tpl FROM `achievers` WHERE id = v_achiever;
                IF v_tpl = 'flexible' THEN
                    SET v_snap = JSON_ARRAY(
                        JSON_OBJECT('actor','student','min_hours',48,'pct',100),
                        JSON_OBJECT('actor','student','min_hours',2,'pct',50),
                        JSON_OBJECT('actor','student','min_hours',0,'pct',0),
                        JSON_OBJECT('actor','achiever','min_hours',0,'pct',100),
                        JSON_OBJECT('actor','admin','min_hours',0,'pct',100));
                ELSEIF v_tpl = 'always_full' THEN
                    SET v_snap = JSON_ARRAY(
                        JSON_OBJECT('actor','student','min_hours',0,'pct',100),
                        JSON_OBJECT('actor','achiever','min_hours',0,'pct',100),
                        JSON_OBJECT('actor','admin','min_hours',0,'pct',100));
                ELSE
                    SELECT JSON_ARRAYAGG(JSON_OBJECT(
                               'actor', actor, 'min_hours', min_hours, 'pct', refund_pct))
                      INTO v_snap
                      FROM `refund_rules`
                     WHERE is_active = 1
                       AND rule_set = IF(EXISTS(SELECT 1 FROM `refund_rules` r2
                                                 WHERE r2.is_active = 1 AND r2.rule_set = 'session'),
                                         'session', 'floor');
                END IF;

                -- payment_status='paid' on this INSERT. Sweep deletes pending+pending.
                INSERT INTO `achiever_sessions`
                    (id, mentor_id, student_id, status, amount, platform_fee,
                     achiever_earning, payment_status, payment_order_id, payment_id,
                     coupon_code, discount_amount, refund_snapshot)
                VALUES
                    (v_session, v_achiever, v_student, 'confirmed', v_gross, v_fee,
                     v_earning, 'paid', p_order_id, p_provider_payment_id,
                     v_coupon, IFNULL(v_discount, 0), v_snap);

                UPDATE `achiever_slots`
                   SET status = 'booked', session_id = v_session,
                       updated_at = UTC_TIMESTAMP()
                 WHERE id = v_slot;
            END IF;
        END IF;

        IF v_slot IS NULL OR IFNULL(v_slot_state, '') <> 'booked' THEN
            UPDATE `payment_orders`
               SET status = 'paid',
                   provider = p_provider,
                   provider_payment_id = p_provider_payment_id,
                   paid_at = UTC_TIMESTAMP(),
                   updated_at = UTC_TIMESTAMP()
             WHERE id = p_order_id;

            SET v_note = CONCAT('order ', p_order_id);

            IF v_achiever IS NOT NULL AND v_earning > 0 THEN
                INSERT INTO `ledger_entries`
                    (id, account_type, account_id, entry_type, amount, currency,
                     order_id, session_id, note, created_at)
                VALUES
                    (UUID(), 'achiever', v_achiever, 'earning', v_earning, v_currency,
                     p_order_id, v_session, v_note, UTC_TIMESTAMP());
            END IF;

            INSERT INTO `ledger_entries`
                (id, account_type, account_id, entry_type, amount, currency,
                 order_id, session_id, note, created_at)
            VALUES
                (UUID(), 'platform', NULL, 'platform_fee', v_fee, v_currency,
                 p_order_id, v_session, v_note, UTC_TIMESTAMP());

            IF v_session IS NOT NULL THEN
                CALL sp_invoice_issue_for_order(
                    p_order_id, 'session', v_session,
                    CONCAT('1-on-1 session'));
                CALL sp_coupon_redeem_for_order(p_order_id, 'session', v_session);
            END IF;

            COMMIT;
            SELECT p_order_id AS order_id, 'paid' AS result, v_session AS session_id;
        END IF;
    END IF;
END$$


-- ---------------------------------------------------------------------------
-- Release holds whose lease ran out. Run every minute from Celery beat.
--
-- The NOT EXISTS guard is the important part: an order can be paid a moment
-- after its expiry timestamp passes, and freeing a slot that someone has
-- actually paid for would sell it twice.
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_payment_expire_holds`$$
CREATE PROCEDURE `sp_payment_expire_holds`()
BEGIN
    DECLARE v_released     INT DEFAULT 0;
    DECLARE v_orphans      INT DEFAULT 0;
    DECLARE v_cohort_seats INT DEFAULT 0;

    UPDATE `achiever_slots` s
       JOIN `payment_orders` o
         ON o.slot_id = s.id
        AND o.status IN ('created', 'pending')
        AND o.expires_at < UTC_TIMESTAMP()
       SET s.status = 'available',
           s.updated_at = UTC_TIMESTAMP()
     WHERE s.status = 'blocked'
       AND NOT EXISTS (
             SELECT 1 FROM `payment_orders` p
              WHERE p.slot_id = s.id
                AND p.status IN ('paid', 'settled')
           );

    SET v_released = ROW_COUNT();

    -- Second pass: holds with no payment_orders row at all.
    --
    -- sp_student_session_book blocks a slot directly without opening an order,
    -- and nothing used to release it — one write, zero releases, so every
    -- abandoned paid checkout destroyed that slot permanently. Keyed off
    -- blocked_until so a slot held by a flow this procedure knows nothing about
    -- still comes back.
    UPDATE `achiever_slots` s
       SET s.status = 'available',
           s.blocked_until = NULL,
           s.session_id = NULL,
           s.updated_at = UTC_TIMESTAMP()
     WHERE s.status = 'blocked'
       AND s.blocked_until IS NOT NULL
       AND s.blocked_until < UTC_TIMESTAMP()
       AND NOT EXISTS (
             SELECT 1 FROM `payment_orders` p
              WHERE p.slot_id = s.id
                AND p.status IN ('paid', 'settled')
           )
       AND NOT EXISTS (
             SELECT 1 FROM `achiever_sessions` ses
              WHERE ses.id = s.session_id
                AND ses.payment_status IN ('paid', 'free')
           );

    SET v_orphans = ROW_COUNT();

    UPDATE `payment_orders`
       SET status = 'expired', updated_at = UTC_TIMESTAMP()
     WHERE status IN ('created', 'pending')
       AND expires_at < UTC_TIMESTAMP();

    -- Cohort checkout holds never move filled_seats (that counter is paid
    -- students only). Occupancy for the cap is paid/free + unexpired pending,
    -- so flipping pending → expired is enough to free the seat. Decrementing
    -- filled_seats here was leftover from when hold used to increment it, and
    -- it drifted the counter below the real paid count.
    UPDATE `cohort_enrollments`
       SET payment_status = 'expired', updated_at = UTC_TIMESTAMP()
     WHERE payment_status = 'pending'
       AND expires_at IS NOT NULL
       AND expires_at < UTC_TIMESTAMP();

    SET v_cohort_seats = ROW_COUNT();

    SELECT v_released      AS slots_released,
           v_orphans       AS orphan_holds_released,
           v_cohort_seats  AS cohort_seats_released;
END$$


-- ---------------------------------------------------------------------------
-- Reverse a paid order. Writes opposite-signed entries rather than editing the
-- originals, so the ledger stays append-only and the original sale remains
-- visible in history.
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_payment_order_refund`$$
CREATE PROCEDURE `sp_payment_order_refund`(
    IN p_order_id CHAR(36),
    IN p_amount   DECIMAL(10,2),
    IN p_reason   TEXT,
    IN p_actor_id CHAR(36)
)
BEGIN
    DECLARE v_status   VARCHAR(20);
    DECLARE v_slot     CHAR(36);
    DECLARE v_achiever CHAR(36);
    DECLARE v_gross    DECIMAL(10,2);
    DECLARE v_rate     DECIMAL(5,4);
    DECLARE v_fee_rev  DECIMAL(10,2);
    DECLARE v_earn_rev DECIMAL(10,2);
    DECLARE v_amt      DECIMAL(10,2);
    DECLARE v_currency VARCHAR(3);
    DECLARE v_already  DECIMAL(10,2);
    DECLARE v_remain   DECIMAL(10,2);
    DECLARE v_full     TINYINT DEFAULT 0;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    START TRANSACTION;

    SELECT status, slot_id, achiever_id, gross, commission_rate, currency,
           IFNULL(refunded_amount, 0)
      INTO v_status, v_slot, v_achiever, v_gross, v_rate, v_currency, v_already
      FROM `payment_orders`
     WHERE id = p_order_id
       FOR UPDATE;

    IF v_status IS NULL THEN
        ROLLBACK;
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ORDER_NOT_FOUND';
    END IF;

    IF v_status NOT IN ('paid', 'settled') THEN
        ROLLBACK;
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ORDER_NOT_REFUNDABLE';
    END IF;

    SET v_remain = ROUND(v_gross - v_already, 2);
    IF v_remain <= 0 THEN
        ROLLBACK;
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ORDER_NOT_REFUNDABLE';
    END IF;

    SET v_amt = LEAST(IFNULL(p_amount, v_remain), v_remain);
    SET v_full = IF(ROUND(v_already + v_amt, 2) >= v_gross, 1, 0);

    SET v_fee_rev  = ROUND(v_amt * v_rate, 2);
    SET v_earn_rev = ROUND(v_amt - v_fee_rev, 2);

    IF v_achiever IS NOT NULL AND v_earn_rev > 0 THEN
        INSERT INTO `ledger_entries`
            (id, account_type, account_id, entry_type, amount, currency,
             order_id, note, created_at, created_by)
        VALUES
            (UUID(), 'achiever', v_achiever, 'refund_reversal', -v_earn_rev, v_currency,
             p_order_id, p_reason, UTC_TIMESTAMP(), p_actor_id);
    END IF;

    INSERT INTO `ledger_entries`
        (id, account_type, account_id, entry_type, amount, currency,
         order_id, note, created_at, created_by)
    VALUES
        (UUID(), 'platform', NULL, 'refund_reversal', -v_fee_rev, v_currency,
         p_order_id, p_reason, UTC_TIMESTAMP(), p_actor_id);

    UPDATE `payment_orders`
       SET refunded_amount = ROUND(v_already + v_amt, 2),
           status = IF(v_full = 1, 'refunded', status),
           failure_reason = p_reason,
           updated_at = UTC_TIMESTAMP()
     WHERE id = p_order_id;

    IF v_full = 1 AND v_slot IS NOT NULL THEN
        UPDATE `achiever_slots`
           SET status = 'available', session_id = NULL, updated_at = UTC_TIMESTAMP()
         WHERE id = v_slot;
        CALL sp_coupon_restore_for_order(p_order_id);
        UPDATE `invoices` SET status = 'refunded', refunded_at = UTC_TIMESTAMP()
         WHERE payment_id = p_order_id AND status = 'paid';
    END IF;

    COMMIT;

    SELECT p_order_id AS order_id, v_amt AS refunded_amount, v_full AS fully_refunded;
END$$


-- ---------------------------------------------------------------------------
-- An achiever's payable balance, straight from the ledger. No stored balance
-- column anywhere — the sum is the truth.
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_achiever_balance`$$
CREATE PROCEDURE `sp_achiever_balance`(
    IN p_achiever_id CHAR(36)
)
BEGIN
    SELECT
        IFNULL(SUM(CASE WHEN entry_type = 'earning'         THEN amount END), 0) AS gross_earned,
        IFNULL(SUM(CASE WHEN entry_type = 'refund_reversal' THEN amount END), 0) AS refunded,
        IFNULL(SUM(CASE WHEN entry_type = 'payout'          THEN amount END), 0) AS paid_out,
        IFNULL(SUM(amount), 0)                                                   AS balance
      FROM `ledger_entries`
     WHERE account_type = 'achiever'
       AND account_id = p_achiever_id;
END$$

DELIMITER ;
