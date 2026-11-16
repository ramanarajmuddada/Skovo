-- ============================================================
-- SKOVO — ACHIEVER DOCUMENT TYPES (master data)
-- ============================================================
-- The evidence dropdown, and the categories the submit rule depends on.
--
-- The generic sp_master_* procedures already handle CRUD for this table via
-- master_registry, so the Admin > Masters screen manages it with no new code.
-- These two exist because the generic list procedure deliberately returns only
-- the standard master columns, and validation needs `category`.
--
-- CATEGORY drives the rule "one identity document AND one credential document".
-- A NULL category counts as 'supporting': an option added through the generic
-- admin screen must not silently become acceptable proof of identity.
-- ============================================================

DELIMITER $$

-- ------------------------------------------------------------
-- The dropdown the achiever sees, with the category the UI groups by.
-- ------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_achiever_doc_types_list`$$
CREATE PROCEDURE `sp_achiever_doc_types_list`(IN p_active_only TINYINT)
BEGIN
    SELECT value, label, IFNULL(category, 'supporting') AS category,
           help_text, sort_order, is_active,
           -- Drives the order and the gate on the achiever's own screen: the
           -- required types are asked for one at a time, in sort_order.
           is_required
      FROM master_achiever_doc_type
     WHERE (IFNULL(p_active_only, 1) = 0 OR is_active = 1)
     ORDER BY sort_order, label;
END$$

-- ------------------------------------------------------------
-- Is this a document type an achiever may submit right now?
-- Returns one row so the route can tell "unknown" from "retired" — an achiever
-- re-submitting an option that was withdrawn deserves a different message from
-- someone posting a typo.
-- ------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_achiever_doc_type_check`$$
CREATE PROCEDURE `sp_achiever_doc_type_check`(IN p_value VARCHAR(100))
BEGIN
    DECLARE v_active TINYINT;
    SELECT is_active INTO v_active
      FROM master_achiever_doc_type WHERE value = p_value LIMIT 1;

    IF v_active IS NULL THEN
        SELECT 0 AS ok, 'unknown' AS reason;
    ELSEIF v_active = 0 THEN
        SELECT 0 AS ok, 'retired' AS reason;
    ELSE
        SELECT 1 AS ok, 'ok' AS reason;
    END IF;
END$$

-- ------------------------------------------------------------
-- Submit validation, rewritten to read categories from master data instead of
-- the hardcoded IN ('govt_id','selfie') / IN ('rank_card',...) lists it used to
-- carry. Adding a credential type is now a master-data row, not a deploy.
-- ------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_achiever_application_submit`$$
CREATE PROCEDURE `sp_achiever_application_submit`(IN p_achiever_id CHAR(36))
BEGIN
    DECLARE v_status    VARCHAR(20);
    DECLARE v_docs_left  INT DEFAULT 0;
    DECLARE v_agree_left INT DEFAULT 0;

    SELECT application_status INTO v_status FROM achievers WHERE id = p_achiever_id;

    -- Both checks are now driven by the master tables' is_required flag rather
    -- than by lists written into this procedure.
    --
    -- Documents were counted by category -- one 'identity', one 'credential' --
    -- which let an achiever satisfy the rule with a government ID and skip the
    -- selfie entirely, while the screen asked for both. Requiring each type
    -- flagged is_required makes the two agree, and adding or retiring a document
    -- type is master data rather than a procedure change.
    --
    -- Agreements were hardcoded to three named types with `< 3`. A fourth was
    -- added (the guidelines acknowledgement) and this count silently ignored it.
    SELECT COUNT(*) INTO v_docs_left
      FROM master_achiever_doc_type t
     WHERE t.is_active = 1 AND t.is_required = 1
       AND NOT EXISTS (
             SELECT 1 FROM achiever_documents d
              WHERE d.achiever_id = p_achiever_id
                AND d.doc_type = t.value COLLATE utf8mb4_unicode_ci
                -- Anything not rejected counts: a document waiting on review is
                -- the achiever's part done, and this gate is about their part.
                AND d.status <> 'rejected'
           );

    SELECT COUNT(*) INTO v_agree_left
      FROM master_achiever_agreement m
     WHERE m.is_active = 1 AND m.is_required = 1
       AND NOT EXISTS (
             SELECT 1 FROM achiever_agreements a
              WHERE a.achiever_id = p_achiever_id
                AND a.agreement_type = m.value COLLATE utf8mb4_unicode_ci
                AND a.granted = 1
           );

    IF v_status IS NULL THEN
        SELECT 0 AS ok, 'not_found' AS reason;
    ELSEIF v_status = 'submitted' THEN
        SELECT 0 AS ok, 'already_submitted' AS reason;
    ELSEIF v_status = 'approved' THEN
        SELECT 0 AS ok, 'already_approved' AS reason;
    ELSEIF v_docs_left > 0 THEN
        SELECT 0 AS ok, 'required_document_missing' AS reason;
    ELSEIF v_agree_left > 0 THEN
        SELECT 0 AS ok, 'agreements_required' AS reason;
    ELSE
        UPDATE achievers
           SET application_status = 'submitted',
               application_submitted_at = UTC_TIMESTAMP(),
               rejection_reason = NULL
         WHERE id = p_achiever_id;
        SELECT 1 AS ok, 'submitted' AS reason;
    END IF;
END$$

-- ------------------------------------------------------------
-- What is still missing, computed from the same master data the rule uses — so
-- the checklist on the screen and the refusal from submit can never disagree.
-- ------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_achiever_document_coverage`$$
CREATE PROCEDURE `sp_achiever_document_coverage`(IN p_achiever_id CHAR(36))
BEGIN
    SELECT
        IFNULL(SUM(IFNULL(t.category,'supporting') = 'identity'), 0)   AS identity_docs,
        IFNULL(SUM(IFNULL(t.category,'supporting') = 'credential'), 0) AS credential_docs,
        COUNT(*)                                                       AS total_docs
      FROM achiever_documents d
      LEFT JOIN master_achiever_doc_type t ON t.value = d.doc_type
     WHERE d.achiever_id = p_achiever_id AND d.status <> 'rejected';
END$$

DELIMITER ;
