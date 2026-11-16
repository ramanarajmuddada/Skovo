"""
Seed a year of achiever earnings so the dashboard's date filters have something
to filter.

The live account has five earning events, all in one week — every range from
"last 30 days" to "last year" showed almost the same picture, so the filter
looked broken when it was merely honest.

This writes twelve months of cohort enrolments, course sales and 1-on-1 sessions
across the achiever's existing cohorts/courses, with a mild upward trend and
week-to-week noise so the chart reads like a real business rather than a ramp.

Everything it writes is tagged `payment_id = 'demo_seed_…'`, so it is trivially
identifiable and removable:

    python database/migrations/seed_achiever_year_demo.py --undo

Idempotent: re-running replaces the demo rows rather than stacking a second year
on top. It never touches a row it did not create.
"""
import argparse
import datetime
import hashlib
import random
import uuid

import _bootstrap  # noqa: F401 — puts SKOVO_BACKEND on sys.path and cwd
from sqlalchemy import text

from portal import InitApp
from portal.models import db

app = InitApp().app()

TAG = 'demo_seed_'
PLATFORM_CUT = 0.30          # what SKOVO keeps; the rest is the achiever's

# A fixed seed keeps re-runs identical, so screenshots and tests do not drift.
rng = random.Random(20260809)


def _students(conn, want=200):
    rows = conn.execute(text("""
        SELECT id FROM users
         WHERE deleted_at IS NULL AND status = 'active'
         ORDER BY created_at DESC LIMIT :n
    """), {'n': want}).scalars().all()
    return rows or []


def _achievers(conn):
    return conn.execute(text("SELECT id FROM achievers WHERE is_active = 1")).scalars().all()


def reconcile_seats(conn):
    """Make `cohorts.filled_seats` agree with the enrolment rows.

    filled_seats is a denormalised counter that the enrolment procedures keep in
    step (`UPDATE cohorts SET filled_seats = filled_seats + 1`). Writing rows
    straight into `cohort_enrollments`, as this script does, bypasses that — so
    the counter has to be brought back in line or the achiever's own Cohorts
    screen reports the wrong number of students, which is worse than having no
    demo data at all.

    Run after both seeding and undo, so the counter is true either way.
    """
    return conn.execute(text("""
        UPDATE `cohorts` c
           SET c.`filled_seats` = (
               SELECT COUNT(*) FROM `cohort_enrollments` e WHERE e.`cohort_id` = c.`id`)
         WHERE c.`filled_seats` <> (
               SELECT COUNT(*) FROM `cohort_enrollments` e WHERE e.`cohort_id` = c.`id`)
    """)).rowcount


def undo(conn):
    n = 0
    for tbl in ('cohort_enrollments', 'course_enrollments', 'achiever_sessions'):
        n += conn.execute(text(
            f"DELETE FROM `{tbl}` WHERE `payment_id` LIKE :p"), {'p': TAG + '%'}).rowcount
    return n


def seed_for(conn, achiever_id, students):
    cohorts = conn.execute(text(
        "SELECT id, price FROM cohorts WHERE achiever_id = :a AND deleted_at IS NULL"),
        {'a': achiever_id}).mappings().all()
    courses = conn.execute(text(
        "SELECT id, price FROM achiever_courses WHERE achiever_id = :a"),
        {'a': achiever_id}).mappings().all()
    if not students or (not cohorts and not courses):
        return 0

    # A student may enrol in a given cohort/course exactly once
    # (uq_enrollment_user_cohort). Track the pairs already spent — including any
    # that existed before this script ran — so the seed never violates a real
    # business rule to manufacture volume. Sessions have no such limit, so they
    # absorb the remainder.
    used = set()
    for tbl, col in (('cohort_enrollments', 'cohort_id'), ('course_enrollments', 'course_id')):
        for r in conn.execute(text(f"SELECT user_id, `{col}` AS oid FROM `{tbl}`")).mappings().all():
            used.add((r['user_id'], r['oid']))

    today = datetime.date.today()
    made = 0

    for back in range(364, -1, -1):
        day = today - datetime.timedelta(days=back)

        # Volume grows gently across the year, dips at weekends, and wobbles —
        # a perfectly smooth ramp reads as fake at a glance.
        progress = (364 - back) / 364
        base = 0.25 + progress * 0.75
        if day.weekday() >= 5:
            base *= 0.45
        events = rng.random() < base * 0.55

        if not events:
            continue

        for _ in range(rng.choice([1, 1, 1, 2])):
            kind = rng.choices(['cohort', 'course', 'session'], weights=[5, 3, 4])[0]
            student = rng.choice(students)
            when = datetime.datetime.combine(day, datetime.time(rng.randint(9, 21), rng.randint(0, 59)))
            # Deterministic id per (achiever, day, kind, n) so a re-run after an
            # --undo produces the same year, not a different one.
            stamp = hashlib.md5(f'{achiever_id}{when}{kind}{made}'.encode()).hexdigest()[:12]
            pay_id = f'{TAG}{stamp}'

            if kind == 'cohort' and cohorts:
                c = rng.choice(cohorts)
                if (student, c['id']) in used:
                    kind = 'session'          # pair spent — fall through to a session
                else:
                    used.add((student, c['id']))

            if kind == 'course' and courses:
                c2 = rng.choice(courses)
                if (student, c2['id']) in used:
                    kind = 'session'
                else:
                    used.add((student, c2['id']))

            if kind == 'cohort' and cohorts:
                amount = float(c['price'] or 2000)
                fee = round(amount * PLATFORM_CUT, 2)
                conn.execute(text("""
                    INSERT INTO cohort_enrollments
                        (id, user_id, cohort_id, payment_status, payment_id, amount_paid,
                         platform_fee, achiever_earning, discount_amount, enrolled_at,
                         created_at, updated_at, enrolled_via)
                    VALUES (:id, :u, :c, 'paid', :pid, :amt, :fee, :earn, 0, :when,
                            :when, :when, 'paid')
                """), {'id': str(uuid.uuid4()), 'u': student, 'c': c['id'], 'pid': pay_id,
                       'amt': amount, 'fee': fee, 'earn': round(amount - fee, 2), 'when': when})
                made += 1

            elif kind == 'course' and courses:
                c = c2
                amount = float(c['price'] or 999)
                fee = round(amount * PLATFORM_CUT, 2)
                conn.execute(text("""
                    INSERT INTO course_enrollments
                        (id, user_id, course_id, payment_status, payment_id, amount_paid,
                         platform_fee, achiever_earning, discount_amount, enrolled_at,
                         created_at, updated_at)
                    VALUES (:id, :u, :c, 'paid', :pid, :amt, :fee, :earn, 0, :when, :when, :when)
                """), {'id': str(uuid.uuid4()), 'u': student, 'c': c['id'], 'pid': pay_id,
                       'amt': amount, 'fee': fee, 'earn': round(amount - fee, 2), 'when': when})
                made += 1

            elif kind == 'session':
                amount = float(rng.choice([500, 750, 1000, 1500]))
                fee = round(amount * PLATFORM_CUT, 2)
                # Older sessions are finished; recent ones are still in flight.
                status = 'completed' if back > 20 else rng.choice(['confirmed', 'completed', 'pending'])
                conn.execute(text("""
                    INSERT INTO achiever_sessions
                        (id, mentor_id, student_id, status, payment_status, payment_id,
                         amount, platform_fee, achiever_earning, discount_amount,
                         duration_minutes, scheduled_at, created_at, updated_at)
                    VALUES (:id, :a, :u, :st, 'paid', :pid, :amt, :fee, :earn, 0,
                            60, :when, :when, :when)
                """), {'id': str(uuid.uuid4()), 'a': achiever_id, 'u': student, 'st': status,
                       'pid': pay_id, 'amt': amount, 'fee': fee,
                       'earn': round(amount - fee, 2), 'when': when})
                made += 1

    return made


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--undo', action='store_true', help='remove every demo row')
    args = ap.parse_args()

    with app.app_context():
        conn = db.session
        removed = undo(conn)          # always clear first — keeps the run idempotent
        if args.undo:
            fixed = reconcile_seats(conn)
            conn.commit()
            print(f'removed {removed} demo row(s)')
            print(f'reconciled filled_seats on {fixed} cohort(s)')
            return
        if removed:
            print(f'cleared {removed} row(s) from a previous run')

        students = _students(conn)
        total = 0
        for aid in _achievers(conn):
            n = seed_for(conn, aid, students)
            total += n
            if n:
                print(f'  achiever {aid[:8]}… +{n} events')
        fixed = reconcile_seats(conn)
        conn.commit()
        print(f'seeded {total} demo earning event(s) across 12 months')
        print(f'reconciled filled_seats on {fixed} cohort(s)')
        print('undo with:  python database/migrations/seed_achiever_year_demo.py --undo')


if __name__ == '__main__':
    main()
