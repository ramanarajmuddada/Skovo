"""
Migration: admin role-based access control (§4.8 / §5.8 — "from day one").

Four roles, per spec:

  founder            all areas
  product_ops        most — everything except finance
  content_moderator  content and moderation only
  finance            payments only

Existing admins become 'founder' so nothing they could do yesterday breaks
today. Narrowing a real person's access is a deliberate act, not a migration
side effect.

Idempotent. Run from SKOVO_BACKEND:  python migrate_admin_roles.py
"""
import _bootstrap  # noqa: F401 — puts SKOVO_BACKEND on sys.path and cwd
from portal import InitApp
from portal.models import db
from sqlalchemy import text

app = InitApp().app()

STMTS = [
    ("alter", "ALTER TABLE admins ADD COLUMN admin_role VARCHAR(24) NOT NULL DEFAULT 'founder'"),

    ("sp", "DROP PROCEDURE IF EXISTS sp_admin_role_get"),
    ("sp", """
    CREATE PROCEDURE sp_admin_role_get(IN p_id CHAR(36))
    BEGIN
      SELECT id, full_name, email, admin_role, status FROM admins WHERE id = p_id;
    END
    """),

    ("sp", "DROP PROCEDURE IF EXISTS sp_admin_roles_list"),
    ("sp", """
    CREATE PROCEDURE sp_admin_roles_list()
    BEGIN
      SELECT id, full_name, email, admin_role, status, created_at
        FROM admins ORDER BY created_at ASC;
    END
    """),

    ("sp", "DROP PROCEDURE IF EXISTS sp_admin_role_set"),
    ("sp", """
    CREATE PROCEDURE sp_admin_role_set(IN p_id CHAR(36), IN p_role VARCHAR(24))
    BEGIN
      DECLARE v_founders INT DEFAULT 0;
      -- Never let the last founder demote themselves out of the platform.
      SELECT COUNT(*) INTO v_founders FROM admins
       WHERE admin_role = 'founder' AND status = 'active' AND id <> p_id;

      IF p_role <> 'founder' AND v_founders = 0 THEN
        SELECT 0 AS ok, 'At least one founder must remain.' AS message;
      ELSE
        UPDATE admins SET admin_role = p_role WHERE id = p_id;
        SELECT ROW_COUNT() AS ok, 'Role updated.' AS message;
      END IF;
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
        n = db.session.execute(text("SELECT COUNT(*) FROM admins")).scalar()
        print(f"admin roles migration complete. admins={n}")


if __name__ == "__main__":
    main()
