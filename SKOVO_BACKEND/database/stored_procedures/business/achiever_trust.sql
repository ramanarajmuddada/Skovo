-- ============================================================
-- SKOVO — ACHIEVER TRUST business-flow stored procedures (MySQL 8)
-- ============================================================
-- The tier ladder that replaced `is_verified`'s two conflicting jobs:
--
--   L0 applied  L1 identity  L2 credential  L3 bgv_cleared  L4 featured
--
-- What each tier unlocks lives in `achiever_trust_rules` (config, not code),
-- so a rate ceiling changes without a deploy.
--
-- `is_verified` is kept in sync as a mirror of (trust_level >= 2) by
-- sp_achiever_trust_set — a dozen older call sites still read it.
--
-- Every tier mutation writes BOTH an audit_logs row (who did it) and an
-- achiever_trust_events row (what it was, why, and what the cascade did).
--
-- MONEY NOTE: these procedures mark enrolments and sessions 'refunded'. They
-- do not call the gateway — side effects stay in Python, per the house rule. The
-- caller reads sp_achiever_cascade_since() and fires the real refunds.
-- ============================================================

DELIMITER $$

-- sp_achiever_booking_eligibility removed: redefined on state in achiever_booking_eligibility.sql.

-- ------------------------------------------------------------
-- Achiever submits their application for review.
-- Requires at least one identity document and one credential document —
-- an admin should never be handed an empty dossier, which is exactly the
-- failure this whole migration exists to close.
-- ------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_achiever_application_submit`$$
CREATE PROCEDURE `sp_achiever_application_submit`(IN p_achiever_id CHAR(36))
BEGIN
    DECLARE v_status  VARCHAR(20);
    DECLARE v_ident   INT DEFAULT 0;
    DECLARE v_cred    INT DEFAULT 0;
    DECLARE v_agreed  INT DEFAULT 0;

    SELECT application_status INTO v_status FROM achievers WHERE id = p_achiever_id;

    SELECT
        SUM(doc_type IN ('govt_id','selfie')),
        SUM(doc_type IN ('achievement_proof','degree','offer_letter','rank_card'))
      INTO v_ident, v_cred
      FROM achiever_documents
     WHERE achiever_id = p_achiever_id AND status <> 'rejected';

    SELECT COUNT(*) INTO v_agreed
      FROM achiever_agreements
     WHERE achiever_id = p_achiever_id AND granted = 1
       AND agreement_type IN ('code_of_conduct','commission','cancellation_policy');

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
    ELSEIF v_agreed < 3 THEN
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
-- Evidence documents.
-- ------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_achiever_document_add`$$
CREATE PROCEDURE `sp_achiever_document_add`(
    IN p_id            CHAR(36),
    IN p_achiever_id   CHAR(36),
    IN p_doc_type      VARCHAR(40),
    IN p_file_url      TEXT,
    IN p_original_name VARCHAR(255),
    IN p_claim         VARCHAR(255)
)
BEGIN
    IF p_id IS NULL OR p_id = '' THEN SET p_id = UUID(); END IF;
    INSERT INTO achiever_documents
        (id, achiever_id, doc_type, file_url, original_name, claim)
    VALUES (p_id, p_achiever_id, p_doc_type, p_file_url, p_original_name, p_claim);

    -- A re-upload after rejection puts the application back in the queue
    -- instead of stranding it in 'rejected' with no way forward.
    UPDATE achievers
       SET application_status = 'draft', rejection_reason = NULL
     WHERE id = p_achiever_id AND application_status = 'rejected';

    SELECT * FROM achiever_documents WHERE id = p_id;
END$$

DROP PROCEDURE IF EXISTS `sp_achiever_documents_list`$$
CREATE PROCEDURE `sp_achiever_documents_list`(IN p_achiever_id CHAR(36))
BEGIN
    SELECT id, achiever_id, doc_type, file_url, original_name, claim,
           status, review_note, reviewed_by, reviewed_at, created_at
      FROM achiever_documents
     WHERE achiever_id = p_achiever_id
     ORDER BY created_at DESC;
END$$

DROP PROCEDURE IF EXISTS `sp_achiever_document_review`$$
CREATE PROCEDURE `sp_achiever_document_review`(
    IN p_doc_id   CHAR(36),
    IN p_status   VARCHAR(20),      -- accepted | rejected
    IN p_note     TEXT,
    IN p_admin_id CHAR(36)
)
BEGIN
    UPDATE achiever_documents
       SET status = p_status, review_note = p_note,
           reviewed_by = p_admin_id, reviewed_at = UTC_TIMESTAMP()
     WHERE id = p_doc_id;
    SELECT * FROM achiever_documents WHERE id = p_doc_id;
END$$

DROP PROCEDURE IF EXISTS `sp_achiever_document_delete`$$
CREATE PROCEDURE `sp_achiever_document_delete`(
    IN p_doc_id      CHAR(36),
    IN p_achiever_id CHAR(36)
)
BEGIN
    -- Ownership is in the WHERE clause, not assumed by the caller: an achiever
    -- must never be able to delete evidence attached to someone else.
    DELETE FROM achiever_documents
     WHERE id = p_doc_id AND achiever_id = p_achiever_id AND status = 'pending';
    SELECT ROW_COUNT() AS deleted;
END$$

-- ------------------------------------------------------------
-- Achiever agreement ledger — append-only, same contract as user_consents.
-- ------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_achiever_agreement_record`$$
CREATE PROCEDURE `sp_achiever_agreement_record`(
    IN p_id          CHAR(36),
    IN p_achiever_id CHAR(36),
    IN p_type        VARCHAR(40),
    IN p_version     VARCHAR(20),
    IN p_granted     TINYINT,
    IN p_ip          VARCHAR(64)
)
BEGIN
    IF p_id IS NULL OR p_id = '' THEN SET p_id = UUID(); END IF;
    INSERT INTO achiever_agreements
        (id, achiever_id, agreement_type, policy_version, granted, ip)
    VALUES (p_id, p_achiever_id, p_type, IFNULL(p_version,'v1'), IFNULL(p_granted,1), p_ip);
    SELECT 1 AS ok;
END$$

DROP PROCEDURE IF EXISTS `sp_achiever_agreements_list`$$
CREATE PROCEDURE `sp_achiever_agreements_list`(IN p_achiever_id CHAR(36))
BEGIN
    SELECT id, agreement_type, policy_version, granted, created_at
      FROM achiever_agreements
     WHERE achiever_id = p_achiever_id
     ORDER BY created_at DESC;
END$$

-- sp_achiever_trust_set removed: state moves via sp_achiever_set_state, which audits it.

-- ------------------------------------------------------------
-- Who the cascade just hurt. Called straight after sp_achiever_trust_set with
-- that call's event timestamp, so Python can refund and apologise to exactly
-- the people affected. Kept separate because the notification and the the gateway
-- refund are side effects, and side effects stay out of SQL.
-- ------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_achiever_cascade_since`$$
CREATE PROCEDURE `sp_achiever_cascade_since`(
    IN p_achiever_id CHAR(36),
    IN p_since       DATETIME
)
BEGIN
    SELECT 'session' AS kind, s.id AS ref_id, s.student_id AS user_id,
           u.email, u.full_name,
           s.payment_id, s.amount AS amount, s.payment_status
      FROM achiever_sessions s
      JOIN users u ON u.id = s.student_id
     WHERE s.mentor_id = p_achiever_id
       AND s.status = 'cancelled'
       AND s.updated_at >= p_since

    UNION ALL

    SELECT 'cohort' AS kind, e.cohort_id AS ref_id, e.user_id,
           u.email, u.full_name,
           e.payment_id, e.amount_paid AS amount, e.payment_status
      FROM cohort_enrollments e
      JOIN cohorts c ON c.id = e.cohort_id
      JOIN users u   ON u.id = e.user_id
     WHERE c.achiever_id = p_achiever_id
       AND c.status = 'cancelled'
       AND e.updated_at >= p_since;
END$$

-- ------------------------------------------------------------
-- Reject an application, with a reason the applicant is actually told.
-- The old code had no rejection path at all — the only lever was is_active = 0,
-- a silent disappearance with nothing recorded and no email.
-- ------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_achiever_application_reject`$$
CREATE PROCEDURE `sp_achiever_application_reject`(
    IN p_achiever_id CHAR(36),
    IN p_reason      TEXT,
    IN p_admin_id    CHAR(36)
)
BEGIN
    DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;
    START TRANSACTION;

    UPDATE achievers
       SET application_status = 'rejected',
           rejection_reason   = p_reason,
           is_verified        = 0,
           updated_at         = UTC_TIMESTAMP(),
           updated_by         = p_admin_id
     WHERE id = p_achiever_id;

    INSERT INTO achiever_trust_events
        (id, achiever_id, from_level, to_level, action, reason, actor_id, actor_role)
    VALUES (UUID(), p_achiever_id, NULL, 0, 'reject', p_reason, p_admin_id, 'admin');

    INSERT INTO audit_logs (id, user_id, action, resource_type, resource_id, created_by)
    VALUES (UUID(), p_admin_id, 'achiever.application.reject',
            'achiever', p_achiever_id, p_admin_id);

    COMMIT;
    SELECT * FROM achievers WHERE id = p_achiever_id;
END$$

-- sp_achiever_bgv_start removed: redefined on state in achiever_bgv_state.sql.

-- Vendor webhook lands here. On 'clear' the achiever does NOT auto-promote to
-- L3: a clear result is evidence, and promotion to the tier that unlocks
-- minors stays a deliberate human act under four-eyes (see the super-admin
-- route). This records the result and lets the reviewer act on it.
DROP PROCEDURE IF EXISTS `sp_achiever_bgv_complete`$$
CREATE PROCEDURE `sp_achiever_bgv_complete`(
    IN p_ref          VARCHAR(120),
    IN p_result       VARCHAR(20),   -- clear | failed
    IN p_valid_months INT
)
BEGIN
    DECLARE v_id    CHAR(36);
    DECLARE v_state VARCHAR(20);

    SELECT id, state INTO v_id, v_state
      FROM achievers WHERE bgv_ref = p_ref LIMIT 1;

    IF v_id IS NULL THEN
        SELECT 0 AS ok, 'unknown_ref' AS reason;
    ELSEIF p_result = 'clear' THEN
        UPDATE achievers
           SET bgv_status     = 'clear',
               bgv_cleared_at = UTC_TIMESTAMP(),
               bgv_expires_at = DATE_ADD(UTC_TIMESTAMP(),
                                         INTERVAL IFNULL(p_valid_months,12) MONTH)
         WHERE id = v_id;
        INSERT INTO achiever_state_events
            (id, achiever_id, from_state, to_state, reason, actor_role, created_at)
        VALUES (UUID(), v_id, v_state, v_state,
                'Background check returned clear', 'system', UTC_TIMESTAMP());
        SELECT 1 AS ok, 'clear' AS reason, v_id AS achiever_id;
    ELSE
        UPDATE achievers
           SET bgv_status = 'failed', bgv_expires_at = NULL
         WHERE id = v_id;
        INSERT INTO achiever_state_events
            (id, achiever_id, from_state, to_state, reason, actor_role, created_at)
        VALUES (UUID(), v_id, v_state, v_state,
                'Background check returned an adverse result', 'system', UTC_TIMESTAMP());
        SELECT 1 AS ok, 'failed' AS reason, v_id AS achiever_id;
    END IF;
END$$

-- ------------------------------------------------------------
-- Admin review queue — applications waiting, with their evidence counted so
-- the list itself shows whether there is anything to look at.
-- ------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_achiever_review_queue`$$
CREATE PROCEDURE `sp_achiever_review_queue`(
    IN p_status VARCHAR(20),
    IN p_limit  INT,
    IN p_offset INT
)
BEGIN
    SELECT a.id, a.full_name, a.email, a.designation, a.company, a.linkedin_url,
           a.bio, a.state, a.application_status, a.application_submitted_at,
           a.bgv_status, a.bgv_expires_at, a.rejection_reason, a.session_rate,
           -- So the queue can show what an already-approved achiever was
           -- granted, and the approve dialog can pre-fill a sensible number
           -- instead of starting blank on a re-review.
           a.cohort_seat_allocation,
           (SELECT COUNT(*) FROM achiever_documents d
             WHERE d.achiever_id = a.id) AS doc_count,
           (SELECT COUNT(*) FROM achiever_documents d
             WHERE d.achiever_id = a.id AND d.status = 'pending') AS doc_pending,
           (SELECT COUNT(*) FROM achiever_agreements g
             WHERE g.achiever_id = a.id AND g.granted = 1) AS agreements_signed
      FROM achievers a
     WHERE (p_status IS NULL OR p_status = '' OR a.application_status = p_status)
     ORDER BY a.application_submitted_at IS NULL, a.application_submitted_at ASC
     LIMIT p_limit OFFSET p_offset;
END$$

-- ------------------------------------------------------------
-- The tier history of one achiever — what an admin reads before deciding.
-- ------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_achiever_trust_events_list`$$
CREATE PROCEDURE `sp_achiever_trust_events_list`(
    IN p_achiever_id CHAR(36),
    IN p_limit       INT
)
BEGIN
    SELECT id, from_level, to_level, action, reason,
           actor_id, actor_role, cascade_note, created_at
      FROM achiever_trust_events
     WHERE achiever_id = p_achiever_id
     ORDER BY created_at DESC
     LIMIT p_limit;
END$$

DELIMITER ;
