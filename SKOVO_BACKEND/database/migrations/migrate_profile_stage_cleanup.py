"""
Migration: let a profile field be cleared, and clean up the rows that could not be.

`sp_profile_upsert` used COALESCE(p_x, existing) on every column, which means a
field could be set but never unset — passing NULL kept the old value. So a
student who moved from a degree to 10th class kept degree_type, branch and
year_of_study on their row forever, and the profile card showed
"In 10th Class" above "B.Tech — Computer Science (CSE), 2nd Year".

The procedure now uses a three-state contract:

    NULL   -> not sent, keep what is stored
    ''     -> sent empty, clear it
    value  -> store it

This also clears the values already stranded on existing rows: any field that
does not belong to the profile's current stage is nulled. School stages keep
board/stream/school_name, college stages keep the course fields, exam aspirants
keep exam_target, and so on.

Idempotent. Run from SKOVO_BACKEND:
    python migrate_profile_stage_cleanup.py
"""
from sqlalchemy import text

import _bootstrap  # noqa: F401 — puts SKOVO_BACKEND on sys.path and cwd
from portal import InitApp
from portal.models import db
from portal.helpers.sql_file import apply_sql_file

app = InitApp().app()

SCHOOL = ('school_10th', 'school_11th', 'school_12th')
COURSE = ('ug', 'pg', 'phd', 'iti', 'polytechnic', 'professional_course')
EXAM = ('govt_exam', 'entrance_exam', 'dropper')

# column -> the stages it belongs to. Anything outside that set gets nulled.
OWNED_BY = {
    'board':        SCHOOL,
    'stream':       SCHOOL,
    'school_name':  SCHOOL,
    'degree_category': COURSE,
    'degree_type':     COURSE,
    'branch':          COURSE,
    'college_name':    COURSE,
    'iti_trade':       ('iti',),
    'professional_course_type':  ('professional_course',),
    'professional_course_level': ('professional_course',),
    'exam_target':       EXAM,
    'working_industry':   ('working',),
    'working_experience': ('working',),
    'working_role':       ('working',),
    # year_of_study doubles as the preparation stage for exam aspirants.
    'year_of_study': COURSE + EXAM + ('working',),
}


def main():
    with app.app_context():
        applied = apply_sql_file('database/stored_procedures/endpoints/profile.sql',
                                 'sp_profile_upsert')

        before = db.session.execute(text("""
            SELECT COUNT(1) FROM user_profiles
             WHERE education_category IN :school
               AND (degree_type IS NOT NULL OR branch IS NOT NULL)
        """).bindparams(school=SCHOOL)).scalar()

        cleared = 0
        for column, stages in OWNED_BY.items():
            result = db.session.execute(text(f"""
                UPDATE user_profiles
                   SET `{column}` = NULL
                 WHERE `{column}` IS NOT NULL
                   AND education_category IS NOT NULL
                   AND education_category NOT IN :stages
            """).bindparams(stages=stages))
            cleared += result.rowcount or 0
        db.session.commit()

        after = db.session.execute(text("""
            SELECT COUNT(1) FROM user_profiles
             WHERE education_category IN :school
               AND (degree_type IS NOT NULL OR branch IS NOT NULL)
        """).bindparams(school=SCHOOL)).scalar()

        print(f"sp_profile_upsert statements applied: {applied}")
        print(f"stranded values cleared: {cleared}")
        print(f"school profiles holding a degree — before: {before}, after: {after}")


if __name__ == "__main__":
    main()
