"""
Migration: the predictor learns how much data is standing behind its answer.

Today it will bucket colleges into Safe / Target / Reach off a handful of rows
and look exactly as confident as it would with a lakh of them. For every other
screen, thin data just looks empty; here it tells a student something specific
and wrong about their future, and they act on it.

`sp_cutoff_coverage` returns what we actually hold for one exam — rows,
colleges, categories and the year span — so the API can label the answer
`none` / `low` / `usable` and the UI can refuse to look confident when it
shouldn't.

Idempotent. Run from SKOVO_BACKEND:
    python migrate_predictor_coverage.py
"""
from sqlalchemy import text

import _bootstrap  # noqa: F401 — puts SKOVO_BACKEND on sys.path and cwd
from portal import InitApp
from portal.models import db

app = InitApp().app()


def main():
    with app.app_context():
        db.session.execute(text("DROP PROCEDURE IF EXISTS sp_cutoff_coverage"))
        db.session.commit()
        db.session.execute(text("""
            CREATE PROCEDURE sp_cutoff_coverage(IN p_exam VARCHAR(50), IN p_state VARCHAR(80))
            BEGIN
              SELECT
                COUNT(*)                        AS rows_total,
                COUNT(DISTINCT college_name)    AS colleges,
                COUNT(DISTINCT branch_name)     AS branches,
                COUNT(DISTINCT category)        AS categories,
                MIN(year)                       AS earliest_year,
                MAX(year)                       AS latest_year
              FROM cg_college_cutoffs
              WHERE exam_type = p_exam
                AND (p_state IS NULL OR p_state = '' OR college_state = p_state);
            END
        """))
        db.session.commit()

        row = db.session.execute(text("""
            SELECT exam_type, COUNT(*) AS n FROM cg_college_cutoffs GROUP BY exam_type
        """)).mappings().all()
        print("sp_cutoff_coverage created")
        print("current cutoff coverage:", {r['exam_type']: r['n'] for r in row} or "none")


if __name__ == "__main__":
    main()
