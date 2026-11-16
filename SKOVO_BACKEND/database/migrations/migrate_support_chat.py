"""
Chat on each support issue (the person and SKOVO admins, with files).

  * support_issue_messages: one row per message; sender_role 'user' | 'admin';
    attachments is a JSON list of {url, name}. Rows are never edited or deleted.

Additive and idempotent. From SKOVO_BACKEND:
    python database/migrations/migrate_support_chat.py
"""
from sqlalchemy import text
import _bootstrap  # noqa: F401
from portal import InitApp
from portal.models import db

app = InitApp().app()


def run():
    with app.app_context():
        db.session.execute(text("SET SESSION lock_wait_timeout = 10"))
        have = db.session.execute(text(
            "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()"
            " AND TABLE_NAME = 'support_issue_messages'")).scalar()
        if have:
            print("  [ok] support_issue_messages already there")
            # Edit (15 min) / delete (2 days) own messages; the original is kept.
            for col, ddl in (('edited_at', 'DATETIME NULL'), ('deleted_at', 'DATETIME NULL'), ('original_body', 'TEXT NULL')):
                if not db.session.execute(text(
                        "SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()"
                        " AND TABLE_NAME = 'support_issue_messages' AND COLUMN_NAME = :c"), {'c': col}).scalar():
                    db.session.execute(text(f"ALTER TABLE support_issue_messages ADD COLUMN `{col}` {ddl}"))
                    db.session.commit()
                    print(f"  [ok] support_issue_messages.{col}")
            return
        db.session.execute(text("""
            CREATE TABLE `support_issue_messages` (
              `id` CHAR(36) NOT NULL PRIMARY KEY,
              `issue_id` CHAR(36) NOT NULL,
              `sender_id` CHAR(36) NOT NULL,
              `sender_role` VARCHAR(10) NOT NULL,
              `body` TEXT NULL,
              `attachments` TEXT NULL,
              `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
              KEY `ix_issue_messages_issue` (`issue_id`, `created_at`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"""))
        db.session.commit()
        print("  [ok] support_issue_messages")


if __name__ == '__main__':
    run()
