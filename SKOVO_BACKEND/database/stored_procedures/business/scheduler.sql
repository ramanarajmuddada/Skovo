-- ============================================================
-- SKOVO — Background-job (scheduler / celery) stored procedures
-- ============================================================
-- These back the time-driven jobs in portal/scheduler.py (in-process
-- APScheduler, the live job runner) and portal/celery_app.py (orphaned,
-- never-deployed — kept in sync for consistency). All still-external
-- side effects (in-app notifications, email sending) stay in Python;
-- only the DB read/write for each job moves here.
-- ============================================================

DELIMITER $$

-- ------------------------------------------------------------
-- Flip cohort status upcoming -> live at session_date.
-- Completing is End session, not the clock.
-- ------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_scheduler_transition_cohorts`$$
CREATE PROCEDURE `sp_scheduler_transition_cohorts`()
BEGIN
    UPDATE `cohorts`
       SET `status` = 'live'
     WHERE `status` = 'upcoming'
       AND `deleted_at` IS NULL
       AND `session_date` IS NOT NULL
       AND `session_date` <= UTC_TIMESTAMP();
    SELECT ROW_COUNT() AS changed;
END$$

-- ------------------------------------------------------------
-- Cohorts starting within the next 15 min (and not more than 2h in the
-- past) that haven't had their T-15 reminder sent yet.
-- ------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_scheduler_due_cohort_reminders`$$
CREATE PROCEDURE `sp_scheduler_due_cohort_reminders`()
BEGIN
    SELECT `id`, `title`, `meeting_link`, `achiever_id`, `duration_minutes`, `session_date`
      FROM `cohorts`
     WHERE `status` IN ('upcoming','live')
       AND `deleted_at` IS NULL
       AND IFNULL(`reminder_sent`, 0) = 0
       AND `session_date` IS NOT NULL
       AND `session_date` BETWEEN (UTC_TIMESTAMP() - INTERVAL 2 HOUR) AND (UTC_TIMESTAMP() + INTERVAL 15 MINUTE);
END$$

-- ------------------------------------------------------------
-- Paid/free enrollees of a cohort (student user_id + email), for the
-- reminder fan-out.
-- ------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_scheduler_cohort_reminder_recipients`$$
CREATE PROCEDURE `sp_scheduler_cohort_reminder_recipients`(IN p_cohort_id CHAR(36))
BEGIN
    SELECT e.`user_id`, u.`email`
      FROM `cohort_enrollments` e
      LEFT JOIN `users` u ON u.`id` = e.`user_id`
     WHERE e.`cohort_id` = p_cohort_id
       AND e.`payment_status` IN ('paid','free');
END$$

DROP PROCEDURE IF EXISTS `sp_scheduler_mark_cohort_reminder_sent`$$
CREATE PROCEDURE `sp_scheduler_mark_cohort_reminder_sent`(IN p_cohort_id CHAR(36))
BEGIN
    UPDATE `cohorts` SET `reminder_sent` = 1 WHERE `id` = p_cohort_id;
END$$

-- ------------------------------------------------------------
-- Live cohorts whose booked minutes have elapsed, notice not yet sent.
-- Status stays live until End session.
-- ------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_scheduler_due_cohort_timeup`$$
CREATE PROCEDURE `sp_scheduler_due_cohort_timeup`()
BEGIN
    SELECT `id`, `title`, `meeting_link`, `achiever_id`, `duration_minutes`
      FROM `cohorts`
     WHERE `status` IN ('upcoming', 'live')
       AND `deleted_at` IS NULL
       AND IFNULL(`timeup_notice_sent`, 0) = 0
       AND `session_date` IS NOT NULL
       AND UTC_TIMESTAMP() >= (`session_date` + INTERVAL IFNULL(`duration_minutes`, 90) MINUTE);
END$$

DROP PROCEDURE IF EXISTS `sp_scheduler_mark_cohort_timeup_sent`$$
CREATE PROCEDURE `sp_scheduler_mark_cohort_timeup_sent`(IN p_cohort_id CHAR(36))
BEGIN
    UPDATE `cohorts` SET `timeup_notice_sent` = 1 WHERE `id` = p_cohort_id;
END$$

-- ------------------------------------------------------------
-- 1-on-1 sessions starting within 15 minutes (T-15, both sides).
-- Slot comparison uses start_utc when present; otherwise IST wall-clock − 5:30.
-- ------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_scheduler_due_session_reminders`$$
CREATE PROCEDURE `sp_scheduler_due_session_reminders`()
BEGIN
    SELECT s.`id` AS session_id, s.`student_id`, s.`mentor_id`, s.`meeting_link`,
           COALESCE(sl.start_utc,
                    DATE_SUB(TIMESTAMP(sl.slot_date, sl.start_time), INTERVAL 330 MINUTE)) AS start_dt,
           a.`full_name` AS achiever_name, a.`email` AS achiever_email,
           u.`email` AS student_email, u.`full_name` AS student_name
      FROM `achiever_sessions` s
      JOIN `achiever_slots` sl ON sl.`session_id` = s.`id`
      LEFT JOIN `achievers` a ON a.`id` = s.`mentor_id`
      LEFT JOIN `users` u ON u.`id` = s.`student_id`
     WHERE s.`status` IN ('confirmed', 'pending')
       AND IFNULL(s.`reminder_sent`, 0) = 0
       AND s.cancelled_at IS NULL
       AND COALESCE(sl.start_utc,
                    DATE_SUB(TIMESTAMP(sl.slot_date, sl.start_time), INTERVAL 330 MINUTE))
           BETWEEN UTC_TIMESTAMP() AND (UTC_TIMESTAMP() + INTERVAL 15 MINUTE);
END$$

-- Auto-complete 1-on-1 when the slot has ended. Payout can then release.
-- No-show refund (achiever missing at start+10) is a separate path; at slot
-- end, complete unless already cancelled / refunded.
DROP PROCEDURE IF EXISTS `sp_scheduler_auto_complete_sessions`$$
CREATE PROCEDURE `sp_scheduler_auto_complete_sessions`()
BEGIN
    UPDATE `achiever_sessions` s
      JOIN `achiever_slots` sl ON sl.session_id = s.id
       SET s.status = 'completed', s.updated_at = UTC_TIMESTAMP()
     WHERE s.status IN ('confirmed', 'pending')
       AND s.payment_status IN ('paid', 'free')
       AND s.cancelled_at IS NULL
       AND COALESCE(sl.end_utc,
                    DATE_SUB(TIMESTAMP(sl.slot_date, sl.end_time), INTERVAL 330 MINUTE))
           <= UTC_TIMESTAMP();
    SELECT ROW_COUNT() AS completed;
END$$

DROP PROCEDURE IF EXISTS `sp_scheduler_mark_session_reminder_sent`$$
CREATE PROCEDURE `sp_scheduler_mark_session_reminder_sent`(IN p_session_id CHAR(36))
BEGIN
    UPDATE `achiever_sessions` SET `reminder_sent` = 1 WHERE `id` = p_session_id;
END$$

-- ------------------------------------------------------------
-- Release slots + delete sessions for abandoned paid 1-on-1 holds
-- (student dismissed the checkout popup, on-dismiss release never
-- fired). Returns how many sessions were freed.
-- ------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_scheduler_sweep_abandoned_holds`$$
CREATE PROCEDURE `sp_scheduler_sweep_abandoned_holds`(IN p_cutoff_minutes INT)
BEGIN
    IF p_cutoff_minutes IS NULL OR p_cutoff_minutes <= 0 THEN SET p_cutoff_minutes = 15; END IF;

    UPDATE `achiever_slots` sl
      JOIN `achiever_sessions` s ON s.`id` = sl.`session_id`
       SET sl.`status` = 'available', sl.`session_id` = NULL
     WHERE s.`status` = 'pending' AND s.`payment_status` = 'pending'
       AND s.`created_at` < (UTC_TIMESTAMP() - INTERVAL p_cutoff_minutes MINUTE);

    DELETE FROM `achiever_sessions`
     WHERE `status` = 'pending' AND `payment_status` = 'pending'
       AND `created_at` < (UTC_TIMESTAMP() - INTERVAL p_cutoff_minutes MINUTE);

    SELECT ROW_COUNT() AS freed;
END$$

-- ------------------------------------------------------------
-- Delete OTP requests older than N hours (celery's cleanup_expired_otps).
-- ------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_scheduler_cleanup_expired_otps`$$
CREATE PROCEDURE `sp_scheduler_cleanup_expired_otps`(IN p_cutoff_hours INT)
BEGIN
    IF p_cutoff_hours IS NULL OR p_cutoff_hours <= 0 THEN SET p_cutoff_hours = 1; END IF;
    DELETE FROM `otp_requests` WHERE `created_at` < (UTC_TIMESTAMP() - INTERVAL p_cutoff_hours HOUR);
    SELECT ROW_COUNT() AS deleted;
END$$

DELIMITER ;
