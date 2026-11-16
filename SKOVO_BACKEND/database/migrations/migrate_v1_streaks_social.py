"""
Migration: buddy and group streaks, version 1 (17 Oct 2026).

Named to sort after migrate_v1_streaks.py, whose sp_buddy_accept and
sp_buddy_nightly_break this replaces — apply_all runs migrations in name order.

Buddy streaks (2 students) — upgraded
  * same class only (admin switch): both must be in the same stage group;
    the class is stored on the pair, and a pair whose members no longer share
    it (promotion) ends at the nightly run, best kept;
  * an exam window holds the pair instead of breaking it (a day counts as held
    when each member either acted or was covered by an exam window);
  * pending invites expire after N days (admin);
  * 30-day milestone (score rule buddy_streak_30), alongside the 7-day one.

Group streaks (3–5 students) — new
  streak_groups / streak_group_members. A group forms on create, becomes
  active once it has group_min members, and grows a day only when every
  member acted that day. Same rules as pairs: same class, exam windows hold,
  no freezes, milestones 7 / 30 (group_streak_7 / group_streak_30).

Leaderboard
  sp_social_leaderboard_pairs / _groups(stage, limit): top pairs and groups in one class.

Settings (Admin > Career Streaks > Buddy & group streaks)
  buddy_same_class, group_enabled, group_min, group_max, group_per_student,
  invite_expiry_days, social_leaderboard.

Badges
  achievements "duo" (best buddy streak) and "squad" (best group streak),
  tiers 7 / 30 — Daily Engagement > Achievements.

Every new score rule starts OFF. Idempotent.
    venv/Scripts/python.exe database/migrations/migrate_v1_streaks_social.py
"""
import _bootstrap  # noqa: F401 — puts SKOVO_BACKEND on sys.path and cwd
from sqlalchemy import text

from portal import InitApp
from portal.models import db

app = InitApp().app()

COLUMNS = [
    ('streak_settings', 'buddy_same_class',   "TINYINT(1) NOT NULL DEFAULT 1"),
    ('streak_settings', 'group_enabled',      "TINYINT(1) NOT NULL DEFAULT 0"),
    ('streak_settings', 'group_min',          "INT NOT NULL DEFAULT 3"),
    ('streak_settings', 'group_max',          "INT NOT NULL DEFAULT 5"),
    ('streak_settings', 'group_per_student',  "INT NOT NULL DEFAULT 1"),
    ('streak_settings', 'invite_expiry_days', "INT NOT NULL DEFAULT 7"),
    ('streak_settings', 'social_leaderboard', "TINYINT(1) NOT NULL DEFAULT 1"),
    ('buddy_streaks',   'stage_group',        "VARCHAR(20) NULL"),
]

TABLES = [
"""CREATE TABLE IF NOT EXISTS `streak_groups` (
  `id`              CHAR(36)    NOT NULL,
  `name`            VARCHAR(60) NOT NULL,
  `invite_code`     VARCHAR(12) NOT NULL,
  `created_by`      CHAR(36)    NOT NULL,
  `stage_group`     VARCHAR(20) NULL,
  `status`          VARCHAR(12) NOT NULL DEFAULT 'forming',
  `current`         INT         NOT NULL DEFAULT 0,
  `best`            INT         NOT NULL DEFAULT 0,
  `covered_through` DATE        NULL,
  `run_started_on`  DATE        NULL,
  `created_at`      DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `ended_at`        DATETIME    NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_streak_groups_code` (`invite_code`),
  KEY `ix_streak_groups_stage` (`stage_group`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci""",
"""CREATE TABLE IF NOT EXISTS `streak_group_members` (
  `group_id`  CHAR(36) NOT NULL,
  `user_id`   CHAR(36) NOT NULL,
  `joined_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `left_at`   DATETIME NULL,
  PRIMARY KEY (`group_id`, `user_id`),
  KEY `ix_sgm_user` (`user_id`, `left_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci""",
]

# A member's class: their active stage group.
STAGE_OF = ("(SELECT st.stage_group FROM student_stages st WHERE st.user_id = {u} "
            "AND st.status = 'active' ORDER BY st.started_at DESC LIMIT 1)")

PROCS = {
'sp_streak_social_settings_set': """
CREATE PROCEDURE `sp_streak_social_settings_set`(
  IN p_same TINYINT, IN p_group_on TINYINT, IN p_min INT, IN p_max INT,
  IN p_per INT, IN p_expiry INT, IN p_board TINYINT)
BEGIN
  INSERT IGNORE INTO streak_settings (id) VALUES (1);
  UPDATE streak_settings
     SET buddy_same_class   = IFNULL(p_same, buddy_same_class),
         group_enabled      = IFNULL(p_group_on, group_enabled),
         group_min          = LEAST(10, GREATEST(2, IFNULL(p_min, group_min))),
         group_max          = LEAST(10, GREATEST(2, IFNULL(p_max, group_max))),
         group_per_student  = GREATEST(0, IFNULL(p_per, group_per_student)),
         invite_expiry_days = GREATEST(0, IFNULL(p_expiry, invite_expiry_days)),
         social_leaderboard = IFNULL(p_board, social_leaderboard)
   WHERE id = 1;
  -- max is never below min
  UPDATE streak_settings SET group_max = GREATEST(group_max, group_min) WHERE id = 1;
  SELECT * FROM streak_settings WHERE id = 1;
END""",

'sp_buddy_accept': """
CREATE PROCEDURE `sp_buddy_accept`(IN p_user CHAR(36), IN p_code VARCHAR(12), IN p_max INT, IN p_same TINYINT)
proc: BEGIN
  DECLARE v_id CHAR(36) DEFAULT NULL;
  DECLARE v_a CHAR(36) DEFAULT NULL;
  DECLARE v_stage_a VARCHAR(20) DEFAULT NULL;
  DECLARE v_stage_b VARCHAR(20) DEFAULT NULL;
  DECLARE v_mine INT DEFAULT 0;
  DECLARE v_theirs INT DEFAULT 0;

  SELECT id, user_a INTO v_id, v_a FROM buddy_streaks
   WHERE invite_code = p_code AND status = 'pending' LIMIT 1;
  IF v_id IS NULL THEN SELECT 0 AS ok, 'invalid_code' AS result; LEAVE proc; END IF;
  IF v_a = p_user THEN SELECT 0 AS ok, 'own_code' AS result; LEAVE proc; END IF;

  SET v_stage_a = """ + STAGE_OF.format(u='v_a') + """;
  SET v_stage_b = """ + STAGE_OF.format(u='p_user') + """;
  IF IFNULL(p_same, 1) = 1 AND NOT (v_stage_a <=> v_stage_b) THEN
    SELECT 0 AS ok, 'different_class' AS result; LEAVE proc;
  END IF;

  IF EXISTS (SELECT 1 FROM buddy_streaks WHERE status = 'active'
              AND ((user_a = v_a AND user_b = p_user) OR (user_a = p_user AND user_b = v_a))) THEN
    SELECT 0 AS ok, 'already_buddies' AS result; LEAVE proc;
  END IF;
  SELECT COUNT(*) INTO v_mine FROM buddy_streaks
   WHERE status = 'active' AND (user_a = p_user OR user_b = p_user);
  SELECT COUNT(*) INTO v_theirs FROM buddy_streaks
   WHERE status = 'active' AND (user_a = v_a OR user_b = v_a);
  IF v_mine >= p_max OR v_theirs >= p_max THEN
    SELECT 0 AS ok, 'buddy_limit' AS result; LEAVE proc;
  END IF;
  UPDATE buddy_streaks SET user_b = p_user, status = 'active', stage_group = v_stage_a WHERE id = v_id;
  SELECT 1 AS ok, 'accepted' AS result, v_id AS id, v_a AS buddy_id;
END""",

'sp_buddy_nightly_break': """
CREATE PROCEDURE `sp_buddy_nightly_break`(IN p_day DATE)
BEGIN
  -- Pairs neither of whose days moved them on. If each member acted or was
  -- covered by an exam window, the pair HOLDS; otherwise it breaks. No freezes.
  UPDATE buddy_streaks b
     SET b.covered_through = p_day
   WHERE b.status = 'active' AND b.current > 0
     AND (b.covered_through IS NULL OR b.covered_through < p_day)
     AND EXISTS (SELECT 1 FROM streak_days d WHERE d.user_id = b.user_a AND d.day = p_day AND d.kind IN ('action','exam'))
     AND EXISTS (SELECT 1 FROM streak_days d WHERE d.user_id = b.user_b AND d.day = p_day AND d.kind IN ('action','exam'));
  UPDATE buddy_streaks SET current = 0, run_started_on = NULL
   WHERE status = 'active' AND current > 0 AND covered_through < p_day;
  SELECT ROW_COUNT() AS broken;
END""",

'sp_group_create': """
CREATE PROCEDURE `sp_group_create`(IN p_id CHAR(36), IN p_user CHAR(36), IN p_name VARCHAR(60),
                                   IN p_code VARCHAR(12), IN p_per INT)
proc: BEGIN
  DECLARE v_mine INT DEFAULT 0;
  SELECT COUNT(*) INTO v_mine FROM streak_group_members m JOIN streak_groups g ON g.id = m.group_id
   WHERE m.user_id = p_user AND m.left_at IS NULL AND g.status IN ('forming','active');
  IF v_mine >= IFNULL(p_per, 1) THEN SELECT 0 AS ok, 'group_limit' AS result; LEAVE proc; END IF;
  INSERT INTO streak_groups (id, name, invite_code, created_by, stage_group, status)
  VALUES (p_id, p_name, p_code, p_user, """ + STAGE_OF.format(u='p_user') + """, 'forming');
  INSERT INTO streak_group_members (group_id, user_id) VALUES (p_id, p_user);
  SELECT 1 AS ok, 'created' AS result, p_id AS id, p_code AS invite_code;
END""",

'sp_group_join': """
CREATE PROCEDURE `sp_group_join`(IN p_user CHAR(36), IN p_code VARCHAR(12), IN p_same TINYINT,
                                 IN p_min INT, IN p_max INT, IN p_per INT)
proc: BEGIN
  DECLARE v_id CHAR(36) DEFAULT NULL;
  DECLARE v_stage VARCHAR(20) DEFAULT NULL;
  DECLARE v_size INT DEFAULT 0;
  DECLARE v_mine INT DEFAULT 0;

  SELECT id, stage_group INTO v_id, v_stage FROM streak_groups
   WHERE invite_code = p_code AND status IN ('forming','active') LIMIT 1;
  IF v_id IS NULL THEN SELECT 0 AS ok, 'invalid_code' AS result; LEAVE proc; END IF;
  IF EXISTS (SELECT 1 FROM streak_group_members WHERE group_id = v_id AND user_id = p_user AND left_at IS NULL) THEN
    SELECT 0 AS ok, 'already_member' AS result; LEAVE proc;
  END IF;
  IF IFNULL(p_same, 1) = 1 AND NOT (v_stage <=> """ + STAGE_OF.format(u='p_user') + """) THEN
    SELECT 0 AS ok, 'different_class' AS result; LEAVE proc;
  END IF;
  SELECT COUNT(*) INTO v_size FROM streak_group_members WHERE group_id = v_id AND left_at IS NULL;
  IF v_size >= p_max THEN SELECT 0 AS ok, 'group_full' AS result; LEAVE proc; END IF;
  SELECT COUNT(*) INTO v_mine FROM streak_group_members m JOIN streak_groups g ON g.id = m.group_id
   WHERE m.user_id = p_user AND m.left_at IS NULL AND g.status IN ('forming','active');
  IF v_mine >= IFNULL(p_per, 1) THEN SELECT 0 AS ok, 'group_limit' AS result; LEAVE proc; END IF;

  INSERT INTO streak_group_members (group_id, user_id) VALUES (v_id, p_user)
    ON DUPLICATE KEY UPDATE left_at = NULL, joined_at = CURRENT_TIMESTAMP;
  UPDATE streak_groups SET status = 'active'
   WHERE id = v_id AND status = 'forming' AND v_size + 1 >= p_min;
  SELECT 1 AS ok, 'joined' AS result, v_id AS id, (SELECT created_by FROM streak_groups WHERE id = v_id) AS owner_id;
END""",

'sp_group_leave': """
CREATE PROCEDURE `sp_group_leave`(IN p_user CHAR(36), IN p_group CHAR(36), IN p_min INT)
proc: BEGIN
  DECLARE v_left INT DEFAULT 0;
  UPDATE streak_group_members SET left_at = CURRENT_TIMESTAMP
   WHERE group_id = p_group AND user_id = p_user AND left_at IS NULL;
  IF ROW_COUNT() = 0 THEN SELECT 0 AS ok; LEAVE proc; END IF;
  SELECT COUNT(*) INTO v_left FROM streak_group_members WHERE group_id = p_group AND left_at IS NULL;
  IF v_left = 0 THEN
    UPDATE streak_groups SET status = 'ended', ended_at = UTC_TIMESTAMP() WHERE id = p_group;
  ELSEIF v_left < p_min THEN
    -- Too few to be a group: back to forming, the shared count restarts.
    UPDATE streak_groups SET status = 'forming', current = 0, run_started_on = NULL WHERE id = p_group;
  END IF;
  SELECT 1 AS ok, v_left AS members_left;
END""",

'sp_group_list': """
CREATE PROCEDURE `sp_group_list`(IN p_user CHAR(36), IN p_day DATE)
BEGIN
  -- One row per (group, member) for the student's groups, with whether each
  -- member has acted today — the screen groups them.
  SELECT g.id, g.name, g.invite_code, g.status, g.current, g.best, g.created_by,
         m.user_id, u.full_name,
         EXISTS (SELECT 1 FROM streak_days d WHERE d.user_id = m.user_id AND d.day = p_day AND d.kind = 'action') AS done_today
    FROM streak_groups g
    JOIN streak_group_members me ON me.group_id = g.id AND me.user_id = p_user AND me.left_at IS NULL
    JOIN streak_group_members m  ON m.group_id = g.id AND m.left_at IS NULL
    LEFT JOIN users u ON u.id = m.user_id
   WHERE g.status IN ('forming','active')
   ORDER BY g.created_at, m.joined_at;
END""",

'sp_group_keep_day': """
CREATE PROCEDURE `sp_group_keep_day`(IN p_user CHAR(36), IN p_day DATE)
BEGIN
  -- Active groups of p_user where EVERY member acted on p_day: move them on.
  DROP TEMPORARY TABLE IF EXISTS tmp_group_moved;
  CREATE TEMPORARY TABLE tmp_group_moved (id CHAR(36) PRIMARY KEY, current INT, run_started_on DATE);
  INSERT INTO tmp_group_moved (id, current, run_started_on)
  SELECT g.id,
         IF(g.covered_through = DATE_SUB(p_day, INTERVAL 1 DAY), g.current + 1, 1),
         IF(g.covered_through = DATE_SUB(p_day, INTERVAL 1 DAY), g.run_started_on, p_day)
    FROM streak_groups g
    JOIN streak_group_members me ON me.group_id = g.id AND me.user_id = p_user AND me.left_at IS NULL
   WHERE g.status = 'active'
     AND (g.covered_through IS NULL OR g.covered_through < p_day)
     AND NOT EXISTS (
           SELECT 1 FROM streak_group_members m
            WHERE m.group_id = g.id AND m.left_at IS NULL
              AND NOT EXISTS (SELECT 1 FROM streak_days d
                               WHERE d.user_id = m.user_id AND d.day = p_day AND d.kind = 'action'));
  UPDATE streak_groups g JOIN tmp_group_moved t ON t.id = g.id
     SET g.current = t.current, g.best = GREATEST(g.best, t.current),
         g.covered_through = p_day, g.run_started_on = t.run_started_on;
  SELECT t.id, t.current, t.run_started_on FROM tmp_group_moved t;
  DROP TEMPORARY TABLE IF EXISTS tmp_group_moved;
END""",

'sp_group_members_of': """
CREATE PROCEDURE `sp_group_members_of`(IN p_group CHAR(36))
BEGIN
  SELECT user_id FROM streak_group_members WHERE group_id = p_group AND left_at IS NULL;
END""",

'sp_group_nightly': """
CREATE PROCEDURE `sp_group_nightly`(IN p_day DATE)
BEGIN
  -- Hold a group whose every member acted or was in an exam window; break the rest.
  UPDATE streak_groups g
     SET g.covered_through = p_day
   WHERE g.status = 'active' AND g.current > 0
     AND (g.covered_through IS NULL OR g.covered_through < p_day)
     AND NOT EXISTS (
           SELECT 1 FROM streak_group_members m
            WHERE m.group_id = g.id AND m.left_at IS NULL
              AND NOT EXISTS (SELECT 1 FROM streak_days d
                               WHERE d.user_id = m.user_id AND d.day = p_day AND d.kind IN ('action','exam')));
  UPDATE streak_groups SET current = 0, run_started_on = NULL
   WHERE status = 'active' AND current > 0 AND covered_through < p_day;
  SELECT ROW_COUNT() AS broken;
END""",

'sp_social_housekeeping': """
CREATE PROCEDURE `sp_social_housekeeping`(IN p_expiry_days INT)
BEGIN
  -- 1. Unused buddy invites expire.
  IF IFNULL(p_expiry_days, 0) > 0 THEN
    UPDATE buddy_streaks SET status = 'expired', ended_at = UTC_TIMESTAMP()
     WHERE status = 'pending' AND created_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL p_expiry_days DAY);
  END IF;
  -- 2. A member moved up a class: the pair / their group membership ends.
  UPDATE buddy_streaks b SET b.status = 'ended', b.ended_at = UTC_TIMESTAMP()
   WHERE b.status = 'active' AND b.stage_group IS NOT NULL
     AND (NOT (""" + STAGE_OF.format(u='b.user_a') + """ <=> b.stage_group)
          OR NOT (""" + STAGE_OF.format(u='b.user_b') + """ <=> b.stage_group));
  UPDATE streak_group_members m JOIN streak_groups g ON g.id = m.group_id
     SET m.left_at = UTC_TIMESTAMP()
   WHERE m.left_at IS NULL AND g.status IN ('forming','active') AND g.stage_group IS NOT NULL
     AND NOT (""" + STAGE_OF.format(u='m.user_id') + """ <=> g.stage_group);
  SELECT 1 AS ok;
END""",

'sp_social_leaderboard_pairs': """
CREATE PROCEDURE `sp_social_leaderboard_pairs`(IN p_stage VARCHAR(20), IN p_limit INT)
BEGIN
  SELECT 'pair' AS kind, b.id, b.current, b.best,
         CONCAT(IFNULL(ua.full_name, '—'), ' & ', IFNULL(ub.full_name, '—')) AS name,
         CONCAT(b.user_a, ',', b.user_b) AS members
    FROM buddy_streaks b
    LEFT JOIN users ua ON ua.id = b.user_a
    LEFT JOIN users ub ON ub.id = b.user_b
   WHERE b.status = 'active' AND b.current > 0 AND (b.stage_group <=> p_stage)
   ORDER BY b.current DESC, b.best DESC LIMIT p_limit;
END""",

'sp_social_leaderboard_groups': """
CREATE PROCEDURE `sp_social_leaderboard_groups`(IN p_stage VARCHAR(20), IN p_limit INT)
BEGIN
  SELECT 'group' AS kind, g.id, g.current, g.best, g.name,
         (SELECT GROUP_CONCAT(m.user_id) FROM streak_group_members m
           WHERE m.group_id = g.id AND m.left_at IS NULL) AS members
    FROM streak_groups g
   WHERE g.status = 'active' AND g.current > 0 AND (g.stage_group <=> p_stage)
   ORDER BY g.current DESC, g.best DESC LIMIT p_limit;
END""",
}

RULES = [
    ('buddy_streak_30', '30-day buddy streak', 3),
    ('group_streak_7',  '7-day group streak',  1),
    ('group_streak_30', '30-day group streak', 3),
]

ACHIEVEMENTS = [
    ('duo',   'Duo',   'buddy_best', '[{"tier":"bronze","target":7},{"tier":"silver","target":30}]', 20),
    ('squad', 'Squad', 'group_best', '[{"tier":"bronze","target":7},{"tier":"silver","target":30}]', 21),
]
METRICS = [('buddy_best', 'Best buddy streak (days)'), ('group_best', 'Best group streak (days)')]


def main():
    with app.app_context():
        x = lambda sql, **p: db.session.execute(text(sql), p)
        for table, col, ddl in COLUMNS:
            has = x("""SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
                        AND TABLE_NAME = :t AND COLUMN_NAME = :c""", t=table, c=col).scalar()
            if not has:
                x(f"ALTER TABLE `{table}` ADD COLUMN `{col}` {ddl}")
        for ddl in TABLES:
            x(ddl)
        x("DROP PROCEDURE IF EXISTS `sp_social_leaderboard`")   # first draft returned two result sets
        for name, body in PROCS.items():
            x(f"DROP PROCEDURE IF EXISTS `{name}`")
            x(body)
        for key, label, pts in RULES:
            x("""INSERT IGNORE INTO score_event_rules (event_type, label, points, is_active, cap_type, shape, leaderboard_points)
                 VALUES (:k, :l, :p, 0, 'per_item', 'simple', 0)""", k=key, l=label, p=pts)
        for value, label in METRICS:
            x("""INSERT INTO master_achievement_metric (id, value, label, sort_order, is_active)
                 SELECT UUID(), :v, :l, 100, 1 FROM DUAL
                  WHERE NOT EXISTS (SELECT 1 FROM master_achievement_metric WHERE value = :v)""", v=value, l=label)
        for key, label, metric, tiers, sort in ACHIEVEMENTS:
            x("""INSERT IGNORE INTO achievements (ach_key, label, metric, tiers_json, coins_json, is_active, sort_order)
                 VALUES (:k, :l, :m, :t, '{}', 1, :s)""", k=key, l=label, m=metric, t=tiers, s=sort)
        db.session.commit()
        print('buddy & group streaks ready')


if __name__ == '__main__':
    main()
