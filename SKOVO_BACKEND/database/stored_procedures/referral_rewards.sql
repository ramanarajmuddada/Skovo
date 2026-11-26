-- Refer & Earn procedures.

DELIMITER $$

DROP PROCEDURE IF EXISTS `sp_referral_rules_list`$$
CREATE PROCEDURE `sp_referral_rules_list`()
BEGIN
    SELECT * FROM `referral_reward_rules` ORDER BY `created_at` ASC;
END$$

DROP PROCEDURE IF EXISTS `sp_referral_rule_upsert`$$
CREATE PROCEDURE `sp_referral_rule_upsert`(
    IN p_id CHAR(36),
    IN p_trigger VARCHAR(20),
    IN p_ref_audience VARCHAR(20),
    IN p_fri_audience VARCHAR(20),
    IN p_cohort_count INT,
    IN p_pro_months INT,
    IN p_milestone INT,
    IN p_ref_kind VARCHAR(20), IN p_ref_points INT, IN p_ref_days INT,
    IN p_ref_ctype VARCHAR(10), IN p_ref_cvalue DECIMAL(10,2), IN p_ref_capplies VARCHAR(10),
    IN p_ref_pay DECIMAL(12,2), IN p_ref_seats INT,
    IN p_fri_kind VARCHAR(20), IN p_fri_points INT, IN p_fri_days INT,
    IN p_fri_ctype VARCHAR(10), IN p_fri_cvalue DECIMAL(10,2), IN p_fri_capplies VARCHAR(10),
    IN p_fri_pay DECIMAL(12,2), IN p_fri_seats INT,
    IN p_active TINYINT, IN p_admin CHAR(36)
)
BEGIN
    IF p_id IS NULL OR p_id = '' THEN SET p_id = UUID(); END IF;
    -- created_at is left alone on an edit: it is the start of the window this
    -- rule pays for, and moving it would drop or re-pay friends.
    INSERT INTO `referral_reward_rules` (
        id, trigger_kind, referrer_audience, friend_audience,
        cohort_count, pro_months, milestone_count,
        referrer_kind, referrer_points, referrer_pro_days,
        referrer_coupon_type, referrer_coupon_value, referrer_coupon_applies,
        referrer_pay_amount, referrer_seats,
        friend_kind, friend_points, friend_pro_days,
        friend_coupon_type, friend_coupon_value, friend_coupon_applies,
        friend_pay_amount, friend_seats,
        is_active, updated_by
    ) VALUES (
        p_id, p_trigger, IFNULL(p_ref_audience, 'student'), IFNULL(p_fri_audience, 'student'),
        p_cohort_count, p_pro_months, p_milestone,
        p_ref_kind, p_ref_points, p_ref_days, p_ref_ctype, p_ref_cvalue, p_ref_capplies,
        p_ref_pay, p_ref_seats,
        p_fri_kind, p_fri_points, p_fri_days, p_fri_ctype, p_fri_cvalue, p_fri_capplies,
        p_fri_pay, p_fri_seats,
        IFNULL(p_active, 1), p_admin
    )
    ON DUPLICATE KEY UPDATE
        trigger_kind = p_trigger,
        referrer_audience = IFNULL(p_ref_audience, 'student'),
        friend_audience = IFNULL(p_fri_audience, 'student'),
        cohort_count = p_cohort_count,
        pro_months = p_pro_months,
        milestone_count = p_milestone,
        referrer_kind = p_ref_kind,
        referrer_points = p_ref_points,
        referrer_pro_days = p_ref_days,
        referrer_coupon_type = p_ref_ctype,
        referrer_coupon_value = p_ref_cvalue,
        referrer_coupon_applies = p_ref_capplies,
        referrer_pay_amount = p_ref_pay,
        referrer_seats = p_ref_seats,
        friend_kind = p_fri_kind,
        friend_points = p_fri_points,
        friend_pro_days = p_fri_days,
        friend_coupon_type = p_fri_ctype,
        friend_coupon_value = p_fri_cvalue,
        friend_coupon_applies = p_fri_capplies,
        friend_pay_amount = p_fri_pay,
        friend_seats = p_fri_seats,
        is_active = IFNULL(p_active, 1),
        updated_by = p_admin;
    SELECT * FROM `referral_reward_rules` WHERE id = p_id;
END$$

DROP PROCEDURE IF EXISTS `sp_referral_rule_delete`$$
CREATE PROCEDURE `sp_referral_rule_delete`(IN p_id CHAR(36))
BEGIN
    DELETE FROM `referral_reward_rules` WHERE id = p_id;
    SELECT ROW_COUNT() AS removed;
END$$

-- A stable code is SKV- (student) or SKA- (achiever) plus the start of the
-- account id. Links shared before the codes grew carry 8 characters; new ones
-- carry 13. A prefix that matches two accounts pays neither. An achiever's
-- link works once they are approved (active), not while pending.
DROP PROCEDURE IF EXISTS `sp_referral_find_referrer`$$
CREATE PROCEDURE `sp_referral_find_referrer`(IN p_code VARCHAR(40))
proc: BEGIN
    DECLARE v_code VARCHAR(40);
    DECLARE v_tail VARCHAR(40);
    DECLARE v_hits INT DEFAULT 0;

    SET v_code = UPPER(TRIM(IFNULL(p_code, '')));
    SET v_tail = SUBSTRING(v_code, 5);

    IF LEFT(v_code, 4) = 'SKV-' AND CHAR_LENGTH(v_tail) >= 8 THEN
        SELECT COUNT(*) INTO v_hits
          FROM `users` u
         WHERE u.status = 'active' AND u.deleted_at IS NULL
           AND UPPER(LEFT(u.id, CHAR_LENGTH(v_tail))) = v_tail;
        IF v_hits = 1 THEN
            SELECT u.id AS referrer_id, u.email AS referrer_email,
                   'student' AS referrer_audience, 'stable' AS source
              FROM `users` u
             WHERE u.status = 'active' AND u.deleted_at IS NULL
               AND UPPER(LEFT(u.id, CHAR_LENGTH(v_tail))) = v_tail
             LIMIT 1;
            LEAVE proc;
        END IF;
    ELSEIF LEFT(v_code, 4) = 'SKA-' AND CHAR_LENGTH(v_tail) >= 8 THEN
        SELECT COUNT(*) INTO v_hits
          FROM `achievers` a
         WHERE IFNULL(a.is_active, 1) = 1 AND a.state = 'active'
           AND UPPER(LEFT(a.id, CHAR_LENGTH(v_tail))) = v_tail;
        IF v_hits = 1 THEN
            SELECT a.id AS referrer_id, a.email AS referrer_email,
                   'achiever' AS referrer_audience, 'stable' AS source
              FROM `achievers` a
             WHERE IFNULL(a.is_active, 1) = 1 AND a.state = 'active'
               AND UPPER(LEFT(a.id, CHAR_LENGTH(v_tail))) = v_tail
             LIMIT 1;
            LEAVE proc;
        END IF;
    END IF;

    -- A per-invite code from an older email.
    SELECT r.referrer_id AS referrer_id, COALESCE(u.email, a.email) AS referrer_email,
           IFNULL(r.referrer_audience, 'student') AS referrer_audience, 'invite' AS source
      FROM `referrals` r
      LEFT JOIN `users` u
             ON u.id = r.referrer_id AND u.status = 'active' AND u.deleted_at IS NULL
            AND IFNULL(r.referrer_audience, 'student') = 'student'
      LEFT JOIN `achievers` a
             ON a.id = r.referrer_id AND IFNULL(a.is_active, 1) = 1
            AND a.state = 'active'
            AND r.referrer_audience = 'achiever'
     WHERE r.referral_code = v_code
       AND (u.id IS NOT NULL OR a.id IS NOT NULL)
     LIMIT 1;
END$$

DROP PROCEDURE IF EXISTS `sp_referral_bind`$$
CREATE PROCEDURE `sp_referral_bind`(
    IN p_id CHAR(36), IN p_referrer CHAR(36), IN p_email VARCHAR(320),
    IN p_friend CHAR(36), IN p_code VARCHAR(40),
    IN p_ref_audience VARCHAR(20), IN p_fri_audience VARCHAR(20)
)
BEGIN
    DECLARE v_ref_email VARCHAR(320);
    DECLARE v_existing CHAR(36);

    IF p_ref_audience = 'achiever' THEN
        SELECT email INTO v_ref_email FROM `achievers` WHERE id = p_referrer LIMIT 1;
    ELSE
        SELECT email INTO v_ref_email FROM `users` WHERE id = p_referrer LIMIT 1;
    END IF;

    IF p_referrer = p_friend OR LOWER(IFNULL(v_ref_email, '')) = LOWER(TRIM(p_email)) THEN
        SELECT 'self' AS result;
    ELSEIF p_fri_audience = 'achiever' AND p_ref_audience <> 'achiever' THEN
        SELECT 'skipped' AS result;
    ELSE
        SELECT id INTO v_existing FROM `referrals`
         WHERE referred_user_id = p_friend AND status = 'completed' LIMIT 1;
        IF v_existing IS NOT NULL THEN
            SELECT 'already' AS result;
        ELSE
            UPDATE `referrals`
               SET referred_user_id = p_friend,
                   status = 'completed',
                   referrer_audience = p_ref_audience,
                   friend_audience = p_fri_audience,
                   completed_at = UTC_TIMESTAMP(),
                   updated_at = UTC_TIMESTAMP()
             WHERE referrer_id = p_referrer
               AND LOWER(referred_email) = LOWER(TRIM(p_email))
               AND status = 'pending'
             LIMIT 1;
            IF ROW_COUNT() = 0 THEN
                INSERT INTO `referrals`
                    (id, referrer_id, referrer_audience, friend_audience,
                     referred_email, referred_user_id, referral_code, status,
                     completed_at, created_at, updated_at)
                VALUES
                    (p_id, p_referrer, p_ref_audience, p_fri_audience,
                     LOWER(TRIM(p_email)), p_friend, NULL, 'completed',
                     UTC_TIMESTAMP(), UTC_TIMESTAMP(), UTC_TIMESTAMP());
            END IF;
            SELECT 'bound' AS result, p_referrer AS referrer_id;
        END IF;
    END IF;
END$$

DROP PROCEDURE IF EXISTS `sp_referral_attended`$$
CREATE PROCEDURE `sp_referral_attended`(IN p_user CHAR(36))
BEGIN
    SELECT COUNT(*) AS attended
      FROM `cohort_enrollments`
     WHERE user_id = p_user AND attended = 1;
END$$

-- Friends of one referrer who meet a rule's gate, first to join first.
-- p_since is the rule's created_at: a rule pays only for friends who joined
-- after it existed, so a new or re-created rule never pays past friends.
DROP PROCEDURE IF EXISTS `sp_referral_qualifying`$$
CREATE PROCEDURE `sp_referral_qualifying`(
    IN p_referrer CHAR(36), IN p_trigger VARCHAR(20),
    IN p_cohorts INT, IN p_months INT, IN p_audience VARCHAR(20),
    IN p_since DATETIME
)
BEGIN
    DECLARE v_since DATETIME;
    SET v_since = IFNULL(p_since, '1000-01-01 00:00:00');

    IF p_trigger = 'approved' THEN
        SELECT r.referred_user_id AS friend_id
          FROM `referrals` r
          JOIN `achievers` a ON a.id = r.referred_user_id
         WHERE r.referrer_id = p_referrer
           AND r.status = 'completed'
           AND r.completed_at >= v_since
           AND IFNULL(r.friend_audience, 'student') = 'achiever'
           AND a.state = 'active'
         ORDER BY r.completed_at ASC, r.id ASC;
    ELSEIF p_trigger = 'cohorts' THEN
        SELECT r.referred_user_id AS friend_id
          FROM `referrals` r
         WHERE r.referrer_id = p_referrer
           AND r.status = 'completed'
           AND r.completed_at >= v_since
           AND IFNULL(r.friend_audience, 'student') = IFNULL(p_audience, 'student')
           AND r.referred_user_id IS NOT NULL
           AND (SELECT COUNT(*) FROM `cohort_enrollments` e
                 WHERE e.user_id = r.referred_user_id AND e.attended = 1) >= IFNULL(p_cohorts, 1)
         ORDER BY r.completed_at ASC, r.id ASC;
    ELSEIF p_trigger = 'pro_purchase' THEN
        SELECT r.referred_user_id AS friend_id
          FROM `referrals` r
         WHERE r.referrer_id = p_referrer
           AND r.status = 'completed'
           AND r.completed_at >= v_since
           AND IFNULL(r.friend_audience, 'student') = IFNULL(p_audience, 'student')
           AND r.referred_user_id IS NOT NULL
           AND EXISTS (
                SELECT 1
                  FROM `subscriptions` s
                  JOIN `subscription_plans` p ON p.plan_key = s.plan
                  JOIN `payment_orders` o ON o.order_no = s.payment_order_id
                 WHERE s.user_id = r.referred_user_id
                   AND o.status IN ('paid', 'settled')
                   AND p.months = p_months
           )
         ORDER BY r.completed_at ASC, r.id ASC;
    ELSE
        SELECT r.referred_user_id AS friend_id
          FROM `referrals` r
         WHERE r.referrer_id = p_referrer
           AND r.status = 'completed'
           AND r.completed_at >= v_since
           AND IFNULL(r.friend_audience, 'student') = IFNULL(p_audience, 'student')
           AND r.referred_user_id IS NOT NULL
         ORDER BY r.completed_at ASC, r.id ASC;
    END IF;
END$$

-- p_once_key is the friend's id for a per-friend prize and 'milestone' for a
-- milestone, so a milestone is paid once however the friend list reorders.
DROP PROCEDURE IF EXISTS `sp_referral_grant_put`$$
CREATE PROCEDURE `sp_referral_grant_put`(
    IN p_id CHAR(36), IN p_rule CHAR(36), IN p_referrer CHAR(36),
    IN p_friend CHAR(36), IN p_once_key VARCHAR(40), IN p_milestone INT,
    IN p_ref_summary VARCHAR(200), IN p_fri_summary VARCHAR(200)
)
BEGIN
    DECLARE EXIT HANDLER FOR 1062
    BEGIN
        SELECT 0 AS created;
    END;
    INSERT INTO `referral_grants`
        (id, rule_id, referrer_id, friend_user_id, once_key, milestone_count,
         referrer_summary, friend_summary)
    VALUES
        (p_id, p_rule, p_referrer, p_friend, p_once_key, IFNULL(p_milestone, 0),
         p_ref_summary, p_fri_summary);
    SELECT 1 AS created;
END$$

-- What was actually given (a coupon code, or a seat prize that had nothing to
-- raise) is only known after the grant row exists.
DROP PROCEDURE IF EXISTS `sp_referral_grant_summary`$$
CREATE PROCEDURE `sp_referral_grant_summary`(
    IN p_id CHAR(36), IN p_ref_summary VARCHAR(200), IN p_fri_summary VARCHAR(200)
)
BEGIN
    UPDATE `referral_grants`
       SET referrer_summary = p_ref_summary,
           friend_summary = p_fri_summary
     WHERE id = p_id;
    SELECT ROW_COUNT() AS updated;
END$$

DROP PROCEDURE IF EXISTS `sp_referral_score_add`$$
CREATE PROCEDURE `sp_referral_score_add`(
    IN p_user CHAR(36), IN p_points INT, IN p_ref VARCHAR(64), IN p_meta VARCHAR(200)
)
BEGIN
    INSERT INTO `score_events` (id, user_id, event_type, points, ref_id, meta)
    SELECT UUID(), p_user, 'referral_bonus', p_points, p_ref, p_meta
      FROM DUAL
     WHERE NOT EXISTS (
        SELECT 1 FROM `score_events`
         WHERE user_id = p_user AND event_type = 'referral_bonus' AND ref_id = p_ref
     );
    SELECT ROW_COUNT() AS added;
END$$

DROP PROCEDURE IF EXISTS `sp_referral_pro_extend`$$
CREATE PROCEDURE `sp_referral_pro_extend`(IN p_user CHAR(36), IN p_days INT)
BEGIN
    DECLARE v_id CHAR(36);
    SELECT id INTO v_id FROM `subscriptions`
     WHERE user_id = p_user AND status = 'active'
       AND (expires_at IS NULL OR expires_at > UTC_TIMESTAMP())
     ORDER BY expires_at DESC
     LIMIT 1;
    IF v_id IS NOT NULL THEN
        UPDATE `subscriptions`
           SET expires_at = DATE_ADD(GREATEST(IFNULL(expires_at, UTC_TIMESTAMP()), UTC_TIMESTAMP()), INTERVAL p_days DAY),
               updated_at = UTC_TIMESTAMP()
         WHERE id = v_id AND expires_at IS NOT NULL;
    ELSE
        INSERT INTO `subscriptions` (id, user_id, plan, status, amount, started_at, expires_at)
        VALUES (UUID(), p_user, 'referral', 'active', 0, UTC_TIMESTAMP(),
                DATE_ADD(UTC_TIMESTAMP(), INTERVAL p_days DAY));
    END IF;
    SELECT 1 AS ok;
END$$

DROP PROCEDURE IF EXISTS `sp_referral_referrer_of`$$
CREATE PROCEDURE `sp_referral_referrer_of`(IN p_friend CHAR(36))
BEGIN
    SELECT referrer_id, IFNULL(referrer_audience, 'student') AS referrer_audience,
           IFNULL(friend_audience, 'student') AS friend_audience
      FROM `referrals`
     WHERE referred_user_id = p_friend AND status = 'completed'
     LIMIT 1;
END$$

-- Replaced by event hooks: every gate now asks again when it changes.
DROP PROCEDURE IF EXISTS `sp_referral_friend_ids`$$

DROP PROCEDURE IF EXISTS `sp_referral_grants_for`$$
CREATE PROCEDURE `sp_referral_grants_for`(IN p_user CHAR(36))
BEGIN
    SELECT * FROM `referral_grants`
     WHERE referrer_id = p_user OR friend_user_id = p_user
     ORDER BY created_at DESC;
END$$

DROP PROCEDURE IF EXISTS `sp_referrals_by_referrer`$$
CREATE PROCEDURE `sp_referrals_by_referrer`(IN p_user_id CHAR(36))
BEGIN
    SELECT r.*, COALESCE(u.`full_name`, a.`full_name`) AS referred_name
      FROM `referrals` r
      LEFT JOIN `users` u ON u.`id` = r.`referred_user_id`
      LEFT JOIN `achievers` a ON a.`id` = r.`referred_user_id`
     WHERE r.`referrer_id` = p_user_id
     ORDER BY r.`created_at` DESC;
END$$

DROP PROCEDURE IF EXISTS `sp_referrals_send`$$
CREATE PROCEDURE `sp_referrals_send`(
    IN p_id CHAR(36), IN p_referrer_id CHAR(36),
    IN p_email VARCHAR(320), IN p_referral_code VARCHAR(40),
    IN p_ref_audience VARCHAR(20), IN p_fri_audience VARCHAR(20))
BEGIN
    IF EXISTS (SELECT 1 FROM `referrals`
                WHERE `referrer_id` = p_referrer_id AND `referred_email` = p_email) THEN
        SELECT 0 AS created, NULL AS id;
    ELSE
        INSERT INTO `referrals`
            (`id`,`referrer_id`,`referrer_audience`,`friend_audience`,`referred_email`,
             `referral_code`,`status`,`created_at`,`updated_at`)
        VALUES (p_id, p_referrer_id, IFNULL(p_ref_audience, 'student'), IFNULL(p_fri_audience, 'student'),
                p_email, p_referral_code, 'pending', UTC_TIMESTAMP(), UTC_TIMESTAMP());
        SELECT 1 AS created, p_id AS id;
    END IF;
END$$

DROP PROCEDURE IF EXISTS `sp_referral_pay_add`$$
CREATE PROCEDURE `sp_referral_pay_add`(
    IN p_achiever CHAR(36), IN p_amount DECIMAL(12,2), IN p_ref VARCHAR(80)
)
BEGIN
    INSERT INTO `ledger_entries`
        (id, account_type, account_id, entry_type, amount, currency, note, created_at)
    SELECT UUID(), 'achiever', p_achiever, 'earning', p_amount, 'INR', p_ref, UTC_TIMESTAMP()
      FROM DUAL
     WHERE p_amount > 0
       AND NOT EXISTS (
            SELECT 1 FROM `ledger_entries`
             WHERE account_type = 'achiever' AND account_id = p_achiever AND note = p_ref
       );
    SELECT ROW_COUNT() AS added;
END$$

-- A NULL allocation means no seat cap (see _seat_allocation_for), so there is
-- nothing to raise. applied = 0 tells the caller to say so, not claim seats.
DROP PROCEDURE IF EXISTS `sp_referral_seats_add`$$
CREATE PROCEDURE `sp_referral_seats_add`(
    IN p_achiever CHAR(36), IN p_seats INT
)
BEGIN
    DECLARE v_applied INT DEFAULT 0;
    UPDATE `achievers`
       SET cohort_seat_allocation = cohort_seat_allocation + p_seats
     WHERE id = p_achiever
       AND cohort_seat_allocation IS NOT NULL
       AND p_seats > 0;
    SET v_applied = ROW_COUNT();
    SELECT v_applied AS applied, cohort_seat_allocation AS seats
      FROM `achievers` WHERE id = p_achiever;
END$$

-- A prize coupon: one use, and only the winner can redeem it
-- (sp_student_coupon_validate checks owner_user_id).
DROP PROCEDURE IF EXISTS `sp_referral_coupon_create`$$
CREATE PROCEDURE `sp_referral_coupon_create`(
    IN p_id CHAR(36), IN p_code VARCHAR(40), IN p_type VARCHAR(10),
    IN p_value DECIMAL(10,2), IN p_applies VARCHAR(10),
    IN p_owner_user CHAR(36), IN p_days INT
)
BEGIN
    INSERT INTO `coupons`
        (id, code, discount_type, value, max_discount, min_amount, applies_to,
         max_uses, used_count, per_user_limit, valid_from, valid_until, is_active,
         created_by, owner_user_id)
    VALUES
        (p_id, UPPER(p_code), p_type, p_value, NULL, 0, p_applies,
         1, 0, 1, UTC_TIMESTAMP(), DATE_ADD(UTC_TIMESTAMP(), INTERVAL IFNULL(p_days, 365) DAY), 1,
         NULL, p_owner_user);
    SELECT code, valid_until FROM `coupons` WHERE id = p_id;
END$$

-- Activating a paid plan moved to sp_subscription_activate_for_order
-- (stored_procedures/endpoints/subscription_activate.sql).
DROP PROCEDURE IF EXISTS `sp_referral_activate_subscription`$$
