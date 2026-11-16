-- SKOVO stored procedures: Readiness Score Playbook v2.1
-- Journey Cards, readiness ledger, verification queue, Streak Points ledger,
-- the one day streak, weekly plans and the config change log.
-- Tables: database/migrations/migrate_v21_readiness_foundation.py
-- Engine:  portal/helpers/readiness_v21.py (the only writer of scores)

DELIMITER $$

-- ── settings ────────────────────────────────────────────────────────────────

DROP PROCEDURE IF EXISTS `sp_rv_settings_get`$$
CREATE PROCEDURE `sp_rv_settings_get`()
BEGIN
    INSERT IGNORE INTO readiness_settings (id) VALUES (1);
    SELECT * FROM readiness_settings WHERE id = 1;
END$$

-- p_json holds only the keys being changed; anything absent keeps its value.
DROP PROCEDURE IF EXISTS `sp_rv_settings_set`$$
CREATE PROCEDURE `sp_rv_settings_set`(IN p_json JSON, IN p_admin CHAR(36))
BEGIN
    UPDATE readiness_settings SET
        v21_enabled              = IFNULL(JSON_EXTRACT(p_json, '$.v21_enabled'), v21_enabled),
        earned_max               = IFNULL(JSON_EXTRACT(p_json, '$.earned_max'), earned_max),
        completion_max           = IFNULL(JSON_EXTRACT(p_json, '$.completion_max'), completion_max),
        monthly_cap              = IFNULL(JSON_EXTRACT(p_json, '$.monthly_cap'), monthly_cap),
        cap_months               = IFNULL(JSON_EXTRACT(p_json, '$.cap_months'), cap_months),
        unlock_score             = IFNULL(JSON_EXTRACT(p_json, '$.unlock_score'), unlock_score),
        premium_score            = IFNULL(JSON_EXTRACT(p_json, '$.premium_score'), premium_score),
        boost_threshold          = IFNULL(JSON_EXTRACT(p_json, '$.boost_threshold'), boost_threshold),
        boost_bands              = IFNULL(JSON_EXTRACT(p_json, '$.boost_bands'), boost_bands),
        max_action_points        = IFNULL(JSON_EXTRACT(p_json, '$.max_action_points'), max_action_points),
        max_employer_points      = IFNULL(JSON_EXTRACT(p_json, '$.max_employer_points'), max_employer_points),
        active_ready_days        = IFNULL(JSON_EXTRACT(p_json, '$.active_ready_days'), active_ready_days),
        verify_hours             = IFNULL(JSON_EXTRACT(p_json, '$.verify_hours'), verify_hours),
        escalate_hours           = IFNULL(JSON_EXTRACT(p_json, '$.escalate_hours'), escalate_hours),
        correction_approval_over = IFNULL(JSON_EXTRACT(p_json, '$.correction_approval_over'), correction_approval_over),
        grace_days               = IFNULL(JSON_EXTRACT(p_json, '$.grace_days'), grace_days),
        skill_card_months        = IFNULL(JSON_EXTRACT(p_json, '$.skill_card_months'), skill_card_months),
        promotion_on             = IFNULL(JSON_UNQUOTE(JSON_EXTRACT(p_json, '$.promotion_on')), promotion_on),
        pass_mark                = IFNULL(JSON_EXTRACT(p_json, '$.pass_mark'), pass_mark),
        ai_weight                = IFNULL(JSON_EXTRACT(p_json, '$.ai_weight'), ai_weight),
        config_version           = config_version + 1,
        updated_by               = p_admin
     WHERE id = 1;
    SELECT * FROM readiness_settings WHERE id = 1;
END$$

DROP PROCEDURE IF EXISTS `sp_spv_settings_get`$$
CREATE PROCEDURE `sp_spv_settings_get`()
BEGIN
    SELECT * FROM sp_settings WHERE id = 1;
END$$

DROP PROCEDURE IF EXISTS `sp_spv_settings_set`$$
CREATE PROCEDURE `sp_spv_settings_set`(IN p_json JSON, IN p_admin CHAR(36))
BEGIN
    UPDATE sp_settings SET
        streak_seconds      = IFNULL(JSON_EXTRACT(p_json, '$.streak_seconds'), streak_seconds),
        monthly_saves       = IFNULL(JSON_EXTRACT(p_json, '$.monthly_saves'), monthly_saves),
        pause_tokens_year   = IFNULL(JSON_EXTRACT(p_json, '$.pause_tokens_year'), pause_tokens_year),
        pause_days          = IFNULL(JSON_EXTRACT(p_json, '$.pause_days'), pause_days),
        exam_pause_cards    = IFNULL(JSON_EXTRACT(p_json, '$.exam_pause_cards'), exam_pause_cards),
        exam_days_around    = IFNULL(JSON_EXTRACT(p_json, '$.exam_days_around'), exam_days_around),
        reminder_hours      = IFNULL(JSON_EXTRACT(p_json, '$.reminder_hours'), reminder_hours),
        quiet_from          = IFNULL(JSON_EXTRACT(p_json, '$.quiet_from'), quiet_from),
        quiet_to            = IFNULL(JSON_EXTRACT(p_json, '$.quiet_to'), quiet_to),
        weekly_reset_dow    = IFNULL(JSON_EXTRACT(p_json, '$.weekly_reset_dow'), weekly_reset_dow),
        multiplier_steps    = IFNULL(JSON_EXTRACT(p_json, '$.multiplier_steps'), multiplier_steps),
        multiplier_on_bonus = IFNULL(JSON_EXTRACT(p_json, '$.multiplier_on_bonus'), multiplier_on_bonus),
        levels              = IFNULL(JSON_EXTRACT(p_json, '$.levels'), levels),
        milestones          = IFNULL(JSON_EXTRACT(p_json, '$.milestones'), milestones),
        board_top_n         = IFNULL(JSON_EXTRACT(p_json, '$.board_top_n'), board_top_n),
        config_version      = config_version + 1,
        updated_by          = p_admin
     WHERE id = 1;
    SELECT * FROM sp_settings WHERE id = 1;
END$$

-- ── config change log ───────────────────────────────────────────────────────

DROP PROCEDURE IF EXISTS `sp_rv_config_add`$$
CREATE PROCEDURE `sp_rv_config_add`(IN p_id CHAR(36), IN p_area VARCHAR(30), IN p_key VARCHAR(80),
    IN p_old JSON, IN p_new JSON, IN p_reason VARCHAR(500), IN p_effective DATETIME,
    IN p_status VARCHAR(12), IN p_impact JSON, IN p_admin CHAR(36))
BEGIN
    INSERT INTO config_versions (id, area, item_key, old_value, new_value, reason, effective_from,
                                 status, impact, created_by, approved_by, decided_at)
    VALUES (p_id, p_area, p_key, p_old, p_new, p_reason, IFNULL(p_effective, UTC_TIMESTAMP()),
            p_status, p_impact, p_admin,
            IF(p_status = 'applied', p_admin, NULL), IF(p_status = 'applied', UTC_TIMESTAMP(), NULL));
    SELECT * FROM config_versions WHERE id = p_id;
END$$

DROP PROCEDURE IF EXISTS `sp_rv_config_get`$$
CREATE PROCEDURE `sp_rv_config_get`(IN p_id CHAR(36))
BEGIN
    SELECT * FROM config_versions WHERE id = p_id;
END$$

DROP PROCEDURE IF EXISTS `sp_rv_config_list`$$
CREATE PROCEDURE `sp_rv_config_list`(IN p_area VARCHAR(30), IN p_status VARCHAR(12), IN p_limit INT)
BEGIN
    SET p_limit = IFNULL(p_limit, 100);
    SELECT cv.*, u.full_name AS created_by_name, a.full_name AS approved_by_name
      FROM config_versions cv
      LEFT JOIN users u ON u.id = cv.created_by
      LEFT JOIN users a ON a.id = cv.approved_by
     WHERE (p_area IS NULL OR p_area = '' OR cv.area = p_area)
       AND (p_status IS NULL OR p_status = '' OR cv.status = p_status)
     ORDER BY cv.created_at DESC
     LIMIT p_limit;
END$$

DROP PROCEDURE IF EXISTS `sp_rv_config_decide`$$
CREATE PROCEDURE `sp_rv_config_decide`(IN p_id CHAR(36), IN p_status VARCHAR(12), IN p_admin CHAR(36))
BEGIN
    UPDATE config_versions SET status = p_status, approved_by = p_admin, decided_at = UTC_TIMESTAMP()
     WHERE id = p_id;
    SELECT * FROM config_versions WHERE id = p_id;
END$$

-- Scheduled changes whose date has arrived.
DROP PROCEDURE IF EXISTS `sp_rv_config_due`$$
CREATE PROCEDURE `sp_rv_config_due`(IN p_now DATETIME)
BEGIN
    SELECT * FROM config_versions
     WHERE status = 'approved' AND effective_from <= p_now
     ORDER BY effective_from, created_at;
END$$

-- ── readiness points list, buckets, bands, grade conversion ─────────────────

DROP PROCEDURE IF EXISTS `sp_rv_actions_list`$$
CREATE PROCEDURE `sp_rv_actions_list`(IN p_card VARCHAR(30), IN p_active_only TINYINT)
BEGIN
    SELECT * FROM score_actions
     WHERE (p_card IS NULL OR p_card = '' OR JSON_CONTAINS(card_types, JSON_QUOTE(p_card)))
       AND (IFNULL(p_active_only, 0) = 0 OR is_active = 1)
     ORDER BY sort_order, label;
END$$

DROP PROCEDURE IF EXISTS `sp_rv_action_get`$$
CREATE PROCEDURE `sp_rv_action_get`(IN p_key VARCHAR(50))
BEGIN
    SELECT * FROM score_actions WHERE action_key = p_key;
END$$

DROP PROCEDURE IF EXISTS `sp_rv_action_upsert`$$
CREATE PROCEDURE `sp_rv_action_upsert`(IN p_key VARCHAR(50), IN p_label VARCHAR(160), IN p_evidence VARCHAR(255),
    IN p_cards JSON, IN p_pillar VARCHAR(10), IN p_points INT, IN p_bonus INT, IN p_bonus_min INT,
    IN p_limit_type VARCHAR(12), IN p_limit_value INT, IN p_checked_by VARCHAR(20), IN p_employer TINYINT,
    IN p_sort INT, IN p_active TINYINT, IN p_admin CHAR(36))
BEGIN
    INSERT INTO score_actions (action_key, label, evidence, card_types, pillar, points, bonus_points, bonus_min_mark,
                               limit_type, limit_value, checked_by, is_employer, sort_order, is_active, updated_by)
    VALUES (p_key, p_label, p_evidence, p_cards, p_pillar, p_points, p_bonus, p_bonus_min, p_limit_type,
            p_limit_value, p_checked_by, IFNULL(p_employer, 0), IFNULL(p_sort, 0), IFNULL(p_active, 1), p_admin)
    ON DUPLICATE KEY UPDATE label = p_label, evidence = p_evidence, card_types = p_cards, pillar = p_pillar,
        points = p_points, bonus_points = p_bonus, bonus_min_mark = p_bonus_min, limit_type = p_limit_type,
        limit_value = p_limit_value, checked_by = p_checked_by, is_employer = IFNULL(p_employer, 0),
        sort_order = IFNULL(p_sort, sort_order), is_active = IFNULL(p_active, is_active), updated_by = p_admin;
    SELECT * FROM score_actions WHERE action_key = p_key;
END$$

DROP PROCEDURE IF EXISTS `sp_rv_buckets_list`$$
CREATE PROCEDURE `sp_rv_buckets_list`()
BEGIN
    SELECT * FROM card_pillar_config ORDER BY FIELD(card_type, 'class10', 'inter', 'degree_foundation',
           'degree_readiness', 'skill'), FIELD(pillar, 'clarity', 'skill', 'proof');
END$$

DROP PROCEDURE IF EXISTS `sp_rv_bucket_set`$$
CREATE PROCEDURE `sp_rv_bucket_set`(IN p_card VARCHAR(30), IN p_pillar VARCHAR(10), IN p_size INT)
BEGIN
    INSERT INTO card_pillar_config (card_type, pillar, bucket_size) VALUES (p_card, p_pillar, p_size)
    ON DUPLICATE KEY UPDATE bucket_size = p_size;
    SELECT * FROM card_pillar_config WHERE card_type = p_card AND pillar = p_pillar;
END$$

DROP PROCEDURE IF EXISTS `sp_rv_bands_list`$$
CREATE PROCEDURE `sp_rv_bands_list`()
BEGIN
    SELECT * FROM completion_bands ORDER BY sort_order;
END$$

DROP PROCEDURE IF EXISTS `sp_rv_band_set`$$
CREATE PROCEDURE `sp_rv_band_set`(IN p_band VARCHAR(12), IN p_label VARCHAR(40), IN p_min DECIMAL(5,2),
    IN p_grades JSON, IN p_points INT, IN p_pending TINYINT, IN p_sort INT)
BEGIN
    INSERT INTO completion_bands (band, label, min_percent, university_grades, points, is_pending, sort_order)
    VALUES (p_band, p_label, p_min, p_grades, p_points, IFNULL(p_pending, 0), p_sort)
    ON DUPLICATE KEY UPDATE label = p_label, min_percent = p_min, university_grades = p_grades,
        points = p_points, is_pending = IFNULL(p_pending, 0), sort_order = p_sort;
    SELECT * FROM completion_bands WHERE band = p_band;
END$$

DROP PROCEDURE IF EXISTS `sp_rv_grades_list`$$
CREATE PROCEDURE `sp_rv_grades_list`()
BEGIN
    SELECT * FROM grade_conversion ORDER BY board_or_university, raw_grade;
END$$

DROP PROCEDURE IF EXISTS `sp_rv_grade_upsert`$$
CREATE PROCEDURE `sp_rv_grade_upsert`(IN p_id CHAR(36), IN p_board VARCHAR(120), IN p_raw VARCHAR(30),
    IN p_band VARCHAR(12))
BEGIN
    INSERT INTO grade_conversion (id, board_or_university, raw_grade, band) VALUES (p_id, p_board, p_raw, p_band)
    ON DUPLICATE KEY UPDATE band = p_band;
    SELECT * FROM grade_conversion WHERE board_or_university = p_board AND raw_grade = p_raw;
END$$

DROP PROCEDURE IF EXISTS `sp_rv_grade_delete`$$
CREATE PROCEDURE `sp_rv_grade_delete`(IN p_id CHAR(36))
BEGIN
    DELETE FROM grade_conversion WHERE id = p_id;
    SELECT ROW_COUNT() AS affected;
END$$

-- ── Journey Cards ───────────────────────────────────────────────────────────

DROP PROCEDURE IF EXISTS `sp_rv_card_active`$$
CREATE PROCEDURE `sp_rv_card_active`(IN p_user CHAR(36))
BEGIN
    SELECT * FROM student_stages
     WHERE user_id = p_user AND status = 'active' AND card_type IS NOT NULL
     ORDER BY started_at DESC LIMIT 1;
END$$

DROP PROCEDURE IF EXISTS `sp_rv_card_get`$$
CREATE PROCEDURE `sp_rv_card_get`(IN p_id CHAR(36))
BEGIN
    SELECT * FROM student_stages WHERE id = p_id;
END$$

DROP PROCEDURE IF EXISTS `sp_rv_cards_for_user`$$
CREATE PROCEDURE `sp_rv_cards_for_user`(IN p_user CHAR(36))
BEGIN
    SELECT * FROM student_stages
     WHERE user_id = p_user AND card_type IS NOT NULL
     ORDER BY started_at DESC;
END$$

DROP PROCEDURE IF EXISTS `sp_rv_card_set_type`$$
CREATE PROCEDURE `sp_rv_card_set_type`(IN p_id CHAR(36), IN p_card VARCHAR(30), IN p_kind VARCHAR(12),
    IN p_expires DATETIME)
BEGIN
    UPDATE student_stages SET card_type = p_card, card_kind = IFNULL(p_kind, card_kind),
           expires_at = IFNULL(p_expires, expires_at)
     WHERE id = p_id;
    SELECT * FROM student_stages WHERE id = p_id;
END$$

-- A past-result card: an earlier stage the student never worked on in Skovo.
DROP PROCEDURE IF EXISTS `sp_rv_card_add_past`$$
CREATE PROCEDURE `sp_rv_card_add_past`(IN p_id CHAR(36), IN p_user CHAR(36), IN p_card VARCHAR(30),
    IN p_group VARCHAR(20))
BEGIN
    INSERT INTO student_stages (id, user_id, stage_group, status, started_at, counts_from, ended_at,
                                card_type, card_kind)
    SELECT p_id, p_user, p_group, 'closed', UTC_TIMESTAMP(), UTC_TIMESTAMP(), UTC_TIMESTAMP(), p_card, 'past_result'
      FROM DUAL
     WHERE NOT EXISTS (SELECT 1 FROM student_stages WHERE user_id = p_user AND card_type = p_card);
    SELECT * FROM student_stages WHERE user_id = p_user AND card_type = p_card ORDER BY started_at DESC LIMIT 1;
END$$

DROP PROCEDURE IF EXISTS `sp_rv_card_save`$$
CREATE PROCEDURE `sp_rv_card_save`(IN p_id CHAR(36), IN p_earned DECIMAL(5,2), IN p_status VARCHAR(12),
    IN p_band VARCHAR(12), IN p_boost TINYINT, IN p_completion INT, IN p_doc CHAR(36))
BEGIN
    UPDATE student_stages SET
        earned_score      = IFNULL(p_earned, earned_score),
        completion_status = IFNULL(p_status, completion_status),
        result_band       = IFNULL(p_band, result_band),
        boost_applied     = IFNULL(p_boost, boost_applied),
        completion_points = IFNULL(p_completion, completion_points),
        result_doc_id     = IFNULL(p_doc, result_doc_id)
     WHERE id = p_id;
    UPDATE student_stages SET card_score = LEAST(100, earned_score + completion_points) WHERE id = p_id;
    SELECT * FROM student_stages WHERE id = p_id;
END$$

-- Applied and saved (not yet released) points per pillar on one card.
DROP PROCEDURE IF EXISTS `sp_rv_card_pillars`$$
CREATE PROCEDURE `sp_rv_card_pillars`(IN p_card CHAR(36))
BEGIN
    SELECT pillar, IFNULL(SUM(IF(status = 'applied', points, 0)), 0) AS applied,
           IFNULL(SUM(IF(status = 'saved', points, 0)), 0) AS saved
      FROM score_events
     WHERE card_id = p_card AND status IN ('applied', 'saved') AND pillar IS NOT NULL
     GROUP BY pillar;
END$$

-- Points applied in one window (a card month). A released saved row counts in
-- the month it was released, so release_at is its applied time.
DROP PROCEDURE IF EXISTS `sp_rv_card_window_points`$$
CREATE PROCEDURE `sp_rv_card_window_points`(IN p_card CHAR(36), IN p_from DATETIME, IN p_to DATETIME)
BEGIN
    SELECT IFNULL(SUM(points), 0) AS points FROM score_events
     WHERE card_id = p_card AND status = 'applied' AND pillar IS NOT NULL
       AND event_type <> 'correction'
       AND IFNULL(release_at, occurred_at) >= p_from AND IFNULL(release_at, occurred_at) < p_to;
END$$

DROP PROCEDURE IF EXISTS `sp_rv_card_saved_points`$$
CREATE PROCEDURE `sp_rv_card_saved_points`(IN p_card CHAR(36))
BEGIN
    SELECT IFNULL(SUM(points), 0) AS points, MIN(release_at) AS next_release FROM score_events
     WHERE card_id = p_card AND status = 'saved';
END$$

-- How many times an action has counted on a card since a date (limits).
DROP PROCEDURE IF EXISTS `sp_rv_card_action_count`$$
CREATE PROCEDURE `sp_rv_card_action_count`(IN p_card CHAR(36), IN p_key VARCHAR(50), IN p_since DATETIME)
BEGIN
    SELECT COUNT(*) AS n FROM score_events
     WHERE card_id = p_card AND event_type = p_key AND status IN ('applied', 'saved', 'capped')
       AND occurred_at >= IFNULL(p_since, '1970-01-01');
END$$

DROP PROCEDURE IF EXISTS `sp_rv_event_add`$$
CREATE PROCEDURE `sp_rv_event_add`(IN p_id CHAR(36), IN p_user CHAR(36), IN p_card CHAR(36), IN p_key VARCHAR(50),
    IN p_pillar VARCHAR(10), IN p_points INT, IN p_status VARCHAR(10), IN p_release DATETIME, IN p_ref VARCHAR(64),
    IN p_verification CHAR(36), IN p_source VARCHAR(12), IN p_actor CHAR(36), IN p_version INT, IN p_meta TEXT)
BEGIN
    INSERT IGNORE INTO score_events (id, user_id, card_id, event_type, pillar, points, status, release_at, ref_id,
                                     verification_id, source, actor_id, config_version, meta, occurred_at)
    VALUES (p_id, p_user, p_card, p_key, p_pillar, p_points, p_status, p_release, p_ref, p_verification,
            p_source, p_actor, p_version, p_meta, UTC_TIMESTAMP());
    SELECT ROW_COUNT() AS inserted;
END$$

DROP PROCEDURE IF EXISTS `sp_rv_events_due`$$
CREATE PROCEDURE `sp_rv_events_due`(IN p_now DATETIME)
BEGIN
    SELECT * FROM score_events WHERE status = 'saved' AND release_at <= p_now
     ORDER BY card_id, release_at, seq;
END$$

DROP PROCEDURE IF EXISTS `sp_rv_event_settle`$$
CREATE PROCEDURE `sp_rv_event_settle`(IN p_id CHAR(36), IN p_points INT, IN p_status VARCHAR(10),
    IN p_release DATETIME)
BEGIN
    UPDATE score_events SET points = p_points, status = p_status, release_at = p_release WHERE id = p_id;
    SELECT * FROM score_events WHERE id = p_id;
END$$

DROP PROCEDURE IF EXISTS `sp_rv_card_history`$$
CREATE PROCEDURE `sp_rv_card_history`(IN p_card CHAR(36), IN p_limit INT)
BEGIN
    SET p_limit = IFNULL(p_limit, 100);
    SELECT se.id, se.event_type, IFNULL(sa.label, se.event_type) AS label, se.pillar, se.points, se.status,
           se.release_at, se.source, se.occurred_at
      FROM score_events se
      LEFT JOIN score_actions sa ON sa.action_key = se.event_type
     WHERE se.card_id = p_card
     ORDER BY se.occurred_at DESC, se.seq DESC
     LIMIT p_limit;
END$$

DROP PROCEDURE IF EXISTS `sp_rv_last_checked_work`$$
CREATE PROCEDURE `sp_rv_last_checked_work`(IN p_user CHAR(36))
BEGIN
    SELECT MAX(occurred_at) AS at FROM score_events
     WHERE user_id = p_user AND card_id IS NOT NULL AND status IN ('applied', 'saved', 'capped')
       AND event_type NOT IN ('correction', 'completion');
END$$

-- ── Readiness Index / Active Ready ──────────────────────────────────────────

DROP PROCEDURE IF EXISTS `sp_rv_index_get`$$
CREATE PROCEDURE `sp_rv_index_get`(IN p_user CHAR(36))
BEGIN
    SELECT * FROM user_readiness WHERE user_id = p_user;
END$$

DROP PROCEDURE IF EXISTS `sp_rv_index_set`$$
CREATE PROCEDURE `sp_rv_index_set`(IN p_user CHAR(36), IN p_card CHAR(36), IN p_index DECIMAL(5,2),
    IN p_active_ready TINYINT, IN p_last_work DATETIME)
BEGIN
    INSERT INTO user_readiness (user_id, active_card_id, readiness_index, active_ready, last_checked_work_at)
    VALUES (p_user, p_card, p_index, p_active_ready, p_last_work)
    ON DUPLICATE KEY UPDATE active_card_id = p_card, readiness_index = p_index,
        active_ready = p_active_ready, last_checked_work_at = p_last_work;
    SELECT * FROM user_readiness WHERE user_id = p_user;
END$$

-- Active Ready = earned 60+ on the active card and checked work in the window.
DROP PROCEDURE IF EXISTS `sp_rv_active_ready_recalc`$$
CREATE PROCEDURE `sp_rv_active_ready_recalc`(IN p_days INT, IN p_unlock INT)
BEGIN
    UPDATE user_readiness ur
      JOIN student_stages st ON st.id = ur.active_card_id
       SET ur.active_ready = IF(st.earned_score >= p_unlock
                                AND ur.last_checked_work_at >= UTC_TIMESTAMP() - INTERVAL p_days DAY, 1, 0);
    SELECT ROW_COUNT() AS affected;
END$$

-- ── verification queue ──────────────────────────────────────────────────────

DROP PROCEDURE IF EXISTS `sp_rv_verif_create`$$
CREATE PROCEDURE `sp_rv_verif_create`(IN p_id CHAR(36), IN p_user CHAR(36), IN p_card CHAR(36),
    IN p_key VARCHAR(50), IN p_kind VARCHAR(12), IN p_doc CHAR(36), IN p_url VARCHAR(500), IN p_note VARCHAR(500),
    IN p_route VARCHAR(12), IN p_idem VARCHAR(80), IN p_auto JSON)
BEGIN
    INSERT IGNORE INTO verification_requests (id, user_id, card_id, action_key, kind, evidence_doc_id,
                                              evidence_url, note, route_to, idempotency_key, auto_check)
    VALUES (p_id, p_user, p_card, p_key, p_kind, p_doc, p_url, p_note, p_route, p_idem, p_auto);
    SELECT * FROM verification_requests WHERE idempotency_key = p_idem;
END$$

DROP PROCEDURE IF EXISTS `sp_rv_verif_get`$$
CREATE PROCEDURE `sp_rv_verif_get`(IN p_id CHAR(36))
BEGIN
    SELECT * FROM verification_requests WHERE id = p_id;
END$$

DROP PROCEDURE IF EXISTS `sp_rv_verif_queue`$$
CREATE PROCEDURE `sp_rv_verif_queue`(IN p_status VARCHAR(12), IN p_route VARCHAR(12), IN p_kind VARCHAR(12),
    IN p_limit INT, IN p_offset INT)
BEGIN
    SET p_limit = IFNULL(p_limit, 50);
    SET p_offset = IFNULL(p_offset, 0);
    SELECT vr.*, u.full_name AS student_name, st.card_type, st.sub_year,
           IFNULL(sa.label, vr.action_key) AS action_label, sa.pillar, sa.points AS action_points,
           TIMESTAMPDIFF(HOUR, vr.created_at, UTC_TIMESTAMP()) AS age_hours
      FROM verification_requests vr
      JOIN users u ON u.id = vr.user_id
      LEFT JOIN student_stages st ON st.id = vr.card_id
      LEFT JOIN score_actions sa ON sa.action_key = vr.action_key
     WHERE (p_status IS NULL OR p_status = '' OR vr.status = p_status)
       AND (p_route IS NULL OR p_route = '' OR vr.route_to = p_route)
       AND (p_kind IS NULL OR p_kind = '' OR vr.kind = p_kind)
     ORDER BY vr.created_at
     LIMIT p_limit OFFSET p_offset;
END$$

DROP PROCEDURE IF EXISTS `sp_rv_verif_count`$$
CREATE PROCEDURE `sp_rv_verif_count`()
BEGIN
    SELECT route_to, kind, COUNT(*) AS n,
           SUM(TIMESTAMPDIFF(HOUR, created_at, UTC_TIMESTAMP()) >= 36) AS overdue
      FROM verification_requests WHERE status = 'pending'
     GROUP BY route_to, kind;
END$$

DROP PROCEDURE IF EXISTS `sp_rv_verif_decide`$$
CREATE PROCEDURE `sp_rv_verif_decide`(IN p_id CHAR(36), IN p_status VARCHAR(12), IN p_reviewer CHAR(36),
    IN p_mark INT, IN p_feedback VARCHAR(500), IN p_reason VARCHAR(255))
BEGIN
    UPDATE verification_requests
       SET status = p_status, reviewer_id = p_reviewer, mark = p_mark, feedback = p_feedback,
           reason = p_reason, decided_at = UTC_TIMESTAMP()
     WHERE id = p_id AND status IN ('pending', 'held');
    SELECT ROW_COUNT() AS updated, vr.* FROM verification_requests vr WHERE vr.id = p_id;
END$$

DROP PROCEDURE IF EXISTS `sp_rv_verif_for_user`$$
CREATE PROCEDURE `sp_rv_verif_for_user`(IN p_user CHAR(36), IN p_limit INT)
BEGIN
    SET p_limit = IFNULL(p_limit, 50);
    SELECT vr.id, vr.action_key, IFNULL(sa.label, vr.action_key) AS action_label, vr.kind, vr.status,
           vr.mark, vr.feedback, vr.reason, vr.created_at, vr.decided_at
      FROM verification_requests vr
      LEFT JOIN score_actions sa ON sa.action_key = vr.action_key
     WHERE vr.user_id = p_user
     ORDER BY vr.created_at DESC
     LIMIT p_limit;
END$$

-- ── Streak Points ───────────────────────────────────────────────────────────

DROP PROCEDURE IF EXISTS `sp_spv_actions_list`$$
CREATE PROCEDURE `sp_spv_actions_list`()
BEGIN
    SELECT * FROM sp_actions ORDER BY sort_order, label;
END$$

DROP PROCEDURE IF EXISTS `sp_spv_action_get`$$
CREATE PROCEDURE `sp_spv_action_get`(IN p_key VARCHAR(50))
BEGIN
    SELECT * FROM sp_actions WHERE sp_action = p_key;
END$$

DROP PROCEDURE IF EXISTS `sp_spv_action_upsert`$$
CREATE PROCEDURE `sp_spv_action_upsert`(IN p_key VARCHAR(50), IN p_label VARCHAR(160), IN p_points INT,
    IN p_limit_type VARCHAR(12), IN p_limit_value INT, IN p_mult TINYINT, IN p_sort INT, IN p_active TINYINT,
    IN p_admin CHAR(36))
BEGIN
    INSERT INTO sp_actions (sp_action, label, points, limit_type, limit_value, multiplier_applies, sort_order,
                            is_active, updated_by)
    VALUES (p_key, p_label, p_points, p_limit_type, p_limit_value, IFNULL(p_mult, 1), IFNULL(p_sort, 0),
            IFNULL(p_active, 1), p_admin)
    ON DUPLICATE KEY UPDATE label = p_label, points = p_points, limit_type = p_limit_type,
        limit_value = p_limit_value, multiplier_applies = IFNULL(p_mult, multiplier_applies),
        sort_order = IFNULL(p_sort, sort_order), is_active = IFNULL(p_active, is_active), updated_by = p_admin;
    SELECT * FROM sp_actions WHERE sp_action = p_key;
END$$

DROP PROCEDURE IF EXISTS `sp_spv_action_count`$$
CREATE PROCEDURE `sp_spv_action_count`(IN p_user CHAR(36), IN p_key VARCHAR(50), IN p_from DATE, IN p_to DATE)
BEGIN
    SELECT COUNT(*) AS n FROM sp_events
     WHERE user_id = p_user AND sp_action = p_key
       AND day >= IFNULL(p_from, '1970-01-01') AND day <= IFNULL(p_to, '2999-12-31');
END$$

DROP PROCEDURE IF EXISTS `sp_spv_event_add`$$
CREATE PROCEDURE `sp_spv_event_add`(IN p_user CHAR(36), IN p_key VARCHAR(50), IN p_base INT,
    IN p_mult DECIMAL(4,2), IN p_points INT, IN p_card VARCHAR(30), IN p_community CHAR(36), IN p_day DATE,
    IN p_week DATE, IN p_ref VARCHAR(64), IN p_idem VARCHAR(120))
BEGIN
    INSERT IGNORE INTO sp_events (user_id, sp_action, base_points, multiplier, points, card_type, community_id,
                                  day, week_start, ref_id, idempotency_key)
    VALUES (p_user, p_key, p_base, p_mult, p_points, p_card, p_community, p_day, p_week, p_ref, p_idem);
    SELECT ROW_COUNT() AS inserted;
END$$

DROP PROCEDURE IF EXISTS `sp_spv_totals`$$
CREATE PROCEDURE `sp_spv_totals`(IN p_user CHAR(36), IN p_week DATE)
BEGIN
    SELECT IFNULL(SUM(points), 0) AS lifetime,
           IFNULL(SUM(IF(week_start = p_week, points, 0)), 0) AS weekly
      FROM sp_events WHERE user_id = p_user;
END$$

-- Weekly board: SP this week, optionally one Journey Card and/or one city.
DROP PROCEDURE IF EXISTS `sp_spv_board_weekly`$$
CREATE PROCEDURE `sp_spv_board_weekly`(IN p_week DATE, IN p_card VARCHAR(30), IN p_city VARCHAR(100), IN p_limit INT)
BEGIN
    SET p_limit = IFNULL(p_limit, 10);
    SELECT e.user_id, u.full_name, u.avatar_url, up.city, st.card_type, st.sub_year, st.stage_group,
           SUM(e.points) AS value, MAX(e.created_at) AS reached_at
      FROM sp_events e
      JOIN users u ON u.id = e.user_id
      LEFT JOIN user_profiles up ON up.user_id = e.user_id
      LEFT JOIN student_stages st ON st.user_id = e.user_id AND st.status = 'active'
     WHERE e.week_start = p_week
       AND (p_card IS NULL OR p_card = '' OR e.card_type = p_card)
       AND (p_city IS NULL OR p_city = '' OR up.city = p_city)
     GROUP BY e.user_id, u.full_name, u.avatar_url, up.city, st.card_type, st.sub_year, st.stage_group
     ORDER BY value DESC, reached_at ASC
     LIMIT p_limit;
END$$

DROP PROCEDURE IF EXISTS `sp_spv_rank_weekly`$$
CREATE PROCEDURE `sp_spv_rank_weekly`(IN p_user CHAR(36), IN p_week DATE, IN p_card VARCHAR(30), IN p_city VARCHAR(100))
BEGIN
    SELECT COUNT(*) + 1 AS `rank`, (SELECT IFNULL(SUM(points), 0) FROM sp_events
                                    WHERE user_id = p_user AND week_start = p_week) AS value
      FROM (SELECT e.user_id, SUM(e.points) AS v
              FROM sp_events e LEFT JOIN user_profiles up ON up.user_id = e.user_id
             WHERE e.week_start = p_week
               AND (p_card IS NULL OR p_card = '' OR e.card_type = p_card)
               AND (p_city IS NULL OR p_city = '' OR up.city = p_city)
             GROUP BY e.user_id) t
     WHERE t.v > (SELECT IFNULL(SUM(points), 0) FROM sp_events WHERE user_id = p_user AND week_start = p_week);
END$$

DROP PROCEDURE IF EXISTS `sp_spv_board_streak`$$
CREATE PROCEDURE `sp_spv_board_streak`(IN p_city VARCHAR(100), IN p_limit INT)
BEGIN
    SET p_limit = IFNULL(p_limit, 10);
    SELECT cs.user_id, u.full_name, u.avatar_url, up.city, st.card_type, st.sub_year, st.stage_group,
           cs.lifetime_current AS value
      FROM career_streaks cs
      JOIN users u ON u.id = cs.user_id
      LEFT JOIN user_profiles up ON up.user_id = cs.user_id
      LEFT JOIN student_stages st ON st.user_id = cs.user_id AND st.status = 'active'
     WHERE cs.lifetime_current > 0 AND (p_city IS NULL OR p_city = '' OR up.city = p_city)
     ORDER BY cs.lifetime_current DESC, cs.run_started_on ASC
     LIMIT p_limit;
END$$

-- Readiness board: earned points only (completion would reveal grades).
DROP PROCEDURE IF EXISTS `sp_spv_board_readiness`$$
CREATE PROCEDURE `sp_spv_board_readiness`(IN p_card VARCHAR(30), IN p_city VARCHAR(100), IN p_limit INT)
BEGIN
    SET p_limit = IFNULL(p_limit, 10);
    SELECT st.user_id, u.full_name, u.avatar_url, up.city, st.card_type, st.sub_year, st.stage_group,
           st.earned_score AS value
      FROM student_stages st
      JOIN users u ON u.id = st.user_id
      LEFT JOIN user_profiles up ON up.user_id = st.user_id
     WHERE st.status = 'active' AND st.card_type = p_card AND st.earned_score > 0
       AND (p_city IS NULL OR p_city = '' OR up.city = p_city)
     ORDER BY st.earned_score DESC, st.updated_at ASC
     LIMIT p_limit;
END$$

-- ── the one day streak ──────────────────────────────────────────────────────

DROP PROCEDURE IF EXISTS `sp_spv_streak_get`$$
CREATE PROCEDURE `sp_spv_streak_get`(IN p_user CHAR(36))
BEGIN
    INSERT IGNORE INTO career_streaks (user_id) VALUES (p_user);
    SELECT * FROM career_streaks WHERE user_id = p_user;
END$$

DROP PROCEDURE IF EXISTS `sp_spv_streak_save`$$
CREATE PROCEDURE `sp_spv_streak_save`(IN p_user CHAR(36), IN p_current INT, IN p_best INT, IN p_covered DATE,
    IN p_run_started DATE, IN p_save_month CHAR(7), IN p_tokens INT, IN p_tokens_year SMALLINT,
    IN p_paused_until DATE, IN p_pause_reason VARCHAR(20))
BEGIN
    UPDATE career_streaks SET lifetime_current = p_current, lifetime_best = GREATEST(lifetime_best, p_best),
           covered_through = p_covered, run_started_on = p_run_started, save_month = p_save_month,
           pause_tokens_left = p_tokens, pause_tokens_year = p_tokens_year, paused_until = p_paused_until,
           pause_reason = p_pause_reason
     WHERE user_id = p_user;
    SELECT * FROM career_streaks WHERE user_id = p_user;
END$$

DROP PROCEDURE IF EXISTS `sp_spv_streak_day_add`$$
CREATE PROCEDURE `sp_spv_streak_day_add`(IN p_user CHAR(36), IN p_day DATE, IN p_kind VARCHAR(10))
BEGIN
    INSERT INTO streak_days (user_id, day, kind, actions) VALUES (p_user, p_day, p_kind, 1)
    ON DUPLICATE KEY UPDATE actions = actions + 1;
    SELECT * FROM streak_days WHERE user_id = p_user AND day = p_day;
END$$

DROP PROCEDURE IF EXISTS `sp_spv_streak_days`$$
CREATE PROCEDURE `sp_spv_streak_days`(IN p_user CHAR(36), IN p_from DATE, IN p_to DATE)
BEGIN
    SELECT day, kind FROM streak_days WHERE user_id = p_user AND day BETWEEN p_from AND p_to ORDER BY day;
END$$

-- Streaks whose last covered day is before p_day: the nightly close settles them.
DROP PROCEDURE IF EXISTS `sp_spv_streak_open_runs`$$
CREATE PROCEDURE `sp_spv_streak_open_runs`(IN p_day DATE)
BEGIN
    SELECT cs.*, st.card_type FROM career_streaks cs
      LEFT JOIN student_stages st ON st.user_id = cs.user_id AND st.status = 'active'
     WHERE cs.lifetime_current > 0 AND (cs.covered_through IS NULL OR cs.covered_through < p_day);
END$$

DROP PROCEDURE IF EXISTS `sp_spv_exam_window_on`$$
CREATE PROCEDURE `sp_spv_exam_window_on`(IN p_day DATE, IN p_around INT)
BEGIN
    SELECT * FROM streak_exam_windows
     WHERE is_active = 1
       AND p_day BETWEEN start_date - INTERVAL IFNULL(p_around, 0) DAY AND end_date + INTERVAL IFNULL(p_around, 0) DAY;
END$$

-- ── weekly plan ─────────────────────────────────────────────────────────────

DROP PROCEDURE IF EXISTS `sp_rv_plan_get`$$
CREATE PROCEDURE `sp_rv_plan_get`(IN p_user CHAR(36), IN p_week DATE)
BEGIN
    SELECT * FROM weekly_plans WHERE user_id = p_user AND week_start = p_week;
END$$

DROP PROCEDURE IF EXISTS `sp_rv_plan_set`$$
CREATE PROCEDURE `sp_rv_plan_set`(IN p_user CHAR(36), IN p_week DATE, IN p_keys JSON, IN p_done JSON,
    IN p_bonus TINYINT)
BEGIN
    INSERT INTO weekly_plans (user_id, week_start, action_keys, completed, bonus_paid)
    VALUES (p_user, p_week, p_keys, p_done, IFNULL(p_bonus, 0))
    ON DUPLICATE KEY UPDATE action_keys = p_keys, completed = p_done, bonus_paid = IFNULL(p_bonus, bonus_paid);
    SELECT * FROM weekly_plans WHERE user_id = p_user AND week_start = p_week;
END$$

-- Students with an active card (weekly plan job, audit sample).
DROP PROCEDURE IF EXISTS `sp_rv_active_cards`$$
CREATE PROCEDURE `sp_rv_active_cards`(IN p_limit INT, IN p_offset INT)
BEGIN
    SET p_limit = IFNULL(p_limit, 1000);
    SET p_offset = IFNULL(p_offset, 0);
    SELECT id, user_id, card_type, started_at, expires_at FROM student_stages
     WHERE status = 'active' AND card_type IS NOT NULL
     ORDER BY id LIMIT p_limit OFFSET p_offset;
END$$

DROP PROCEDURE IF EXISTS `sp_rv_skill_cards_due`$$
CREATE PROCEDURE `sp_rv_skill_cards_due`(IN p_now DATETIME)
BEGIN
    SELECT id, user_id, expires_at, DATEDIFF(expires_at, p_now) AS days_left FROM student_stages
     WHERE status = 'active' AND card_type = 'skill' AND expires_at IS NOT NULL
       AND (expires_at <= p_now OR DATEDIFF(expires_at, p_now) IN (90, 30, 7));
END$$

DROP PROCEDURE IF EXISTS `sp_rv_card_close`$$
CREATE PROCEDURE `sp_rv_card_close`(IN p_id CHAR(36), IN p_status VARCHAR(12), IN p_admin CHAR(36),
    IN p_reason VARCHAR(255))
BEGIN
    UPDATE student_stages SET status = p_status, ended_at = IFNULL(ended_at, UTC_TIMESTAMP()),
           final_score = ROUND(card_score), closed_by = p_admin, close_reason = p_reason
     WHERE id = p_id;
    SELECT * FROM student_stages WHERE id = p_id;
END$$

DELIMITER ;
