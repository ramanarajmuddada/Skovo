-- Cancellation rules, set by admin (Wallet & refunds > Cancellation rules).
--
-- refund_rules keeps every version: saving closes the active rows and adds a
-- new version, so old bookings (which carry a refund_snapshot taken at pay)
-- are never changed. rule_set 'floor' = cohort classes (the name the payment
-- procedures already read); 'session' = 1-on-1 sessions, which fall back to
-- 'floor' until admin saves their own. Only the student rows are editable:
-- when an achiever or admin cancels, the student always gets 100% back.
DELIMITER $$

DROP PROCEDURE IF EXISTS `sp_refund_rules_get`$$
CREATE PROCEDURE `sp_refund_rules_get`(IN p_set VARCHAR(40))
BEGIN
    SELECT rule_set, version, min_hours, refund_pct, created_at
      FROM `refund_rules`
     WHERE is_active = 1 AND actor = 'student' AND rule_set = p_set
     ORDER BY min_hours DESC;
END$$

DROP PROCEDURE IF EXISTS `sp_refund_rules_save`$$
CREATE PROCEDURE `sp_refund_rules_save`(IN p_set VARCHAR(40), IN p_rules JSON)
BEGIN
    DECLARE v_ver INT;
    SELECT IFNULL(MAX(version), 0) + 1 INTO v_ver FROM `refund_rules` WHERE rule_set = p_set;

    UPDATE `refund_rules` SET is_active = 0, closed_at = UTC_TIMESTAMP()
     WHERE rule_set = p_set AND is_active = 1;

    INSERT INTO `refund_rules` (id, rule_set, version, actor, min_hours, refund_pct, is_active)
    SELECT UUID(), p_set, v_ver, 'student', t.h, t.p, 1
      FROM JSON_TABLE(p_rules, '$[*]' COLUMNS (
               h DECIMAL(10,2) PATH '$.min_hours',
               p DECIMAL(5,2)  PATH '$.pct')) AS t;

    INSERT INTO `refund_rules` (id, rule_set, version, actor, min_hours, refund_pct, is_active)
    VALUES (UUID(), p_set, v_ver, 'achiever', 0, 100, 1),
           (UUID(), p_set, v_ver, 'admin', 0, 100, 1);

    SELECT v_ver AS version;
END$$

DELIMITER ;
