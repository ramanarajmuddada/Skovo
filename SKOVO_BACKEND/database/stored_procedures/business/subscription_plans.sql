-- ============================================================================
-- SKOVO — subscription plan management
--
-- The admin screen could edit the three seeded plans but never add a fourth:
-- only _list and _update existed. The table was always shaped for more (a
-- plan_key, a sort_order), so this adds the missing half.
-- ============================================================================

DELIMITER $$

-- ---------------------------------------------------------------------------
-- Create a plan.
--
-- plan_key is the stable identifier `subscriptions.plan` points at, so it is
-- lowercased and must be unique — two plans answering to the same key would
-- make an existing subscriber's row ambiguous.
--
-- New plans start inactive. A plan appears on the student app the moment it is
-- active, and creating one is not the same decision as launching it.
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_subscription_plan_create`$$
CREATE PROCEDURE `sp_subscription_plan_create`(
    IN p_key           VARCHAR(30),
    IN p_label         VARCHAR(120),
    IN p_months        INT,
    IN p_price         INT,
    -- A launch offer is usually the reason the plan is being created at all,
    -- so it is settable here rather than only on the card afterwards. All five
    -- are optional; passing NULL for every one creates a plain plan.
    IN p_offer_price   INT,
    IN p_offer_percent INT,
    IN p_offer_label   VARCHAR(120),
    IN p_offer_starts  DATETIME,
    IN p_offer_ends    DATETIME
)
BEGIN
    DECLARE v_key VARCHAR(30);
    DECLARE v_next INT;

    SET v_key = LOWER(TRIM(p_key));

    IF v_key = '' OR v_key IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'PLAN_KEY_REQUIRED';
    END IF;
    IF p_months IS NULL OR p_months < 1 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'MONTHS_INVALID';
    END IF;
    IF p_price IS NULL OR p_price < 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'PRICE_INVALID';
    END IF;
    IF EXISTS (SELECT 1 FROM `subscription_plans` WHERE plan_key = v_key) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'PLAN_KEY_EXISTS';
    END IF;

    -- Offer validation. The student app reads offer_price first and falls back
    -- to offer_percent, so a plan carrying both silently ignores the percent.
    -- Refusing the pair here is kinder than letting an admin set a discount
    -- that never applies.
    IF p_offer_price IS NOT NULL AND p_offer_percent IS NOT NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'OFFER_BOTH_SET';
    END IF;
    IF p_offer_percent IS NOT NULL AND (p_offer_percent < 1 OR p_offer_percent > 100) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'OFFER_PERCENT_INVALID';
    END IF;
    IF p_offer_price IS NOT NULL AND p_offer_price < 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'OFFER_PRICE_INVALID';
    END IF;
    -- An "offer" at or above the base price is not an offer, and would render
    -- as a strikethrough showing the student a discount to a higher number.
    IF p_offer_price IS NOT NULL AND p_offer_price >= p_price THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'OFFER_PRICE_NOT_LOWER';
    END IF;
    IF p_offer_starts IS NOT NULL AND p_offer_ends IS NOT NULL
       AND p_offer_ends <= p_offer_starts THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'OFFER_WINDOW_INVALID';
    END IF;

    SELECT COALESCE(MAX(sort_order), 0) + 1 INTO v_next FROM `subscription_plans`;

    -- is_active = 0: the plan is created hidden so the price and any offer can
    -- be checked before students can buy it.
    INSERT INTO `subscription_plans`
        (id, plan_key, label, price, months,
         offer_price, offer_percent, offer_label, offer_starts_at, offer_ends_at,
         is_active, sort_order, created_at, updated_at)
    VALUES
        (UUID(), v_key, TRIM(p_label), p_price, p_months,
         p_offer_price, p_offer_percent, NULLIF(TRIM(COALESCE(p_offer_label, '')), ''),
         p_offer_starts, p_offer_ends,
         0, v_next, UTC_TIMESTAMP(), UTC_TIMESTAMP());

    SELECT plan_key, label, price, months,
           offer_price, offer_percent, offer_label, offer_starts_at, offer_ends_at,
           is_active, sort_order
      FROM `subscription_plans` WHERE plan_key = v_key;
END$$

-- ---------------------------------------------------------------------------
-- Delete a plan, but only one nobody ever bought.
--
-- `subscriptions.plan` stores the key, so removing a plan somebody is on would
-- leave their row pointing at nothing — and the record of what they paid for
-- is the thing you need when they ask. A plan in use can be deactivated
-- instead, which hides it from the student app and leaves history intact.
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_subscription_plan_delete`$$
CREATE PROCEDURE `sp_subscription_plan_delete`(
    IN p_key VARCHAR(30)
)
BEGIN
    DECLARE v_used INT DEFAULT 0;

    SELECT COUNT(*) INTO v_used FROM `subscriptions` WHERE plan = p_key;
    IF v_used > 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'PLAN_IN_USE';
    END IF;

    DELETE FROM `subscription_plans` WHERE plan_key = p_key;
    SELECT ROW_COUNT() AS deleted;
END$$

-- ---------------------------------------------------------------------------
-- The label was not editable before — only price and offer fields were — so a
-- typo in a plan name was permanent. `months` stays fixed on purpose: it is
-- what an existing subscriber bought, and changing it rewrites their term.
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_subscription_plan_rename`$$
CREATE PROCEDURE `sp_subscription_plan_rename`(
    IN p_key   VARCHAR(30),
    IN p_label VARCHAR(120)
)
BEGIN
    IF TRIM(COALESCE(p_label, '')) = '' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'LABEL_REQUIRED';
    END IF;
    UPDATE `subscription_plans`
       SET label = TRIM(p_label), updated_at = UTC_TIMESTAMP()
     WHERE plan_key = p_key;
    SELECT ROW_COUNT() AS updated;
END$$

DELIMITER ;
