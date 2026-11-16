"""
Migration: employer CRM-lite + applicant pipeline export (v1 §4.5).

The Opportunities Hub is the anchor, and its admin side needs:
  * a lightweight employer contact record (CRM-lite — no self-serve in v1)
  * the application pipeline already exists (submitted → viewed → shortlisted
    → rejected via sp_opportunity_application_set_status); this adds the admin
    read side and a structured export of an applicant's profile + shared docs.

Idempotent. Run from SKOVO_BACKEND:  python migrate_employers.py
"""
import _bootstrap  # noqa: F401 — puts SKOVO_BACKEND on sys.path and cwd
from portal import InitApp
from portal.models import db
from sqlalchemy import text

app = InitApp().app()

STMTS = [
    ("table", """
    CREATE TABLE IF NOT EXISTS employers (
      id CHAR(36) PRIMARY KEY,
      name VARCHAR(160) NOT NULL,
      contact_name VARCHAR(120) NULL,
      contact_email VARCHAR(160) NULL,
      contact_phone VARCHAR(40) NULL,
      website VARCHAR(200) NULL,
      notes TEXT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_employers_name (name)
    )
    """),
    # Link opportunities to an employer record (nullable — legacy rows keep
    # their free-text company field).
    ("alter", "ALTER TABLE opportunities ADD COLUMN employer_id CHAR(36) NULL"),

    ("sp", "DROP PROCEDURE IF EXISTS sp_employers_list"),
    ("sp", """
    CREATE PROCEDURE sp_employers_list(IN p_search VARCHAR(120), IN p_limit INT, IN p_offset INT)
    BEGIN
      SELECT e.*,
             (SELECT COUNT(*) FROM opportunities o
               WHERE o.employer_id = e.id AND o.deleted_at IS NULL) AS opportunity_count
        FROM employers e
       WHERE e.status <> 'archived'
         AND (p_search IS NULL OR p_search = ''
              OR e.name LIKE CONCAT('%', p_search, '%')
              OR e.contact_name LIKE CONCAT('%', p_search, '%'))
       ORDER BY e.created_at DESC
       LIMIT p_limit OFFSET p_offset;
    END
    """),
    ("sp", "DROP PROCEDURE IF EXISTS sp_employers_get"),
    ("sp", """
    CREATE PROCEDURE sp_employers_get(IN p_id CHAR(36))
    BEGIN
      SELECT * FROM employers WHERE id = p_id;
    END
    """),
    ("sp", "DROP PROCEDURE IF EXISTS sp_employers_create"),
    ("sp", """
    CREATE PROCEDURE sp_employers_create(IN p_id CHAR(36), IN p_name VARCHAR(160),
        IN p_contact_name VARCHAR(120), IN p_contact_email VARCHAR(160),
        IN p_contact_phone VARCHAR(40), IN p_website VARCHAR(200), IN p_notes TEXT)
    BEGIN
      INSERT INTO employers (id, name, contact_name, contact_email, contact_phone, website, notes)
      VALUES (p_id, p_name, p_contact_name, p_contact_email, p_contact_phone, p_website, p_notes);
      SELECT * FROM employers WHERE id = p_id;
    END
    """),
    ("sp", "DROP PROCEDURE IF EXISTS sp_employers_update"),
    ("sp", """
    CREATE PROCEDURE sp_employers_update(IN p_id CHAR(36), IN p_name VARCHAR(160),
        IN p_contact_name VARCHAR(120), IN p_contact_email VARCHAR(160),
        IN p_contact_phone VARCHAR(40), IN p_website VARCHAR(200), IN p_notes TEXT,
        IN p_status VARCHAR(20))
    BEGIN
      UPDATE employers SET
        name = COALESCE(p_name, name),
        contact_name = p_contact_name, contact_email = p_contact_email,
        contact_phone = p_contact_phone, website = p_website, notes = p_notes,
        status = COALESCE(p_status, status)
      WHERE id = p_id;
      SELECT * FROM employers WHERE id = p_id;
    END
    """),

    # ── admin pipeline: applications for one opportunity, with applicant info ─
    ("sp", "DROP PROCEDURE IF EXISTS sp_opp_applications_admin"),
    ("sp", """
    CREATE PROCEDURE sp_opp_applications_admin(IN p_opp CHAR(36))
    BEGIN
      SELECT ap.id, ap.user_id, ap.opportunity_id, ap.status, ap.resume_link,
             ap.cover_note, ap.applied_at, ap.status_updated_at,
             u.full_name, u.email, u.phone,
             IFNULL(rs.score, 0) AS readiness_score,
             -- Pro applicants surface first (§4.5 priority visibility).
             (SELECT COUNT(*) FROM subscriptions sub
               WHERE sub.user_id = ap.user_id AND sub.status = 'active'
                 AND sub.expires_at > UTC_TIMESTAMP()) AS is_pro
        FROM opportunity_applications ap
        JOIN users u ON u.id = ap.user_id
        LEFT JOIN readiness_scores rs ON rs.user_id = ap.user_id
       WHERE ap.opportunity_id = p_opp
       ORDER BY is_pro DESC, ap.applied_at ASC;
    END
    """),

    # ── structured applicant export: profile + shared vault documents ────────
    ("sp", "DROP PROCEDURE IF EXISTS sp_applicant_export"),
    ("sp", """
    CREATE PROCEDURE sp_applicant_export(IN p_app CHAR(36))
    BEGIN
      SELECT ap.id AS application_id, ap.status, ap.resume_link, ap.cover_note,
             ap.applied_at, ap.opportunity_id,
             u.id AS user_id, u.full_name, u.email, u.phone,
             p.stream AS current_stream, p.city, p.career_interests AS interests,
             IFNULL(rs.score, 0) AS readiness_score, rs.level,
             o.title AS opportunity_title, o.company
        FROM opportunity_applications ap
        JOIN users u ON u.id = ap.user_id
        LEFT JOIN user_profiles p ON p.user_id = ap.user_id
        LEFT JOIN readiness_scores rs ON rs.user_id = ap.user_id
        LEFT JOIN opportunities o ON o.id = ap.opportunity_id
       WHERE ap.id = p_app;
    END
    """),
    ("sp", "DROP PROCEDURE IF EXISTS sp_applicant_export_docs"),
    ("sp", """
    CREATE PROCEDURE sp_applicant_export_docs(IN p_user CHAR(36))
    BEGIN
      -- Only documents the student made public are shareable with employers,
      -- honouring the vault's per-user consent model.
      SELECT id, name, category, file_url FROM document_vault
       WHERE user_id = p_user AND is_public = 1
       ORDER BY created_at DESC;
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
        print("employers migration complete.")


if __name__ == "__main__":
    main()
