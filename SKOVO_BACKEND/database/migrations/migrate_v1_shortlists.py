"""
Migration: v1 shortlists — Opportunities shortlist + Saved Colleges.

Two free-tier features the v1 spec calls for that had no backend at all:

  * opportunity_shortlist — "Save opportunities to a shortlist" (§4.5, free at
    score >= 60). Unlimited; saving is not the gated action, applying is.
  * saved_colleges — "Save up to 3 colleges to a comparison list" (§4.1 free),
    Pro unlocks unlimited saves and a 10-way comparison.

Both feed the Score Engine signals that were already configured but unwired
(college_saved, college_viewed).

Idempotent. Run from SKOVO_BACKEND:  python migrate_v1_shortlists.py
"""
import _bootstrap  # noqa: F401 — puts SKOVO_BACKEND on sys.path and cwd
from portal import InitApp
from portal.models import db
from sqlalchemy import text

app = InitApp().app()

STMTS = [
    ("table", """
    CREATE TABLE IF NOT EXISTS opportunity_shortlist (
      id CHAR(36) PRIMARY KEY,
      user_id CHAR(36) NOT NULL,
      opportunity_id CHAR(36) NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_oppshort (user_id, opportunity_id),
      INDEX idx_oppshort_user (user_id, created_at)
    )
    """),
    ("table", """
    CREATE TABLE IF NOT EXISTS saved_colleges (
      id CHAR(36) PRIMARY KEY,
      user_id CHAR(36) NOT NULL,
      college_id CHAR(36) NOT NULL,
      note TEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_savedcollege (user_id, college_id),
      INDEX idx_savedcollege_user (user_id, created_at)
    )
    """),

    # ══ opportunity shortlist ═════════════════════════════════════════════
    ("sp", "DROP PROCEDURE IF EXISTS sp_opp_shortlist_add"),
    ("sp", """
    CREATE PROCEDURE sp_opp_shortlist_add(IN p_id CHAR(36), IN p_user CHAR(36), IN p_opp CHAR(36))
    BEGIN
      IF EXISTS (SELECT 1 FROM opportunity_shortlist
                  WHERE user_id = p_user AND opportunity_id = p_opp) THEN
        SELECT 0 AS added, 'already' AS result;
      ELSE
        INSERT INTO opportunity_shortlist (id, user_id, opportunity_id)
        VALUES (p_id, p_user, p_opp);
        SELECT 1 AS added, 'saved' AS result;
      END IF;
    END
    """),
    ("sp", "DROP PROCEDURE IF EXISTS sp_opp_shortlist_remove"),
    ("sp", """
    CREATE PROCEDURE sp_opp_shortlist_remove(IN p_user CHAR(36), IN p_opp CHAR(36))
    BEGIN
      DELETE FROM opportunity_shortlist WHERE user_id = p_user AND opportunity_id = p_opp;
      SELECT ROW_COUNT() AS removed;
    END
    """),
    ("sp", "DROP PROCEDURE IF EXISTS sp_opp_shortlist_list"),
    ("sp", """
    CREATE PROCEDURE sp_opp_shortlist_list(IN p_user CHAR(36))
    BEGIN
      SELECT o.*, sl.created_at AS saved_at
        FROM opportunity_shortlist sl
        JOIN opportunities o ON o.id = sl.opportunity_id
       WHERE sl.user_id = p_user
       ORDER BY sl.created_at DESC;
    END
    """),
    ("sp", "DROP PROCEDURE IF EXISTS sp_opp_shortlist_ids"),
    ("sp", """
    CREATE PROCEDURE sp_opp_shortlist_ids(IN p_user CHAR(36))
    BEGIN
      SELECT opportunity_id FROM opportunity_shortlist WHERE user_id = p_user;
    END
    """),

    # ══ saved colleges ════════════════════════════════════════════════════
    ("sp", "DROP PROCEDURE IF EXISTS sp_saved_colleges_add"),
    ("sp", """
    CREATE PROCEDURE sp_saved_colleges_add(IN p_id CHAR(36), IN p_user CHAR(36),
                                           IN p_college CHAR(36), IN p_note TEXT)
    BEGIN
      IF EXISTS (SELECT 1 FROM saved_colleges WHERE user_id = p_user AND college_id = p_college) THEN
        SELECT 0 AS added, 'already' AS result;
      ELSE
        INSERT INTO saved_colleges (id, user_id, college_id, note)
        VALUES (p_id, p_user, p_college, p_note);
        SELECT 1 AS added, 'saved' AS result;
      END IF;
    END
    """),
    ("sp", "DROP PROCEDURE IF EXISTS sp_saved_colleges_remove"),
    ("sp", """
    CREATE PROCEDURE sp_saved_colleges_remove(IN p_user CHAR(36), IN p_college CHAR(36))
    BEGIN
      DELETE FROM saved_colleges WHERE user_id = p_user AND college_id = p_college;
      SELECT ROW_COUNT() AS removed;
    END
    """),
    ("sp", "DROP PROCEDURE IF EXISTS sp_saved_colleges_list"),
    ("sp", """
    CREATE PROCEDURE sp_saved_colleges_list(IN p_user CHAR(36))
    BEGIN
      SELECT c.*, sc.created_at AS saved_at, sc.note
        FROM saved_colleges sc
        JOIN colleges c ON c.id = sc.college_id
       WHERE sc.user_id = p_user
       ORDER BY sc.created_at DESC;
    END
    """),
    ("sp", "DROP PROCEDURE IF EXISTS sp_saved_colleges_count"),
    ("sp", """
    CREATE PROCEDURE sp_saved_colleges_count(IN p_user CHAR(36))
    BEGIN
      SELECT COUNT(*) AS total FROM saved_colleges WHERE user_id = p_user;
    END
    """),
    ("sp", "DROP PROCEDURE IF EXISTS sp_saved_colleges_ids"),
    ("sp", """
    CREATE PROCEDURE sp_saved_colleges_ids(IN p_user CHAR(36))
    BEGIN
      SELECT college_id FROM saved_colleges WHERE user_id = p_user;
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
        print("v1 shortlists migration complete.")


if __name__ == "__main__":
    main()
