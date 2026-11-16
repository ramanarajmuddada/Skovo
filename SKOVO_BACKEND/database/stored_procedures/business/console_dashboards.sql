-- ============================================================================
-- SKOVO — console dashboards
--
-- Two procedures answering two different questions, deliberately not sharing
-- numbers:
--
--   sp_admin_dashboard  "what needs me today"    — queues, links into work
--   sp_super_dashboard  "is this business working" — money, growth, liability
--
-- If both returned the same figures one of the consoles would be redundant,
-- which is exactly the flaw in the super-admin screens that merely mirror the
-- admin ones.
--
-- Each is a single call. A dashboard assembled from nine endpoints renders
-- nine times and shows a different moment in each tile.
-- ============================================================================

DELIMITER $$

-- ---------------------------------------------------------------------------
-- Admin: the work waiting, today's activity, and what is going wrong.
--
-- Counts only — never lists. A queue of 400 payouts must not make the
-- dashboard the slowest screen in the console; the counts link to the real
-- screens, which paginate.
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_admin_dashboard`$$
CREATE PROCEDURE `sp_admin_dashboard`(IN p_from DATE, IN p_to DATE)
BEGIN
    -- The activity block covers p_from..p_to as *IST* calendar days (the
    -- dashboard's date filter). Timestamps are stored in UTC, so each IST day
    -- starts at 18:30 UTC the evening before. NULL on either end means today.
    -- Failed payments and the no-show rate follow the range too. Queues,
    -- stuck orders, at-risk achievers and totals are states ("right now"), so
    -- a date range has nothing to say about them and they ignore it.
    DECLARE v_today DATE;
    DECLARE v_from  DATETIME;
    DECLARE v_to    DATETIME;

    SET v_today = DATE(DATE_ADD(UTC_TIMESTAMP(), INTERVAL 330 MINUTE));
    SET v_from  = DATE_SUB(IFNULL(p_from, v_today), INTERVAL 330 MINUTE);
    SET v_to    = DATE_SUB(DATE_ADD(IFNULL(p_to, v_today), INTERVAL 1 DAY), INTERVAL 330 MINUTE);

    SELECT
        -- ── Needs you now ────────────────────────────────────────────────
        (SELECT COUNT(DISTINCT d.achiever_id)
           FROM `achiever_documents` d
           JOIN `achievers` a ON a.id = d.achiever_id
          WHERE d.status = 'pending' AND a.state = 'pending')      AS docs_to_review,

        (SELECT COUNT(*) FROM `achievers`
          WHERE state = 'probation'
            AND demo_submitted_at IS NOT NULL)                     AS probations_waiting,

        (SELECT COUNT(*) FROM `payout_requests`
          WHERE status = 'pending')                                AS payouts_pending,

        (SELECT IFNULL(SUM(amount), 0) FROM `payout_requests`
          WHERE status = 'pending')                                AS payouts_amount,

        -- Money captured that could not be delivered. The reconciler retries,
        -- but a refund failing repeatedly needs a person.
        (SELECT COUNT(*) FROM `payment_orders`
          WHERE failure_reason LIKE '%REFUND%'
             OR failure_reason LIKE '%SLOT_TAKEN%')                AS refunds_failed,

        -- ── Activity in the selected range ───────────────────────────────
        (SELECT COUNT(*) FROM `achiever_sessions`
          WHERE created_at >= v_from AND created_at < v_to)                     AS sessions_today,

        (SELECT COUNT(*) FROM `achiever_sessions`
          WHERE created_at >= v_from AND created_at < v_to
            AND status = 'completed')                              AS sessions_done_today,

        (SELECT COUNT(*) FROM `achiever_sessions`
          WHERE created_at >= v_from AND created_at < v_to
            AND IFNULL(no_show, 0) = 1)                            AS no_shows_today,

        (SELECT COUNT(*) FROM `users`
          WHERE created_at >= v_from AND created_at < v_to
            AND deleted_at IS NULL)                                AS students_today,

        (SELECT COUNT(*) FROM `achievers`
          WHERE created_at >= v_from AND created_at < v_to)                     AS applications_today,

        (SELECT IFNULL(SUM(gross), 0) FROM `payment_orders`
          WHERE status IN ('paid','settled')
            AND paid_at >= v_from AND paid_at < v_to)                        AS revenue_today,

        -- ── Health: the things that quietly go wrong ─────────────────────
        (SELECT COUNT(*) FROM `achievers`
          WHERE state = 'active' AND standing = 'at_risk')          AS achievers_at_risk,

        (SELECT COUNT(*) FROM `payment_orders`
          WHERE status = 'failed'
            AND created_at >= v_from AND created_at < v_to)          AS failed_payments,

        -- Orders past their hold that the reconciler has not resolved. Should
        -- be zero; anything else means the job is not running.
        (SELECT COUNT(*) FROM `payment_orders`
          WHERE status IN ('created','pending')
            AND expires_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 MINUTE)) AS stuck_orders,

        (SELECT ROUND(AVG(IFNULL(no_show, 0)) * 100, 1)
           FROM `achiever_sessions`
          WHERE status = 'completed'
            AND created_at >= v_from AND created_at < v_to)          AS no_show_pct,

        -- ── Platform totals, for context ─────────────────────────────────
        (SELECT COUNT(*) FROM `achievers` WHERE state = 'active')   AS achievers_active,
        (SELECT COUNT(*) FROM `achievers` WHERE state = 'probation') AS achievers_probation,
        (SELECT COUNT(*) FROM `users` WHERE deleted_at IS NULL)     AS students_total;
END$$


-- ---------------------------------------------------------------------------
-- Super-admin: money, growth, and what the platform owes.
--
-- `outstanding_liability` is the number worth putting in front of a founder:
-- money sitting in the platform's bank that belongs to achievers. Revenue that
-- ignores it flatters the business.
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_super_dashboard`$$
CREATE PROCEDURE `sp_super_dashboard`()
BEGIN
    DECLARE v_month_start DATETIME;
    DECLARE v_prev_start  DATETIME;

    SET v_month_start = DATE_FORMAT(UTC_DATE(), '%Y-%m-01');
    SET v_prev_start  = DATE_SUB(v_month_start, INTERVAL 1 MONTH);

    SELECT
        -- ── Revenue ──────────────────────────────────────────────────────
        (SELECT IFNULL(SUM(gross), 0) FROM `payment_orders`
          WHERE status IN ('paid','settled') AND paid_at >= v_month_start) AS revenue_month,

        (SELECT IFNULL(SUM(gross), 0) FROM `payment_orders`
          WHERE status IN ('paid','settled')
            AND paid_at >= v_prev_start AND paid_at < v_month_start)       AS revenue_prev_month,

        (SELECT IFNULL(SUM(platform_fee), 0) FROM `payment_orders`
          WHERE status IN ('paid','settled') AND paid_at >= v_month_start) AS platform_cut_month,

        (SELECT IFNULL(SUM(gross), 0) FROM `payment_orders`
          WHERE status IN ('paid','settled'))                              AS revenue_all_time,

        -- ── What we owe ──────────────────────────────────────────────────
        -- Straight from the ledger: earnings minus refunds minus payouts.
        -- No stored balance column, so this cannot drift from reality.
        (SELECT IFNULL(SUM(amount), 0) FROM `ledger_entries`
          WHERE account_type = 'achiever')                                 AS outstanding_liability,

        (SELECT IFNULL(SUM(amount), 0) FROM `payout_requests`
          WHERE status = 'paid' AND processed_at >= v_month_start)         AS paid_out_month,

        (SELECT IFNULL(SUM(amount), 0) FROM `payout_requests`
          WHERE status = 'pending')                                        AS payouts_pending_amount,

        -- ── Growth ───────────────────────────────────────────────────────
        (SELECT COUNT(*) FROM `users` WHERE deleted_at IS NULL)            AS students_total,

        (SELECT COUNT(*) FROM `users`
          WHERE deleted_at IS NULL AND created_at >= v_month_start)        AS students_month,

        (SELECT COUNT(*) FROM `users`
          WHERE deleted_at IS NULL
            AND created_at >= v_prev_start AND created_at < v_month_start) AS students_prev_month,

        -- A paying student is one who has actually completed a payment; the
        -- conversion rate is the number that decides whether this is a
        -- business or a directory.
        (SELECT COUNT(DISTINCT student_id) FROM `payment_orders`
          WHERE status IN ('paid','settled'))                              AS students_paying,

        (SELECT COUNT(*) FROM `achievers` WHERE state = 'active')          AS achievers_active,
        (SELECT COUNT(*) FROM `achievers` WHERE state = 'probation')       AS achievers_probation,
        (SELECT COUNT(*) FROM `achievers` WHERE state = 'pending')         AS achievers_pending,
        (SELECT COUNT(*) FROM `achievers` WHERE state = 'suspended')       AS achievers_suspended,

        (SELECT COUNT(*) FROM `achiever_sessions`
          WHERE created_at >= v_month_start AND is_demo = 0)               AS sessions_month,

        (SELECT COUNT(*) FROM `achiever_sessions`
          WHERE created_at >= v_prev_start AND created_at < v_month_start
            AND is_demo = 0)                                               AS sessions_prev_month,

        -- ── Unit economics ───────────────────────────────────────────────
        (SELECT IFNULL(AVG(gross), 0) FROM `payment_orders`
          WHERE status IN ('paid','settled'))                              AS avg_order_value,

        -- A student paying twice is worth more than two students paying once,
        -- and it is the cheapest growth there is.
        (SELECT ROUND(
                  (COUNT(*) - COUNT(DISTINCT student_id)) / NULLIF(COUNT(*), 0) * 100, 1)
           FROM `payment_orders` WHERE status IN ('paid','settled'))       AS repeat_rate_pct,

        (SELECT ROUND(
                  SUM(status = 'refunded') / NULLIF(COUNT(*), 0) * 100, 1)
           FROM `payment_orders`
          WHERE status IN ('paid','settled','refunded'))                   AS refund_rate_pct,

        -- ── Governance ───────────────────────────────────────────────────
        (SELECT COUNT(*) FROM `admins` WHERE state = 'active')             AS admins_active,
        (SELECT COUNT(*) FROM `admins` WHERE state = 'pending')            AS admins_pending,
        (SELECT COUNT(*) FROM `admins` WHERE state = 'suspended')          AS admins_suspended,

        (SELECT rate FROM `commission_rules`
          WHERE scope = 'global' AND kind IS NULL AND is_active = 1
          LIMIT 1)                                                         AS commission_rate;
END$$


-- ---------------------------------------------------------------------------
-- One audit stream for the super-admin, stitched from the tables that record
-- who did what. A single audit_events table would be better and is worth doing
-- later; until then this keeps the screen honest rather than showing nothing.
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_super_audit_feed`$$
CREATE PROCEDURE `sp_super_audit_feed`(
    IN p_limit INT
)
BEGIN
    IF p_limit IS NULL OR p_limit <= 0 OR p_limit > 500 THEN
        SET p_limit = 100;
    END IF;

    SELECT * FROM (
        SELECT 'achiever' AS area,
               CONCAT(e.from_state, ' -> ', e.to_state) AS action,
               a.full_name  AS target,
               e.reason,
               e.actor_role,
               e.created_at
          FROM `achiever_state_events` e
          LEFT JOIN `achievers` a ON a.id = e.achiever_id

        UNION ALL

        SELECT 'admin',
               CONCAT(e.from_state, ' -> ', e.to_state),
               ad.full_name,
               e.reason,
               e.actor_role,
               e.created_at
          FROM `admin_state_events` e
          LEFT JOIN `admins` ad ON ad.id = e.admin_id

        UNION ALL

        SELECT 'payout',
               CONCAT('payout ', p.status),
               ach.full_name,
               p.note,
               'admin',
               IFNULL(p.processed_at, p.created_at)
          FROM `payout_requests` p
          LEFT JOIN `achievers` ach ON ach.id = p.achiever_id

        UNION ALL

        SELECT 'commission',
               CONCAT('rate set to ', ROUND(c.rate * 100), '%'),
               CONCAT(c.scope, IFNULL(CONCAT(':', c.scope_id), '')),
               c.note,
               'admin',
               c.created_at
          FROM `commission_rules` c
    ) feed
    ORDER BY created_at DESC
    LIMIT p_limit;
END$$

DELIMITER ;
