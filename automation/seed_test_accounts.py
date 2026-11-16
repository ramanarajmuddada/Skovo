"""
Seed known test accounts + baseline data for the SKOVO Playwright suite.

Everything created here is clearly labelled (e2e.* emails, 'E2E …' names) and
never touches real users/data. Idempotent — safe to re-run. Password for every
account: E2ePass!234

Creates:
  Portal logins   admin / super / achiever
  Students        e2e.pro   (Skovo Pro, readiness score 75, consent granted)
                  e2e.free  (free tier, score 0, consent granted)
  Baseline data   4 open communities · 1 open + 1 Pro-only market deal
                  1 active opportunity (min score 0) for the apply flow

Run from the automation folder:
    ..\\SKOVO_BACKEND\\venv\\Scripts\\python.exe seed_test_accounts.py
"""
import os
import sys
import uuid

BACKEND = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'SKOVO_BACKEND'))
sys.path.insert(0, BACKEND)
os.chdir(BACKEND)

import app as a  # noqa: E402
from sqlalchemy import text  # noqa: E402
from portal.models import db  # noqa: E402
from werkzeug.security import generate_password_hash  # noqa: E402

PASSWORD = 'E2ePass!234'
PORTAL_ACCOUNTS = {
    'admin': 'e2e.admin@skovo-test.local',
    'super': 'e2e.super@skovo-test.local',
    'achiever': 'e2e.achiever@skovo-test.local',
}
PRO_EMAIL = 'e2e.pro@skovo-test.local'
# Disposable admin the block/restore test acts on, so it never reaches for a
# real one out of the live list.
BLOCK_TARGET_EMAIL = 'e2e.blocktarget@skovo-test.local'
FREE_EMAIL = 'e2e.free@skovo-test.local'


def _ensure_student(s, pw, email, name, score, is_pro):
    """Create-or-refresh a student. Upserts rather than deleting, because test
    runs leave posts/applications behind that hold foreign keys on the user."""
    uid = s.execute(text("SELECT id FROM users WHERE email=:e"), {'e': email}).scalar()

    if uid:
        s.execute(text("""
            UPDATE users SET full_name=:n, password_hash=:p, status='active',
                   consent_status='granted', updated_at=UTC_TIMESTAMP()
             WHERE id=:i
        """), {'i': uid, 'n': name, 'p': pw})
    else:
        uid = str(uuid.uuid4())
        s.execute(text("""
            INSERT INTO users (id, email, full_name, password_hash, status, consent_status,
                               created_at, updated_at)
            VALUES (:i, :e, :n, :p, 'active', 'granted', UTC_TIMESTAMP(), UTC_TIMESTAMP())
        """), {'i': uid, 'e': email, 'n': name, 'p': pw})
        s.execute(text("""
            INSERT INTO user_profiles (id, user_id, created_at, updated_at)
            VALUES (:i, :u, UTC_TIMESTAMP(), UTC_TIMESTAMP())
        """), {'i': str(uuid.uuid4()), 'u': uid})

    # The app gates first login on Profile until education + reservation are
    # set, so seed a complete path here or every UI test lands on /profile.
    s.execute(text("""
        UPDATE user_profiles SET education_level='ug', education_category='ug',
               state='Telangana', city='Hyderabad',
               degree_category='Engineering', degree_type='B.Tech', branch='CSE',
               year_of_study='2nd Year',
               updated_at=UTC_TIMESTAMP()
         WHERE user_id=:u
    """), {'u': uid})
    s.execute(text("DELETE FROM student_goals WHERE user_id=:u"), {'u': uid})
    s.execute(text("""
        INSERT INTO student_goals (id, user_id, reservation_category, created_at, updated_at)
        VALUES (:i, :u, 'general', UTC_TIMESTAMP(), UTC_TIMESTAMP())
    """), {'i': str(uuid.uuid4()), 'u': uid})

    # Reset the state the tests mutate, so every run starts from a known place.
    s.execute(text("DELETE FROM subscriptions WHERE user_id=:u"), {'u': uid})
    s.execute(text("DELETE FROM score_events WHERE user_id=:u"), {'u': uid})
    s.execute(text("DELETE FROM group_memberships WHERE user_id=:u"), {'u': uid})
    s.execute(text("DELETE FROM opportunity_shortlist WHERE user_id=:u"), {'u': uid})
    s.execute(text("DELETE FROM readiness_scores WHERE user_id=:u"), {'u': uid})

    level = 'Achiever' if score >= 65 else ('Pioneer' if score >= 30 else 'Explorer')
    s.execute(text("""
        INSERT INTO readiness_scores (id, user_id, score, level, base_points, decay_points,
                                      cohorts_completed, tasks_completed, last_event_at)
        VALUES (:i, :u, :sc, :lv, :sc, 0, 0, 0, UTC_TIMESTAMP())
    """), {'i': str(uuid.uuid4()), 'u': uid, 'sc': score, 'lv': level})

    # The score is rebuilt from the ledger on every read, so a directly-set
    # score won't stick — seed a real ledger event worth the target score.
    if score > 0:
        s.execute(text("""
            INSERT INTO score_events (id, user_id, event_type, points, ref_id, meta, occurred_at)
            VALUES (:i, :u, 'admin_adjustment', :sc, 'e2e-seed', 'e2e seed score', UTC_TIMESTAMP())
        """), {'i': str(uuid.uuid4()), 'u': uid, 'sc': score})

    if is_pro:
        s.execute(text("""
            INSERT INTO subscriptions (id, user_id, plan, status, amount, started_at, expires_at,
                                       created_at, updated_at)
            VALUES (:i, :u, 'annual', 'active', 1499, UTC_TIMESTAMP(),
                    DATE_ADD(UTC_TIMESTAMP(), INTERVAL 1 YEAR), UTC_TIMESTAMP(), UTC_TIMESTAMP())
        """), {'i': str(uuid.uuid4()), 'u': uid})
    return uid


def _ensure_communities(s):
    for i in range(1, 5):
        gid = f'e2e00000-0000-4000-8000-00000000000{i}'
        s.execute(text("""
            INSERT INTO `groups` (id, name, category, group_type, join_type, member_count,
                                  is_active, created_at, updated_at)
            VALUES (:i, :n, 'career', 'regular', 'open', 0, 1, UTC_TIMESTAMP(), UTC_TIMESTAMP())
            ON DUPLICATE KEY UPDATE join_type='open', is_active=1
        """), {'i': gid, 'n': f'E2E Community {i}'})


def _ensure_deals(s):
    s.execute(text("DELETE FROM market_deals WHERE title LIKE 'E2E %'"))
    s.execute(text("""
        INSERT INTO market_deals (id, title, brand, category, deal_url, coupon_code, discount_label,
                                  is_pro_only, is_active, sort_order)
        VALUES (:i, 'E2E Open Deal', 'E2EBrand', 'software', 'https://e2e.test/open',
                'E2EOPEN', '50% OFF', 0, 1, 10)
    """), {'i': str(uuid.uuid4())})
    s.execute(text("""
        INSERT INTO market_deals (id, title, brand, category, deal_url, coupon_code, discount_label,
                                  is_pro_only, is_active, sort_order)
        VALUES (:i, 'E2E Pro Deal', 'E2EBrand', 'software', 'https://e2e.test/pro',
                'E2EPRO', '70% OFF', 1, 1, 9)
    """), {'i': str(uuid.uuid4())})


def _ensure_open_dm_report(s, reporter_id, reported_id):
    """Always leave one open report so the moderation test never skips."""
    s.execute(text("DELETE FROM dm_reports WHERE reason LIKE 'E2E %'"))
    s.execute(text("""
        INSERT INTO dm_reports (id, reporter_id, reported_user_id, reason, status)
        VALUES (:i, :a, :b, 'E2E seeded report for moderation test', 'open')
    """), {'i': str(uuid.uuid4()), 'a': reporter_id, 'b': reported_id})


def _cleanup_e2e_artifacts(s):
    """Drop rows the cross-portal specs create, so repeated runs neither grow
    the database without bound nor block the account upserts below."""
    # Enrollments first — they point at the cohorts we are about to remove.
    s.execute(text("""DELETE ce FROM cohort_enrollments ce
                      JOIN cohorts c ON c.id = ce.cohort_id
                      WHERE c.title LIKE 'E2E %'"""))
    # Attendance codes cascade with their cohort, but drop them explicitly so a
    # stale live code from a previous run can never satisfy a fresh check-in.
    s.execute(text("""DELETE cac FROM cohort_attendance_codes cac
                      JOIN cohorts c ON c.id = cac.cohort_id
                      WHERE c.title LIKE 'E2E %'"""))
    s.execute(text("DELETE FROM cohorts WHERE title LIKE 'E2E %'"))
    s.execute(text("""DELETE oa FROM opportunity_applications oa
                      JOIN opportunities o ON o.id = oa.opportunity_id
                      WHERE o.title LIKE 'E2E %'"""))
    s.execute(text("DELETE FROM opportunities WHERE title LIKE 'E2E Role %'"))
    s.execute(text("DELETE FROM domains WHERE name LIKE 'E2E %'"))

    # 1-on-1 booking fixtures: the slot spec opens the same date/time each run,
    # so last run's slot (and the session booked into it) must go first or the
    # slot comes back already booked.
    ach = s.execute(text("SELECT id FROM achievers WHERE email=:e"),
                    {'e': PORTAL_ACCOUNTS['achiever']}).fetchone()
    if ach:
        s.execute(text("DELETE FROM achiever_sessions WHERE mentor_id=:a"), {'a': ach[0]})
        s.execute(text("DELETE FROM achiever_slots WHERE mentor_id=:a"), {'a': ach[0]})
        s.execute(text("DELETE FROM achiever_availability WHERE mentor_id=:a"), {'a': ach[0]})


def _upsert_admin(s, pw):
    row = s.execute(text("SELECT id FROM admins WHERE email=:e"),
                    {'e': PORTAL_ACCOUNTS['admin']}).fetchone()
    if row:
        # state='active' is the real approval gate now (_install_admin_approval_gate
        # reads admins.state, not status) — without it every admin endpoint 403s.
        #
        # No admin_role. The admin role system was removed entirely (CLAUDE.md,
        # 2026-08-30) because admin_role was never written to the JWT and so
        # enforced nothing; the column went with it. Writing it here failed with
        # "Unknown column 'admin_role'" and killed the whole seed at this line —
        # so admin, super AND achiever fixtures were all never created, every
        # login in global-setup failed, and every authed spec in the suite
        # failed for one reason that had nothing to do with the code under test.
        # Same shape as the trust_level bug fixed in _upsert_achiever below.
        s.execute(text("""UPDATE admins SET full_name='E2E Admin', password_hash=:p,
                          status='active', state='active' WHERE id=:i"""),
                  {'p': pw, 'i': row[0]})
    else:
        s.execute(text("""INSERT INTO admins (id, full_name, email, password_hash, status, state, created_at)
                          VALUES (:i,'E2E Admin',:e,:p,'active','active',UTC_TIMESTAMP())"""),
                  {'i': str(uuid.uuid4()), 'e': PORTAL_ACCOUNTS['admin'], 'p': pw})


def _upsert_block_target(s, pw):
    """A second, disposable admin for the block/restore test to act on.

    Without it, `22-admin-actions-reach-users.spec.js` picked "any admin that is
    not the E2E founder" out of the live list and set their status to blocked —
    and `.env` points at production, so the account it reached for was a real
    person's. It restored them afterwards, but a run that failed or was
    interrupted in between left a real admin locked out of the portal.

    Blocking is a destructive act on somebody's access. It gets its own throwaway
    account, and the test now refuses to touch anything else.
    """
    row = s.execute(text("SELECT id FROM admins WHERE email=:e"),
                    {'e': BLOCK_TARGET_EMAIL}).fetchone()
    if row:
        s.execute(text("""UPDATE admins SET full_name='E2E Block Target', password_hash=:p,
                          status='active', state='active' WHERE id=:i"""),
                  {'p': pw, 'i': row[0]})
    else:
        s.execute(text("""INSERT INTO admins (id, full_name, email, password_hash, status, state, created_at)
                          VALUES (:i,'E2E Block Target',:e,:p,'active','active',UTC_TIMESTAMP())"""),
                  {'i': str(uuid.uuid4()), 'e': BLOCK_TARGET_EMAIL, 'p': pw})


def _upsert_super(s, pw):
    row = s.execute(text("SELECT id FROM super_admins WHERE email=:e"),
                    {'e': PORTAL_ACCOUNTS['super']}).fetchone()
    if row:
        s.execute(text("""UPDATE super_admins SET full_name='E2E Super', password_hash=:p,
                          status='active' WHERE id=:i"""), {'p': pw, 'i': row[0]})
    else:
        s.execute(text("""INSERT INTO super_admins (id, full_name, email, password_hash, status, created_at)
                          VALUES (:i,'E2E Super',:e,:p,'active',UTC_TIMESTAMP())"""),
                  {'i': str(uuid.uuid4()), 'e': PORTAL_ACCOUNTS['super'], 'p': pw})


def _upsert_achiever(s, pw):
    row = s.execute(text("SELECT id FROM achievers WHERE email=:e"),
                    {'e': PORTAL_ACCOUNTS['achiever']}).fetchone()
    # Verification matters: booking, cohort creation and slot publishing all
    # refuse an unverified achiever, so an unverified fixture cannot exercise
    # any of the flows this suite exists to cover.
    #
    # The trust ladder was replaced by the five-state machine (see CLAUDE.md):
    # `trust_level` no longer exists on `achievers`, and the guards now read
    # `state`. A fully-usable fixture is state='active' + is_verified=1, which is
    # what "may charge, may run cohorts" means today. (This block used to set
    # trust_level=2 and failed with Unknown column once that column was dropped.)
    # linkedin_url is NOT optional padding — it is the one profile field the app
    # makes mandatory (CLAUDE.md: "LinkedIn is mandatory"), because it is how an
    # admin checks that the person reviewing as "Senior Engineer at Google"
    # actually is. The fixture had none, so pressing Save Profile failed client
    # validation and never issued the PUT, and two specs timed out waiting for a
    # request that was never going to happen — reported as the profile screen
    # being broken when the app was correctly enforcing a required field.
    #
    # bio and designation for the same reason at one remove: a profile with
    # every optional field empty is not what any real achiever looks like, and
    # screens that render them get tested against blanks.
    PROFILE = {
        'linkedin_url': 'https://www.linkedin.com/in/e2e-achiever',
        'designation': 'Senior Engineer',
        'company': 'E2E Test Corp',
        'bio': 'Seeded E2E achiever. Runs cohorts and 1-on-1 sessions for the test suite.',
    }
    if row:
        s.execute(text("""UPDATE achievers SET full_name='E2E Achiever', password_hash=:p,
                          status='active', state='active', is_active=1, is_verified=1,
                          application_status='approved', session_rate=500,
                          linkedin_url=:linkedin_url, designation=:designation,
                          company=:company, bio=:bio,
                          updated_at=UTC_TIMESTAMP() WHERE id=:i"""),
                  {'p': pw, 'i': row[0], **PROFILE})
    else:
        s.execute(text("""INSERT INTO achievers (id, full_name, email, password_hash, status,
                                                 state, is_active, is_verified,
                                                 application_status, session_rate,
                                                 linkedin_url, designation, company, bio,
                                                 created_at, updated_at)
                          VALUES (:i,'E2E Achiever',:e,:p,'active','active',1,1,'approved',500,
                                  :linkedin_url,:designation,:company,:bio,
                                  UTC_TIMESTAMP(),UTC_TIMESTAMP())"""),
                  {'i': str(uuid.uuid4()), 'e': PORTAL_ACCOUNTS['achiever'], 'p': pw, **PROFILE})


def _ensure_cutoffs(s):
    """Seed a small EAMCET cutoff set so the College Predictor is testable.
    Idempotent: cleared and re-inserted for year 2025."""
    s.execute(text("DELETE FROM cg_college_cutoffs WHERE exam_type='EAMCET' AND year=2025"))
    rows = [
        ('RGUKT AP (IIIT Nuzvid)', 'Nuzvid', 'CSE', 'Computer Science & Engineering', 'OC', 1, 4800),
        ('RGUKT AP (IIIT Nuzvid)', 'Nuzvid', 'ECE', 'Electronics & Communication', 'OC', 2500, 6000),
        ('RGUKT AP (IIIT Nuzvid)', 'Nuzvid', 'MECH', 'Mechanical Engineering', 'OC', 6000, 15000),
        ('Govt Polytechnic Visakhapatnam', 'Visakhapatnam', 'CSE', 'Computer Science & Engineering', 'OC', 4000, 9000),
        ('Govt Polytechnic Visakhapatnam', 'Visakhapatnam', 'CIVIL', 'Civil Engineering', 'OC', 9000, 22000),
        ('RGUKT AP (IIIT Nuzvid)', 'Nuzvid', 'CSE', 'Computer Science & Engineering', 'BC', 3000, 7500),
        ('RGUKT AP (IIIT Nuzvid)', 'Nuzvid', 'CSE', 'Computer Science & Engineering', 'SC', 8000, 25000),
        ('Govt Polytechnic Visakhapatnam', 'Visakhapatnam', 'ECE', 'Electronics & Communication', 'OC', 5500, 11000),
    ]
    for name, city, bcode, bname, cat, op, cl in rows:
        s.execute(text("""
            INSERT INTO cg_college_cutoffs
              (id, college_name, college_city, college_state, college_type, branch_code,
               branch_name, exam_type, year, category, gender, opening_rank, closing_rank,
               total_seats, created_at)
            VALUES (:i, :n, :c, 'Andhra Pradesh', 'government', :bc, :bn, 'EAMCET', 2025,
                    :cat, 'all', :op, :cl, 60, UTC_TIMESTAMP())
        """), {'i': str(uuid.uuid4()), 'n': name, 'c': city, 'bc': bcode, 'bn': bname,
               'cat': cat, 'op': op, 'cl': cl})


def _ensure_opportunity(s):
    exists = s.execute(text(
        "SELECT COUNT(*) FROM opportunities WHERE title='E2E Test Internship'")).scalar()
    if not exists:
        s.execute(text("""
            INSERT INTO opportunities (id, title, company, type, location, is_remote,
                                       min_readiness_score, status, created_at, updated_at)
            VALUES (:i, 'E2E Test Internship', 'E2E Corp', 'internship', 'Remote', 1,
                    0, 'active', UTC_TIMESTAMP(), UTC_TIMESTAMP())
        """), {'i': str(uuid.uuid4())})


def main():
    with a.app.app_context():
        s = db.session
        pw = generate_password_hash(PASSWORD)

        # ── portal accounts ──────────────────────────────────────────────
        # Upsert rather than delete+insert: other rows point at these accounts
        # (cohorts.achiever_id, audit_logs.admin_id, …) and a DELETE trips the
        # foreign keys once the cross-portal tests have created anything.
        _cleanup_e2e_artifacts(s)

        _upsert_admin(s, pw)

        _upsert_block_target(s, pw)
        _upsert_super(s, pw)
        _upsert_achiever(s, pw)

        # ── students + baseline data ─────────────────────────────────────
        pro_id = _ensure_student(s, pw, PRO_EMAIL, 'E2E Pro Student', 75, True)
        free_id = _ensure_student(s, pw, FREE_EMAIL, 'E2E Free Student', 0, False)
        _ensure_communities(s)
        _ensure_deals(s)
        _ensure_opportunity(s)
        _ensure_cutoffs(s)
        _ensure_open_dm_report(s, free_id, pro_id)

        s.commit()
        print("Seeded portal accounts, Pro/free students, and baseline data.")
        for role, email in PORTAL_ACCOUNTS.items():
            print(f"  {role:9} {email}  /  {PASSWORD}")
        print(f"  pro       {PRO_EMAIL}  /  {PASSWORD}")
        print(f"  free      {FREE_EMAIL}  /  {PASSWORD}")


if __name__ == '__main__':
    main()
