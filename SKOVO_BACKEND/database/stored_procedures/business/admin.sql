-- ============================================================
-- SKOVO — ADMIN portal business-flow stored procedures (MySQL 8)
-- ============================================================
-- Achiever verification, coupon creation, payout approval, dashboard stats.
-- Every mutation records an audit_logs row (actor = p_admin_id).
-- ============================================================

DELIMITER $$

-- ------------------------------------------------------------
-- Feature / unfeature an achiever.
-- ------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_admin_achiever_feature`$$
CREATE PROCEDURE `sp_admin_achiever_feature`(
    IN p_achiever_id CHAR(36),
    IN p_featured    TINYINT,
    IN p_admin_id    CHAR(36)
)
BEGIN
    UPDATE `achievers` SET is_featured = IFNULL(p_featured,1), updated_by = p_admin_id
     WHERE id = p_achiever_id;
    SELECT * FROM `achievers` WHERE id = p_achiever_id;
END$$

-- ------------------------------------------------------------
-- Start a bank/UPI transfer. Occupies the request so a second Pay cannot
-- fire while Cashfree is still deciding. Paid happens only in approve,
-- after SUCCESS + UTR.
-- ------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_admin_payout_mark_processing`$$
CREATE PROCEDURE `sp_admin_payout_mark_processing`(
    IN p_request_id  CHAR(36),
    IN p_transfer_id VARCHAR(40),
    IN p_admin_id    CHAR(36)
)
BEGIN
    DECLARE v_status VARCHAR(20);
    DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;
    START TRANSACTION;
    SELECT status INTO v_status FROM `payout_requests` WHERE id = p_request_id FOR UPDATE;
    IF v_status IS NULL THEN
        ROLLBACK; SELECT 0 AS ok, 'Payout request not found.' AS message;
    ELSEIF v_status NOT IN ('pending', 'failed') THEN
        ROLLBACK; SELECT 0 AS ok, CONCAT('Request already ', v_status, '.') AS message;
    ELSE
        UPDATE `payout_requests`
           SET status = 'processing',
               transfer_id = p_transfer_id,
               failure_reason = NULL
         WHERE id = p_request_id;
        COMMIT;
        SELECT 1 AS ok, 'Transfer starting.' AS message;
    END IF;
END$$


-- ------------------------------------------------------------
-- Transfer did not land. Amount stays reserved so the achiever cannot
-- request it twice; admin Pay retries or Rejects.
-- ------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_admin_payout_mark_failed`$$
CREATE PROCEDURE `sp_admin_payout_mark_failed`(
    IN p_request_id CHAR(36),
    IN p_reason     VARCHAR(255)
)
BEGIN
    DECLARE v_status VARCHAR(20);
    DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;
    START TRANSACTION;
    SELECT status INTO v_status FROM `payout_requests` WHERE id = p_request_id FOR UPDATE;
    IF v_status IS NULL THEN
        ROLLBACK; SELECT 0 AS ok, 'Payout request not found.' AS message;
    ELSEIF v_status = 'paid' THEN
        ROLLBACK; SELECT 0 AS ok, 'Request already paid.' AS message;
    ELSE
        UPDATE `payout_requests`
           SET status = 'failed',
               failure_reason = LEFT(IFNULL(p_reason, 'transfer failed'), 255)
         WHERE id = p_request_id;
        COMMIT;
        SELECT 1 AS ok, 'Transfer failed.' AS message;
    END IF;
END$$


-- ------------------------------------------------------------
-- Confirm a payout AFTER the bank transfer succeeded. Writes the ledger
-- debit and stores the UTR. Accepts pending (legacy) or processing.
-- ------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_admin_payout_approve`$$
CREATE PROCEDURE `sp_admin_payout_approve`(
    IN p_request_id CHAR(36),
    IN p_admin_id   CHAR(36),
    IN p_utr        VARCHAR(40)
)
BEGIN
    DECLARE v_status VARCHAR(20);
    DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;
    START TRANSACTION;
    SELECT status INTO v_status FROM `payout_requests` WHERE id = p_request_id FOR UPDATE;
    IF v_status IS NULL THEN
        ROLLBACK; SELECT 0 AS ok, 'Payout request not found.' AS message;
    ELSEIF v_status = 'paid' THEN
        COMMIT;
        SELECT 1 AS ok, 'already_paid' AS message;
    ELSEIF v_status NOT IN ('pending', 'processing', 'failed') THEN
        ROLLBACK; SELECT 0 AS ok, CONCAT('Request already ', v_status, '.') AS message;
    ELSE
        UPDATE `payout_requests`
           SET status = 'paid',
               processed_at = UTC_TIMESTAMP(),
               utr = COALESCE(p_utr, utr),
               failure_reason = NULL
         WHERE id = p_request_id;
        INSERT INTO `ledger_entries`
            (id, account_type, account_id, entry_type, amount, currency,
             payout_id, note, created_at, created_by)
        SELECT UUID(), 'achiever', achiever_id, 'payout', -amount, 'INR',
               p_request_id, 'payout sent', UTC_TIMESTAMP(), p_admin_id
          FROM `payout_requests` WHERE id = p_request_id;
        IF p_admin_id IS NOT NULL THEN
            INSERT INTO `audit_logs` (id, user_id, action, resource_type, resource_id, created_by)
            VALUES (UUID(), p_admin_id, 'payout.approve', 'payout_request', p_request_id, p_admin_id);
        END IF;
        COMMIT;
        SELECT 1 AS ok, 'Payout approved.' AS message;
    END IF;
END$$


-- ------------------------------------------------------------
-- Reject a payout request that has not left the bank.
-- ------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_admin_payout_reject`$$
CREATE PROCEDURE `sp_admin_payout_reject`(
    IN p_request_id CHAR(36),
    IN p_admin_id   CHAR(36)
)
BEGIN
    DECLARE v_status VARCHAR(20);
    DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;
    START TRANSACTION;
    SELECT status INTO v_status FROM `payout_requests` WHERE id = p_request_id FOR UPDATE;
    IF v_status IS NULL THEN
        ROLLBACK; SELECT 0 AS ok, 'Payout request not found.' AS message;
    ELSEIF v_status = 'processing' THEN
        ROLLBACK; SELECT 0 AS ok, 'This payout is already being sent.' AS message;
    ELSEIF v_status NOT IN ('pending', 'failed') THEN
        ROLLBACK; SELECT 0 AS ok, CONCAT('Request already ', v_status, '.') AS message;
    ELSE
        UPDATE `payout_requests` SET status='rejected', processed_at=UTC_TIMESTAMP() WHERE id=p_request_id;
        INSERT INTO `audit_logs` (id, user_id, action, resource_type, resource_id, created_by)
        VALUES (UUID(), p_admin_id, 'payout.reject', 'payout_request', p_request_id, p_admin_id);
        COMMIT;
        SELECT 1 AS ok, 'Payout rejected.' AS message;
    END IF;
END$$

-- ------------------------------------------------------------
-- Admin dashboard stats — one summary row.
-- ------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_admin_dashboard_stats`$$
CREATE PROCEDURE `sp_admin_dashboard_stats`()
BEGIN
    SELECT
        (SELECT COUNT(*) FROM `users` WHERE deleted_at IS NULL)                     AS total_users,
        (SELECT COUNT(*) FROM `achievers` WHERE is_active = 1)                      AS total_achievers,
        (SELECT COUNT(*) FROM `achievers` WHERE is_verified = 0)                    AS achievers_pending_verify,
        (SELECT COUNT(*) FROM `cohorts` WHERE deleted_at IS NULL)                   AS total_cohorts,
        (SELECT COUNT(*) FROM `cohort_enrollments` WHERE payment_status IN ('paid','free')) AS total_enrollments,
        (SELECT COUNT(*) FROM `opportunities` WHERE status='active' AND deleted_at IS NULL) AS active_opportunities,
        (SELECT COUNT(*) FROM `opportunities` WHERE deleted_at IS NULL)             AS total_opportunities,
        (SELECT COUNT(*) FROM `colleges` WHERE deleted_at IS NULL)                  AS total_colleges,
        (SELECT COUNT(*) FROM `coaching_centres` WHERE deleted_at IS NULL)          AS total_coaching_centres,
        (SELECT COUNT(*) FROM `groups` WHERE deleted_at IS NULL)                    AS total_groups,
        (SELECT IFNULL(SUM(total_amount),0) FROM `invoices` WHERE status='paid')    AS gross_revenue,
        (SELECT IFNULL(SUM(platform_fee),0) FROM `cohort_enrollments` WHERE payment_status='paid')
          + (SELECT IFNULL(SUM(platform_fee),0) FROM `course_enrollments` WHERE payment_status='paid')
          + (SELECT IFNULL(SUM(platform_fee),0) FROM `achiever_sessions` WHERE payment_status='paid')
                                                                                    AS platform_earnings,
        (SELECT COUNT(*) FROM `payout_requests` WHERE status='pending')             AS pending_payouts;
END$$

-- ------------------------------------------------------------
-- Admin dashboard: most recently registered active users.
-- ------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_admin_recent_users`$$
CREATE PROCEDURE `sp_admin_recent_users`(IN p_limit INT)
BEGIN
    IF p_limit IS NULL OR p_limit <= 0 THEN SET p_limit = 5; END IF;
    SELECT `id`, `full_name`, `email`, `phone`, `created_at`
      FROM `users`
     WHERE `deleted_at` IS NULL
     ORDER BY `created_at` DESC
     LIMIT p_limit;
END$$


-- ---------------------------------------------------------------------------
-- Recent signups for the admin dashboard, one page, inside the dashboard's
-- date filter. p_from..p_to are IST calendar days; created_at is UTC, so each
-- IST day starts at 18:30 UTC the evening before. NULL on either end = today.
-- `total_rows` (COUNT(*) OVER()) gives the pager its total in the same trip.
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_admin_recent_signups`$$
CREATE PROCEDURE `sp_admin_recent_signups`(
    IN p_from   DATE,
    IN p_to     DATE,
    IN p_limit  INT,
    IN p_offset INT
)
BEGIN
    DECLARE v_today  DATE;
    DECLARE v_from   DATETIME;
    DECLARE v_to     DATETIME;
    DECLARE v_limit  INT;
    DECLARE v_offset INT;

    SET v_today  = DATE(DATE_ADD(UTC_TIMESTAMP(), INTERVAL 330 MINUTE));
    SET v_from   = DATE_SUB(IFNULL(p_from, v_today), INTERVAL 330 MINUTE);
    SET v_to     = DATE_SUB(DATE_ADD(IFNULL(p_to, v_today), INTERVAL 1 DAY), INTERVAL 330 MINUTE);
    -- Clamped: a page is between 1 and 100 rows whatever the caller asks for.
    SET v_limit  = LEAST(GREATEST(IFNULL(p_limit, 10), 1), 100);
    SET v_offset = GREATEST(IFNULL(p_offset, 0), 0);

    SELECT `id`, `full_name`, `email`, `phone`, `created_at`,
           COUNT(*) OVER() AS `total_rows`
      FROM `users`
     WHERE `deleted_at` IS NULL
       AND `created_at` >= v_from AND `created_at` < v_to
     ORDER BY `created_at` DESC
     LIMIT v_limit OFFSET v_offset;
END$$

DELIMITER ;
