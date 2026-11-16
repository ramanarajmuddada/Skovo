-- Turn on the Skovo Pro plan a confirmed payment paid for.
--
-- The subscribe route opens a 'pending' subscriptions row next to the order,
-- and nothing moved it to 'active' once the money arrived. Called from the
-- Cashfree webhook and from reconcile, after the order is marked paid.
--
-- Free Pro days from a referral carry over: the referral row is closed and
-- whatever time it had left is added on top of the paid months.
--
-- Returns result: 'activated' (this call turned it on), 'already' (a retry,
-- or the other confirmation path got there first) or 'skip'.

DELIMITER $$

DROP PROCEDURE IF EXISTS `sp_subscription_activate_for_order`$$
CREATE PROCEDURE `sp_subscription_activate_for_order`(IN p_order_id CHAR(36))
BEGIN
    DECLARE v_student CHAR(36);
    DECLARE v_order_no VARCHAR(100);
    DECLARE v_status VARCHAR(20);
    DECLARE v_kind VARCHAR(20);
    DECLARE v_sub CHAR(36);
    DECLARE v_sub_status VARCHAR(20);
    DECLARE v_months INT;
    DECLARE v_carry BIGINT DEFAULT 0;

    SELECT student_id, order_no, status, kind
      INTO v_student, v_order_no, v_status, v_kind
      FROM `payment_orders` WHERE id = p_order_id LIMIT 1;

    IF v_kind = 'subscription' AND v_status IN ('paid', 'settled') AND v_student IS NOT NULL THEN
        -- FOR UPDATE: the webhook and reconcile can confirm the same order at
        -- once. The second waits here and then sees 'active'.
        SELECT s.id, s.status, p.months INTO v_sub, v_sub_status, v_months
          FROM `subscriptions` s
          LEFT JOIN `subscription_plans` p ON p.plan_key = s.plan
         WHERE s.payment_order_id = v_order_no
         LIMIT 1
           FOR UPDATE;

        IF v_sub IS NOT NULL AND v_sub_status = 'pending' THEN
            SELECT IFNULL(SUM(GREATEST(TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), expires_at), 0)), 0)
              INTO v_carry
              FROM `subscriptions`
             WHERE user_id = v_student AND plan = 'referral' AND status = 'active'
               AND expires_at > UTC_TIMESTAMP();

            UPDATE `subscriptions`
               SET status = 'expired', expires_at = UTC_TIMESTAMP(), updated_at = UTC_TIMESTAMP()
             WHERE user_id = v_student AND plan = 'referral' AND status = 'active';

            UPDATE `subscriptions`
               SET status = 'active',
                   started_at = UTC_TIMESTAMP(),
                   expires_at = DATE_ADD(
                       DATE_ADD(UTC_TIMESTAMP(), INTERVAL IFNULL(v_months, 1) MONTH),
                       INTERVAL v_carry SECOND),
                   updated_at = UTC_TIMESTAMP()
             WHERE id = v_sub;
            SELECT v_student AS user_id, IFNULL(v_months, 0) AS months, 'activated' AS result;
        ELSE
            SELECT v_student AS user_id, IFNULL(v_months, 0) AS months, 'already' AS result;
        END IF;
    ELSE
        SELECT NULL AS user_id, 0 AS months, 'skip' AS result;
    END IF;
END$$

DELIMITER ;
