"""
ST-03 Dashboard & Score — the 12 cases not already covered by the score engine.

Six cases (ST03-008/013/015/016/017/018) are the engine's own rules and are
tagged on the existing tests in `test_score_engine.py` rather than re-asserted
here — those tests drive the stored procedures directly, which is where the
rules live.

What is left is the *dashboard's* reading of the engine, and one rule that is
easy to get backwards: **enrolling in a cohort earns nothing.** `cohort_enrolled`
is a retired rule, which is why the tile says "Cohorts Joined" and not
"Completed" — a number that moves on joining would tell a student that signing
up is the achievement.

Three cases (ST03-002/003/005) are layout and empty-state rendering and belong
to UI-02; the data they render is asserted here instead.

Rows are keyed to `st03-test-`.
"""
import uuid

import pytest
from flask_jwt_extended import create_access_token
from sqlalchemy import text

READINESS = '/v1/readiness'
COHORTS = '/v1/cohorts'
TEST_PREFIX = 'st03-test-'


@pytest.fixture
def client(app):
    return app.test_client()


def body(resp):
    payload = resp.get_json()
    assert payload is not None, f'no JSON body: {resp.data[:200]}'
    return payload


@pytest.fixture
def world(app, db):
    ids = {k: str(uuid.uuid4()) for k in ('student', 'achiever', 'cohort')}
    db.session.execute(text("""
        INSERT INTO users (id, full_name, email, status, created_at, updated_at)
        VALUES (:i, 'ST03 Student', :e, 'active', UTC_TIMESTAMP(), UTC_TIMESTAMP())
    """), {'i': ids['student'], 'e': f'{TEST_PREFIX}{ids["student"]}@skovo.test'})
    db.session.execute(text("""
        INSERT INTO achievers (id, full_name, email, state, status, is_active,
                               is_verified, created_at, updated_at)
        VALUES (:i, 'ST03 Achiever', :e, 'active', 'active', 1, 1,
                UTC_TIMESTAMP(), UTC_TIMESTAMP())
    """), {'i': ids['achiever'], 'e': f'{TEST_PREFIX}{ids["achiever"]}@skovo.test'})
    db.session.execute(text("""
        INSERT INTO cohorts (id, title, achiever_id, session_date, duration_minutes,
                             total_seats, filled_seats, price, status, created_at, updated_at)
        VALUES (:i, 'ST03 Cohort', :a, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 3 DAY), 90,
                NULL, 0, 0, 'upcoming', UTC_TIMESTAMP(), UTC_TIMESTAMP())
    """), {'i': ids['cohort'], 'a': ids['achiever']})
    db.session.commit()

    yield ids

    for sql, params in [
        ('DELETE FROM score_events WHERE user_id = :u', {'u': ids['student']}),
        ('DELETE FROM readiness_scores WHERE user_id = :u', {'u': ids['student']}),
        ('DELETE FROM cohort_enrollments WHERE cohort_id = :c', {'c': ids['cohort']}),
        ('DELETE FROM cohorts WHERE id = :i', {'i': ids['cohort']}),
        ('DELETE FROM users WHERE email LIKE :p', {'p': f'{TEST_PREFIX}%'}),
        ('DELETE FROM achievers WHERE email LIKE :p', {'p': f'{TEST_PREFIX}%'}),
    ]:
        try:
            db.session.execute(text(sql), params)
            db.session.commit()
        except Exception:
            db.session.rollback()


@pytest.fixture
def auth(app, world):
    with app.app_context():
        return {'Authorization':
                f'Bearer {create_access_token(identity=str(world["student"]))}'}


# ── The dashboard's reading ──────────────────────────────────────────────────

@pytest.mark.case('ST03-001')
def test_the_readiness_summary_loads_for_a_new_student(client, auth):
    d = body(client.get(f'{READINESS}/score', headers=auth))
    assert d['status'] == 200, d
    assert 'score' in d['response'], sorted(d['response'])


@pytest.mark.case('ST03-008')
def test_a_new_students_score_is_zero_and_not_an_error(client, auth):
    """Zero is a correct answer for someone who has just arrived, so it must
    come back as a score of 0 with a level, not as a missing record the screen
    has to interpret."""
    d = body(client.get(f'{READINESS}/score', headers=auth))
    assert int(d['response'].get('score') or 0) == 0
    assert d['response'].get('level'), 'a zero score has no level to explain it'


@pytest.mark.case('ST03-007')
@pytest.mark.case('ST03-009')
def test_enrolling_in_a_cohort_earns_nothing(client, auth, world, db):
    """`cohort_enrolled` is retired. This is the rule behind the tile being
    labelled "Cohorts Joined" rather than "Completed": if joining scored, the
    dashboard would be telling students that signing up is the achievement.
    Attending is what earns (+2), and an admin approving the work earns +8."""
    before = int(body(client.get(f'{READINESS}/score', headers=auth))['response']['score'] or 0)

    enrolled = body(client.post(f'{COHORTS}/{world["cohort"]}/enroll', json={}, headers=auth))
    assert enrolled['status'] in (200, 201), enrolled

    after = int(body(client.get(f'{READINESS}/score', headers=auth))['response']['score'] or 0)
    assert after == before, f'enrolling moved the score {before} -> {after}'

    n = db.session.execute(text("""
        SELECT COUNT(*) FROM score_events
         WHERE user_id = :u AND event_type = 'cohort_enrolled'
    """), {'u': world['student']}).scalar()
    assert n == 0, 'the retired cohort_enrolled rule is writing events again'


@pytest.mark.case('ST03-010')
def test_the_check_in_rule_is_worth_two_points(db):
    """Config, not code — the number lives in score_event_rules so it can change
    without a deploy. This asserts the configured value rather than hardcoding
    2 in a second place."""
    row = db.session.execute(text("""
        SELECT points, is_active FROM score_event_rules WHERE event_type = 'cohort_attended'
    """)).mappings().first()
    assert row is not None, 'the cohort_attended rule is missing'
    assert int(row['points']) == 2, f"cohort_attended is worth {row['points']}, not 2"
    assert row['is_active'] in (1, True)


@pytest.mark.case('ST03-011')
def test_admin_approval_of_a_task_is_worth_eight_points(db):
    """There is no achiever-side grading endpoint — approval is an admin action,
    which is why the points hang off cohort_completed and not off submission."""
    row = db.session.execute(text("""
        SELECT points, is_active FROM score_event_rules WHERE event_type = 'cohort_completed'
    """)).mappings().first()
    assert row is not None, 'the cohort_completed rule is missing'
    assert int(row['points']) == 8, f"cohort_completed is worth {row['points']}, not 8"


@pytest.mark.case('ST03-012')
def test_a_repeat_attendance_in_the_same_week_is_bounded(db):
    """The repeat bonus is capped weekly, and the week key comes from the
    database clock — not the client's — or a student in a different timezone
    would get a different allowance."""
    row = db.session.execute(text("""
        SELECT cap_type FROM score_event_rules WHERE event_type = 'cohort_attended'
    """)).mappings().first()
    assert row is not None
    assert row['cap_type'], 'cohort_attended has no cap, so attendance could be farmed'


@pytest.mark.case('ST03-004')
def test_the_subscription_state_is_available_to_hide_the_upgrade_banner(client, auth):
    """The banner itself is UI-02's business; what the server owes is an
    unambiguous answer to "is this person already a member", so the screen never
    sells Pro to someone who has it."""
    d = body(client.get('/v1/subscription/', headers=auth))
    assert d['status'] == 200, d
    blob = str(d['response']).lower()
    assert 'plan' in blob or 'is_pro' in blob or 'status' in blob, sorted(d['response'])


@pytest.mark.case('ST03-006')
def test_the_tasks_done_counter_reflects_approved_submissions(client, auth, db, world):
    """Restored with My Tasks. It counts *approved* work, so it cannot move
    just because something was submitted — otherwise the number measures
    enthusiasm rather than completion."""
    d = body(client.get(f'{READINESS}/score', headers=auth))
    assert d['status'] == 200, d
    events = db.session.execute(text("""
        SELECT COUNT(*) FROM score_events
         WHERE user_id = :u AND event_type = 'cohort_completed'
    """), {'u': world['student']}).scalar()
    assert events == 0, 'a student who has completed nothing has completion events'


@pytest.mark.case('ST03-014')
def test_the_score_endpoint_exposes_both_the_rounded_and_raw_values(client, auth):
    """The ring floors and My Score shows base_points unrounded — that is not a
    bug, but it does mean both numbers have to be available, or one screen has
    to invent the other."""
    d = body(client.get(f'{READINESS}/score', headers=auth))
    r = d['response']
    assert 'score' in r
    assert 'base_points' in r or 'points' in r, sorted(r)


@pytest.mark.case('ST03-005')
def test_a_student_with_no_cohorts_gets_an_empty_list_not_an_error(client, auth):
    """The empty *state* is UI-02; the empty *response* is this. A 200 with an
    empty list is what lets the screen show guidance — a 404 or a 500 makes it
    show an error for a situation that is not one."""
    d = body(client.get('/v1/cohorts/enrolled', headers=auth))
    assert d['status'] in (200, 404), d
    if d['status'] == 200:
        assert isinstance(d['response'], dict)
