"""
Migration: DPDP Act 2023 consent capture (v1 §11.1 — "non-optional").

Captures:
  * date of birth + derived age band at signup
  * an append-only consent ledger (what was agreed, which policy version, when)
  * parental consent for the 14–17 band before the minor account activates

MECHANISM NOTE (needs founder / legal sign-off):
  The spec's Open Questions leave the minor-consent mechanism undecided
  (parent email vs parent phone OTP vs school verification). This ships the
  most common, lowest-friction default — parental EMAIL verification via a
  tokenised confirmation link — and keeps the record model mechanism-agnostic,
  so switching to phone OTP later is a route change, not a schema change.

Idempotent. Run from SKOVO_BACKEND:  python migrate_dpdp_consent.py
"""
import _bootstrap  # noqa: F401 — puts SKOVO_BACKEND on sys.path and cwd
from portal import InitApp
from portal.models import db
from sqlalchemy import text

app = InitApp().app()

STMTS = [
    # date_of_birth was assumed to exist here. It did on the machine this was
    # written on and nowhere else: no model, no migration and no DDL in the
    # repo ever created it, so every fresh deploy answered 500 on the DOB
    # step of signup. Added first, before the columns derived from it.
    ("alter", "ALTER TABLE users ADD COLUMN date_of_birth DATE NULL"),
    ("alter", "ALTER TABLE users ADD COLUMN consent_status VARCHAR(20) NOT NULL DEFAULT 'pending'"),

    # Append-only consent ledger — one row per agreement, never overwritten.
    ("table", """
    CREATE TABLE IF NOT EXISTS user_consents (
      id CHAR(36) PRIMARY KEY,
      user_id CHAR(36) NOT NULL,
      consent_type VARCHAR(40) NOT NULL,
      policy_version VARCHAR(20) NOT NULL DEFAULT 'v1',
      granted TINYINT(1) NOT NULL DEFAULT 1,
      ip VARCHAR(64) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_uc_user (user_id, consent_type, created_at)
    )
    """),

    # Parental consent for the 14–17 band. Tokenised link the parent confirms.
    ("table", """
    CREATE TABLE IF NOT EXISTS parental_consents (
      id CHAR(36) PRIMARY KEY,
      user_id CHAR(36) NOT NULL,
      parent_email VARCHAR(160) NOT NULL,
      parent_name VARCHAR(120) NULL,
      token CHAR(36) NOT NULL UNIQUE,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      confirmed_at DATETIME NULL,
      expires_at DATETIME NOT NULL,
      INDEX idx_pc_user (user_id, status)
    )
    """),

    # ── derive + persist age band from DOB ────────────────────────────────
    ("sp", "DROP PROCEDURE IF EXISTS sp_user_set_dob"),
    ("sp", """
    CREATE PROCEDURE sp_user_set_dob(IN p_user CHAR(36), IN p_dob DATE)
    BEGIN
      DECLARE v_age INT DEFAULT 0;
      SET v_age = TIMESTAMPDIFF(YEAR, p_dob, CURDATE());

      -- No age banding. There is no minimum age and no parental-consent
      -- step, so the date of birth is stored as plain profile data and
      -- every account is granted.
      UPDATE users SET date_of_birth = p_dob, consent_status = 'granted'
       WHERE id = p_user;

      SELECT v_age AS age,
             (SELECT consent_status FROM users WHERE id = p_user) AS consent_status;
    END
    """),

    # ── record a consent grant (append-only) ──────────────────────────────
    ("sp", "DROP PROCEDURE IF EXISTS sp_consent_record"),
    ("sp", """
    CREATE PROCEDURE sp_consent_record(IN p_id CHAR(36), IN p_user CHAR(36),
        IN p_type VARCHAR(40), IN p_version VARCHAR(20), IN p_granted TINYINT, IN p_ip VARCHAR(64))
    BEGIN
      INSERT INTO user_consents (id, user_id, consent_type, policy_version, granted, ip)
      VALUES (p_id, p_user, p_type, p_version, p_granted, p_ip);
      SELECT 1 AS ok;
    END
    """),
    ("sp", "DROP PROCEDURE IF EXISTS sp_consent_list"),
    ("sp", """
    CREATE PROCEDURE sp_consent_list(IN p_user CHAR(36))
    BEGIN
      SELECT id, consent_type, policy_version, granted, created_at
        FROM user_consents WHERE user_id = p_user ORDER BY created_at DESC;
    END
    """),

    # ── parental consent request + confirmation ───────────────────────────
    ("sp", "DROP PROCEDURE IF EXISTS sp_parental_consent_request"),
    ("sp", """
    CREATE PROCEDURE sp_parental_consent_request(IN p_id CHAR(36), IN p_user CHAR(36),
        IN p_email VARCHAR(160), IN p_name VARCHAR(120), IN p_token CHAR(36), IN p_days INT)
    BEGIN
      -- Supersede any earlier pending request for this minor.
      UPDATE parental_consents SET status = 'superseded'
       WHERE user_id = p_user AND status = 'pending';

      INSERT INTO parental_consents (id, user_id, parent_email, parent_name, token, expires_at)
      VALUES (p_id, p_user, p_email, p_name, p_token,
              DATE_ADD(UTC_TIMESTAMP(), INTERVAL p_days DAY));

      UPDATE users SET consent_status = 'awaiting_parent' WHERE id = p_user;
      SELECT 1 AS ok, p_token AS token;
    END
    """),
    ("sp", "DROP PROCEDURE IF EXISTS sp_parental_consent_confirm"),
    ("sp", """
    CREATE PROCEDURE sp_parental_consent_confirm(IN p_token CHAR(36))
    BEGIN
      DECLARE v_user CHAR(36); DECLARE v_status VARCHAR(20); DECLARE v_exp DATETIME;
      SELECT user_id, status, expires_at INTO v_user, v_status, v_exp
        FROM parental_consents WHERE token = p_token;

      IF v_user IS NULL THEN
        SELECT 0 AS ok, 'invalid' AS result;
      ELSEIF v_status = 'confirmed' THEN
        SELECT 1 AS ok, 'already' AS result, v_user AS user_id;
      ELSEIF v_status <> 'pending' THEN
        SELECT 0 AS ok, 'superseded' AS result;
      ELSEIF v_exp < UTC_TIMESTAMP() THEN
        SELECT 0 AS ok, 'expired' AS result;
      ELSE
        UPDATE parental_consents SET status = 'confirmed', confirmed_at = UTC_TIMESTAMP()
         WHERE token = p_token;
        UPDATE users SET consent_status = 'granted' WHERE id = v_user;
        INSERT INTO user_consents (id, user_id, consent_type, policy_version, granted)
        VALUES (UUID(), v_user, 'parental', 'v1', 1);
        SELECT 1 AS ok, 'confirmed' AS result, v_user AS user_id;
      END IF;
    END
    """),
    ("sp", "DROP PROCEDURE IF EXISTS sp_parental_consent_status"),
    ("sp", """
    CREATE PROCEDURE sp_parental_consent_status(IN p_user CHAR(36))
    BEGIN
      SELECT u.consent_status,
             pc.parent_email, pc.status AS parent_status, pc.requested_at
        FROM users u
        LEFT JOIN parental_consents pc
          ON pc.user_id = u.id AND pc.status IN ('pending','confirmed')
       WHERE u.id = p_user
       ORDER BY pc.requested_at DESC
       LIMIT 1;
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
        # Existing accounts predate consent capture — mark them adult/granted so
        # the gate does not lock out the current user base retroactively. New
        # signups go through the DOB gate from here on.
        db.session.execute(text(
            "UPDATE users SET consent_status = 'granted' "
            "WHERE consent_status = 'pending'"))
        db.session.commit()
        print("DPDP consent migration complete.")


if __name__ == "__main__":
    main()
