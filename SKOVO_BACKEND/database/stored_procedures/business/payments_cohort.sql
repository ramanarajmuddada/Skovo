-- ============================================================================
-- SKOVO — cohort seat reservation
--
-- Split from payments.sql because it is the one part of the payment flow that
-- reserves a *counted* resource rather than a single row: a cohort may cap its
-- seats, so the hold has to be taken under the cohort's own row lock.
--
-- It does NOT move cohorts.filled_seats. That counter means "students who have
-- paid", and it is incremented only in sp_payment_cohort_mark_paid — see the
-- note at the end of sp_payment_cohort_hold for why.
-- ============================================================================

DELIMITER $$

-- ---------------------------------------------------------------------------
-- Reserve a cohort seat BEFORE payment, and open the order for it.
--
-- sp_student_cohort_enroll_confirm claims the seat only *after* the money is
-- taken, so two students buying the last seat meant one of them got
-- 'No seats available.' with a completed payment and no refund path. This
-- claims the seat first, under the same row lock, and sp_payment_expire_holds
-- gives it back if payment never lands.
--
-- What the hold takes is the enrolment row (payment_status 'pending') under the
-- cohort's row lock — NOT a filled_seats increment. The comment that used to sit
-- here said the opposite; it described the behaviour before 2026-08-30 and had
-- contradicted the code 130 lines below ever since. See that note for the why.
-- ---------------------------------------------------------------------------
-- Named _offer (2026-11-03) when it gained p_offer: the dev and live stacks
-- share one database, so changing the old procedure's arguments in place would
-- have broken live checkout until the next deploy. The old
-- sp_payment_cohort_hold can be dropped once every server runs this code.
DROP PROCEDURE IF EXISTS `sp_payment_cohort_hold_offer`$$
CREATE PROCEDURE `sp_payment_cohort_hold_offer`(
    IN p_order_id     CHAR(36),
    IN p_order_no     VARCHAR(40),
    IN p_student_id   CHAR(36),
    IN p_cohort_id    CHAR(36),
    IN p_gross        DECIMAL(10,2),
    IN p_discount     DECIMAL(10,2),
    IN p_coupon       VARCHAR(40),
    IN p_hold_minutes INT,
    IN p_offer        TINYINT
)
BEGIN
    DECLARE v_price    DECIMAL(10,2);
    DECLARE v_status   VARCHAR(20);
    DECLARE v_total    INT;
    DECLARE v_filled   INT;
    DECLARE v_deleted  DATETIME;
    DECLARE v_achiever CHAR(36);
    DECLARE v_prev     VARCHAR(20) DEFAULT NULL;
    DECLARE v_rate     DECIMAL(5,4);
    DECLARE v_fee      DECIMAL(10,2);
    DECLARE v_earning  DECIMAL(10,2);
    DECLARE v_hold     INT;
    DECLARE v_currency VARCHAR(3);
    DECLARE v_expires  DATETIME;
    DECLARE v_eid      CHAR(36);
    DECLARE v_taken    INT DEFAULT 0;
    DECLARE v_off_price INT;
    DECLARE v_off_pct   INT;
    DECLARE v_off_start DATETIME;
    DECLARE v_off_end   DATETIME;
    DECLARE v_off_seats INT;
    DECLARE v_off_used  INT DEFAULT 0;
    DECLARE v_session   DATETIME;
    DECLARE v_tiers     JSON;
    DECLARE v_tier_val  INT;
    DECLARE v_tier_disc DECIMAL(10,2);
    DECLARE v_late      INT;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    START TRANSACTION;

    SELECT price, status, total_seats, filled_seats, deleted_at, achiever_id,
           offer_price, offer_percent, offer_starts_at, offer_ends_at, offer_seats,
           session_date, late_join_minutes, offer_tiers
      INTO v_price, v_status, v_total, v_filled, v_deleted, v_achiever,
           v_off_price, v_off_pct, v_off_start, v_off_end, v_off_seats,
           v_session, v_late, v_tiers
      FROM `cohorts` WHERE id = p_cohort_id FOR UPDATE;

    IF v_price IS NULL OR v_deleted IS NOT NULL THEN
        ROLLBACK; SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'COHORT_NOT_FOUND';
    END IF;

    -- Open until the start, then for the achiever's late-join minutes on
    -- leftover seats (cohorts.late_join_minutes, 0 = closes at the start).
    IF v_status NOT IN ('upcoming', 'live')
       OR (v_session IS NOT NULL AND v_session <= UTC_TIMESTAMP()
           AND DATE_ADD(v_session, INTERVAL IFNULL(v_late, 0) MINUTE) <= UTC_TIMESTAMP()) THEN
        ROLLBACK; SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'COHORT_CLOSED';
    END IF;

    SELECT payment_status INTO v_prev FROM `cohort_enrollments`
     WHERE user_id = p_student_id AND cohort_id = p_cohort_id LIMIT 1;

    IF v_prev IN ('paid', 'free') THEN
        ROLLBACK; SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ALREADY_ENROLLED';
    END IF;

    -- BookMyShow hold: a live checkout occupies a seat the same way a 1-on-1
    -- slot goes `blocked`. Paid/free rows plus unexpired pending holds count;
    -- this student's own pending does not, so a retry of the same checkout is
    -- not turned away by their own lease. filled_seats stays "who paid" and is
    -- still not touched here — expire must not decrement it either.
    SELECT COUNT(*) INTO v_taken
      FROM `cohort_enrollments`
     WHERE cohort_id = p_cohort_id
       AND (
            payment_status IN ('paid', 'free')
         OR (payment_status = 'pending'
             AND expires_at IS NOT NULL
             AND expires_at > UTC_TIMESTAMP()
             AND user_id <> p_student_id)
           );

    IF v_total IS NOT NULL AND v_total > 0 AND IFNULL(v_taken, 0) >= v_total THEN
        ROLLBACK; SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'NO_SEATS_AVAILABLE';
    END IF;

    -- Public offer (no codes in v1). The caller priced this checkout at the
    -- offer; re-check it here, under the same row lock as the seat cap, so the
    -- last "first N" place goes to exactly one student. Places: paid or
    -- refunded offer seats plus other students' live holds.
    IF IFNULL(p_offer, 0) = 1 AND v_tiers IS NOT NULL THEN
        -- Slabs: the price depends on how many offer places are already taken,
        -- so work it out here and refuse a checkout priced at a full slab.
        IF v_off_end IS NOT NULL AND v_off_end <= UTC_TIMESTAMP() THEN
            ROLLBACK; SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'OFFER_GONE';
        END IF;
        SELECT COUNT(*) INTO v_off_used
          FROM `cohort_enrollments`
         WHERE cohort_id = p_cohort_id AND offer_applied = 1
           AND (payment_status NOT IN ('pending', 'expired', 'failed')
                OR (payment_status = 'pending' AND expires_at > UTC_TIMESTAMP()
                    AND user_id <> p_student_id));
        SET v_tier_val = NULL;
        SELECT t.val INTO v_tier_val
          FROM (SELECT j.ord, j.val,
                       SUM(IFNULL(j.seats, 1000000)) OVER (ORDER BY j.ord) AS cum
                  FROM JSON_TABLE(v_tiers, '$.tiers[*]' COLUMNS (
                         ord   FOR ORDINALITY,
                         seats INT PATH '$.seats',
                         val   INT PATH '$.value')) AS j) AS t
         WHERE t.cum > v_off_used
         ORDER BY t.ord
         LIMIT 1;
        IF v_tier_val IS NULL THEN
            ROLLBACK; SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'OFFER_GONE';
        END IF;
        -- Exact, never rounded: the same figure as offer_tier_price in
        -- portal/helpers/helpers.py (Rs 5 at 50% off is a Rs 2.50 discount).
        IF JSON_UNQUOTE(JSON_EXTRACT(v_tiers, '$.type')) = 'amount' THEN
            SET v_tier_disc = v_tier_val;
        ELSE
            SET v_tier_disc = v_price * v_tier_val / 100;
        END IF;
        IF ABS(v_tier_disc - IFNULL(p_discount, 0)) > 0.01 THEN
            ROLLBACK; SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'OFFER_GONE';
        END IF;
    ELSEIF IFNULL(p_offer, 0) = 1 THEN
        IF (v_off_price IS NULL AND IFNULL(v_off_pct, 0) = 0)
           OR (v_off_start IS NOT NULL AND v_off_start > UTC_TIMESTAMP())
           OR (v_off_end IS NOT NULL AND v_off_end <= UTC_TIMESTAMP()) THEN
            ROLLBACK; SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'OFFER_GONE';
        END IF;
        IF v_off_seats IS NOT NULL THEN
            SELECT COUNT(*) INTO v_off_used
              FROM `cohort_enrollments`
             WHERE cohort_id = p_cohort_id AND offer_applied = 1
               AND (payment_status NOT IN ('pending', 'expired', 'failed')
                    OR (payment_status = 'pending' AND expires_at > UTC_TIMESTAMP()
                        AND user_id <> p_student_id));
            IF v_off_used >= v_off_seats THEN
                ROLLBACK; SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'OFFER_GONE';
            END IF;
        END IF;
    END IF;

    -- Same resolution as sp_payment_order_open, kept in step deliberately. The
    -- `tier` scope is gone with trust_level: it matched a column nothing
    -- maintains, so a tier rule would have priced every cohort on the platform.
    SELECT rate INTO v_rate
      FROM `commission_rules`
     WHERE is_active = 1
       AND effective_from <= UTC_TIMESTAMP()
       AND (effective_to IS NULL OR effective_to > UTC_TIMESTAMP())
       AND (kind IS NULL OR kind = 'cohort')
       AND (
             (scope = 'achiever' AND scope_id = v_achiever)
          OR (scope = 'global')
           )
     ORDER BY
        CASE scope WHEN 'achiever' THEN 1 ELSE 2 END,
        CASE WHEN kind IS NULL THEN 2 ELSE 1 END,
        effective_from DESC
     LIMIT 1;

    IF v_rate IS NULL THEN
        ROLLBACK; SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'NO_COMMISSION_RULE';
    END IF;

    SELECT CAST(setting_value AS UNSIGNED) INTO v_hold
      FROM `payment_settings` WHERE setting_key = 'hold_minutes';
    SELECT setting_value INTO v_currency
      FROM `payment_settings` WHERE setting_key = 'currency';

    IF v_currency IS NULL OR (p_hold_minutes IS NULL AND v_hold IS NULL) THEN
        ROLLBACK; SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'PAYMENT_SETTINGS_MISSING';
    END IF;

    SET v_hold    = IFNULL(p_hold_minutes, v_hold);
    SET v_expires = DATE_ADD(UTC_TIMESTAMP(), INTERVAL v_hold MINUTE);
    SET v_fee     = ROUND(p_gross * v_rate, 2);
    SET v_earning = ROUND(p_gross - v_fee, 2);
    SET v_eid     = UUID();

    INSERT INTO `payment_orders`
        (id, order_no, kind, student_id, achiever_id, slot_id, ref_id,
         currency, gross, discount, coupon_code,
         commission_rate, platform_fee, achiever_earning,
         status, expires_at, created_at, updated_at)
    VALUES
        (p_order_id, p_order_no, 'cohort', p_student_id, v_achiever, NULL, p_cohort_id,
         v_currency, p_gross, IFNULL(p_discount, 0), p_coupon,
         v_rate, v_fee, v_earning,
         'created', v_expires, UTC_TIMESTAMP(), UTC_TIMESTAMP());

    -- Upsert: a student who abandoned an earlier attempt already has a row, and
    -- UNIQUE(user_id, cohort_id) would reject a second insert.
    INSERT INTO `cohort_enrollments`
        (id, user_id, cohort_id, payment_status, expires_at, payment_order_id,
         amount_paid, platform_fee, achiever_earning, coupon_code, discount_amount,
         offer_applied, enrolled_at)
    VALUES
        (v_eid, p_student_id, p_cohort_id, 'pending', v_expires, p_order_id,
         p_gross, v_fee, v_earning, p_coupon, IFNULL(p_discount, 0),
         IFNULL(p_offer, 0), UTC_TIMESTAMP())
    ON DUPLICATE KEY UPDATE
        payment_status   = 'pending',
        expires_at       = v_expires,
        payment_order_id = p_order_id,
        amount_paid      = p_gross,
        platform_fee     = v_fee,
        achiever_earning = v_earning,
        coupon_code      = p_coupon,
        discount_amount  = IFNULL(p_discount, 0),
        offer_applied    = IFNULL(p_offer, 0);

    -- filled_seats is deliberately NOT touched here. Occupancy for the cap is
    -- paid/free rows plus live pending holds (counted above). The paid counter
    -- still moves only in sp_payment_cohort_mark_paid, so abandoned checkout
    -- cannot invent a student who never paid. Expire flips pending → expired
    -- and must not decrement filled_seats either.

    COMMIT;

    SELECT p_order_id AS order_id, v_rate AS commission_rate,
           v_fee AS platform_fee, v_earning AS achiever_earning,
           v_expires AS expires_at,
           -- NULL when uncapped: there is no ceiling to count down from.
           -- v_taken is others; this hold occupies one more.
           CASE WHEN v_total IS NOT NULL AND v_total > 0
                THEN GREATEST(0, v_total - IFNULL(v_taken, 0) - 1)
                ELSE NULL END AS seats_left;
END$$


-- ---------------------------------------------------------------------------
-- Confirm a cohort order once the webhook has verified payment.
--
-- Idempotent for the same reason sp_payment_order_mark_paid is: gateways retry
-- until they get a 2xx, so this runs more than once for one payment as a matter
-- of course.
--
-- Increments filled_seats. The seat is NOT counted at hold time, so this is
-- the only place a cohort's count grows: the early-return above makes the
-- gateway's retries no-ops, so one payment counts exactly one seat.
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_payment_cohort_mark_paid`$$
CREATE PROCEDURE `sp_payment_cohort_mark_paid`(
    IN p_order_id CHAR(36),
    IN p_provider VARCHAR(20),
    IN p_provider_payment_id VARCHAR(80)
)
BEGIN
    DECLARE v_status   VARCHAR(20);
    DECLARE v_cohort   CHAR(36);
    DECLARE v_student  CHAR(36);
    DECLARE v_achiever CHAR(36);
    DECLARE v_fee      DECIMAL(10,2);
    DECLARE v_earning  DECIMAL(10,2);
    DECLARE v_currency VARCHAR(3);
    DECLARE v_tpl      VARCHAR(20);
    DECLARE v_snap     JSON;
    DECLARE v_eid      CHAR(36);

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    START TRANSACTION;

    SELECT status, ref_id, student_id, achiever_id, platform_fee, achiever_earning, currency
      INTO v_status, v_cohort, v_student, v_achiever, v_fee, v_earning, v_currency
      FROM `payment_orders` WHERE id = p_order_id FOR UPDATE;

    IF v_status IS NULL THEN
        ROLLBACK; SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ORDER_NOT_FOUND';
    END IF;

    IF v_status IN ('paid', 'settled') THEN
        COMMIT;
        SELECT p_order_id AS order_id, 'already_paid' AS result;
    ELSE
        UPDATE `payment_orders`
           SET status = 'paid', provider = p_provider,
               provider_payment_id = p_provider_payment_id,
               paid_at = UTC_TIMESTAMP(), updated_at = UTC_TIMESTAMP()
         WHERE id = p_order_id;

        SELECT refund_template INTO v_tpl FROM `cohorts` WHERE id = v_cohort;
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
             WHERE is_active = 1 AND rule_set = 'floor';
        END IF;

        UPDATE `cohort_enrollments`
           SET payment_status = 'paid', expires_at = NULL,
               payment_id = p_provider_payment_id,
               refund_snapshot = v_snap,
               updated_at = UTC_TIMESTAMP()
         WHERE user_id = v_student AND cohort_id = v_cohort;

        SELECT id INTO v_eid FROM `cohort_enrollments`
         WHERE user_id = v_student AND cohort_id = v_cohort LIMIT 1;

        IF v_achiever IS NOT NULL AND v_earning > 0 THEN
            INSERT INTO `ledger_entries`
                (id, account_type, account_id, entry_type, amount, currency,
                 order_id, note, created_at)
            VALUES
                (UUID(), 'achiever', v_achiever, 'earning', v_earning, v_currency,
                 p_order_id, CONCAT('cohort order ', p_order_id), UTC_TIMESTAMP());
        END IF;

        INSERT INTO `ledger_entries`
            (id, account_type, account_id, entry_type, amount, currency,
             order_id, note, created_at)
        VALUES
            (UUID(), 'platform', NULL, 'platform_fee', v_fee, v_currency,
             p_order_id, CONCAT('cohort order ', p_order_id), UTC_TIMESTAMP());

        UPDATE `cohorts`
           SET filled_seats = IFNULL(filled_seats, 0) + 1,
               updated_at = UTC_TIMESTAMP()
         WHERE id = v_cohort;

        CALL sp_invoice_issue_for_order(
            p_order_id, 'cohort', v_cohort, 'Cohort enrollment');
        CALL sp_coupon_redeem_for_order(p_order_id, 'cohort', IFNULL(v_eid, v_cohort));

        COMMIT;
        SELECT p_order_id AS order_id, 'paid' AS result;
    END IF;
END$$

DELIMITER ;
