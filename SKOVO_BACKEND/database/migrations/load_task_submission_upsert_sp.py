"""Reinstall sp_task_submission_upsert. Procedures only; idempotent.

Ships the change that clears mentor_score / mentor_notes / reviewed_by /
reviewed_at when a student resubmits: a resubmission is new work, and the
previous verdict was travelling with it into the reviewer's queue.

No table is touched and nothing is added — the file DROPs and re-CREATEs the two
procedures it already owns.
"""
import _bootstrap  # noqa: F401
from sqlalchemy import text
from portal import InitApp
from portal.models import db
from portal.helpers.sql_file import apply_sql_file

app = InitApp().app()
SP_FILE = 'database/stored_procedures/endpoints/task_submissions_upsert.sql'


def main():
    with app.app_context():
        n = apply_sql_file(SP_FILE)
        print(f"  loaded {n} statement(s)")
        for proc in ('sp_task_submission_upsert', 'sp_task_submission_get_by_user'):
            got = db.session.execute(text(
                "SELECT COUNT(*) FROM information_schema.ROUTINES "
                "WHERE ROUTINE_SCHEMA = DATABASE() AND ROUTINE_NAME = :n"
            ), {'n': proc}).scalar()
            print(f"  {proc} {'OK' if got else 'MISSING'}")

        # The point of the change: the review columns must be cleared on the
        # UPDATE branch, so read the body back rather than trusting the load.
        body = db.session.execute(text(
            "SELECT ROUTINE_DEFINITION FROM information_schema.ROUTINES "
            "WHERE ROUTINE_SCHEMA = DATABASE() "
            "AND ROUTINE_NAME = 'sp_task_submission_upsert'"
        )).scalar() or ''
        clears = 'mentor_score = NULL' in body and 'reviewed_at = NULL' in body
        print(f"  resubmission clears the previous verdict: {'OK' if clears else 'MISSING'}")


if __name__ == '__main__':
    main()
