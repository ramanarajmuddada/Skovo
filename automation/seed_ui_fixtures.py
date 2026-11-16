"""
Seed the data the UI specs need in order to run at all.

Several UI-02/UI-04 cases were skipping with an honest reason rather than
passing — "no modal opened", "no colleges to save", "no tasks to date-check".
A skip is truthful but it is not a result, so this creates the minimum data that
lets those cases actually execute:

  * two colleges          — Saved Colleges, college detail, the save/unsave
                            round trip. `colleges` has 0 rows on this RDS, which
                            is real (CLAUDE.md §6) and is why those cases could
                            never run.
  * one live cohort       — the cohort detail slideover, the attendance modal
    with an enrolment        and the feedback panel all need a row to open.
  * one open task         — the task detail modal, and the deadline cases that
                            check a time is shown next to the date.

Everything is prefixed `E2E ` or `UI-FIXTURE ` and is removed by
cleanup_ui_fixtures.py. Run from the automation folder:

    ..\\SKOVO_BACKEND\\venv\\Scripts\\python.exe seed_ui_fixtures.py
"""
import datetime
import os
import sys
import uuid

BACKEND = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'SKOVO_BACKEND'))
sys.path.insert(0, BACKEND)
os.chdir(BACKEND)

from dotenv import load_dotenv                                      # noqa: E402
from sqlalchemy import create_engine, text                          # noqa: E402

load_dotenv('.env')
engine = create_engine(os.environ['DATABASE_URL'], connect_args={'connect_timeout': 15})

# Five, not two.
#
# `colleges` has 0 real rows on this RDS (CLAUDE.md), so every college case runs
# on fixtures alone — and the free saved-colleges cap is 3
# (`FREE_SAVED_COLLEGES` in routes/Colleges/colleges.py). With two rows a free
# student cannot reach the cap, so the test that checks a cap answers with an
# upgrade OFFER rather than an error could never execute. Five leaves room to
# save three and be refused on the fourth.
#
# Deliberately a mix of type/state/rank, and one with no NIRF rank at all: the
# browse ordering puts unranked colleges last, and a fixture set where every row
# is ranked would never exercise that.
COLLEGES = [
    ('UI-FIXTURE Institute of Technology', 'government', 'Hyderabad', 'Telangana', 12),
    ('UI-FIXTURE College of Science', 'private', 'Bengaluru', 'Karnataka', None),
    ('UI-FIXTURE School of Management', 'private', 'Pune', 'Maharashtra', 47),
    ('UI-FIXTURE Institute of Design', 'government', 'Ahmedabad', 'Gujarat', 88),
    ('UI-FIXTURE College of Engineering', 'private', 'Chennai', 'Tamil Nadu', 130),
]

# Courses every fixture college offers. B.Tech CSE is the one that matters: it is
# what the seeded pro student's profile reads, and therefore what the "For You"
# tab filters on. The other two exist so a degree filter has something to
# exclude — a fixture set where everything matches cannot catch a filter that
# has stopped filtering.
COURSES = [
    ('B.Tech Computer Science and Engineering', 'CSE', 'B.Tech', 4),
    ('B.Tech Electronics and Communication', 'ECE', 'B.Tech', 4),
    ('B.Com Honours', 'COM', 'B.Com', 3),
]


def main():
    with engine.begin() as c:
        pro = c.execute(text(
            "SELECT id FROM users WHERE email = 'e2e.pro@skovo-test.local'")).scalar()
        achiever = c.execute(text(
            "SELECT id FROM achievers WHERE email = 'e2e.achiever@skovo-test.local'")).scalar()
        if not pro or not achiever:
            raise SystemExit('run seed_test_accounts.py first — e2e fixtures are missing')

        # ── Colleges ────────────────────────────────────────────────────────
        made = 0
        courses = 0
        # Idempotent per PIECE, not per college.
        #
        # This used to `continue` on an existing college, which was fine while a
        # college was only a row. Once courses were added, a run against a
        # database seeded by an EARLIER version skipped the college and never
        # created its courses — so the seeder printed success and the "For You"
        # tab stayed empty. Existence of the parent says nothing about the
        # children; each is checked on its own.
        for name, ctype, city, state, rank in COLLEGES:
            cid = c.execute(text('SELECT id FROM colleges WHERE name = :n'),
                            {'n': name}).scalar()
            if not cid:
                cid = str(uuid.uuid4())
                c.execute(text("""
                    INSERT INTO colleges (id, name, type, location_city, location_state,
                                          nirf_ranking, is_active, created_at, updated_at)
                    VALUES (:i, :n, :t, :city, :st, :rank, 1, UTC_TIMESTAMP(), UTC_TIMESTAMP())
                """), {'i': cid, 'n': name, 't': ctype,
                       'city': city, 'st': state, 'rank': rank})
                made += 1

            # A college with no courses is invisible on the DEFAULT view.
            #
            # /colleges opens on "For You", which filters by the student's own
            # degree: sp_colleges_browse requires a matching row in
            # college_courses, matched on degree_type normalised to letters
            # ('B.Tech' -> 'btech'). The seeded pro student reads B.Tech (CSE),
            # so five course-less colleges produced "No colleges match your..."
            # on the tab every college test lands on, and four specs failed on
            # an empty table while the fixtures looked fine in the database.
            for cname, branch, degree, years in COURSES:
                if c.execute(text('SELECT COUNT(*) FROM college_courses '
                                  'WHERE college_id = :c AND course_name = :n'),
                             {'c': cid, 'n': cname}).scalar():
                    continue
                c.execute(text("""
                    INSERT INTO college_courses (id, college_id, course_name, branch_code,
                                                 duration_years, degree_type, total_seats,
                                                 annual_fee, created_at, updated_at)
                    VALUES (:i, :c, :n, :b, :y, :d, 60, 150000, UTC_TIMESTAMP(), UTC_TIMESTAMP())
                """), {'i': str(uuid.uuid4()), 'c': cid, 'n': cname,
                       'b': branch, 'y': years, 'd': degree})
                courses += 1
        print(f'colleges: +{made}, courses: +{courses}')

        # ── A live cohort the student is enrolled in ────────────────────────
        cohort = c.execute(text(
            "SELECT id FROM cohorts WHERE title = 'E2E UI Live Cohort'")).scalar()
        if not cohort:
            cohort = str(uuid.uuid4())
            c.execute(text("""
                INSERT INTO cohorts (id, title, achiever_id, session_date, duration_minutes,
                                     total_seats, filled_seats, price, status, meeting_link,
                                     about, created_at, updated_at)
                VALUES (:i, 'E2E UI Live Cohort', :a,
                        DATE_SUB(UTC_TIMESTAMP(), INTERVAL 15 MINUTE), 120,
                        NULL, 0, 0, 'live', 'https://meet.example.com/e2e-ui',
                        'A live cohort seeded so the UI specs can open a detail view.',
                        UTC_TIMESTAMP(), UTC_TIMESTAMP())
            """), {'i': cohort, 'a': achiever})
            print('cohort: created')

        if not c.execute(text(
                'SELECT COUNT(*) FROM cohort_enrollments WHERE cohort_id = :c AND user_id = :u'),
                {'c': cohort, 'u': pro}).scalar():
            c.execute(text("""
                INSERT INTO cohort_enrollments (id, user_id, cohort_id, payment_status,
                                                amount_paid, enrolled_at, created_at, updated_at)
                VALUES (:i, :u, :c, 'free', 0, UTC_TIMESTAMP(), UTC_TIMESTAMP(), UTC_TIMESTAMP())
            """), {'i': str(uuid.uuid4()), 'u': pro, 'c': cohort})

            # Keep filled_seats in step. Writing the enrolment row straight to
            # the table skips the procedure that would have moved the counter,
            # so the fixture leaves the cohort with a real enrolment and a count
            # of zero — and X01-019 asserts that invariant across the WHOLE
            # table, so a seeded inconsistency fails a test about production
            # data. `paid` and `free` are both real seats; only a `pending` hold
            # is not.
            c.execute(text('UPDATE cohorts SET filled_seats = ('
                           '  SELECT COUNT(*) FROM cohort_enrollments '
                           "   WHERE cohort_id = :c AND payment_status IN ('paid','free')) "
                           'WHERE id = :c'), {'c': cohort})
            print('enrolment: created (filled_seats synced)')

        # ── An open task with a deadline that carries a TIME ────────────────
        # The date cases check that a time is shown, not just a day — students
        # miss deadlines by hours — so the due date is deliberately 18:30, not
        # midnight, which would render as a bare date on some screens.
        # Keyed to THIS cohort, not just to the title. A cancel test soft-deletes
        # the fixture cohort, the next seed run creates a fresh one — and a task
        # matched on title alone is then left pointing at the dead cohort, so My
        # Tasks is empty while the seeder reports success.
        if not c.execute(text(
                "SELECT COUNT(*) FROM cohort_tasks "
                "WHERE title = 'E2E UI Task' AND cohort_id = :c"),
                {'c': cohort}).scalar():
            due = (datetime.datetime.utcnow() + datetime.timedelta(days=3)).replace(
                hour=13, minute=0, second=0, microsecond=0)      # 18:30 IST
            c.execute(text("""
                INSERT INTO cohort_tasks (id, cohort_id, title, description, task_type,
                                          submission_type, difficulty_level, task_status,
                                          score_weight, due_date, created_by,
                                          created_at, updated_at)
                VALUES (:i, :c, 'E2E UI Task',
                        'Seeded so the task detail modal and the deadline cases can run.',
                        'assignment', 'text', 'beginner', 'active', 5, :due, :a,
                        UTC_TIMESTAMP(), UTC_TIMESTAMP())
            """), {'i': str(uuid.uuid4()), 'c': cohort, 'due': due, 'a': achiever})
            print('task: created')

        print('done')


if __name__ == '__main__':
    main()
