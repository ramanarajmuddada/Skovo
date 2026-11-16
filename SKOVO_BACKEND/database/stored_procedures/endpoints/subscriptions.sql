-- ============================================================
-- SKOVO — Skovo Pro subscription (endpoint procs)
-- One active subscription per user. Pro unlocks: free cohorts, free
-- courses, premium study materials, 1-on-1 session credits, AI + certs.
-- ============================================================

DELIMITER $$

-- Current live subscription for a user (active + not expired), else NULL row.
DROP PROCEDURE IF EXISTS `sp_subscription_get`$$
CREATE PROCEDURE `sp_subscription_get`(IN p_user_id CHAR(36))
BEGIN
    SELECT id, user_id, plan, status, amount, started_at, expires_at,
           auto_renew, created_at,
           (status = 'active' AND (expires_at IS NULL OR expires_at > UTC_TIMESTAMP())) AS is_active
      FROM `subscriptions`
     WHERE user_id = p_user_id
     ORDER BY (status = 'active' AND (expires_at IS NULL OR expires_at > UTC_TIMESTAMP())) DESC,
              expires_at DESC
     LIMIT 1;
END$$

-- Lightweight boolean check used by gating in enroll/booking flows.
DROP PROCEDURE IF EXISTS `sp_subscription_is_active`$$
CREATE PROCEDURE `sp_subscription_is_active`(IN p_user_id CHAR(36))
BEGIN
    SELECT COUNT(*) AS is_active
      FROM `subscriptions`
     WHERE user_id = p_user_id AND status = 'active'
       AND (expires_at IS NULL OR expires_at > UTC_TIMESTAMP());
END$$

-- Create a pending subscription row when the the gateway order is created.
DROP PROCEDURE IF EXISTS `sp_subscription_create_pending`$$
CREATE PROCEDURE `sp_subscription_create_pending`(
    IN p_id CHAR(36), IN p_user_id CHAR(36), IN p_plan VARCHAR(30),
    IN p_amount DECIMAL(10,2), IN p_order_id VARCHAR(100)
)
BEGIN
    INSERT INTO `subscriptions` (id, user_id, plan, status, amount, payment_order_id)
    VALUES (p_id, p_user_id, COALESCE(p_plan,'pro'), 'pending', IFNULL(p_amount,0), p_order_id);
    SELECT p_id AS id;
END$$

-- Session credits remaining for a Pro member, counted over the subscription
-- period they are currently paying for.
--
-- This used to reset on the calendar month (YEAR/MONTH of created_at), which
-- meant an annual member received a fresh batch twelve times over one payment
-- and somebody who subscribed on the 30th got a second batch two days later.
-- Counting from `started_at` ties the grant to the thing that was actually
-- bought: N per term, and renewing starts a new term and a new N.
--
-- p_allowance NULL means UNLIMITED — `remaining` comes back NULL and callers
-- must read it as "no cap" rather than "none left".
DROP PROCEDURE IF EXISTS `sp_pro_session_credits`$$
CREATE PROCEDURE `sp_pro_session_credits`(IN p_user_id CHAR(36), IN p_allowance INT)
BEGIN
    DECLARE v_used INT DEFAULT 0;
    DECLARE v_since DATETIME;

    -- The live subscription's start. No row (or no date) falls back to counting
    -- everything, which is the safe direction: it can only under-grant.
    SELECT `started_at` INTO v_since
      FROM `subscriptions`
     WHERE `user_id` = p_user_id
       AND `status` = 'active'
     ORDER BY `started_at` DESC
     LIMIT 1;

    SELECT COUNT(*) INTO v_used FROM `achiever_sessions`
     WHERE student_id = p_user_id
       AND note = 'pro_credit'
       AND (v_since IS NULL OR created_at >= v_since);

    SELECT p_allowance AS allowance,
           v_used      AS used,
           CASE WHEN p_allowance IS NULL THEN NULL
                ELSE GREATEST(0, p_allowance - v_used) END AS remaining;
END$$

DELIMITER ;
