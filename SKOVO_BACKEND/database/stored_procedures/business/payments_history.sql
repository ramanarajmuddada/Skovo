-- ============================================================================
-- SKOVO — a student's own payment history
--
-- One procedure, filtered by student_id in SQL. The existing student-facing
-- money screens (Billing /invoices) pull 50,000 rows and filter in Python;
-- that is fine on an empty dev database and quietly becomes the slowest
-- request on the platform once real orders exist. This never leaves SQL.
--
-- Everything here is scoped to the caller's own student_id, so the route can
-- pass the JWT identity straight through — there is no code path that returns
-- another student's orders.
-- ============================================================================

DELIMITER $$

-- ---------------------------------------------------------------------------
-- Every order this student has placed, newest first.
--
-- `label` answers "what was this for" without the caller needing four more
-- lookups. A session shows the achiever's name, a cohort or course its title;
-- when the referenced row has since been deleted the kind is used as the
-- fallback, so a paid order never renders as a blank line.
--
-- `refund_state` is derived rather than stored: a refund writes reversing rows
-- into ledger_entries and flips the order to 'refunded'. Summing the reversals
-- is what makes a partial refund legible — the order row alone cannot say how
-- much came back.
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_payment_history_student`$$
CREATE PROCEDURE `sp_payment_history_student`(
    IN p_student_id CHAR(36),
    IN p_limit      INT,
    IN p_offset     INT
)
BEGIN
    -- A caller that forgets a limit should not be able to ask for everything.
    IF p_limit IS NULL OR p_limit <= 0 OR p_limit > 200 THEN
        SET p_limit = 50;
    END IF;
    IF p_offset IS NULL OR p_offset < 0 THEN
        SET p_offset = 0;
    END IF;

    SELECT
        o.id,
        o.order_no,
        o.kind,
        o.status,
        o.currency,
        -- `gross` is misleadingly named: sp_payment_order_open is called with
        -- (rate - discount), so gross already has the discount applied and IS
        -- the amount charged to the card. `discount` is what came off the list
        -- price, kept for the receipt line, not to be subtracted again.
        o.gross           AS amount_paid,
        o.discount,
        (o.gross + o.discount) AS list_price,
        o.coupon_code,
        o.provider,
        o.provider_payment_id,
        o.failure_reason,
        o.paid_at,
        o.created_at,
        o.ref_id,
        o.achiever_id,

        CASE o.kind
            WHEN 'session'      THEN CONCAT('1-on-1 session with ', COALESCE(a.full_name, 'an achiever'))
            WHEN 'cohort'       THEN COALESCE(ch.title, 'Cohort')
            WHEN 'course'       THEN COALESCE(cc.display_name, 'Course')
            WHEN 'subscription' THEN 'SKOVO Pro subscription'
            ELSE o.kind
        END AS label,

        a.full_name AS achiever_name,

        -- Reversals are stored negative, so this comes back positive.
        COALESCE((
            SELECT -SUM(le.amount)
              FROM `ledger_entries` le
             WHERE le.order_id = o.id
               AND le.entry_type = 'refund_reversal'
        ), 0) AS refunded_amount

    FROM `payment_orders` o
    LEFT JOIN `achievers`        a  ON a.id  = o.achiever_id
    LEFT JOIN `cohorts`          ch ON ch.id = o.ref_id AND o.kind = 'cohort'
    LEFT JOIN `course_catalogue` cc ON cc.id = o.ref_id AND o.kind = 'course'
    WHERE o.student_id = p_student_id
      -- 'created' orders are checkout attempts the student abandoned before
      -- the gateway was ever opened. Showing them makes the history read as a
      -- list of failures rather than a list of purchases.
      AND o.status <> 'created'
    ORDER BY o.created_at DESC
    LIMIT p_limit OFFSET p_offset;
END$$

-- ---------------------------------------------------------------------------
-- Totals for the header strip, computed over the whole history rather than
-- the current page — a "total spent" that changes when you paginate is worse
-- than no total at all.
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_payment_history_summary`$$
CREATE PROCEDURE `sp_payment_history_summary`(
    IN p_student_id CHAR(36)
)
BEGIN
    SELECT
        COUNT(*)                                                    AS orders,
        -- gross is the charged amount; see the note in sp_payment_history_student.
        COALESCE(SUM(CASE WHEN o.status = 'paid'     THEN o.gross END), 0) AS total_paid,
        COALESCE(SUM(CASE WHEN o.status = 'refunded' THEN o.gross END), 0) AS total_refunded,
        -- SUM over no rows is NULL, not 0 — a student with no orders would
        -- otherwise get `null` where the screen expects a count.
        COALESCE(SUM(o.status = 'pending'), 0)                      AS pending,
        COALESCE(SUM(o.status = 'failed'), 0)                       AS failed
    FROM `payment_orders` o
    WHERE o.student_id = p_student_id
      AND o.status <> 'created';
END$$

DELIMITER ;
