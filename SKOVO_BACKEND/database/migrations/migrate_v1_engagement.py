"""Daily engagement, Duolingo-style (feature-updates.md §7). No AI.

Every feature here is OFF (engagement_settings) and every reward is 0 until an
admin switches it on and prices it. Readiness points always come from admin
score rules; coins are a separate shop currency with admin-set amounts.

WHAT CHANGES (all new)
    engagement_settings    singleton on/off per feature + numbers
    daily_activity         one row per student per IST day per action
    goal_levels / user_goals
    quests / user_quests / friend_quest_pool / friend_quests
    monthly_challenges / user_challenge_awards
    mistake_reviews
    learning_paths / path_units / path_levels / user_path_progress
    placement_tests / user_placements
    follows / activity_feed / feed_cheers
    coin_ledger / shop_items / user_inventory / lb_boosts
    achievements / user_achievements
    message_templates
    tournaments
    score_event_rules + daily_goal_met, quest_completed, quests_all_done,
        monthly_challenge, mistakes_cleared, path_level_passed, path_checkpoint,
        topper_level, placement_done, speed_round, friend_quest, achievement_tier,
        perfect_week -- all 0 points, inactive

Path and placement questions reuse task_questions: their task_id holds the
path level / placement test id, so one question builder and one grader serve
cohort quizzes, paths and placement tests.

Additive, idempotent. From SKOVO_BACKEND:
    python database/migrations/migrate_v1_engagement.py
"""
from sqlalchemy import text

import _bootstrap  # noqa: F401
from portal import InitApp
from portal.models import db

app = InitApp().app()

UTF = "ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"

TABLES = [
f"""CREATE TABLE IF NOT EXISTS `engagement_settings` (
  `id` TINYINT NOT NULL DEFAULT 1,
  `daily_goal_enabled` TINYINT(1) NOT NULL DEFAULT 0,
  `quests_enabled` TINYINT(1) NOT NULL DEFAULT 0,
  `quests_per_day` INT NOT NULL DEFAULT 3,
  `challenge_enabled` TINYINT(1) NOT NULL DEFAULT 0,
  `mistakes_enabled` TINYINT(1) NOT NULL DEFAULT 0,
  `mistake_days` VARCHAR(40) NOT NULL DEFAULT '1,3,7',
  `paths_enabled` TINYINT(1) NOT NULL DEFAULT 0,
  `friends_enabled` TINYINT(1) NOT NULL DEFAULT 0,
  `friend_quests_enabled` TINYINT(1) NOT NULL DEFAULT 0,
  `coins_enabled` TINYINT(1) NOT NULL DEFAULT 0,
  `speed_enabled` TINYINT(1) NOT NULL DEFAULT 0,
  `speed_seconds` INT NOT NULL DEFAULT 60,
  `speed_questions` INT NOT NULL DEFAULT 20,
  `achievements_enabled` TINYINT(1) NOT NULL DEFAULT 0,
  `winback_enabled` TINYINT(1) NOT NULL DEFAULT 0,
  `winback_days` VARCHAR(40) NOT NULL DEFAULT '3,7,30',
  `winback_boost_hours` INT NOT NULL DEFAULT 0,
  `winback_free_freeze` TINYINT(1) NOT NULL DEFAULT 0,
  `offline_enabled` TINYINT(1) NOT NULL DEFAULT 0,
  `perfect_week_enabled` TINYINT(1) NOT NULL DEFAULT 0,
  `club_extra_freeze_days` INT NOT NULL DEFAULT 0,
  `coins_per_freeze_milestone` INT NOT NULL DEFAULT 0,
  `updated_at` DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  `updated_by` CHAR(36) NULL,
  PRIMARY KEY (`id`)
) {UTF}""",

f"""CREATE TABLE IF NOT EXISTS `daily_activity` (
  `user_id` CHAR(36) NOT NULL, `day` DATE NOT NULL, `action_key` VARCHAR(50) NOT NULL,
  `count` INT NOT NULL DEFAULT 0,
  PRIMARY KEY (`user_id`, `day`, `action_key`),
  KEY `ix_da_day` (`day`)
) {UTF}""",

f"""CREATE TABLE IF NOT EXISTS `goal_levels` (
  `level_key` VARCHAR(20) NOT NULL, `label` VARCHAR(60) NOT NULL, `tasks_per_day` INT NOT NULL,
  `sort_order` INT NOT NULL DEFAULT 0, `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (`level_key`)
) {UTF}""",

f"""CREATE TABLE IF NOT EXISTS `user_goals` (
  `user_id` CHAR(36) NOT NULL, `level_key` VARCHAR(20) NOT NULL,
  `updated_at` DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`)
) {UTF}""",

f"""CREATE TABLE IF NOT EXISTS `quests` (
  `id` CHAR(36) NOT NULL, `label` VARCHAR(160) NOT NULL, `label_te` VARCHAR(200) NULL,
  `kind` VARCHAR(20) NOT NULL DEFAULT 'action',
  `action_key` VARCHAR(50) NULL, `target` INT NOT NULL DEFAULT 1, `min_percent` INT NULL,
  `difficulty` VARCHAR(10) NOT NULL DEFAULT 'easy', `coins` INT NOT NULL DEFAULT 0,
  `segment_stage` VARCHAR(255) NULL, `is_active` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, `created_by` CHAR(36) NULL,
  PRIMARY KEY (`id`)
) {UTF}""",

f"""CREATE TABLE IF NOT EXISTS `user_quests` (
  `user_id` CHAR(36) NOT NULL, `day` DATE NOT NULL, `quest_id` CHAR(36) NOT NULL,
  `progress` INT NOT NULL DEFAULT 0, `target` INT NOT NULL DEFAULT 1, `done_at` DATETIME NULL,
  PRIMARY KEY (`user_id`, `day`, `quest_id`),
  KEY `ix_uq_day` (`day`)
) {UTF}""",

f"""CREATE TABLE IF NOT EXISTS `friend_quest_pool` (
  `id` CHAR(36) NOT NULL, `label` VARCHAR(160) NOT NULL, `action_key` VARCHAR(50) NOT NULL,
  `target` INT NOT NULL DEFAULT 10, `coins` INT NOT NULL DEFAULT 0, `is_active` TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`)
) {UTF}""",

f"""CREATE TABLE IF NOT EXISTS `friend_quests` (
  `id` CHAR(36) NOT NULL, `week_start` DATE NOT NULL, `user_a` CHAR(36) NOT NULL, `user_b` CHAR(36) NOT NULL,
  `pool_id` CHAR(36) NOT NULL, `action_key` VARCHAR(50) NOT NULL, `target` INT NOT NULL,
  `progress` INT NOT NULL DEFAULT 0, `done_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  KEY `ix_fq_a` (`user_a`, `week_start`), KEY `ix_fq_b` (`user_b`, `week_start`)
) {UTF}""",

f"""CREATE TABLE IF NOT EXISTS `monthly_challenges` (
  `month` CHAR(7) NOT NULL, `label` VARCHAR(160) NOT NULL, `target_quests` INT NOT NULL DEFAULT 20,
  `badge_label` VARCHAR(80) NULL, `coins` INT NOT NULL DEFAULT 0, `is_active` TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`month`)
) {UTF}""",

f"""CREATE TABLE IF NOT EXISTS `user_challenge_awards` (
  `user_id` CHAR(36) NOT NULL, `month` CHAR(7) NOT NULL, `awarded_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`, `month`)
) {UTF}""",

f"""CREATE TABLE IF NOT EXISTS `mistake_reviews` (
  `user_id` CHAR(36) NOT NULL, `question_id` CHAR(36) NOT NULL, `source` VARCHAR(12) NOT NULL DEFAULT 'quiz',
  `step` INT NOT NULL DEFAULT 0, `due_on` DATE NOT NULL, `cleared_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`, `question_id`),
  KEY `ix_mr_due` (`user_id`, `due_on`)
) {UTF}""",

f"""CREATE TABLE IF NOT EXISTS `learning_paths` (
  `id` CHAR(36) NOT NULL, `title` VARCHAR(160) NOT NULL, `exam` VARCHAR(100) NULL,
  `stage_group` VARCHAR(20) NULL, `branch` VARCHAR(120) NULL, `description` TEXT NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 0, `sort_order` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, `created_by` CHAR(36) NULL,
  PRIMARY KEY (`id`)
) {UTF}""",

f"""CREATE TABLE IF NOT EXISTS `path_units` (
  `id` CHAR(36) NOT NULL, `path_id` CHAR(36) NOT NULL, `title` VARCHAR(160) NOT NULL,
  `position` INT NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`), KEY `ix_pu_path` (`path_id`, `position`)
) {UTF}""",

f"""CREATE TABLE IF NOT EXISTS `path_levels` (
  `id` CHAR(36) NOT NULL, `unit_id` CHAR(36) NOT NULL, `title` VARCHAR(160) NOT NULL,
  `position` INT NOT NULL DEFAULT 0, `pass_percent` INT NOT NULL DEFAULT 60,
  `is_checkpoint` TINYINT(1) NOT NULL DEFAULT 0, `topper_enabled` TINYINT(1) NOT NULL DEFAULT 0,
  `topper_seconds` INT NOT NULL DEFAULT 300, `offline_allowed` TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`), KEY `ix_pl_unit` (`unit_id`, `position`)
) {UTF}""",

f"""CREATE TABLE IF NOT EXISTS `user_path_progress` (
  `user_id` CHAR(36) NOT NULL, `level_id` CHAR(36) NOT NULL, `best_percent` DECIMAL(5,1) NOT NULL DEFAULT 0,
  `attempts` INT NOT NULL DEFAULT 0, `passed_at` DATETIME NULL, `topper_at` DATETIME NULL,
  PRIMARY KEY (`user_id`, `level_id`)
) {UTF}""",

f"""CREATE TABLE IF NOT EXISTS `placement_tests` (
  `id` CHAR(36) NOT NULL, `path_id` CHAR(36) NOT NULL, `title` VARCHAR(160) NOT NULL,
  `bands_json` JSON NULL, `is_active` TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`), KEY `ix_pt_path` (`path_id`)
) {UTF}""",

f"""CREATE TABLE IF NOT EXISTS `user_placements` (
  `user_id` CHAR(36) NOT NULL, `path_id` CHAR(36) NOT NULL, `stage_id` CHAR(36) NULL,
  `percent` DECIMAL(5,1) NOT NULL, `start_level_id` CHAR(36) NULL,
  `taken_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`, `path_id`)
) {UTF}""",

f"""CREATE TABLE IF NOT EXISTS `follows` (
  `follower_id` CHAR(36) NOT NULL, `followee_id` CHAR(36) NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`follower_id`, `followee_id`), KEY `ix_follow_ee` (`followee_id`)
) {UTF}""",

f"""CREATE TABLE IF NOT EXISTS `activity_feed` (
  `id` CHAR(36) NOT NULL, `user_id` CHAR(36) NOT NULL, `kind` VARCHAR(30) NOT NULL,
  `text` VARCHAR(300) NOT NULL, `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`), KEY `ix_feed_user` (`user_id`, `created_at`)
) {UTF}""",

f"""CREATE TABLE IF NOT EXISTS `feed_cheers` (
  `feed_id` CHAR(36) NOT NULL, `user_id` CHAR(36) NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`feed_id`, `user_id`)
) {UTF}""",

f"""CREATE TABLE IF NOT EXISTS `coin_ledger` (
  `id` BIGINT NOT NULL AUTO_INCREMENT, `user_id` CHAR(36) NOT NULL, `delta` INT NOT NULL,
  `reason` VARCHAR(40) NOT NULL, `ref_id` VARCHAR(80) NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`), UNIQUE KEY `uq_coin_ref` (`user_id`, `reason`, `ref_id`), KEY `ix_coin_user` (`user_id`)
) {UTF}""",

f"""CREATE TABLE IF NOT EXISTS `shop_items` (
  `item_key` VARCHAR(40) NOT NULL, `label` VARCHAR(80) NOT NULL, `kind` VARCHAR(20) NOT NULL,
  `price` INT NOT NULL DEFAULT 0, `boost_minutes` INT NOT NULL DEFAULT 0, `image_url` VARCHAR(500) NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 0, `sort_order` INT NOT NULL DEFAULT 0,
  PRIMARY KEY (`item_key`)
) {UTF}""",

f"""CREATE TABLE IF NOT EXISTS `user_inventory` (
  `user_id` CHAR(36) NOT NULL, `item_key` VARCHAR(40) NOT NULL, `quantity` INT NOT NULL DEFAULT 0,
  `equipped` TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`user_id`, `item_key`)
) {UTF}""",

f"""CREATE TABLE IF NOT EXISTS `lb_boosts` (
  `id` CHAR(36) NOT NULL, `user_id` CHAR(36) NOT NULL, `multiplier` DECIMAL(3,1) NOT NULL DEFAULT 2.0,
  `starts_at` DATETIME NOT NULL, `ends_at` DATETIME NOT NULL, `source` VARCHAR(30) NOT NULL,
  PRIMARY KEY (`id`), KEY `ix_boost_user` (`user_id`, `ends_at`)
) {UTF}""",

f"""CREATE TABLE IF NOT EXISTS `achievements` (
  `ach_key` VARCHAR(40) NOT NULL, `label` VARCHAR(80) NOT NULL, `metric` VARCHAR(40) NOT NULL,
  `tiers_json` JSON NOT NULL, `coins_json` JSON NULL, `is_active` TINYINT(1) NOT NULL DEFAULT 0,
  `sort_order` INT NOT NULL DEFAULT 0,
  PRIMARY KEY (`ach_key`)
) {UTF}""",

f"""CREATE TABLE IF NOT EXISTS `user_achievements` (
  `user_id` CHAR(36) NOT NULL, `ach_key` VARCHAR(40) NOT NULL, `tier` VARCHAR(10) NOT NULL,
  `earned_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`, `ach_key`, `tier`)
) {UTF}""",

f"""CREATE TABLE IF NOT EXISTS `message_templates` (
  `tpl_key` VARCHAR(40) NOT NULL, `lang` VARCHAR(5) NOT NULL DEFAULT 'en',
  `title` VARCHAR(160) NOT NULL, `body` VARCHAR(500) NOT NULL,
  `updated_at` DATETIME NULL ON UPDATE CURRENT_TIMESTAMP, `updated_by` CHAR(36) NULL,
  PRIMARY KEY (`tpl_key`, `lang`)
) {UTF}""",

f"""CREATE TABLE IF NOT EXISTS `tournaments` (
  `id` CHAR(36) NOT NULL, `label` VARCHAR(80) NOT NULL, `tier` INT NOT NULL,
  `starts_on` DATE NOT NULL, `ends_on` DATE NOT NULL, `status` VARCHAR(10) NOT NULL DEFAULT 'open',
  `created_by` CHAR(36) NULL, `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) {UTF}""",
]

COLUMNS = [
    ('cohort_tasks', 'offline_allowed', "TINYINT(1) NOT NULL DEFAULT 0"),
]

RULES = [
    ('daily_goal_met', 'Met the daily goal', 'daily', 1),
    ('quest_completed', 'Completed a daily quest', 'daily', 3),
    ('quests_all_done', 'Completed all daily quests', 'daily', 1),
    ('monthly_challenge', 'Completed the monthly challenge', 'monthly', 1),
    ('mistakes_cleared', 'Cleared a My Mistakes set', 'daily', 1),
    ('path_level_passed', 'Passed a learning-path level', 'per_item', 1),
    ('path_checkpoint', 'Passed a unit checkpoint', 'per_item', 1),
    ('topper_level', 'Cleared a level in Topper mode', 'per_item', 1),
    ('placement_done', 'Took a placement test', 'per_item', 1),
    ('speed_round', 'Played a speed practice round', 'daily', 3),
    ('friend_quest', 'Completed a friend quest', 'weekly', 1),
    ('achievement_tier', 'Earned an achievement tier', 'per_item', 1),
    ('perfect_week', 'Perfect week (goal met 7/7)', 'weekly', 1),
]

GOALS = [('casual', 'Casual', 1, 1), ('regular', 'Regular', 2, 2), ('serious', 'Serious', 3, 3)]

SHOP = [
    ('streak_freeze', 'Streak freeze', 'streak_freeze', 200, 0, 1),
    ('double_points_15', 'Double leaderboard points (15 min)', 'boost', 300, 15, 2),
    ('frame_gold', 'Gold profile frame', 'frame', 500, 0, 3),
]

ACHIEVEMENTS = [
    ('quiz_master', 'Quiz Master', 'quizzes_submitted', '[{"tier":"bronze","target":10},{"tier":"silver","target":50},{"tier":"gold","target":200}]', 1),
    ('helper', 'Helper', 'answers_solved', '[{"tier":"bronze","target":5},{"tier":"silver","target":25},{"tier":"gold","target":100}]', 2),
    ('streak_club', 'Streak Club', 'streak_best', '[{"tier":"bronze","target":30},{"tier":"silver","target":100},{"tier":"gold","target":365}]', 3),
    ('path_climber', 'Path Climber', 'path_levels_passed', '[{"tier":"bronze","target":5},{"tier":"silver","target":25},{"tier":"gold","target":100}]', 4),
    ('topper', 'Topper', 'topper_levels', '[{"tier":"bronze","target":1},{"tier":"silver","target":10},{"tier":"gold","target":50}]', 5),
]

TEMPLATES = [
    ('streak_risk', 'en', '🔥 {streak} ends tonight', 'Do one task before midnight to keep your streak, {name}.'),
    ('streak_risk', 'te', '🔥 {streak} రోజుల స్ట్రీక్ ఈ రాత్రి ముగుస్తుంది', '{name}, అర్ధరాత్రి లోపు ఒక పని చేయండి.'),
    ('winback_3', 'en', 'We miss you, {name}', 'One quick quiz gets you back on track.'),
    ('winback_7', 'en', 'Come back to SKOVO', 'Your classmates kept going this week. Jump back in.'),
    ('winback_30', 'en', 'Your goals are waiting', 'Pick up where you left off in a few minutes.'),
    ('goal_met', 'en', 'Daily goal done 🎉', 'Great work today, {name}.'),
    ('quests_all', 'en', 'All quests done!', 'You finished every quest today.'),
]

PROCS = {
'sp_eng_settings_get': """
CREATE PROCEDURE `sp_eng_settings_get`()
BEGIN
  INSERT IGNORE INTO engagement_settings (id) VALUES (1);
  SELECT * FROM engagement_settings WHERE id = 1;
END""",

'sp_activity_track': """
CREATE PROCEDURE `sp_activity_track`(IN p_user CHAR(36), IN p_day DATE, IN p_key VARCHAR(50))
BEGIN
  INSERT INTO daily_activity (user_id, day, action_key, count) VALUES (p_user, p_day, p_key, 1)
  ON DUPLICATE KEY UPDATE count = count + 1;
  SELECT IFNULL(SUM(count), 0) AS day_total,
         (SELECT count FROM daily_activity WHERE user_id = p_user AND day = p_day AND action_key = p_key) AS key_total
    FROM daily_activity WHERE user_id = p_user AND day = p_day AND action_key <> 'daily_goal_met';
END""",

'sp_coin_add': """
CREATE PROCEDURE `sp_coin_add`(IN p_user CHAR(36), IN p_delta INT, IN p_reason VARCHAR(40), IN p_ref VARCHAR(80))
BEGIN
  INSERT IGNORE INTO coin_ledger (user_id, delta, reason, ref_id) VALUES (p_user, p_delta, p_reason, p_ref);
  SELECT ROW_COUNT() AS added, (SELECT IFNULL(SUM(delta), 0) FROM coin_ledger WHERE user_id = p_user) AS balance;
END""",

'sp_coin_balance': """
CREATE PROCEDURE `sp_coin_balance`(IN p_user CHAR(36))
BEGIN
  SELECT IFNULL(SUM(delta), 0) AS balance FROM coin_ledger WHERE user_id = p_user;
END""",

'sp_coin_spend': """
CREATE PROCEDURE `sp_coin_spend`(IN p_user CHAR(36), IN p_amount INT, IN p_reason VARCHAR(40), IN p_ref VARCHAR(80))
proc: BEGIN
  DECLARE v_bal INT DEFAULT 0;
  -- Serialise spends per student so two taps cannot both pass the check.
  SELECT IFNULL(SUM(delta), 0) INTO v_bal FROM coin_ledger WHERE user_id = p_user FOR UPDATE;
  IF v_bal < p_amount THEN SELECT 0 AS ok, v_bal AS balance; LEAVE proc; END IF;
  INSERT INTO coin_ledger (user_id, delta, reason, ref_id) VALUES (p_user, -p_amount, p_reason, p_ref);
  SELECT 1 AS ok, v_bal - p_amount AS balance;
END""",

'sp_quest_assign_candidates': """
CREATE PROCEDURE `sp_quest_assign_candidates`(IN p_since DATE)
BEGIN
  -- Students active in the last 14 days (assigning to everyone ever is waste).
  SELECT DISTINCT da.user_id, st.stage_group
    FROM daily_activity da
    LEFT JOIN student_stages st ON st.user_id = da.user_id AND st.status = 'active'
   WHERE da.day >= p_since;
END""",

'sp_mistakes_due': """
CREATE PROCEDURE `sp_mistakes_due`(IN p_user CHAR(36), IN p_day DATE, IN p_limit INT)
BEGIN
  SELECT mr.question_id, mr.step, mr.due_on, q.*
    FROM mistake_reviews mr
    JOIN task_questions q ON q.id = mr.question_id AND q.deleted_at IS NULL
   WHERE mr.user_id = p_user AND mr.cleared_at IS NULL AND mr.due_on <= p_day
   ORDER BY mr.due_on, mr.created_at LIMIT p_limit;
END""",
}


def has_column(table, col):
    return db.session.execute(text(
        "SELECT COUNT(*) FROM information_schema.COLUMNS "
        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND COLUMN_NAME = :c"
    ), {'t': table, 'c': col}).scalar() > 0


def main():
    with app.app_context():
        for ddl in TABLES:
            db.session.execute(text(ddl))
        for table, col, ddl in COLUMNS:
            if not has_column(table, col):
                db.session.execute(text(f"ALTER TABLE `{table}` ADD COLUMN `{col}` {ddl}"))
        db.session.execute(text("INSERT IGNORE INTO engagement_settings (id) VALUES (1)"))
        for k, l, ct, cv in RULES:
            db.session.execute(text(
                "INSERT IGNORE INTO score_event_rules (event_type, label, points, is_active, cap_type, cap_value) "
                "VALUES (:k, :l, 0, 0, :ct, :cv)"), {'k': k, 'l': l, 'ct': ct, 'cv': cv})
        for k, l, n, o in GOALS:
            db.session.execute(text(
                "INSERT IGNORE INTO goal_levels (level_key, label, tasks_per_day, sort_order) VALUES (:k, :l, :n, :o)"),
                {'k': k, 'l': l, 'n': n, 'o': o})
        for k, l, kind, price, mins, o in SHOP:          # inactive until admin prices + enables
            db.session.execute(text(
                "INSERT IGNORE INTO shop_items (item_key, label, kind, price, boost_minutes, is_active, sort_order) "
                "VALUES (:k, :l, :kd, :p, :m, 0, :o)"), {'k': k, 'l': l, 'kd': kind, 'p': price, 'm': mins, 'o': o})
        for k, l, metric, tiers, o in ACHIEVEMENTS:
            db.session.execute(text(
                "INSERT IGNORE INTO achievements (ach_key, label, metric, tiers_json, is_active, sort_order) "
                "VALUES (:k, :l, :m, :t, 0, :o)"), {'k': k, 'l': l, 'm': metric, 't': tiers, 'o': o})
        for k, lang, title, body in TEMPLATES:
            db.session.execute(text(
                "INSERT IGNORE INTO message_templates (tpl_key, lang, title, body) VALUES (:k, :g, :t, :b)"),
                {'k': k, 'g': lang, 't': title, 'b': body})
        db.session.commit()
        print("  tables + inactive rules, shop items, achievements, templates ready")
        for name, ddl in PROCS.items():
            db.session.execute(text(f"DROP PROCEDURE IF EXISTS `{name}`"))
            db.session.execute(text(ddl))
        db.session.commit()
        print(f"  {len(PROCS)} procedures")
        print("Done.")


if __name__ == '__main__':
    main()
