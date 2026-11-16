-- ============================================================
-- SKOVO — Tailored endpoint stored procedures: task submission upsert
-- ============================================================
-- Used by POST /tasks/<id>/submit — the generic sp_task_submissions_create/
-- _update procs don't expose `submitted_at` (auto-timestamp column skipped
-- by the generator), and a resubmission needs it bumped to NOW(). Blocks
-- resubmission once a mentor has approved the task.
-- ============================================================

DELIMITER $$

DROP PROCEDURE IF EXISTS `sp_task_submission_get_by_user`$$
CREATE PROCEDURE `sp_task_submission_get_by_user`(IN p_task_id VARCHAR(36), IN p_user_id VARCHAR(36))
BEGIN
    SELECT * FROM `task_submissions` WHERE `task_id` = p_task_id AND `user_id` = p_user_id LIMIT 1;
END$$

DROP PROCEDURE IF EXISTS `sp_task_submission_upsert`$$
CREATE PROCEDURE `sp_task_submission_upsert`(
    IN p_task_id       VARCHAR(36),
    IN p_user_id       VARCHAR(36),
    IN p_evidence_url  TEXT,
    IN p_evidence_text TEXT
)
BEGIN
    DECLARE v_status VARCHAR(20) DEFAULT NULL;
    DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

    START TRANSACTION;
    SELECT `status` INTO v_status FROM `task_submissions`
     WHERE `task_id` = p_task_id AND `user_id` = p_user_id FOR UPDATE;

    IF v_status = 'approved' THEN
        ROLLBACK; SELECT 0 AS ok, 'Task already approved. Contact your mentor to reopen.' AS message;
    ELSE
        INSERT INTO `task_submissions`
            (id, task_id, user_id, status, evidence_url, evidence_text, submitted_at)
        VALUES (UUID(), p_task_id, p_user_id, 'pending', p_evidence_url, p_evidence_text, UTC_TIMESTAMP())
        ON DUPLICATE KEY UPDATE
            status = 'pending', evidence_url = p_evidence_url, evidence_text = p_evidence_text,
            submitted_at = UTC_TIMESTAMP(),
            -- A resubmission is new work, so the verdict on the old work goes
            -- with it. These four used to survive, which meant a task rejected
            -- at 3/10 came back into the reviewer's queue still displaying
            -- 3/10 and the previous feedback -- a score for evidence nobody had
            -- looked at yet, on both the reviewer's drawer and the student's
            -- own task screen.
            mentor_score = NULL, mentor_notes = NULL,
            reviewed_by = NULL, reviewed_at = NULL;
        COMMIT;
        SELECT 1 AS ok, 'Submission saved.' AS message;
    END IF;
END$$

DELIMITER ;
