"""
Install the student payment-history procedures.

Procedures only — no tables, no rows. Safe to re-run: each CREATE is preceded
by DROP PROCEDURE IF EXISTS in the .sql file, so this is idempotent.
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import _bootstrap  # noqa: F401 — puts SKOVO_BACKEND on sys.path and cwd

from sqlalchemy import text
from portal import InitApp
from portal.models import db
from portal.helpers.sql_file import apply_sql_file

app = InitApp().app()

SP_FILE = 'database/stored_procedures/business/payments_history.sql'
PROCS = ('sp_payment_history_student', 'sp_payment_history_summary')


def main():
    with app.app_context():
        n = apply_sql_file(SP_FILE)
        print(f"  loaded {n} statement(s) from {SP_FILE}")

        for p in PROCS:
            got = db.session.execute(text(
                "SELECT COUNT(*) FROM information_schema.ROUTINES "
                "WHERE ROUTINE_SCHEMA = DATABASE() AND ROUTINE_NAME = :n"
            ), {'n': p}).scalar()
            print(f"  {p:<32} {'OK' if got else 'MISSING'}")

        # Call both for real against a student id that cannot exist. Proves the
        # SQL parses, the joins resolve and every column named is present —
        # a CREATE succeeding only proves the syntax was valid.
        probe = '00000000-0000-0000-0000-000000000000'
        rows = db.session.execute(
            text("CALL sp_payment_history_student(:s, 10, 0)"), {'s': probe}).fetchall()
        print(f"  sp_payment_history_student ran — {len(rows)} row(s), as expected for a fake id")

        summary = db.session.execute(
            text("CALL sp_payment_history_summary(:s)"), {'s': probe}).mappings().first()
        print(f"  sp_payment_history_summary ran — {dict(summary)}")


if __name__ == '__main__':
    main()
