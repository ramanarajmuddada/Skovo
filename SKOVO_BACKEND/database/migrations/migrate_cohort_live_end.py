"""
Cohort live until End session.

Adds timeup_notice_sent so the scheduler can email both sides when the booked
minutes elapse without flipping status to completed.

Idempotent. From SKOVO_BACKEND:
    python database/migrations/migrate_cohort_live_end.py
"""
from sqlalchemy import text

import _bootstrap  # noqa: F401

from portal import InitApp
from portal.models import db
from portal.helpers.sql_file import apply_sql_file, add_column

app = InitApp().app()

SP_FILE = 'database/stored_procedures/business/scheduler.sql'


def run():
    with app.app_context():
        if add_column(
            'cohorts', 'timeup_notice_sent',
            'TINYINT(1) NOT NULL DEFAULT 0 AFTER `reminder_sent`',
        ):
            print("  [ok] added cohorts.timeup_notice_sent")
        else:
            print("  [ok] cohorts.timeup_notice_sent already present")

        procs = apply_sql_file(SP_FILE)
        db.session.commit()
        print(f"  [ok] loaded {procs} statement(s) from {SP_FILE}")
        print("Cohort live/end migration complete.")


if __name__ == "__main__":
    run()
