"""Leaderboard: same class only, period points, leagues, privacy, Hall of Fame.

WHY
    feature-updates.md §4. The old board (sp_leaderboard) ranked every user on
    the platform by user_streaks.total_points. Now:
      * a student sees only their own stage group + year (+ optional branch)
      * tabs: school / city / state / all India x this week / month / season
      * ranked by LEADERBOARD points earned in the period, never the readiness
        score (which converges at 100) and never payments
      * leaderboard points are a per-rule number admin sets (default 0)
      * name + photo, or an alias / photo off; students cannot hide; admin can
        remove a student
      * weekly leagues (off by default) and a Hall of Fame at season end

WHAT CHANGES
    score_event_rules + leaderboard_points DECIMAL(5,2) DEFAULT 0
    lb_settings       singleton: enabled 0, daily cap, name format, photos
    lb_events         leaderboard ledger (one row per paying score event)
    lb_state          last score_events.seq copied
    lb_profiles       alias / hide photo / admin removal
    league_settings   singleton: enabled 0, group size, promote / demote counts
    league_members    one row per student per week
    hall_of_fame      season-end winners
    sp_lb_*, sp_league_*, sp_hof_*

Additive, idempotent. From SKOVO_BACKEND:
    python database/migrations/migrate_v1_leaderboard.py
"""
from sqlalchemy import text

import _bootstrap  # noqa: F401
from portal import InitApp
from portal.models import db

app = InitApp().app()

TABLES = [
"""CREATE TABLE IF NOT EXISTS `lb_settings` (
  `id`            TINYINT     NOT NULL DEFAULT 1,
  `enabled`       TINYINT(1)  NOT NULL DEFAULT 0,
  `daily_cap`     INT         NOT NULL DEFAULT 50,
  `name_format`   VARCHAR(12) NOT NULL DEFAULT 'full',
  `photos`        TINYINT(1)  NOT NULL DEFAULT 1,
  `updated_at`    DATETIME    NULL ON UPDATE CURRENT_TIMESTAMP,
  `updated_by`    CHAR(36)    NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci""",

"""CREATE TABLE IF NOT EXISTS `lb_events` (
  `id`          BIGINT       NOT NULL AUTO_INCREMENT,
  `user_id`     CHAR(36)     NOT NULL,
  `stage_id`    CHAR(36)     NULL,
  `event_seq`   BIGINT       NOT NULL,
  `event_type`  VARCHAR(50)  NOT NULL,
  `points`      DECIMAL(6,2) NOT NULL,
  `day`         DATE         NOT NULL,
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_lb_seq` (`event_seq`),
  KEY `ix_lb_user_day` (`user_id`, `day`),
  KEY `ix_lb_stage_day` (`stage_id`, `day`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci""",

"""CREATE TABLE IF NOT EXISTS `lb_state` (
  `id`       TINYINT NOT NULL DEFAULT 1,
  `last_seq` BIGINT  NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB""",

"""CREATE TABLE IF NOT EXISTS `lb_profiles` (
  `user_id`        CHAR(36)     NOT NULL,
  `alias`          VARCHAR(40)  NULL,
  `hide_photo`     TINYINT(1)   NOT NULL DEFAULT 0,
  `removed`        TINYINT(1)   NOT NULL DEFAULT 0,
  `removed_reason` VARCHAR(255) NULL,
  `removed_by`     CHAR(36)     NULL,
  `removed_at`     DATETIME     NULL,
  `updated_at`     DATETIME     NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci""",

"""CREATE TABLE IF NOT EXISTS `league_settings` (
  `id`            TINYINT      NOT NULL DEFAULT 1,
  `enabled`       TINYINT(1)   NOT NULL DEFAULT 0,
  `group_size`    INT          NOT NULL DEFAULT 30,
  `promote_count` INT          NOT NULL DEFAULT 7,
  `demote_count`  INT          NOT NULL DEFAULT 5,
  `tiers`         VARCHAR(255) NOT NULL DEFAULT 'Bronze,Silver,Gold,Platinum,Diamond',
  `updated_at`    DATETIME     NULL ON UPDATE CURRENT_TIMESTAMP,
  `updated_by`    CHAR(36)     NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci""",

"""CREATE TABLE IF NOT EXISTS `league_members` (
  `week_start`  DATE         NOT NULL,
  `user_id`     CHAR(36)     NOT NULL,
  `stage_group` VARCHAR(20)  NOT NULL,
  `sub_year`    VARCHAR(30)  NULL,
  `tier`        TINYINT      NOT NULL DEFAULT 0,
  `group_no`    INT          NOT NULL DEFAULT 0,
  `points`      DECIMAL(8,2) NOT NULL DEFAULT 0,
  `final_rank`  INT          NULL,
  `result`      VARCHAR(10)  NULL,
  PRIMARY KEY (`week_start`, `user_id`),
  KEY `ix_league_group` (`week_start`, `stage_group`, `sub_year`, `tier`, `group_no`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci""",

"""CREATE TABLE IF NOT EXISTS `hall_of_fame` (
  `id`           CHAR(36)     NOT NULL,
  `season_label` VARCHAR(60)  NOT NULL,
  `stage_group`  VARCHAR(20)  NOT NULL,
  `sub_year`     VARCHAR(30)  NULL,
  `scope`        VARCHAR(10)  NOT NULL,
  `scope_value`  VARCHAR(200) NULL,
  `user_id`      CHAR(36)     NOT NULL,
  `rank`         INT          NOT NULL,
  `points`       DECIMAL(8,2) NOT NULL,
  `created_at`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `created_by`   CHAR(36)     NULL,
  PRIMARY KEY (`id`),
  KEY `ix_hof_user` (`user_id`),
  KEY `ix_hof_season` (`season_label`, `stage_group`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci""",
]

# Who is on a board, and with what display data. {extra} adds filters.
BOARD_BASE = """
    SELECT st.user_id, u.full_name, u.avatar_url, u.email,
           lp.alias, IFNULL(lp.hide_photo, 0) AS hide_photo,
           st.institute, p.city, COALESCE(NULLIF(st.state, ''), p.state) AS state,
           st.branch, st.stage_group, st.sub_year,
           IFNULL(cs.stage_current, 0) AS stage_streak,
           lm.tier AS league_tier,
           IFNULL((SELECT SUM(le.points) FROM lb_events le
                    WHERE le.user_id = st.user_id AND le.stage_id = st.id AND le.day >= p_from), 0) AS points,
           (SELECT MAX(le.created_at) FROM lb_events le
             WHERE le.user_id = st.user_id AND le.stage_id = st.id AND le.day >= p_from) AS last_gain
      FROM student_stages st
      JOIN users u ON u.id = st.user_id AND u.deleted_at IS NULL
      LEFT JOIN user_profiles p ON p.user_id = st.user_id
      LEFT JOIN lb_profiles lp ON lp.user_id = st.user_id
      LEFT JOIN career_streaks cs ON cs.user_id = st.user_id
      LEFT JOIN league_members lm ON lm.user_id = st.user_id AND lm.week_start = p_week
     WHERE st.status = 'active'
       AND IFNULL(lp.removed, 0) = 0
       AND u.email NOT LIKE 'score-engine-test-%%'
       AND st.stage_group = p_group
       AND (p_year IS NULL OR p_year = '' OR IFNULL(st.sub_year, '') = p_year)
       AND (p_branch IS NULL OR p_branch = '' OR IFNULL(st.branch, '') = p_branch)
       AND (p_scope = 'india'
            OR (p_scope = 'school'   AND IFNULL(st.institute, '') = IFNULL(p_scope_value, '') AND IFNULL(p_scope_value, '') <> '')
            OR (p_scope = 'district' AND IFNULL(p.city, '') = IFNULL(p_scope_value, '') AND IFNULL(p_scope_value, '') <> '')
            OR (p_scope = 'state'    AND COALESCE(NULLIF(st.state, ''), p.state, '') = IFNULL(p_scope_value, '') AND IFNULL(p_scope_value, '') <> ''))
"""

BOARD_PARAMS = """IN p_group VARCHAR(20), IN p_year VARCHAR(30), IN p_branch VARCHAR(120),
  IN p_scope VARCHAR(10), IN p_scope_value VARCHAR(200), IN p_from DATE, IN p_week DATE"""

PROCS = {
'sp_lb_settings_get': """
CREATE PROCEDURE `sp_lb_settings_get`()
BEGIN
  INSERT IGNORE INTO lb_settings (id) VALUES (1);
  SELECT * FROM lb_settings WHERE id = 1;
END""",

'sp_lb_settings_set': """
CREATE PROCEDURE `sp_lb_settings_set`(IN p_enabled TINYINT, IN p_cap INT, IN p_name VARCHAR(12),
  IN p_photos TINYINT, IN p_admin CHAR(36))
BEGIN
  INSERT IGNORE INTO lb_settings (id) VALUES (1);
  UPDATE lb_settings
     SET enabled = IFNULL(p_enabled, enabled), daily_cap = GREATEST(0, IFNULL(p_cap, daily_cap)),
         name_format = IFNULL(p_name, name_format), photos = IFNULL(p_photos, photos), updated_by = p_admin
   WHERE id = 1;
  SELECT * FROM lb_settings WHERE id = 1;
END""",

'sp_lb_pending': """
CREATE PROCEDURE `sp_lb_pending`(IN p_limit INT)
BEGIN
  -- Paying score events not yet copied, with the rule's leaderboard points.
  -- Only positive, real awards; rules with 0 leaderboard points are skipped
  -- (which is every rule until admin sets one). Payment rules never qualify:
  -- admin keeps their leaderboard_points at 0 (enforced in the admin API).
  SELECT e.seq, e.user_id, e.event_type, e.occurred_at, r.leaderboard_points,
         (SELECT st.id FROM student_stages st WHERE st.user_id = e.user_id AND st.status = 'active' LIMIT 1) AS stage_id
    FROM score_events e
    JOIN score_event_rules r ON r.event_type = e.event_type
   WHERE e.seq > (SELECT last_seq FROM lb_state WHERE id = 1)
     AND e.points > 0
     AND r.is_active = 1
     AND IFNULL(r.leaderboard_points, 0) > 0
   ORDER BY e.seq
   LIMIT p_limit;
END""",

'sp_lb_high_water': """
CREATE PROCEDURE `sp_lb_high_water`()
BEGIN
  INSERT IGNORE INTO lb_state (id, last_seq) VALUES (1, 0);
  SELECT last_seq, (SELECT IFNULL(MAX(seq), 0) FROM score_events) AS max_seq FROM lb_state WHERE id = 1;
END""",

'sp_lb_state_set': """
CREATE PROCEDURE `sp_lb_state_set`(IN p_seq BIGINT)
BEGIN
  UPDATE lb_state SET last_seq = GREATEST(last_seq, p_seq) WHERE id = 1;
  SELECT last_seq FROM lb_state WHERE id = 1;
END""",

'sp_lb_day_total': """
CREATE PROCEDURE `sp_lb_day_total`(IN p_user CHAR(36), IN p_day DATE)
BEGIN
  SELECT IFNULL(SUM(points), 0) AS total FROM lb_events WHERE user_id = p_user AND day = p_day;
END""",

'sp_lb_credit': """
CREATE PROCEDURE `sp_lb_credit`(IN p_user CHAR(36), IN p_stage CHAR(36), IN p_seq BIGINT,
  IN p_type VARCHAR(50), IN p_points DECIMAL(6,2), IN p_day DATE)
BEGIN
  INSERT IGNORE INTO lb_events (user_id, stage_id, event_seq, event_type, points, day)
  VALUES (p_user, p_stage, p_seq, p_type, p_points, p_day);
  SELECT ROW_COUNT() AS added;
END""",

'sp_lb_board': """
CREATE PROCEDURE `sp_lb_board`(""" + BOARD_PARAMS + """, IN p_limit INT, IN p_offset INT)
BEGIN
  SELECT b.*, RANK() OVER (ORDER BY b.points DESC) AS `rank`
    FROM (""" + BOARD_BASE + """) b
   WHERE b.points > 0
   ORDER BY b.points DESC, b.last_gain ASC, b.user_id
   LIMIT p_limit OFFSET p_offset;
END""",

'sp_lb_board_count': """
CREATE PROCEDURE `sp_lb_board_count`(""" + BOARD_PARAMS + """)
BEGIN
  SELECT COUNT(*) AS total FROM (""" + BOARD_BASE + """) b WHERE b.points > 0;
END""",

'sp_lb_my_rank': """
CREATE PROCEDURE `sp_lb_my_rank`(""" + BOARD_PARAMS + """, IN p_user CHAR(36))
BEGIN
  SELECT r.* FROM (
    SELECT b.*, RANK() OVER (ORDER BY b.points DESC) AS `rank`
      FROM (""" + BOARD_BASE + """) b
  ) r WHERE r.user_id = p_user;
END""",

'sp_lb_profile_get': """
CREATE PROCEDURE `sp_lb_profile_get`(IN p_user CHAR(36))
BEGIN
  INSERT IGNORE INTO lb_profiles (user_id) VALUES (p_user);
  SELECT * FROM lb_profiles WHERE user_id = p_user;
END""",

'sp_lb_profile_set': """
CREATE PROCEDURE `sp_lb_profile_set`(IN p_user CHAR(36), IN p_alias VARCHAR(40), IN p_hide TINYINT)
BEGIN
  INSERT IGNORE INTO lb_profiles (user_id) VALUES (p_user);
  UPDATE lb_profiles SET alias = NULLIF(p_alias, ''), hide_photo = IFNULL(p_hide, hide_photo)
   WHERE user_id = p_user;
  SELECT * FROM lb_profiles WHERE user_id = p_user;
END""",

'sp_lb_remove': """
CREATE PROCEDURE `sp_lb_remove`(IN p_user CHAR(36), IN p_removed TINYINT, IN p_reason VARCHAR(255), IN p_admin CHAR(36))
BEGIN
  INSERT IGNORE INTO lb_profiles (user_id) VALUES (p_user);
  UPDATE lb_profiles
     SET removed = p_removed, removed_reason = IF(p_removed = 1, p_reason, NULL),
         removed_by = IF(p_removed = 1, p_admin, NULL), removed_at = IF(p_removed = 1, UTC_TIMESTAMP(), NULL)
   WHERE user_id = p_user;
  SELECT * FROM lb_profiles WHERE user_id = p_user;
END""",

'sp_lb_removed_list': """
CREATE PROCEDURE `sp_lb_removed_list`()
BEGIN
  SELECT lp.*, u.full_name, u.email FROM lb_profiles lp JOIN users u ON u.id = lp.user_id
   WHERE lp.removed = 1 ORDER BY lp.removed_at DESC;
END""",

'sp_league_settings_get': """
CREATE PROCEDURE `sp_league_settings_get`()
BEGIN
  INSERT IGNORE INTO league_settings (id) VALUES (1);
  SELECT * FROM league_settings WHERE id = 1;
END""",

'sp_league_settings_set': """
CREATE PROCEDURE `sp_league_settings_set`(IN p_enabled TINYINT, IN p_size INT, IN p_up INT, IN p_down INT,
  IN p_tiers VARCHAR(255), IN p_admin CHAR(36))
BEGIN
  INSERT IGNORE INTO league_settings (id) VALUES (1);
  UPDATE league_settings
     SET enabled = IFNULL(p_enabled, enabled), group_size = GREATEST(5, IFNULL(p_size, group_size)),
         promote_count = GREATEST(0, IFNULL(p_up, promote_count)),
         demote_count = GREATEST(0, IFNULL(p_down, demote_count)),
         tiers = IFNULL(NULLIF(p_tiers, ''), tiers), updated_by = p_admin
   WHERE id = 1;
  SELECT * FROM league_settings WHERE id = 1;
END""",

'sp_league_week_points': """
CREATE PROCEDURE `sp_league_week_points`(IN p_week DATE)
BEGIN
  -- Freeze each member's points for the week that just ended.
  UPDATE league_members lm
     SET lm.points = IFNULL((SELECT SUM(le.points) FROM lb_events le
                              WHERE le.user_id = lm.user_id
                                AND le.day >= p_week AND le.day < DATE_ADD(p_week, INTERVAL 7 DAY)), 0)
   WHERE lm.week_start = p_week;
  SELECT stage_group, sub_year, tier, group_no, user_id, points
    FROM league_members WHERE week_start = p_week
   ORDER BY stage_group, sub_year, tier, group_no, points DESC, user_id;
END""",

'sp_league_set_result': """
CREATE PROCEDURE `sp_league_set_result`(IN p_week DATE, IN p_user CHAR(36), IN p_rank INT, IN p_result VARCHAR(10))
BEGIN
  UPDATE league_members SET final_rank = p_rank, result = p_result
   WHERE week_start = p_week AND user_id = p_user;
END""",

'sp_league_eligible': """
CREATE PROCEDURE `sp_league_eligible`(IN p_since DATE, IN p_prev_week DATE)
BEGIN
  -- Students active in the last 4 weeks (or already in a league), with the tier
  -- they carry into the new week.
  SELECT st.user_id, st.stage_group, IFNULL(st.sub_year, '') AS sub_year,
         lm.tier AS prev_tier, lm.result AS prev_result
    FROM student_stages st
    JOIN users u ON u.id = st.user_id AND u.deleted_at IS NULL
    LEFT JOIN lb_profiles lp ON lp.user_id = st.user_id
    LEFT JOIN league_members lm ON lm.user_id = st.user_id AND lm.week_start = p_prev_week
   WHERE st.status = 'active' AND IFNULL(lp.removed, 0) = 0
     AND u.email NOT LIKE 'score-engine-test-%%'
     AND (lm.user_id IS NOT NULL
          OR EXISTS (SELECT 1 FROM lb_events le WHERE le.user_id = st.user_id AND le.day >= p_since));
END""",

'sp_league_add_member': """
CREATE PROCEDURE `sp_league_add_member`(IN p_week DATE, IN p_user CHAR(36), IN p_group VARCHAR(20),
  IN p_year VARCHAR(30), IN p_tier TINYINT, IN p_no INT)
BEGIN
  INSERT IGNORE INTO league_members (week_start, user_id, stage_group, sub_year, tier, group_no)
  VALUES (p_week, p_user, p_group, p_year, p_tier, p_no);
END""",

'sp_league_my_group': """
CREATE PROCEDURE `sp_league_my_group`(IN p_week DATE, IN p_user CHAR(36))
BEGIN
  SELECT lm.user_id, lm.tier, lm.group_no, lm.final_rank, lm.result,
         IFNULL((SELECT SUM(le.points) FROM lb_events le WHERE le.user_id = lm.user_id
                  AND le.day >= p_week AND le.day < DATE_ADD(p_week, INTERVAL 7 DAY)), 0) AS points,
         u.full_name, u.avatar_url, lp.alias, IFNULL(lp.hide_photo, 0) AS hide_photo
    FROM league_members me
    JOIN league_members lm ON lm.week_start = me.week_start AND lm.stage_group = me.stage_group
                          AND IFNULL(lm.sub_year, '') = IFNULL(me.sub_year, '')
                          AND lm.tier = me.tier AND lm.group_no = me.group_no
    JOIN users u ON u.id = lm.user_id
    LEFT JOIN lb_profiles lp ON lp.user_id = lm.user_id
   WHERE me.week_start = p_week AND me.user_id = p_user
   ORDER BY points DESC, lm.user_id;
END""",

'sp_league_last_result': """
CREATE PROCEDURE `sp_league_last_result`(IN p_user CHAR(36))
BEGIN
  SELECT week_start, tier, final_rank, result FROM league_members
   WHERE user_id = p_user AND result IS NOT NULL ORDER BY week_start DESC LIMIT 1;
END""",

'sp_lb_rule_points_list': """
CREATE PROCEDURE `sp_lb_rule_points_list`()
BEGIN
  SELECT event_type, label, points, is_active, IFNULL(leaderboard_points, 0) AS leaderboard_points
    FROM score_event_rules ORDER BY is_active DESC, label;
END""",

'sp_lb_rule_points_set': """
CREATE PROCEDURE `sp_lb_rule_points_set`(IN p_event VARCHAR(50), IN p_points DECIMAL(5,2))
BEGIN
  UPDATE score_event_rules SET leaderboard_points = GREATEST(0, LEAST(100, IFNULL(p_points, 0)))
   WHERE event_type = p_event;
  SELECT event_type, label, points, is_active, leaderboard_points
    FROM score_event_rules WHERE event_type = p_event;
END""",

'sp_hof_add': """
CREATE PROCEDURE `sp_hof_add`(IN p_id CHAR(36), IN p_season VARCHAR(60), IN p_group VARCHAR(20),
  IN p_year VARCHAR(30), IN p_scope VARCHAR(10), IN p_value VARCHAR(200), IN p_user CHAR(36),
  IN p_rank INT, IN p_points DECIMAL(8,2), IN p_admin CHAR(36))
BEGIN
  INSERT INTO hall_of_fame (id, season_label, stage_group, sub_year, scope, scope_value, user_id, `rank`, points, created_by)
  VALUES (p_id, p_season, p_group, p_year, p_scope, p_value, p_user, p_rank, p_points, p_admin);
END""",

'sp_hof_list': """
CREATE PROCEDURE `sp_hof_list`(IN p_user CHAR(36), IN p_season VARCHAR(60))
BEGIN
  SELECT h.*, u.full_name, u.avatar_url, lp.alias, IFNULL(lp.hide_photo, 0) AS hide_photo
    FROM hall_of_fame h JOIN users u ON u.id = h.user_id
    LEFT JOIN lb_profiles lp ON lp.user_id = h.user_id
   WHERE (p_user IS NULL OR p_user = '' OR h.user_id = p_user)
     AND (p_season IS NULL OR p_season = '' OR h.season_label = p_season)
   ORDER BY h.created_at DESC, h.stage_group, h.scope, h.`rank`
   LIMIT 500;
END""",

'sp_hof_season_exists': """
CREATE PROCEDURE `sp_hof_season_exists`(IN p_season VARCHAR(60))
BEGIN
  SELECT COUNT(*) AS n FROM hall_of_fame WHERE season_label = p_season;
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
        if not has_column('score_event_rules', 'leaderboard_points'):
            db.session.execute(text(
                "ALTER TABLE score_event_rules ADD COLUMN leaderboard_points DECIMAL(5,2) NOT NULL DEFAULT 0"))
            print("  score_event_rules.leaderboard_points added")
        for t in ('lb_settings', 'league_settings'):
            db.session.execute(text(f"INSERT IGNORE INTO {t} (id) VALUES (1)"))
        # Start the copy at the current high water: points earned before the
        # leaderboard existed do not flood this week's board.
        db.session.execute(text(
            "INSERT IGNORE INTO lb_state (id, last_seq) SELECT 1, IFNULL(MAX(seq), 0) FROM score_events"))
        db.session.commit()
        print("  tables ready")

        for name, ddl in PROCS.items():
            db.session.execute(text(f"DROP PROCEDURE IF EXISTS `{name}`"))
            db.session.execute(text(ddl.replace('%%', '%')))
        db.session.commit()
        print(f"  {len(PROCS)} procedures")
        print("Done.")


if __name__ == '__main__':
    main()
