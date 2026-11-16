-- ============================================================
-- SKOVO — ACHIEVER AGREEMENTS (master data)
-- ============================================================
-- The three ticks on the Verification screen. They were a Python tuple plus a
-- hardcoded label map in React; they are now rows in master_achiever_agreement,
-- registered in master_registry so Admin > Masters edits them.
--
-- Each row carries the TEXT that was accepted and its version. The consent
-- ledger (achiever_agreements) stores which version an achiever ticked, so
-- "what did they agree to" is answerable — which it was not before.
--
-- The generic sp_master_* procedures already do CRUD here. These exist because
-- sp_master_list returns only the standard columns and the flows below need
-- `body`, `version` and `is_required`.
-- ============================================================

DELIMITER $$

-- ------------------------------------------------------------
-- Every agreement the achiever must accept, with its text and version.
-- p_required_only = 1 returns just the gating ones.
-- ------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_achiever_agreement_types_list`$$
CREATE PROCEDURE `sp_achiever_agreement_types_list`(IN p_required_only TINYINT)
BEGIN
    SELECT value, label, body, body_url, version, is_required, sort_order
      FROM master_achiever_agreement
     WHERE is_active = 1
       AND (IFNULL(p_required_only, 0) = 0 OR is_required = 1)
     ORDER BY sort_order, label;
END$$

-- ------------------------------------------------------------
-- Is this a live agreement, and what version is current?
-- The route records the version returned here, so an achiever's consent is
-- pinned to the exact wording they were shown.
-- ------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_achiever_agreement_type_check`$$
CREATE PROCEDURE `sp_achiever_agreement_type_check`(IN p_value VARCHAR(100))
BEGIN
    DECLARE v_active TINYINT;
    DECLARE v_version VARCHAR(20);

    SELECT is_active, version INTO v_active, v_version
      FROM master_achiever_agreement WHERE value = p_value LIMIT 1;

    IF v_active IS NULL THEN
        SELECT 0 AS ok, 'unknown' AS reason, NULL AS version;
    ELSEIF v_active = 0 THEN
        SELECT 0 AS ok, 'retired' AS reason, NULL AS version;
    ELSE
        SELECT 1 AS ok, 'ok' AS reason, v_version AS version;
    END IF;
END$$

-- ------------------------------------------------------------
-- What has this achiever accepted, against what is currently required?
--
-- Returns one row per REQUIRED agreement — accepted or not — so the screen can
-- show the full checklist rather than only the ticked ones, and can flag an
-- agreement whose version has moved on since it was signed.
-- ------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_achiever_agreement_status`$$
CREATE PROCEDURE `sp_achiever_agreement_status`(IN p_achiever_id CHAR(36))
BEGIN
    SELECT
        m.value,
        m.label,
        m.body,
        m.body_url,
        m.version                       AS current_version,
        m.is_required,
        m.sort_order,
        a.policy_version                AS accepted_version,
        a.created_at                    AS accepted_at,
        a.ip                            AS accepted_ip,
        (a.id IS NOT NULL)              AS accepted,
        -- Wording moved on since they signed. Not a blocker today, but the
        -- screen should be able to say so rather than showing a bare tick.
        (a.id IS NOT NULL
         AND a.policy_version <> m.version) AS stale
      FROM master_achiever_agreement m
      LEFT JOIN (
            SELECT agreement_type, policy_version, created_at, ip, id,
                   ROW_NUMBER() OVER (PARTITION BY agreement_type
                                      ORDER BY created_at DESC) AS rn
              FROM achiever_agreements
             WHERE achiever_id = p_achiever_id AND granted = 1
      ) a ON a.agreement_type = m.value AND a.rn = 1
     WHERE m.is_active = 1
     ORDER BY m.sort_order, m.label;
END$$

-- ------------------------------------------------------------
-- Submit validation, rewritten to count REQUIRED agreements from master data
-- instead of the hardcoded IN ('code_of_conduct','commission',
-- 'cancellation_policy') it carried. Adding a fourth required agreement is now
-- a master-data row, not a deploy.
-- ------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_achiever_application_submit`$$
CREATE PROCEDURE `sp_achiever_application_submit`(IN p_achiever_id CHAR(36))
BEGIN
    DECLARE v_status   VARCHAR(20);
    DECLARE v_ident    INT DEFAULT 0;
    DECLARE v_cred     INT DEFAULT 0;
    DECLARE v_required INT DEFAULT 0;
    DECLARE v_agreed   INT DEFAULT 0;

    SELECT application_status INTO v_status FROM achievers WHERE id = p_achiever_id;

    -- LEFT JOIN, not JOIN: a document whose type was later deleted from master
    -- data must not vanish from the count and silently un-complete an
    -- application the achiever already submitted. It lands in 'supporting'.
    SELECT
        SUM(IFNULL(t.category, 'supporting') = 'identity'),
        SUM(IFNULL(t.category, 'supporting') = 'credential')
      INTO v_ident, v_cred
      FROM achiever_documents d
      LEFT JOIN master_achiever_doc_type t ON t.value = d.doc_type
     WHERE d.achiever_id = p_achiever_id AND d.status <> 'rejected';

    SELECT COUNT(*) INTO v_required
      FROM master_achiever_agreement WHERE is_active = 1 AND is_required = 1;

    -- DISTINCT: re-accepting after a version bump inserts a second ledger row,
    -- and that must not count as two separate agreements satisfied.
    SELECT COUNT(DISTINCT g.agreement_type) INTO v_agreed
      FROM achiever_agreements g
      JOIN master_achiever_agreement m
        ON m.value = g.agreement_type AND m.is_active = 1 AND m.is_required = 1
     WHERE g.achiever_id = p_achiever_id AND g.granted = 1;

    IF v_status IS NULL THEN
        SELECT 0 AS ok, 'not_found' AS reason;
    ELSEIF v_status = 'submitted' THEN
        SELECT 0 AS ok, 'already_submitted' AS reason;
    ELSEIF v_status = 'approved' THEN
        SELECT 0 AS ok, 'already_approved' AS reason;
    ELSEIF IFNULL(v_ident,0) = 0 THEN
        SELECT 0 AS ok, 'identity_document_required' AS reason;
    ELSEIF IFNULL(v_cred,0) = 0 THEN
        SELECT 0 AS ok, 'credential_document_required' AS reason;
    ELSEIF v_agreed < v_required THEN
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
-- Verification completion, as a single number plus its parts.
--
-- Feeds the completion score on the Verification screen. Computed here rather
-- than in React so the figure the achiever sees and the rule that gates submit
-- come from the same place.
-- ------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_achiever_verification_progress`$$
CREATE PROCEDURE `sp_achiever_verification_progress`(IN p_achiever_id CHAR(36))
BEGIN
    DECLARE v_ident      INT DEFAULT 0;
    DECLARE v_cred       INT DEFAULT 0;
    DECLARE v_required   INT DEFAULT 0;
    DECLARE v_agreed     INT DEFAULT 0;
    DECLARE v_bgv        VARCHAR(20);
    DECLARE v_doc_types  INT DEFAULT 0;
    DECLARE v_doc_done   INT DEFAULT 0;
    DECLARE v_profile    INT DEFAULT 0;

    SELECT
        IFNULL(SUM(IFNULL(t.category,'supporting') = 'identity'), 0),
        IFNULL(SUM(IFNULL(t.category,'supporting') = 'credential'), 0)
      INTO v_ident, v_cred
      FROM achiever_documents d
      LEFT JOIN master_achiever_doc_type t ON t.value = d.doc_type
     WHERE d.achiever_id = p_achiever_id AND d.status <> 'rejected';

    SELECT COUNT(*) INTO v_required
      FROM master_achiever_agreement WHERE is_active = 1 AND is_required = 1;

    SELECT COUNT(DISTINCT g.agreement_type) INTO v_agreed
      FROM achiever_agreements g
      JOIN master_achiever_agreement m
        ON m.value = g.agreement_type AND m.is_active = 1 AND m.is_required = 1
     WHERE g.achiever_id = p_achiever_id AND g.granted = 1;

    SELECT bgv_status INTO v_bgv
      FROM achievers WHERE id = p_achiever_id;

    -- ── The number on the ring ──────────────────────────────────────────────
    --
    -- One required item = one unit, so every action the achiever takes moves
    -- the ring, and it fills at the exact moment Submit becomes available.
    --
    -- It used to be four equally weighted categories, which was wrong twice
    -- over. BGV was one of the four, and an achiever cannot clear their own
    -- background check -- so someone who had done everything asked of them sat
    -- at 75% looking at an unfinished ring, forever. Meanwhile the LinkedIn URL
    -- counted for nothing despite being required to submit, and the two
    -- identity documents shared a single unit, so uploading the second one
    -- moved nothing at all. Two of the six actions in a complete application
    -- changed the number by zero.
    --
    -- BGV is not on the ring any more. It is still reported below and shown on
    -- its own line: it is news about the application, not progress through it.

    -- How many required document TYPES exist, and how many are satisfied.
    -- DISTINCT on the type: re-uploading after a rejection adds a row rather
    -- than replacing one, and two files of the same type are still one item
    -- done.
    SELECT COUNT(*) INTO v_doc_types
      FROM master_achiever_doc_type WHERE is_required = 1 AND is_active = 1;

    SELECT COUNT(DISTINCT t.value) INTO v_doc_done
      FROM master_achiever_doc_type t
      JOIN achiever_documents d
        ON d.doc_type = t.value COLLATE utf8mb4_unicode_ci
       AND d.achiever_id = p_achiever_id
       AND d.status <> 'rejected'
     WHERE t.is_required = 1 AND t.is_active = 1;

    -- The one profile field the application cannot go without. It is the only
    -- claim on the form an admin can check independently, which is why it is
    -- required and why it belongs in the count.
    SELECT (linkedin_url IS NOT NULL AND TRIM(linkedin_url) <> '')
      INTO v_profile
      FROM achievers WHERE id = p_achiever_id;

    SELECT
        (v_ident > 0)                                   AS identity_done,
        (v_cred > 0)                                    AS credential_done,
        (v_required > 0 AND v_agreed >= v_required)     AS agreements_done,
        (IFNULL(v_bgv,'none') = 'clear')                AS bgv_done,
        IFNULL(v_bgv, 'none')                           AS bgv_status,
        v_agreed                                        AS agreements_accepted,
        v_required                                      AS agreements_required,
        v_ident                                         AS identity_docs,
        v_cred                                          AS credential_docs,
        -- GREATEST(...,1): master data with no required rows would otherwise
        -- divide by zero and fail the whole screen rather than the ring.
        ROUND(
            (IFNULL(v_doc_done,0) + IFNULL(v_agreed,0) + IFNULL(v_profile,0))
            / GREATEST(IFNULL(v_doc_types,0) + IFNULL(v_required,0) + 1, 1)
            * 100
        ) AS percent_complete;
END$$

DELIMITER ;
