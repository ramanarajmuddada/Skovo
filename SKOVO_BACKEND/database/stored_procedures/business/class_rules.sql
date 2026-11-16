-- Class-day rules: Start window, missed classes, End session, automatic close,
-- the complaint window, reminders and achiever strikes.
-- Tables come from database/migrations/migrate_class_rules.py.
--
-- Only classes created on or after class_rules.live_from follow the new rules;
-- older classes keep the old behaviour, so none is ever marked missed.
DELIMITER $$

-- ── Settings ────────────────────────────────────────────────────────────────
DROP PROCEDURE IF EXISTS `sp_class_rules_get`$$
CREATE PROCEDURE `sp_class_rules_get`()
BEGIN
    SELECT * FROM `class_rules` WHERE id = 1;
END$$

-- p: JSON of the fields to change; a key left out keeps its value.
DROP PROCEDURE IF EXISTS `sp_class_rules_save`$$
CREATE PROCEDURE `sp_class_rules_save`(IN p JSON, IN p_admin CHAR(36))
BEGIN
    UPDATE `class_rules` SET
        start_before_min   = COALESCE(JSON_EXTRACT(p, '$.start_before_min') + 0, start_before_min),
        start_after_min    = COALESCE(JSON_EXTRACT(p, '$.start_after_min') + 0, start_after_min),
        end_before_min     = COALESCE(JSON_EXTRACT(p, '$.end_before_min') + 0, end_before_min),
        auto_close_min     = COALESCE(JSON_EXTRACT(p, '$.auto_close_min') + 0, auto_close_min),
        release_hours      = COALESCE(JSON_EXTRACT(p, '$.release_hours') + 0, release_hours),
        change_lock_hours  = COALESCE(JSON_EXTRACT(p, '$.change_lock_hours') + 0, change_lock_hours),
        strike_missed      = COALESCE(JSON_EXTRACT(p, '$.strike_missed') + 0, strike_missed),
        strike_late_cancel = COALESCE(JSON_EXTRACT(p, '$.strike_late_cancel') + 0, strike_late_cancel),
        strike_left_early  = COALESCE(JSON_EXTRACT(p, '$.strike_left_early') + 0, strike_left_early),
        strike_pause_at    = COALESCE(JSON_EXTRACT(p, '$.strike_pause_at') + 0, strike_pause_at),
        strike_suspend_at  = COALESCE(JSON_EXTRACT(p, '$.strike_suspend_at') + 0, strike_suspend_at),
        strike_days        = COALESCE(JSON_EXTRACT(p, '$.strike_days') + 0, strike_days),
        reminders_on       = COALESCE(JSON_EXTRACT(p, '$.reminders_on') + 0, reminders_on),
        updated_by         = p_admin
     WHERE id = 1;
    SELECT * FROM `class_rules` WHERE id = 1;
END$$

-- ── Start / end marks ───────────────────────────────────────────────────────
DROP PROCEDURE IF EXISTS `sp_cohort_mark_started`$$
CREATE PROCEDURE `sp_cohort_mark_started`(IN p_cohort CHAR(36))
BEGIN
    UPDATE `cohorts`
       SET started_at = IFNULL(started_at, UTC_TIMESTAMP()),
           status = IF(status = 'upcoming', 'live', status),
           updated_at = UTC_TIMESTAMP()
     WHERE id = p_cohort;
    SELECT * FROM `cohorts` WHERE id = p_cohort;
END$$

DROP PROCEDURE IF EXISTS `sp_cohort_mark_ended`$$
CREATE PROCEDURE `sp_cohort_mark_ended`(IN p_cohort CHAR(36))
BEGIN
    UPDATE `cohorts` SET ended_at = IFNULL(ended_at, UTC_TIMESTAMP()) WHERE id = p_cohort;
END$$

DROP PROCEDURE IF EXISTS `sp_session_mark_started`$$
CREATE PROCEDURE `sp_session_mark_started`(IN p_session CHAR(36))
BEGIN
    UPDATE `achiever_sessions` SET started_at = IFNULL(started_at, UTC_TIMESTAMP()) WHERE id = p_session;
END$$

DROP PROCEDURE IF EXISTS `sp_session_mark_ended`$$
CREATE PROCEDURE `sp_session_mark_ended`(IN p_session CHAR(36))
BEGIN
    UPDATE `achiever_sessions` SET ended_at = IFNULL(ended_at, UTC_TIMESTAMP()) WHERE id = p_session;
END$$

DROP PROCEDURE IF EXISTS `sp_class_mark`$$
CREATE PROCEDURE `sp_class_mark`(IN p_kind VARCHAR(10), IN p_id CHAR(36), IN p_field VARCHAR(20), IN p_value VARCHAR(60))
BEGIN
    -- missed / rescheduled / reminders, one small writer for both kinds.
    IF p_kind = 'cohort' THEN
        IF p_field = 'missed' THEN
            UPDATE `cohorts` SET missed_at = UTC_TIMESTAMP(), status = 'cancelled', updated_at = UTC_TIMESTAMP() WHERE id = p_id;
        ELSEIF p_field = 'rescheduled' THEN
            UPDATE `cohorts` SET rescheduled_at = UTC_TIMESTAMP() WHERE id = p_id;
        ELSEIF p_field = 'reminders' THEN
            UPDATE `cohorts` SET reminders_sent = p_value WHERE id = p_id;
        END IF;
    ELSE
        IF p_field = 'missed' THEN
            UPDATE `achiever_sessions` SET missed_at = UTC_TIMESTAMP(), status = 'cancelled',
                   cancelled_at = IFNULL(cancelled_at, UTC_TIMESTAMP()) WHERE id = p_id;
        ELSEIF p_field = 'rescheduled' THEN
            UPDATE `achiever_sessions` SET rescheduled_at = UTC_TIMESTAMP() WHERE id = p_id;
        ELSEIF p_field = 'reminders' THEN
            UPDATE `achiever_sessions` SET reminders_sent = p_value WHERE id = p_id;
        END IF;
    END IF;
END$$

-- A 1-on-1 with its start and end in UTC (from its booked slot).
DROP PROCEDURE IF EXISTS `sp_session_with_times`$$
CREATE PROCEDURE `sp_session_with_times`(IN p_session CHAR(36))
BEGIN
    SELECT s.*,
           COALESCE(sl.start_utc,
                    DATE_SUB(TIMESTAMP(sl.slot_date, sl.start_time), INTERVAL 330 MINUTE)) AS start_utc,
           TIMESTAMPDIFF(MINUTE, sl.start_time, sl.end_time) AS duration_minutes
      FROM `achiever_sessions` s
      LEFT JOIN `achiever_slots` sl ON sl.session_id = s.id
        AND (s.proposed_slot_id IS NULL OR sl.id <> s.proposed_slot_id)
     WHERE s.id = p_session
     LIMIT 1;
END$$

-- ── The scheduler's lists (every minute) ────────────────────────────────────
-- Classes due a reminder, a missed mark or an automatic close.
DROP PROCEDURE IF EXISTS `sp_class_watch_cohorts`$$
CREATE PROCEDURE `sp_class_watch_cohorts`()
BEGIN
    DECLARE v_from DATETIME;
    DECLARE v_close INT;
    SELECT live_from, auto_close_min INTO v_from, v_close FROM `class_rules` WHERE id = 1;
    SELECT c.id, c.title, c.achiever_id, c.session_date, c.duration_minutes, c.status,
           c.started_at, c.ended_at, c.missed_at, c.reminders_sent, c.is_demo,
           (SELECT COUNT(*) FROM cohort_enrollments e
             WHERE e.cohort_id = c.id AND e.payment_status IN ('paid', 'free')) AS booked,
           (SELECT COUNT(*) FROM cohort_enrollments e
             WHERE e.cohort_id = c.id AND e.payment_status IN ('paid', 'free') AND e.attended = 1) AS attended
      FROM `cohorts` c
     WHERE c.deleted_at IS NULL
       AND c.created_at >= v_from
       AND c.status NOT IN ('cancelled', 'completed')
       AND c.session_date IS NOT NULL
       AND c.session_date <= UTC_TIMESTAMP() + INTERVAL 25 HOUR
       AND c.session_date >= UTC_TIMESTAMP() - INTERVAL 2 DAY;
END$$

DROP PROCEDURE IF EXISTS `sp_class_watch_sessions`$$
CREATE PROCEDURE `sp_class_watch_sessions`()
BEGIN
    DECLARE v_from DATETIME;
    SELECT live_from INTO v_from FROM `class_rules` WHERE id = 1;
    SELECT * FROM (
        SELECT s.id, s.mentor_id AS achiever_id, s.student_id, s.status, s.payment_status,
               s.payment_order_id, s.amount, s.is_demo,
               s.started_at, s.ended_at, s.missed_at, s.reminders_sent,
               COALESCE(sl.start_utc,
                        DATE_SUB(TIMESTAMP(sl.slot_date, sl.start_time), INTERVAL 330 MINUTE)) AS start_utc,
               TIMESTAMPDIFF(MINUTE, sl.start_time, sl.end_time) AS duration_minutes
          FROM `achiever_sessions` s
          JOIN `achiever_slots` sl ON sl.session_id = s.id
            AND (s.proposed_slot_id IS NULL OR sl.id <> s.proposed_slot_id)
         WHERE s.created_at >= v_from
           AND s.status = 'confirmed'
    ) t
     WHERE t.start_utc <= UTC_TIMESTAMP() + INTERVAL 25 HOUR
       AND t.start_utc >= UTC_TIMESTAMP() - INTERVAL 2 DAY;
END$$

-- ── Strikes ─────────────────────────────────────────────────────────────────
-- One strike per reason per class; returns the achiever's points and state.
DROP PROCEDURE IF EXISTS `sp_achiever_strike_add`$$
CREATE PROCEDURE `sp_achiever_strike_add`(
    IN p_achiever CHAR(36), IN p_reason VARCHAR(30), IN p_points INT,
    IN p_source_type VARCHAR(20), IN p_source_id CHAR(36), IN p_note VARCHAR(500), IN p_by CHAR(36))
BEGIN
    IF p_points > 0 AND NOT EXISTS (
        SELECT 1 FROM `achiever_strikes`
         WHERE achiever_id = p_achiever AND reason = p_reason AND removed_at IS NULL
           AND IFNULL(source_id, '') = IFNULL(p_source_id, '')) THEN
        INSERT INTO `achiever_strikes` (id, achiever_id, reason, points, source_type, source_id, note, created_by)
        VALUES (UUID(), p_achiever, p_reason, p_points, p_source_type, p_source_id, p_note, p_by);
    END IF;
    CALL sp_achiever_strike_points(p_achiever);
END$$

DROP PROCEDURE IF EXISTS `sp_achiever_strike_points`$$
CREATE PROCEDURE `sp_achiever_strike_points`(IN p_achiever CHAR(36))
BEGIN
    DECLARE v_days INT;
    SELECT strike_days INTO v_days FROM `class_rules` WHERE id = 1;
    SELECT IFNULL(SUM(s.points), 0) AS points,
           (SELECT state FROM `achievers` WHERE id = p_achiever) AS state,
           (SELECT classes_paused_at FROM `achievers` WHERE id = p_achiever) AS paused_at
      FROM `achiever_strikes` s
     WHERE s.achiever_id = p_achiever AND s.removed_at IS NULL
       AND s.created_at >= UTC_TIMESTAMP() - INTERVAL IFNULL(v_days, 30) DAY;
END$$

DROP PROCEDURE IF EXISTS `sp_achiever_set_paused`$$
CREATE PROCEDURE `sp_achiever_set_paused`(IN p_achiever CHAR(36), IN p_paused TINYINT)
BEGIN
    UPDATE `achievers`
       SET classes_paused_at = IF(p_paused = 1, IFNULL(classes_paused_at, UTC_TIMESTAMP()), NULL)
     WHERE id = p_achiever;
END$$

DROP PROCEDURE IF EXISTS `sp_achiever_strike_remove`$$
CREATE PROCEDURE `sp_achiever_strike_remove`(IN p_id CHAR(36), IN p_admin CHAR(36), IN p_note VARCHAR(500))
BEGIN
    UPDATE `achiever_strikes`
       SET removed_at = UTC_TIMESTAMP(), removed_by = p_admin, removed_note = p_note
     WHERE id = p_id AND removed_at IS NULL;
    SELECT achiever_id FROM `achiever_strikes` WHERE id = p_id;
END$$

-- Admin: achievers with strikes in the window, or paused.
DROP PROCEDURE IF EXISTS `sp_admin_strikes_list`$$
CREATE PROCEDURE `sp_admin_strikes_list`()
BEGIN
    DECLARE v_days INT;
    SELECT strike_days INTO v_days FROM `class_rules` WHERE id = 1;
    SELECT s.id, s.achiever_id, a.full_name AS achiever_name, a.state, a.classes_paused_at,
           s.reason, s.points, s.source_type, s.source_id, s.note, s.created_at,
           s.removed_at, s.removed_note,
           (s.removed_at IS NULL AND s.created_at >= UTC_TIMESTAMP() - INTERVAL IFNULL(v_days, 30) DAY) AS counts
      FROM `achiever_strikes` s
      LEFT JOIN `achievers` a ON a.id = s.achiever_id
     WHERE s.created_at >= UTC_TIMESTAMP() - INTERVAL 120 DAY
     ORDER BY s.created_at DESC
     LIMIT 500;
END$$

DROP PROCEDURE IF EXISTS `sp_admin_paused_achievers`$$
CREATE PROCEDURE `sp_admin_paused_achievers`()
BEGIN
    SELECT id AS achiever_id, full_name AS achiever_name, state, classes_paused_at
      FROM `achievers` WHERE classes_paused_at IS NOT NULL ORDER BY classes_paused_at DESC;
END$$

-- ── Class issues (complaints, classes with no check-ins, missed classes) ────
DROP PROCEDURE IF EXISTS `sp_class_issue_add`$$
CREATE PROCEDURE `sp_class_issue_add`(
    IN p_kind VARCHAR(20), IN p_source_type VARCHAR(20), IN p_source_id CHAR(36), IN p_booking CHAR(36),
    IN p_achiever CHAR(36), IN p_student CHAR(36), IN p_reason VARCHAR(1000), IN p_status VARCHAR(20))
BEGIN
    IF NOT EXISTS (SELECT 1 FROM `class_issues`
                    WHERE kind = p_kind AND source_id = p_source_id
                      AND IFNULL(booking_id, '') = IFNULL(p_booking, '') AND status = 'open') THEN
        INSERT INTO `class_issues` (id, kind, source_type, source_id, booking_id, achiever_id, student_id, reason, status)
        VALUES (UUID(), p_kind, p_source_type, p_source_id, p_booking, p_achiever, p_student, p_reason, p_status);
    END IF;
    -- A complaint keeps the money back while admin checks it.
    IF p_status = 'open' THEN
        IF p_source_type = 'cohort' THEN
            UPDATE `cohort_enrollments` SET earning_hold = 1
             WHERE cohort_id = p_source_id AND (p_booking IS NULL OR id = p_booking);
        ELSE
            UPDATE `achiever_sessions` SET earning_hold = 1 WHERE id = p_source_id;
        END IF;
    END IF;
END$$

DROP PROCEDURE IF EXISTS `sp_admin_class_issues`$$
CREATE PROCEDURE `sp_admin_class_issues`()
BEGIN
    SELECT i.*, a.full_name AS achiever_name, u.full_name AS student_name, u.email AS student_email,
           COALESCE(c.title, '1-on-1 session') AS class_title,
           COALESCE(c.session_date, NULL) AS session_date,
           COALESCE(c.started_at, s.started_at) AS started_at,
           COALESCE(c.ended_at, s.ended_at) AS ended_at,
           CASE WHEN i.source_type = 'cohort' THEN
                (SELECT COUNT(*) FROM cohort_enrollments e WHERE e.cohort_id = i.source_id
                    AND e.payment_status IN ('paid', 'free') AND e.attended = 1) END AS checked_in,
           CASE WHEN i.source_type = 'cohort' THEN
                (SELECT COUNT(*) FROM cohort_enrollments e WHERE e.cohort_id = i.source_id
                    AND e.payment_status IN ('paid', 'free')) ELSE 1 END AS booked
      FROM `class_issues` i
      LEFT JOIN `achievers` a ON a.id = i.achiever_id
      LEFT JOIN `users` u ON u.id = i.student_id
      LEFT JOIN `cohorts` c ON i.source_type = 'cohort' AND c.id = i.source_id
      LEFT JOIN `achiever_sessions` s ON i.source_type = 'session' AND s.id = i.source_id
     WHERE i.status = 'open' OR i.created_at >= UTC_TIMESTAMP() - INTERVAL 30 DAY
     ORDER BY (i.status = 'open') DESC, i.created_at DESC
     LIMIT 300;
END$$

DROP PROCEDURE IF EXISTS `sp_class_issue_get`$$
CREATE PROCEDURE `sp_class_issue_get`(IN p_id CHAR(36))
BEGIN
    SELECT * FROM `class_issues` WHERE id = p_id;
END$$

-- Release: the held money goes to the achiever (the 24 hours still apply).
DROP PROCEDURE IF EXISTS `sp_class_issue_resolve`$$
CREATE PROCEDURE `sp_class_issue_resolve`(IN p_id CHAR(36), IN p_status VARCHAR(20), IN p_admin CHAR(36), IN p_note VARCHAR(500))
BEGIN
    DECLARE v_type VARCHAR(20); DECLARE v_src CHAR(36); DECLARE v_booking CHAR(36);
    SELECT source_type, source_id, booking_id INTO v_type, v_src, v_booking FROM `class_issues` WHERE id = p_id;
    UPDATE `class_issues`
       SET status = p_status, resolved_at = UTC_TIMESTAMP(), resolved_by = p_admin, resolution = p_note
     WHERE id = p_id;
    IF v_type = 'cohort' THEN
        UPDATE `cohort_enrollments` SET earning_hold = 0
         WHERE cohort_id = v_src AND (v_booking IS NULL OR id = v_booking)
           AND NOT EXISTS (SELECT 1 FROM `class_issues` o WHERE o.status = 'open' AND o.source_id = v_src
                            AND (o.booking_id IS NULL OR o.booking_id = cohort_enrollments.id));
    ELSE
        UPDATE `achiever_sessions` SET earning_hold = 0 WHERE id = v_src;
    END IF;
END$$

DELIMITER ;
