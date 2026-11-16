"""
Migration: college predictor.

A student enters their exam, rank and category; the predictor returns colleges
that admit that rank, bucketed into Safe / Target / Reach so the list reads like
counselling advice rather than a raw dump.

Data lives in cg_college_cutoffs (already exists): per college + branch + exam +
category, an opening_rank..closing_rank band. A student's rank R qualifies for a
row when R <= closing_rank. How much headroom they have decides the bucket:

    closing_rank >= R * 1.30   → Safe    (comfortably inside last year's cutoff)
    closing_rank >= R          → Target  (they make it, but not by much)
    opening_rank <= R*1.15     → Reach   (just outside; worth a shot)

The bands are last year's data, so this predicts, it does not promise — the API
labels every result a prediction and carries the source year.

Two SPs:
  * sp_cutoff_exams        — the exams we actually have data for (drives the form)
  * sp_college_predict     — the ranked, bucketed prediction

Idempotent. Run from SKOVO_BACKEND:  python migrate_college_predictor.py
"""
import _bootstrap  # noqa: F401 — puts SKOVO_BACKEND on sys.path and cwd
from portal import InitApp
from portal.models import db
from sqlalchemy import text

app = InitApp().app()


def main():
    with app.app_context():
        # Speeds up the range scan the predictor does on every call.
        idx = db.session.execute(text("""
            SELECT COUNT(*) FROM information_schema.STATISTICS
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cg_college_cutoffs'
               AND INDEX_NAME='idx_cutoff_predict'
        """)).scalar()
        if not idx:
            db.session.execute(text("""
                CREATE INDEX idx_cutoff_predict ON cg_college_cutoffs
                    (exam_type, category, closing_rank)
            """))
        db.session.commit()

        db.session.execute(text("DROP PROCEDURE IF EXISTS sp_cutoff_exams"))
        db.session.commit()
        db.session.execute(text("""
            CREATE PROCEDURE sp_cutoff_exams()
            BEGIN
              SELECT exam_type,
                     COUNT(*)                    AS rows_available,
                     COUNT(DISTINCT college_name) AS colleges,
                     MAX(year)                    AS latest_year
                FROM cg_college_cutoffs
               GROUP BY exam_type
               ORDER BY exam_type;
            END
        """))
        db.session.commit()

        # p_category '' or NULL means "any category".
        db.session.execute(text("DROP PROCEDURE IF EXISTS sp_college_predict"))
        db.session.commit()
        db.session.execute(text("""
            CREATE PROCEDURE sp_college_predict(
                IN p_exam VARCHAR(50), IN p_rank INT,
                IN p_category VARCHAR(40), IN p_state VARCHAR(80), IN p_limit INT)
            BEGIN
              SELECT
                college_name, college_city, college_state, college_type,
                branch_name, category, opening_rank, closing_rank, year,
                CASE
                  WHEN closing_rank >= ROUND(p_rank * 1.30) THEN 'safe'
                  WHEN closing_rank >= p_rank               THEN 'target'
                  ELSE 'reach'
                END AS bucket
              FROM cg_college_cutoffs
              WHERE exam_type = p_exam
                AND (p_category IS NULL OR p_category = '' OR category = p_category)
                AND (p_state    IS NULL OR p_state    = '' OR college_state = p_state)
                -- Include admits (rank within closing) plus near-misses (a Reach
                -- sits just above the opening rank), nothing wildly out of range.
                AND (closing_rank >= p_rank OR opening_rank <= ROUND(p_rank * 1.15))
              ORDER BY closing_rank ASC
              LIMIT p_limit;
            END
        """))
        db.session.commit()

        print("college predictor migration complete: 1 index, 2 procedures")


if __name__ == "__main__":
    main()
