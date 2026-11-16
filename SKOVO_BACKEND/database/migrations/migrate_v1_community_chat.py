"""Community live chat: messages, replies, reactions, polls, doubts, safety.

WHY
    feature-updates.md §6. Communities were a post feed. Version 1 adds a
    WhatsApp-style chat inside each community, keeping the existing limits
    (free: 3 communities joined + created; Pro: unlimited) and roles.

WHAT CHANGES
    groups               + admin_only, slow_mode_seconds, allow_links, invite_code
    community_messages   chat messages (seq for cursors), replies, mentions,
                         doubt / solved, flags (masked number, blocked words)
    community_reactions  emoji reactions
    community_polls      + community_poll_votes
    community_reads      unread cursor + mute per member
    community_reports    reported messages (owner + platform admin)
    community_blocked_words  admin-maintained Telugu + English list
    score_event_rules    + answer_solved (cap 2 / day), top_helper_week
                           -- 0 points, inactive; forum accepted answers pay the
                           same answer_solved rule, so one daily cap covers both

Additive, idempotent. From SKOVO_BACKEND:
    python database/migrations/migrate_v1_community_chat.py
"""
from sqlalchemy import text

import _bootstrap  # noqa: F401
from portal import InitApp
from portal.models import db

app = InitApp().app()

COLUMNS = [
    ('groups', 'admin_only', "TINYINT(1) NOT NULL DEFAULT 0"),
    ('groups', 'slow_mode_seconds', "INT NOT NULL DEFAULT 0"),
    ('groups', 'allow_links', "TINYINT(1) NOT NULL DEFAULT 0"),
    ('groups', 'invite_code', "VARCHAR(12) NULL"),
]

TABLES = [
"""CREATE TABLE IF NOT EXISTS `community_messages` (
  `id`              CHAR(36)     NOT NULL,
  `seq`             BIGINT       NOT NULL AUTO_INCREMENT,
  `group_id`        CHAR(36)     NOT NULL,
  `sender_id`       CHAR(36)     NOT NULL,
  `body`            TEXT         NULL,
  `media_url`       VARCHAR(1000) NULL,
  `media_type`      VARCHAR(20)  NULL,
  `reply_to_id`     CHAR(36)     NULL,
  `mentions_json`   JSON         NULL,
  `poll_id`         CHAR(36)     NULL,
  `is_doubt`        TINYINT(1)   NOT NULL DEFAULT 0,
  `solved_by_message_id` CHAR(36) NULL,
  `solved_at`       DATETIME     NULL,
  `flags_json`      JSON         NULL,
  `deleted_at`      DATETIME     NULL,
  `deleted_by`      CHAR(36)     NULL,
  `created_at`      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_cm_seq` (`seq`),
  KEY `ix_cm_group_seq` (`group_id`, `seq`),
  KEY `ix_cm_sender` (`sender_id`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci""",

"""CREATE TABLE IF NOT EXISTS `community_reactions` (
  `message_id` CHAR(36)    NOT NULL,
  `user_id`    CHAR(36)    NOT NULL,
  `emoji`      VARCHAR(16) NOT NULL,
  `created_at` DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`message_id`, `user_id`, `emoji`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci""",

"""CREATE TABLE IF NOT EXISTS `community_polls` (
  `id`           CHAR(36)     NOT NULL,
  `group_id`     CHAR(36)     NOT NULL,
  `question`     VARCHAR(300) NOT NULL,
  `options_json` JSON         NOT NULL,
  `multi`        TINYINT(1)   NOT NULL DEFAULT 0,
  `closes_at`    DATETIME     NULL,
  `created_by`   CHAR(36)     NOT NULL,
  `created_at`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci""",

"""CREATE TABLE IF NOT EXISTS `community_poll_votes` (
  `poll_id`      CHAR(36) NOT NULL,
  `user_id`      CHAR(36) NOT NULL,
  `option_index` INT      NOT NULL,
  `created_at`   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`poll_id`, `user_id`, `option_index`)
) ENGINE=InnoDB""",

"""CREATE TABLE IF NOT EXISTS `community_reads` (
  `user_id`       CHAR(36)   NOT NULL,
  `group_id`      CHAR(36)   NOT NULL,
  `last_read_seq` BIGINT     NOT NULL DEFAULT 0,
  `muted`         TINYINT(1) NOT NULL DEFAULT 0,
  `updated_at`    DATETIME   NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`, `group_id`)
) ENGINE=InnoDB""",

"""CREATE TABLE IF NOT EXISTS `community_reports` (
  `id`          CHAR(36)     NOT NULL,
  `message_id`  CHAR(36)     NOT NULL,
  `group_id`    CHAR(36)     NOT NULL,
  `reporter_id` CHAR(36)     NOT NULL,
  `reason`      VARCHAR(300) NULL,
  `status`      VARCHAR(10)  NOT NULL DEFAULT 'open',
  `resolved_by` CHAR(36)     NULL,
  `resolved_at` DATETIME     NULL,
  `action`      VARCHAR(20)  NULL,
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `ix_cr_status` (`status`, `created_at`),
  KEY `ix_cr_group` (`group_id`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci""",

"""CREATE TABLE IF NOT EXISTS `community_blocked_words` (
  `word`       VARCHAR(60) NOT NULL,
  `lang`       VARCHAR(5)  NOT NULL DEFAULT 'en',
  `created_by` CHAR(36)    NULL,
  `created_at` DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`word`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci""",
]

RULES = [
    ('answer_solved', 'Answer marked Solved (community or forum)', 'daily', 2),
    ('top_helper_week', 'Weekly Top Helper in a community', 'weekly', 1),
]

PROCS = {
'sp_cm_message_create': """
CREATE PROCEDURE `sp_cm_message_create`(IN p_id CHAR(36), IN p_group CHAR(36), IN p_sender CHAR(36),
  IN p_body TEXT, IN p_media VARCHAR(1000), IN p_media_type VARCHAR(20), IN p_reply CHAR(36),
  IN p_mentions JSON, IN p_poll CHAR(36), IN p_doubt TINYINT, IN p_flags JSON)
BEGIN
  INSERT INTO community_messages (id, group_id, sender_id, body, media_url, media_type, reply_to_id,
                                  mentions_json, poll_id, is_doubt, flags_json)
  VALUES (p_id, p_group, p_sender, p_body, p_media, p_media_type, p_reply, p_mentions, p_poll,
          IFNULL(p_doubt, 0), p_flags);
  -- The sender has read their own message.
  INSERT INTO community_reads (user_id, group_id, last_read_seq)
  VALUES (p_sender, p_group, (SELECT seq FROM community_messages WHERE id = p_id))
  ON DUPLICATE KEY UPDATE last_read_seq = GREATEST(last_read_seq, VALUES(last_read_seq));
  CALL sp_cm_message_get(p_id);
END""",

'sp_cm_message_get': """
CREATE PROCEDURE `sp_cm_message_get`(IN p_id CHAR(36))
BEGIN
  SELECT m.*, u.full_name AS sender_name, u.avatar_url AS sender_avatar,
         r.body AS reply_body, ru.full_name AS reply_sender_name
    FROM community_messages m
    JOIN users u ON u.id = m.sender_id
    LEFT JOIN community_messages r ON r.id = m.reply_to_id
    LEFT JOIN users ru ON ru.id = r.sender_id
   WHERE m.id = p_id;
END""",

'sp_cm_messages_list': """
CREATE PROCEDURE `sp_cm_messages_list`(IN p_group CHAR(36), IN p_after BIGINT, IN p_before BIGINT, IN p_limit INT)
BEGIN
  -- after > 0: newer than a cursor (live polling); before > 0: older page.
  SELECT * FROM (
    SELECT m.*, u.full_name AS sender_name, u.avatar_url AS sender_avatar,
           r.body AS reply_body, ru.full_name AS reply_sender_name
      FROM community_messages m
      JOIN users u ON u.id = m.sender_id
      LEFT JOIN community_messages r ON r.id = m.reply_to_id
      LEFT JOIN users ru ON ru.id = r.sender_id
     WHERE m.group_id = p_group
       AND (IFNULL(p_after, 0) = 0 OR m.seq > p_after)
       AND (IFNULL(p_before, 0) = 0 OR m.seq < p_before)
     ORDER BY IF(IFNULL(p_after, 0) > 0, m.seq, -m.seq)
     LIMIT p_limit
  ) x ORDER BY x.seq;
END""",

'sp_cm_message_delete': """
CREATE PROCEDURE `sp_cm_message_delete`(IN p_id CHAR(36), IN p_actor CHAR(36))
BEGIN
  UPDATE community_messages SET deleted_at = UTC_TIMESTAMP(), deleted_by = p_actor
   WHERE id = p_id AND deleted_at IS NULL;
  SELECT ROW_COUNT() AS deleted;
END""",

'sp_cm_last_sent': """
CREATE PROCEDURE `sp_cm_last_sent`(IN p_group CHAR(36), IN p_user CHAR(36))
BEGIN
  SELECT MAX(created_at) AS last_at FROM community_messages
   WHERE group_id = p_group AND sender_id = p_user AND deleted_at IS NULL;
END""",

'sp_cm_react_toggle': """
CREATE PROCEDURE `sp_cm_react_toggle`(IN p_message CHAR(36), IN p_user CHAR(36), IN p_emoji VARCHAR(16))
BEGIN
  IF EXISTS (SELECT 1 FROM community_reactions WHERE message_id = p_message AND user_id = p_user AND emoji = p_emoji) THEN
    DELETE FROM community_reactions WHERE message_id = p_message AND user_id = p_user AND emoji = p_emoji;
    SELECT 'removed' AS result;
  ELSE
    INSERT INTO community_reactions (message_id, user_id, emoji) VALUES (p_message, p_user, p_emoji);
    SELECT 'added' AS result;
  END IF;
END""",

'sp_cm_reactions_for_group': """
CREATE PROCEDURE `sp_cm_reactions_for_group`(IN p_group CHAR(36), IN p_from_seq BIGINT, IN p_to_seq BIGINT)
BEGIN
  SELECT r.message_id, r.emoji, COUNT(*) AS n, GROUP_CONCAT(r.user_id) AS user_ids
    FROM community_reactions r
    JOIN community_messages m ON m.id = r.message_id
   WHERE m.group_id = p_group AND m.seq BETWEEN p_from_seq AND p_to_seq
   GROUP BY r.message_id, r.emoji;
END""",

'sp_cm_poll_create': """
CREATE PROCEDURE `sp_cm_poll_create`(IN p_id CHAR(36), IN p_group CHAR(36), IN p_q VARCHAR(300),
  IN p_options JSON, IN p_multi TINYINT, IN p_closes DATETIME, IN p_user CHAR(36))
BEGIN
  INSERT INTO community_polls (id, group_id, question, options_json, multi, closes_at, created_by)
  VALUES (p_id, p_group, p_q, p_options, IFNULL(p_multi, 0), p_closes, p_user);
  SELECT * FROM community_polls WHERE id = p_id;
END""",

'sp_cm_poll_get': """
CREATE PROCEDURE `sp_cm_poll_get`(IN p_id CHAR(36))
BEGIN
  SELECT * FROM community_polls WHERE id = p_id;
END""",

'sp_cm_poll_vote': """
CREATE PROCEDURE `sp_cm_poll_vote`(IN p_poll CHAR(36), IN p_user CHAR(36), IN p_option INT, IN p_multi TINYINT)
BEGIN
  IF IFNULL(p_multi, 0) = 0 THEN
    DELETE FROM community_poll_votes WHERE poll_id = p_poll AND user_id = p_user;
  END IF;
  INSERT IGNORE INTO community_poll_votes (poll_id, user_id, option_index) VALUES (p_poll, p_user, p_option);
  SELECT 1 AS ok;
END""",

'sp_cm_poll_results': """
CREATE PROCEDURE `sp_cm_poll_results`(IN p_poll CHAR(36))
BEGIN
  SELECT option_index, COUNT(*) AS votes, GROUP_CONCAT(user_id) AS user_ids
    FROM community_poll_votes WHERE poll_id = p_poll GROUP BY option_index;
END""",

'sp_cm_mark_solved': """
CREATE PROCEDURE `sp_cm_mark_solved`(IN p_doubt CHAR(36), IN p_answer CHAR(36))
BEGIN
  UPDATE community_messages SET solved_by_message_id = p_answer, solved_at = UTC_TIMESTAMP()
   WHERE id = p_doubt AND is_doubt = 1 AND solved_by_message_id IS NULL;
  SELECT ROW_COUNT() AS solved;
END""",

'sp_cm_read_set': """
CREATE PROCEDURE `sp_cm_read_set`(IN p_user CHAR(36), IN p_group CHAR(36), IN p_seq BIGINT)
BEGIN
  INSERT INTO community_reads (user_id, group_id, last_read_seq) VALUES (p_user, p_group, p_seq)
  ON DUPLICATE KEY UPDATE last_read_seq = GREATEST(last_read_seq, p_seq);
  SELECT 1 AS ok;
END""",

'sp_cm_mute_set': """
CREATE PROCEDURE `sp_cm_mute_set`(IN p_user CHAR(36), IN p_group CHAR(36), IN p_muted TINYINT)
BEGIN
  INSERT INTO community_reads (user_id, group_id, muted) VALUES (p_user, p_group, p_muted)
  ON DUPLICATE KEY UPDATE muted = p_muted;
  SELECT 1 AS ok;
END""",

'sp_cm_unread_counts': """
CREATE PROCEDURE `sp_cm_unread_counts`(IN p_user CHAR(36))
BEGIN
  SELECT gm.group_id,
         (SELECT COUNT(*) FROM community_messages m
           WHERE m.group_id = gm.group_id AND m.deleted_at IS NULL AND m.sender_id <> p_user
             AND m.seq > IFNULL(cr.last_read_seq, 0)) AS unread,
         IFNULL(cr.muted, 0) AS muted,
         (SELECT MAX(m2.created_at) FROM community_messages m2 WHERE m2.group_id = gm.group_id) AS last_message_at
    FROM group_memberships gm
    LEFT JOIN community_reads cr ON cr.user_id = p_user AND cr.group_id = gm.group_id
   WHERE gm.user_id = p_user AND gm.status = 'active';
END""",

'sp_cm_group_settings_set': """
CREATE PROCEDURE `sp_cm_group_settings_set`(IN p_group CHAR(36), IN p_admin_only TINYINT,
  IN p_slow INT, IN p_links TINYINT, IN p_actor CHAR(36))
BEGIN
  UPDATE `groups` SET admin_only = IFNULL(p_admin_only, admin_only),
         slow_mode_seconds = GREATEST(0, LEAST(3600, IFNULL(p_slow, slow_mode_seconds))),
         allow_links = IFNULL(p_links, allow_links), updated_by = p_actor
   WHERE id = p_group;
  SELECT id, admin_only, slow_mode_seconds, allow_links, invite_code FROM `groups` WHERE id = p_group;
END""",

'sp_cm_group_chat_settings': """
CREATE PROCEDURE `sp_cm_group_chat_settings`(IN p_group CHAR(36))
BEGIN
  SELECT id, name, created_by, is_active, deleted_at, admin_only, slow_mode_seconds, allow_links, invite_code,
         max_members, member_count, join_type
    FROM `groups` WHERE id = p_group;
END""",

'sp_cm_invite_code_set': """
CREATE PROCEDURE `sp_cm_invite_code_set`(IN p_group CHAR(36), IN p_code VARCHAR(12))
BEGIN
  UPDATE `groups` SET invite_code = p_code WHERE id = p_group;
  SELECT invite_code FROM `groups` WHERE id = p_group;
END""",

'sp_cm_group_by_invite': """
CREATE PROCEDURE `sp_cm_group_by_invite`(IN p_code VARCHAR(12))
BEGIN
  SELECT id, name, is_active, deleted_at FROM `groups` WHERE invite_code = p_code LIMIT 1;
END""",

'sp_cm_report_create': """
CREATE PROCEDURE `sp_cm_report_create`(IN p_id CHAR(36), IN p_message CHAR(36), IN p_group CHAR(36),
  IN p_reporter CHAR(36), IN p_reason VARCHAR(300))
BEGIN
  INSERT INTO community_reports (id, message_id, group_id, reporter_id, reason)
  SELECT p_id, p_message, p_group, p_reporter, p_reason
   WHERE NOT EXISTS (SELECT 1 FROM community_reports WHERE message_id = p_message
                      AND reporter_id = p_reporter AND status = 'open');
  SELECT ROW_COUNT() AS created;
END""",

'sp_cm_reports_list': """
CREATE PROCEDURE `sp_cm_reports_list`(IN p_group CHAR(36), IN p_status VARCHAR(10), IN p_limit INT, IN p_offset INT)
BEGIN
  SELECT r.*, m.body, m.sender_id, su.full_name AS sender_name, ru.full_name AS reporter_name, g.name AS group_name
    FROM community_reports r
    JOIN community_messages m ON m.id = r.message_id
    JOIN users su ON su.id = m.sender_id
    JOIN users ru ON ru.id = r.reporter_id
    JOIN `groups` g ON g.id = r.group_id
   WHERE (p_group IS NULL OR p_group = '' OR r.group_id = p_group)
     AND (p_status IS NULL OR p_status = '' OR r.status = p_status)
   ORDER BY r.created_at DESC LIMIT p_limit OFFSET p_offset;
END""",

'sp_cm_report_resolve': """
CREATE PROCEDURE `sp_cm_report_resolve`(IN p_id CHAR(36), IN p_actor CHAR(36), IN p_action VARCHAR(20))
BEGIN
  UPDATE community_reports SET status = 'resolved', resolved_by = p_actor, resolved_at = UTC_TIMESTAMP(),
         action = p_action WHERE id = p_id;
  SELECT * FROM community_reports WHERE id = p_id;
END""",

'sp_cm_top_helpers': """
CREATE PROCEDURE `sp_cm_top_helpers`(IN p_group CHAR(36), IN p_since DATETIME, IN p_limit INT)
BEGIN
  SELECT a.sender_id AS user_id, u.full_name, u.avatar_url, COUNT(*) AS solved
    FROM community_messages d
    JOIN community_messages a ON a.id = d.solved_by_message_id
    JOIN users u ON u.id = a.sender_id
   WHERE d.group_id = p_group AND d.solved_at >= p_since AND a.sender_id <> d.sender_id
   GROUP BY a.sender_id, u.full_name, u.avatar_url
   ORDER BY solved DESC, MIN(d.solved_at) ASC LIMIT p_limit;
END""",

'sp_cm_groups_with_solved': """
CREATE PROCEDURE `sp_cm_groups_with_solved`(IN p_since DATETIME, IN p_until DATETIME)
BEGIN
  SELECT DISTINCT group_id FROM community_messages WHERE solved_at >= p_since AND solved_at < p_until;
END""",

'sp_cm_blocked_words': """
CREATE PROCEDURE `sp_cm_blocked_words`()
BEGIN
  SELECT word, lang FROM community_blocked_words ORDER BY lang, word;
END""",

'sp_cm_blocked_word_add': """
CREATE PROCEDURE `sp_cm_blocked_word_add`(IN p_word VARCHAR(60), IN p_lang VARCHAR(5), IN p_admin CHAR(36))
BEGIN
  INSERT IGNORE INTO community_blocked_words (word, lang, created_by) VALUES (p_word, IFNULL(p_lang, 'en'), p_admin);
  SELECT ROW_COUNT() AS added;
END""",

'sp_cm_blocked_word_delete': """
CREATE PROCEDURE `sp_cm_blocked_word_delete`(IN p_word VARCHAR(60))
BEGIN
  DELETE FROM community_blocked_words WHERE word = p_word;
  SELECT ROW_COUNT() AS deleted;
END""",

'sp_cm_member_role': """
CREATE PROCEDURE `sp_cm_member_role`(IN p_group CHAR(36), IN p_user CHAR(36))
BEGIN
  SELECT role, status FROM group_memberships WHERE group_id = p_group AND user_id = p_user LIMIT 1;
END""",

'sp_cm_member_search': """
CREATE PROCEDURE `sp_cm_member_search`(IN p_q VARCHAR(100), IN p_limit INT)
BEGIN
  -- Owner "add member": name + school, never phone or email.
  SELECT u.id AS user_id, u.full_name, u.avatar_url,
         COALESCE(NULLIF(p.college_name, ''), p.school_name) AS institute, p.city
    FROM users u
    JOIN user_profiles p ON p.user_id = u.id
   WHERE u.deleted_at IS NULL AND u.status = 'active'
     AND (u.full_name LIKE CONCAT('%', p_q, '%')
          OR p.school_name LIKE CONCAT('%', p_q, '%') OR p.college_name LIKE CONCAT('%', p_q, '%'))
   ORDER BY u.full_name LIMIT p_limit;
END""",
}


def has_column(table, col):
    return db.session.execute(text(
        "SELECT COUNT(*) FROM information_schema.COLUMNS "
        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND COLUMN_NAME = :c"
    ), {'t': table, 'c': col}).scalar() > 0


def main():
    with app.app_context():
        for table, col, ddl in COLUMNS:
            if not has_column(table, col):
                db.session.execute(text(f"ALTER TABLE `{table}` ADD COLUMN `{col}` {ddl}"))
                print(f"  {table}.{col} added")
        has_idx = db.session.execute(text(
            "SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() "
            "AND TABLE_NAME = 'groups' AND INDEX_NAME = 'uq_groups_invite'")).scalar()
        if not has_idx:
            db.session.execute(text("ALTER TABLE `groups` ADD UNIQUE KEY `uq_groups_invite` (`invite_code`)"))
        for ddl in TABLES:
            db.session.execute(text(ddl))
        for key, label, cap_type, cap in RULES:
            db.session.execute(text(
                "INSERT IGNORE INTO score_event_rules (event_type, label, points, is_active, cap_type, cap_value) "
                "VALUES (:k, :l, 0, 0, :ct, :cv)"), {'k': key, 'l': label, 'ct': cap_type, 'cv': cap})
        db.session.commit()
        print("  tables + inactive rules ready")
        for name, ddl in PROCS.items():
            db.session.execute(text(f"DROP PROCEDURE IF EXISTS `{name}`"))
            db.session.execute(text(ddl))
        db.session.commit()
        print(f"  {len(PROCS)} procedures")
        print("Done.")


if __name__ == '__main__':
    main()
