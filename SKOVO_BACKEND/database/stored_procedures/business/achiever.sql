-- ============================================================
-- SKOVO — ACHIEVER portal business-flow stored procedures (MySQL 8)
-- ============================================================
-- Earnings roll-up, payout requests, weekly-availability expansion into
-- concrete bookable slots, and session status updates.
-- Actual money movement (gateway payout transfer) stays in the app.
-- ============================================================

DELIMITER $$

-- ------------------------------------------------------------
-- Earnings summary for an achiever.
-- earned    = achiever_earning on all PAID cohorts + courses + 1-on-1 sessions
-- paid_out  = sum of approved (status='paid') payout_requests
-- pending   = sum of pending + processing + failed requests (reserved)
-- available = earned - paid_out - pending
-- ------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_achiever_earnings_summary`$$
CREATE PROCEDURE `sp_achiever_earnings_summary`(
    IN p_achiever_id CHAR(36)
)
BEGIN
    -- ONE basis for every figure this returns: v_achiever_earning_lines, which
    -- owns the definition of "released" (cohort ended / student forfeit /
    -- escrow backstop / course delivered on buy). The predicate used to be
    -- written out here AND again in sp_achiever_payout_request; two copies of
    -- the rule that decides who gets paid is how a balance and its line items
    -- drift apart.
    --
    -- total_earned is released + escrow, so it reconciles with the buckets
    -- beside it. The ledger is returned as `ledger_balance` for reconciliation
    -- and is deliberately NOT a second "earned" total: it credits at pay time
    -- and reverses only the refunded proportion, so on a partial refund it
    -- legitimately differs from this scan.
    DECLARE v_cohort DECIMAL(12,2) DEFAULT 0;
    DECLARE v_cohort_escrow DECIMAL(12,2) DEFAULT 0;
    DECLARE v_course DECIMAL(12,2) DEFAULT 0;
    DECLARE v_course_gross DECIMAL(12,2) DEFAULT 0;
    DECLARE v_course_fee DECIMAL(12,2) DEFAULT 0;
    DECLARE v_session DECIMAL(12,2) DEFAULT 0;
    DECLARE v_session_escrow DECIMAL(12,2) DEFAULT 0;
    DECLARE v_paid DECIMAL(12,2) DEFAULT 0;
    DECLARE v_pending DECIMAL(12,2) DEFAULT 0;
    DECLARE v_released DECIMAL(12,2); DECLARE v_escrow DECIMAL(12,2);
    DECLARE v_ledger DECIMAL(12,2) DEFAULT 0;
    DECLARE v_clawback DECIMAL(12,2) DEFAULT 0;

    SELECT IFNULL(SUM(CASE WHEN entry_type IN ('earning', 'refund_reversal') THEN amount ELSE 0 END), 0)
      INTO v_ledger
      FROM `ledger_entries`
     WHERE account_type = 'achiever' AND account_id = p_achiever_id;

    SELECT
        IFNULL(SUM(CASE WHEN source_type = 'cohort'  AND is_released = 1 THEN amount END), 0),
        IFNULL(SUM(CASE WHEN source_type = 'cohort'  AND is_released = 0 THEN amount END), 0),
        IFNULL(SUM(CASE WHEN source_type = 'session' AND is_released = 1 THEN amount END), 0),
        IFNULL(SUM(CASE WHEN source_type = 'session' AND is_released = 0 THEN amount END), 0),
        IFNULL(SUM(CASE WHEN source_type = 'course'  THEN amount END), 0),
        IFNULL(SUM(CASE WHEN source_type = 'course'  THEN gross END), 0),
        IFNULL(SUM(CASE WHEN source_type = 'course'  THEN platform_fee END), 0)
      INTO v_cohort, v_cohort_escrow, v_session, v_session_escrow,
           v_course, v_course_gross, v_course_fee
      FROM `v_achiever_earning_lines`
     WHERE achiever_id = p_achiever_id;

    SELECT IFNULL(SUM(amount),0) INTO v_paid
      FROM `payout_requests` WHERE achiever_id = p_achiever_id AND status = 'paid';
    SELECT IFNULL(SUM(amount),0) INTO v_pending
      FROM `payout_requests`
     WHERE achiever_id = p_achiever_id
       AND status IN ('pending', 'processing', 'failed');

    SET v_released = v_cohort + v_course + v_session;
    SET v_escrow   = v_cohort_escrow + v_session_escrow;

    -- A refund that lands after the money was paid out drives this negative.
    -- Show the shortfall as its own figure rather than a negative balance: the
    -- clamp is what makes it a debt carried against the next payout instead of
    -- a number nobody can act on.
    SET v_clawback = GREATEST(0, ROUND(v_paid + v_pending - v_released, 2));

    SELECT ROUND(v_released + v_escrow, 2) AS total_earned,
           v_cohort AS from_cohorts, v_course AS from_courses, v_session AS from_sessions,
           v_course_gross AS course_gross, v_course_fee AS course_platform_fee,
           ROUND(v_escrow, 2) AS in_escrow,
           v_paid AS total_paid_out, v_pending AS pending_payouts,
           ROUND(v_ledger, 2) AS ledger_balance,
           v_clawback AS clawback_due,
           GREATEST(0, ROUND(v_released - v_paid - v_pending, 2)) AS available_balance;
END$$

-- ------------------------------------------------------------
-- Request a payout. Checks the requested amount against available balance,
-- snapshots the achiever's bank/UPI details, inserts a pending request.
-- ------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_achiever_payout_request`$$
CREATE PROCEDURE `sp_achiever_payout_request`(
    IN p_achiever_id CHAR(36),
    IN p_amount      DECIMAL(10,2),
    IN p_method      VARCHAR(20),   -- bank | upi
    IN p_note        TEXT
)
BEGIN
    DECLARE v_earned DECIMAL(12,2) DEFAULT 0;
    DECLARE v_paid DECIMAL(12,2) DEFAULT 0;
    DECLARE v_pending DECIMAL(12,2) DEFAULT 0;
    DECLARE v_avail DECIMAL(12,2);
    DECLARE v_name VARCHAR(150); DECLARE v_acct VARCHAR(50);
    DECLARE v_ifsc VARCHAR(20); DECLARE v_upi VARCHAR(100);
    DECLARE v_rid CHAR(36);
    DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

    START TRANSACTION;

    SELECT payout_account_name, payout_account_number, payout_ifsc, payout_upi
      INTO v_name, v_acct, v_ifsc, v_upi FROM `achievers` WHERE id = p_achiever_id FOR UPDATE;

    -- Same view sp_achiever_earnings_summary reads, and the same view the line
    -- items below are frozen from — so the amount on the request and the rows
    -- explaining it can never disagree.
    SELECT IFNULL(SUM(amount), 0) INTO v_earned
      FROM `v_achiever_earning_lines`
     WHERE achiever_id = p_achiever_id AND is_released = 1;

    SELECT IFNULL(SUM(amount),0) INTO v_paid FROM `payout_requests`
      WHERE achiever_id=p_achiever_id AND status='paid';
    SELECT IFNULL(SUM(amount),0) INTO v_pending FROM `payout_requests`
      WHERE achiever_id=p_achiever_id AND status IN ('pending', 'processing', 'failed');

    -- Clamped, matching the summary. A refund after a payout leaves nothing
    -- withdrawable rather than a negative ceiling; the shortfall is carried
    -- because it keeps suppressing payouts until fresh earnings cover it.
    SET v_avail = GREATEST(0, ROUND(v_earned - v_paid - v_pending, 2));

    IF (v_name IS NULL OR v_name = '' OR v_acct IS NULL OR v_acct = '' OR v_ifsc IS NULL OR v_ifsc = '')
       AND (v_upi IS NULL OR v_upi = '') THEN
        ROLLBACK; SELECT 0 AS ok, 'Please save complete bank details or a UPI ID before requesting a payout.' AS message, NULL AS request_id, v_avail AS available_balance;
    ELSEIF p_amount IS NULL OR p_amount <= 0 THEN
        ROLLBACK; SELECT 0 AS ok, 'Enter a valid amount.' AS message, NULL AS request_id, v_avail AS available_balance;
    ELSEIF p_amount > v_avail THEN
        ROLLBACK; SELECT 0 AS ok, 'Amount exceeds available balance.' AS message, NULL AS request_id, v_avail AS available_balance;
    ELSE
        SET v_rid = UUID();
        INSERT INTO `payout_requests`
            (id, achiever_id, amount, status, method, account_name, account_number, ifsc, upi, note)
        VALUES
            (v_rid, p_achiever_id, p_amount, 'pending', p_method, v_name, v_acct, v_ifsc, v_upi, p_note);

        -- Freeze what the balance was made of at this moment. Not an
        -- allocation: an achiever may request less than the full balance, and
        -- these rows say what was releasable when they asked, so a paid-out
        -- amount can be checked against real classes months later.
        INSERT INTO `payout_request_lines`
            (id, request_id, source_type, source_id, title, amount, occurred_at)
        SELECT UUID(), v_rid, source_type, source_id, LEFT(title, 255), amount, occurred_at
          FROM `v_achiever_earning_lines`
         WHERE achiever_id = p_achiever_id AND is_released = 1 AND amount <> 0;

        COMMIT;
        SELECT 1 AS ok, 'Payout requested.' AS message, v_rid AS request_id, ROUND(v_avail - p_amount,2) AS available_balance;
    END IF;
END$$

-- ------------------------------------------------------------
-- Expand an achiever's weekly availability into concrete bookable slots for
-- the next p_weeks weeks. Idempotent — never duplicates an existing slot.
-- One slot per availability block (start_time..end_time on that weekday).
-- day_of_week: 0=Mon..6=Sun (matches the model).
-- ------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_achiever_availability_expand_slots`$$
CREATE PROCEDURE `sp_achiever_availability_expand_slots`(
    IN p_mentor_id CHAR(36),
    IN p_weeks     INT
)
BEGIN
    DECLARE v_done INT DEFAULT 0;
    DECLARE v_dow SMALLINT; DECLARE v_start TIME; DECLARE v_end TIME;
    DECLARE v_i INT; DECLARE v_date DATE; DECLARE v_created INT DEFAULT 0;
    DECLARE v_today DATE;
    DECLARE v_start_utc DATETIME; DECLARE v_end_utc DATETIME;
    DECLARE cur CURSOR FOR
        SELECT day_of_week, start_time, end_time FROM `achiever_availability`
         WHERE mentor_id = p_mentor_id AND is_active = 1;
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_done = 1;

    IF p_weeks IS NULL OR p_weeks <= 0 THEN SET p_weeks = 4; END IF;

    -- Weekly windows are IST weekdays. Walk the IST calendar, then store UTC instants.
    SET v_today = DATE(DATE_ADD(UTC_TIMESTAMP(), INTERVAL 330 MINUTE));

    OPEN cur;
    read_loop: LOOP
        FETCH cur INTO v_dow, v_start, v_end;
        IF v_done = 1 THEN LEAVE read_loop; END IF;
        SET v_i = 0;
        WHILE v_i < p_weeks * 7 DO
            SET v_date = DATE_ADD(v_today, INTERVAL v_i DAY);
            IF WEEKDAY(v_date) = v_dow THEN
                IF NOT EXISTS (SELECT 1 FROM `achiever_slots`
                                WHERE mentor_id = p_mentor_id AND slot_date = v_date
                                  AND start_time = v_start) THEN
                    SET v_start_utc = DATE_SUB(TIMESTAMP(v_date, v_start), INTERVAL 330 MINUTE);
                    SET v_end_utc   = DATE_SUB(TIMESTAMP(v_date, v_end),   INTERVAL 330 MINUTE);
                    INSERT INTO `achiever_slots`
                        (id, mentor_id, slot_date, start_time, end_time, status,
                         start_utc, end_utc, times_are_utc)
                    VALUES (UUID(), p_mentor_id, v_date, v_start, v_end, 'available',
                            v_start_utc, v_end_utc, 1);
                    SET v_created = v_created + 1;
                END IF;
            END IF;
            SET v_i = v_i + 1;
        END WHILE;
    END LOOP;
    CLOSE cur;

    SELECT v_created AS slots_created;
END$$

-- ------------------------------------------------------------
-- Update a session's status / meeting link / notes / no-show (achiever action).
-- ------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_achiever_session_set_status`$$
CREATE PROCEDURE `sp_achiever_session_set_status`(
    IN p_session_id  CHAR(36),
    IN p_mentor_id   CHAR(36),
    IN p_status      VARCHAR(20),   -- confirmed | completed | cancelled
    IN p_meeting_link VARCHAR(500),
    IN p_mentor_notes TEXT,
    IN p_no_show     TINYINT
)
BEGIN
    UPDATE `achiever_sessions`
       SET status       = IFNULL(p_status, status),
           meeting_link = IFNULL(p_meeting_link, meeting_link),
           mentor_notes = IFNULL(p_mentor_notes, mentor_notes),
           no_show      = IFNULL(p_no_show, no_show)
     WHERE id = p_session_id AND mentor_id = p_mentor_id;
    SELECT * FROM `achiever_sessions` WHERE id = p_session_id;
END$$

-- ------------------------------------------------------------
-- The line items frozen onto one payout request. Scoped by achiever inside the
-- query rather than filtered by the caller, so one achiever cannot read
-- another's payout by guessing a request id.
-- ------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_achiever_payout_lines`$$
CREATE PROCEDURE `sp_achiever_payout_lines`(
    IN p_request_id  CHAR(36),
    IN p_achiever_id CHAR(36)
)
BEGIN
    SELECT l.id, l.source_type, l.source_id, l.title, l.amount, l.occurred_at
      FROM `payout_request_lines` l
      JOIN `payout_requests` r ON r.id = l.request_id
     WHERE l.request_id = p_request_id
       AND r.achiever_id = p_achiever_id
     ORDER BY l.occurred_at DESC, l.title ASC;
END$$

DELIMITER ;
