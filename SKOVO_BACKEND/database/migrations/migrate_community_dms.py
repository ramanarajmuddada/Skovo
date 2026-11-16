"""
Migration: Peer Communities — direct messages, blocks and reports (v1 spec).

Free members join up to 3 communities (enforced in the join route via
sp_assemble_my_group_count); Skovo Pro unlocks unlimited joins and direct
messages between members who share a community. Blocks are bidirectional and
reports land in a moderation queue.

Idempotent. Run from SKOVO_BACKEND:  python migrate_community_dms.py
"""
import _bootstrap  # noqa: F401 — puts SKOVO_BACKEND on sys.path and cwd
from portal import InitApp
from portal.models import db
from sqlalchemy import text

app = InitApp().app()

STMTS = [
    ("table", """
    CREATE TABLE IF NOT EXISTS direct_messages (
      id CHAR(36) PRIMARY KEY,
      sender_id CHAR(36) NOT NULL,
      recipient_id CHAR(36) NOT NULL,
      body TEXT NOT NULL,
      is_read TINYINT(1) NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_dm_pair (sender_id, recipient_id, created_at),
      INDEX idx_dm_inbox (recipient_id, is_read)
    )
    """),
    ("table", """
    CREATE TABLE IF NOT EXISTS dm_blocks (
      id CHAR(36) PRIMARY KEY,
      user_id CHAR(36) NOT NULL,
      blocked_user_id CHAR(36) NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_dm_block (user_id, blocked_user_id)
    )
    """),
    ("table", """
    CREATE TABLE IF NOT EXISTS dm_reports (
      id CHAR(36) PRIMARY KEY,
      reporter_id CHAR(36) NOT NULL,
      reported_user_id CHAR(36) NOT NULL,
      message_id CHAR(36) NULL,
      reason TEXT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'open',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_dmr_open (status, created_at)
    )
    """),

    # ── free-tier join cap ────────────────────────────────────────────────
    ("sp", "DROP PROCEDURE IF EXISTS sp_assemble_my_group_count"),
    ("sp", """
    CREATE PROCEDURE sp_assemble_my_group_count(IN p_user CHAR(36))
    BEGIN
      SELECT COUNT(*) AS total FROM group_memberships
       WHERE user_id = p_user AND status = 'active';
    END
    """),

    # ── you may only DM someone you share a community with ────────────────
    ("sp", "DROP PROCEDURE IF EXISTS sp_dm_shared_group"),
    ("sp", """
    CREATE PROCEDURE sp_dm_shared_group(IN p_a CHAR(36), IN p_b CHAR(36))
    BEGIN
      SELECT COUNT(*) AS shared
        FROM group_memberships ga
        JOIN group_memberships gb ON ga.group_id = gb.group_id
       WHERE ga.user_id = p_a AND gb.user_id = p_b
         AND ga.status = 'active' AND gb.status = 'active';
    END
    """),

    ("sp", "DROP PROCEDURE IF EXISTS sp_dm_send"),
    ("sp", """
    CREATE PROCEDURE sp_dm_send(IN p_id CHAR(36), IN p_sender CHAR(36),
                                IN p_recipient CHAR(36), IN p_body TEXT)
    BEGIN
      -- A block cuts both directions.
      IF EXISTS (SELECT 1 FROM dm_blocks
                  WHERE (user_id = p_recipient AND blocked_user_id = p_sender)
                     OR (user_id = p_sender AND blocked_user_id = p_recipient)) THEN
        SELECT 0 AS ok, 'You can no longer message this member.' AS message, NULL AS id;
      ELSE
        INSERT INTO direct_messages (id, sender_id, recipient_id, body)
        VALUES (p_id, p_sender, p_recipient, p_body);
        SELECT 1 AS ok, 'Sent.' AS message, p_id AS id;
      END IF;
    END
    """),

    ("sp", "DROP PROCEDURE IF EXISTS sp_dm_thread"),
    ("sp", """
    CREATE PROCEDURE sp_dm_thread(IN p_me CHAR(36), IN p_other CHAR(36), IN p_limit INT)
    BEGIN
      UPDATE direct_messages SET is_read = 1
       WHERE recipient_id = p_me AND sender_id = p_other AND is_read = 0;

      SELECT id, sender_id, recipient_id, body, is_read, created_at
        FROM direct_messages
       WHERE (sender_id = p_me AND recipient_id = p_other)
          OR (sender_id = p_other AND recipient_id = p_me)
       ORDER BY created_at ASC
       LIMIT p_limit;
    END
    """),

    ("sp", "DROP PROCEDURE IF EXISTS sp_dm_conversations"),
    ("sp", """
    CREATE PROCEDURE sp_dm_conversations(IN p_me CHAR(36))
    BEGIN
      SELECT t.other_id,
             (SELECT m.body FROM direct_messages m
               WHERE (m.sender_id = p_me AND m.recipient_id = t.other_id)
                  OR (m.sender_id = t.other_id AND m.recipient_id = p_me)
               ORDER BY m.created_at DESC LIMIT 1) AS last_body,
             t.last_at, t.unread
        FROM (SELECT CASE WHEN sender_id = p_me THEN recipient_id ELSE sender_id END AS other_id,
                     MAX(created_at) AS last_at,
                     SUM(CASE WHEN recipient_id = p_me AND is_read = 0 THEN 1 ELSE 0 END) AS unread
                FROM direct_messages
               WHERE sender_id = p_me OR recipient_id = p_me
               GROUP BY other_id) t
       ORDER BY t.last_at DESC;
    END
    """),

    ("sp", "DROP PROCEDURE IF EXISTS sp_dm_block"),
    ("sp", """
    CREATE PROCEDURE sp_dm_block(IN p_id CHAR(36), IN p_user CHAR(36), IN p_blocked CHAR(36))
    BEGIN
      INSERT IGNORE INTO dm_blocks (id, user_id, blocked_user_id)
      VALUES (p_id, p_user, p_blocked);
      SELECT 1 AS ok, 'Member blocked.' AS message;
    END
    """),

    ("sp", "DROP PROCEDURE IF EXISTS sp_dm_unblock"),
    ("sp", """
    CREATE PROCEDURE sp_dm_unblock(IN p_user CHAR(36), IN p_blocked CHAR(36))
    BEGIN
      DELETE FROM dm_blocks WHERE user_id = p_user AND blocked_user_id = p_blocked;
      SELECT 1 AS ok, 'Member unblocked.' AS message;
    END
    """),

    ("sp", "DROP PROCEDURE IF EXISTS sp_dm_report"),
    ("sp", """
    CREATE PROCEDURE sp_dm_report(IN p_id CHAR(36), IN p_reporter CHAR(36), IN p_reported CHAR(36),
                                  IN p_message_id CHAR(36), IN p_reason TEXT)
    BEGIN
      INSERT INTO dm_reports (id, reporter_id, reported_user_id, message_id, reason)
      VALUES (p_id, p_reporter, p_reported, p_message_id, p_reason);
      SELECT 1 AS ok, 'Report submitted. Our team will review it.' AS message;
    END
    """),
]


def main():
    with app.app_context():
        for kind, s in STMTS:
            try:
                db.session.execute(text(s)); db.session.commit()
            except Exception as e:
                db.session.rollback()
                if kind == "alter" and "Duplicate column" in str(e):
                    pass
                else:
                    raise
        print("community DM migration complete.")


if __name__ == "__main__":
    main()
