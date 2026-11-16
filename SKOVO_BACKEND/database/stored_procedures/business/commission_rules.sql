-- ============================================================================
-- SKOVO — commission, per achiever
--
-- The rate is never a constant in code. It resolves from commission_rules,
-- most specific first: a rule naming this achiever beats the global rule, and
-- within a scope a rule naming this `kind` beats one that applies to all.
--
-- The `tier` scope is gone with the tier system. It sat between achiever and
-- global and matched on trust_level, which is no longer maintained — so a tier
-- rule would have quietly applied to everyone at level 0, which is now every
-- achiever on the platform.
-- ============================================================================

DELIMITER $$

DROP PROCEDURE IF EXISTS `sp_commission_rate_resolve`$$
CREATE PROCEDURE `sp_commission_rate_resolve`(
    IN p_achiever_id CHAR(36),
    IN p_kind        VARCHAR(20)
)
BEGIN
    DECLARE v_rate DECIMAL(5,4) DEFAULT NULL;

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

    -- A NULL rate would silently price the sale at zero commission, so this
    -- fails loudly instead. The global rule is seeded by migration and must
    -- never be deleted.
    IF v_rate IS NULL THEN
        SIGNAL SQLSTATE '45000'
          SET MESSAGE_TEXT = 'No commission rule resolved - global rule missing';
    END IF;

    SELECT v_rate AS rate;
END$$


-- ---------------------------------------------------------------------------
-- What one achiever is actually charged, and where that number came from.
--
-- The admin needs both: the effective rate, and whether it is this achiever's
-- own rate or the platform default they are inheriting. "30%" alone does not
-- say whether changing the global rule would move it.
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_commission_for_achiever`$$
CREATE PROCEDURE `sp_commission_for_achiever`(
    IN p_achiever_id CHAR(36)
)
BEGIN
    -- The achiever's own rule is looked up into variables first, rather than
    -- being the FROM of the main SELECT. Driving the query off the override is
    -- what the first version did, and it meant an achiever with no negotiated
    -- rate -- the normal case -- produced zero rows, so the global_rate column
    -- never came back either and the admin screen rendered the platform default
    -- as 0%. The caller always needs the default, whether or not an override
    -- exists, so the final SELECT is unconditional.
    DECLARE v_id             CHAR(36)     DEFAULT NULL;
    DECLARE v_rate           DECIMAL(5,4) DEFAULT NULL;
    DECLARE v_kind           VARCHAR(20)  DEFAULT NULL;
    DECLARE v_note           TEXT         DEFAULT NULL;
    DECLARE v_effective_from DATETIME     DEFAULT NULL;
    DECLARE v_created_at     DATETIME     DEFAULT NULL;

    -- No match leaves every variable NULL, which is exactly what "this achiever
    -- is on the platform default" means to the caller.
    DECLARE CONTINUE HANDLER FOR NOT FOUND BEGIN END;

    SELECT r.id, r.rate, r.kind, r.note, r.effective_from, r.created_at
      INTO v_id, v_rate, v_kind, v_note, v_effective_from, v_created_at
      FROM `commission_rules` r
     WHERE r.is_active = 1
       AND r.scope = 'achiever'
       AND r.scope_id = p_achiever_id
       AND r.effective_from <= UTC_TIMESTAMP()
       AND (r.effective_to IS NULL OR r.effective_to > UTC_TIMESTAMP())
     ORDER BY r.effective_from DESC
     LIMIT 1;

    SELECT
        (SELECT rate FROM `commission_rules`
          WHERE is_active = 1 AND scope = 'global' AND kind IS NULL
            AND effective_from <= UTC_TIMESTAMP()
            AND (effective_to IS NULL OR effective_to > UTC_TIMESTAMP())
          ORDER BY effective_from DESC LIMIT 1)  AS global_rate,
        v_id             AS id,
        v_rate           AS rate,
        v_kind           AS kind,
        v_note           AS note,
        v_effective_from AS effective_from,
        v_created_at     AS created_at;
END$$


-- ---------------------------------------------------------------------------
-- Set an achiever's own rate.
--
-- Rules are not edited in place. The current one is closed off with an
-- effective_to and a new row opens — so an order priced last month can still
-- be explained by the rule that was live when it was placed. Overwriting the
-- rate would make historical orders unexplainable.
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_commission_set_for_achiever`$$
CREATE PROCEDURE `sp_commission_set_for_achiever`(
    IN p_achiever_id CHAR(36),
    IN p_rate        DECIMAL(5,4),
    IN p_note        TEXT,
    IN p_actor_id    CHAR(36)
)
BEGIN
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    IF p_rate IS NULL OR p_rate < 0 OR p_rate > 1 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'RATE_OUT_OF_RANGE';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM `achievers` WHERE id = p_achiever_id) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ACHIEVER_NOT_FOUND';
    END IF;

    START TRANSACTION;

    UPDATE `commission_rules`
       SET effective_to = UTC_TIMESTAMP()
     WHERE is_active = 1
       AND scope = 'achiever'
       AND scope_id = p_achiever_id
       AND (effective_to IS NULL OR effective_to > UTC_TIMESTAMP());

    INSERT INTO `commission_rules`
        (id, scope, scope_id, kind, rate, effective_from, effective_to,
         is_active, note, created_at, created_by)
    VALUES
        (UUID(), 'achiever', p_achiever_id, NULL, p_rate, UTC_TIMESTAMP(), NULL,
         1, p_note, UTC_TIMESTAMP(), p_actor_id);

    COMMIT;

    SELECT p_achiever_id AS achiever_id, p_rate AS rate;
END$$


-- ---------------------------------------------------------------------------
-- Drop an achiever's own rate so they fall back to the platform default.
-- The row is closed off rather than deleted, for the same reason as above.
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_commission_clear_for_achiever`$$
CREATE PROCEDURE `sp_commission_clear_for_achiever`(
    IN p_achiever_id CHAR(36)
)
BEGIN
    UPDATE `commission_rules`
       SET effective_to = UTC_TIMESTAMP()
     WHERE is_active = 1
       AND scope = 'achiever'
       AND scope_id = p_achiever_id
       AND (effective_to IS NULL OR effective_to > UTC_TIMESTAMP());
    SELECT ROW_COUNT() AS cleared;
END$$

DELIMITER ;
