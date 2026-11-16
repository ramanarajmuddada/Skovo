"""
Migration: student_goals — the aspiration half of a student's profile.

`user_profiles` answers "where am I"; nothing answered "where do I want to go".
A guidance product needs the second, and it is multi-valued — NEET *or* JEE,
Chennai *or* Delhi — so it cannot be more columns on the profile row.

Also adds sp_profile_upsert's `board` parameter, so onboarding can store which
board a school student is on (the thing that decides their stream vocabulary).

Idempotent. Run from SKOVO_BACKEND:
    python migrate_student_goals.py
"""
from sqlalchemy import text

import _bootstrap  # noqa: F401 — puts SKOVO_BACKEND on sys.path and cwd
from portal import InitApp
from portal.models import db
from portal.helpers.sql_file import apply_sql_file

app = InitApp().app()


def main():
    with app.app_context():
        goals = apply_sql_file('database/stored_procedures/student_goals.sql')
        # sp_profile_upsert gained a trailing p_board parameter.
        profile = apply_sql_file('database/stored_procedures/endpoints/profile.sql',
                                 'sp_profile_upsert')

        exists = db.session.execute(text("""
            SELECT COUNT(*) FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'student_goals'
        """)).scalar()
        params = db.session.execute(text("""
            SELECT COUNT(*) FROM information_schema.PARAMETERS
             WHERE SPECIFIC_SCHEMA = DATABASE() AND SPECIFIC_NAME = 'sp_profile_upsert'
        """)).scalar()

        print(f"student_goals statements: {goals} | profile statements: {profile}")
        print(f"student_goals table present: {bool(exists)} | sp_profile_upsert params: {params}")


if __name__ == "__main__":
    main()
