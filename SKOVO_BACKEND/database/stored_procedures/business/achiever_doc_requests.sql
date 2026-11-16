-- ============================================================================
-- SKOVO — a reviewer asking an achiever for a document.
--
-- Accept and Reject both need the document to already exist. This is the third
-- lever: ask for one that does not. The request names a type from
-- master_achiever_doc_type, so the achiever gets a real upload slot rather than
-- a message telling them to work out what to attach.
--
-- Fulfilment is derived, never stored. A request is satisfied when a document of
-- that type exists for that achiever and is not rejected — the same condition
-- the submit rule uses. A stored `fulfilled` flag would be a second copy of that
-- truth, and the two would drift the first time a document was deleted.
-- ============================================================================

DELIMITER $$

-- ---------------------------------------------------------------------------
-- Ask for one. Re-asking for a type that is already outstanding is a no-op
-- rather than a second row: an admin clicking twice should not produce two
-- identical asks on the achiever's screen.
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_achiever_doc_request_add`$$
CREATE PROCEDURE `sp_achiever_doc_request_add`(
    IN p_id          CHAR(36),
    IN p_achiever_id CHAR(36),
    IN p_doc_type    VARCHAR(100),
    IN p_note        TEXT,
    IN p_actor_id    CHAR(36)
)
BEGIN
    DECLARE v_known INT DEFAULT 0;

    -- Only a type the upload picker can actually offer; anything else would
    -- render as a slot the achiever has no way to fill.
    SELECT COUNT(*) INTO v_known
      FROM `master_achiever_doc_type`
     WHERE value = p_doc_type COLLATE utf8mb4_unicode_ci AND is_active = 1;

    IF v_known = 0 THEN
        SELECT 0 AS ok, 'unknown_doc_type' AS reason;
    ELSEIF EXISTS (
        SELECT 1 FROM `achiever_document_requests`
         WHERE achiever_id = p_achiever_id
           AND doc_type = p_doc_type COLLATE utf8mb4_unicode_ci
           AND cancelled_at IS NULL
    ) THEN
        SELECT 0 AS ok, 'already_requested' AS reason;
    ELSE
        INSERT INTO `achiever_document_requests`
            (id, achiever_id, doc_type, note, requested_by, created_at)
        VALUES
            (COALESCE(NULLIF(p_id, ''), UUID()), p_achiever_id, p_doc_type,
             NULLIF(TRIM(COALESCE(p_note, '')), ''), p_actor_id, UTC_TIMESTAMP());

        SELECT 1 AS ok, 'requested' AS reason;
    END IF;
END$$

-- ---------------------------------------------------------------------------
-- What has been asked for, with its label and whether it has since arrived.
-- Both sides read this: the achiever to know what to upload, the reviewer to
-- see what they are still waiting on.
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_achiever_doc_requests_list`$$
CREATE PROCEDURE `sp_achiever_doc_requests_list`(
    IN p_achiever_id CHAR(36)
)
BEGIN
    SELECT
        r.id,
        r.doc_type,
        -- The label comes from master data rather than the request, so renaming
        -- a document type updates every outstanding ask with it.
        COALESCE(t.label, r.doc_type) AS label,
        t.help_text,
        r.note,
        r.created_at,
        EXISTS (
            SELECT 1 FROM `achiever_documents` d
             WHERE d.achiever_id = r.achiever_id
               AND d.doc_type = r.doc_type COLLATE utf8mb4_unicode_ci
               AND d.status <> 'rejected'
               AND d.created_at >= r.created_at
        ) AS fulfilled
      FROM `achiever_document_requests` r
      LEFT JOIN `master_achiever_doc_type` t
             ON t.value = r.doc_type COLLATE utf8mb4_unicode_ci
     WHERE r.achiever_id = p_achiever_id
       AND r.cancelled_at IS NULL
     ORDER BY r.created_at;
END$$

-- ---------------------------------------------------------------------------
-- Withdraw one. Cancelled rather than deleted: the achiever may already have
-- seen it, and "why did that disappear" is worth being able to answer.
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_achiever_doc_request_cancel`$$
CREATE PROCEDURE `sp_achiever_doc_request_cancel`(
    IN p_id CHAR(36)
)
BEGIN
    UPDATE `achiever_document_requests`
       SET cancelled_at = UTC_TIMESTAMP()
     WHERE id = p_id AND cancelled_at IS NULL;

    SELECT ROW_COUNT() AS cancelled;
END$$

DELIMITER ;
