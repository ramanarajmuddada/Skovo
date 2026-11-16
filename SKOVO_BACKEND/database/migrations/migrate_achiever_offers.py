"""
Migration: achiever offers on cohorts + achiever_courses.

Adds offer_price / offer_percent / offer_label / offer_starts_at / offer_ends_at
to both tables and creates the ownership-scoped set-offer procedures. Idempotent.

Run from SKOVO_BACKEND:
    python migrate_achiever_offers.py
"""
import _bootstrap  # noqa: F401 — puts SKOVO_BACKEND on sys.path and cwd
from portal import InitApp
from portal.models import db
from sqlalchemy import text

app = InitApp().app()

COLS = [
    ("offer_price", "INT NULL"),
    ("offer_percent", "INT NULL"),
    ("offer_label", "VARCHAR(120) NULL"),
    ("offer_starts_at", "DATETIME NULL"),
    ("offer_ends_at", "DATETIME NULL"),
]
TABLES = ["cohorts", "achiever_courses"]

SPS = [
    "DROP PROCEDURE IF EXISTS sp_cohort_set_offer",
    """
    CREATE PROCEDURE sp_cohort_set_offer(
      IN p_id CHAR(36), IN p_achiever_id CHAR(36), IN p_offer_price INT, IN p_offer_percent INT,
      IN p_offer_label VARCHAR(120), IN p_offer_starts DATETIME, IN p_offer_ends DATETIME)
    BEGIN
      UPDATE cohorts SET offer_price=p_offer_price, offer_percent=p_offer_percent,
             offer_label=p_offer_label, offer_starts_at=p_offer_starts, offer_ends_at=p_offer_ends
       WHERE id=p_id AND achiever_id=p_achiever_id AND deleted_at IS NULL;
      SELECT ROW_COUNT() AS updated;
    END
    """,
    "DROP PROCEDURE IF EXISTS sp_course_set_offer",
    """
    CREATE PROCEDURE sp_course_set_offer(
      IN p_id CHAR(36), IN p_achiever_id CHAR(36), IN p_offer_price INT, IN p_offer_percent INT,
      IN p_offer_label VARCHAR(120), IN p_offer_starts DATETIME, IN p_offer_ends DATETIME)
    BEGIN
      UPDATE achiever_courses SET offer_price=p_offer_price, offer_percent=p_offer_percent,
             offer_label=p_offer_label, offer_starts_at=p_offer_starts, offer_ends_at=p_offer_ends
       WHERE id=p_id AND achiever_id=p_achiever_id AND deleted_at IS NULL;
      SELECT ROW_COUNT() AS updated;
    END
    """,
]


def main():
    with app.app_context():
        for tbl in TABLES:
            for col, ddl in COLS:
                try:
                    db.session.execute(text(f"ALTER TABLE {tbl} ADD COLUMN {col} {ddl}"))
                    db.session.commit()
                except Exception as e:
                    db.session.rollback()
                    if "Duplicate column" not in str(e):
                        raise
        for s in SPS:
            db.session.execute(text(s))
        db.session.commit()
        print("achiever offers migration complete.")


if __name__ == "__main__":
    main()
