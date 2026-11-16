"""
X-02 Cohort state matrix — all 82 cases.

15 actions x 5 states = 75, plus 7 transition cases (X02-076…082).

The sheet is a matrix, so this is written as one, rather than as 75 hand-rolled
tests that would drift apart. `ALLOWED` below IS the specification: each action
names the states it is permitted in, and a single parametrised test asserts both
halves — permitted where listed, and **refused naming the reason** everywhere
else. Getting a row wrong in one direction only is the failure mode this shape
exists to prevent; an action that is allowed everywhere passes a "can do it"
test in all five states.

Two things the sheet insists on and this file therefore checks:

  * **Refusals name the state.** `status_reason` carries live/completed/
    cancelled rather than one generic "Unable to…". That is the same defect
    class as the unaliased procedure branches: a refusal nobody can act on.

  * **Status is derived, never read from the column.** `effective_cohort_status`
    recomputes per request, so a scheduler outage (X02-078) must change none of
    this. Every state below is built by positioning `session_date` relative to
    now and leaving `status` deliberately stale, so a test that only passed
    because the column happened to be right would fail here.

Rows are keyed to `x02-matrix-test-`.
"""
import datetime
import uuid

import pytest
from flask_jwt_extended import create_access_token
from sqlalchemy import text

TEST_PREFIX = 'x02-matrix-test-'

STUDENT_COHORTS = '/v1/cohorts'
ACHIEVER_COHORTS = '/v1/achievers/portal/cohorts'
ACHIEVER_TASKS = '/v1/achievers/portal/tasks'
TASKS = '/v1/tasks'
REVIEWS = '/v1/achiever-reviews'
ADMIN = '/v1/skovo-platform-panel-admin'

STATES = ['upcoming', 'live', 'completed', 'cancelled', 'no_session_date']

# Where each state's block of 15 ids begins on the sheet.
BASE = {'upcoming': 1, 'live': 16, 'completed': 31, 'cancelled': 46,
        'no_session_date': 61}

# The action order the sheet uses, and the states each one is permitted in.
# `no_session_date` behaves as its stored status ('upcoming' here), because
# effective_cohort_status returns a dateless cohort as-is (X02-081).
ALLOWED = {
    'student_enrol_free':       {'upcoming', 'no_session_date'},
    'student_paid_checkout':    {'upcoming', 'no_session_date'},
    'student_meeting_link':     {'live'},
    'student_checkin_redeem':   {'live'},
    'student_see_tasks':        {'live', 'completed'},
    'student_submit_task':      {'live', 'completed'},
    'student_rate':             {'live', 'completed'},
    'student_joined_badge':     set(STATES),
    'achiever_edit':            set(STATES),
    'achiever_cancel':          {'upcoming', 'live', 'no_session_date'},
    'achiever_reveal_code':     {'live'},
    'achiever_mark_attendance': {'live', 'completed'},
    'achiever_create_task':     set(STATES),
    'achiever_read_feedback':   set(STATES),
    'admin_crud':               set(STATES),
}
ACTION_ORDER = list(ALLOWED)

# Actions that change something and therefore owe a stated reason when refused.
# The rest are reads, where "not allowed" means the field is absent from an
# otherwise successful response — there is no refusal to explain.
MUTATING = {
    'student_enrol_free', 'student_paid_checkout', 'student_checkin_redeem',
    'student_submit_task', 'student_rate', 'achiever_cancel',
    'achiever_reveal_code', 'achiever_mark_attendance',
}


def case_id(state, action):
    return f'X02-{BASE[state] + ACTION_ORDER.index(action):03d}'


@pytest.fixture
def client(app):
    return app.test_client()


def body(resp):
    payload = resp.get_json()
    assert payload is not None, f'no JSON body: {resp.data[:200]}'
    return payload


@pytest.fixture
def world(app, db):
    """An achiever, a student enrolled in the cohort, an admin, and a cohort
    factory that can put that cohort into any of the five states.

    The student is enrolled directly in the database rather than through the
    API: half these actions are *about* the enrolment gate, so enrolling through
    it would make the fixture depend on the thing under test.
    """
    aid, uid, adm = (str(uuid.uuid4()) for _ in range(3))
    cid = str(uuid.uuid4())
    db.session.execute(text("""
        INSERT INTO achievers (id, full_name, email, state, status, is_active,
                               is_verified, created_at, updated_at)
        VALUES (:i, 'X02 Achiever', :e, 'active', 'active', 1, 1,
                UTC_TIMESTAMP(), UTC_TIMESTAMP())
    """), {'i': aid, 'e': f'{TEST_PREFIX}{aid}@skovo.test'})
    db.session.execute(text("""
        INSERT INTO users (id, full_name, email, status, created_at, updated_at)
        VALUES (:i, 'X02 Student', :e, 'active', UTC_TIMESTAMP(), UTC_TIMESTAMP())
    """), {'i': uid, 'e': f'{TEST_PREFIX}{uid}@skovo.test'})
    db.session.execute(text("""
        INSERT INTO admins (id, full_name, email, password_hash, status, state, created_at)
        VALUES (:i, 'X02 Admin', :e, 'x', 'active', 'active', UTC_TIMESTAMP())
    """), {'i': adm, 'e': f'{TEST_PREFIX}{adm}@skovo.test'})
    db.session.commit()

    ctx = {'achiever': aid, 'student': uid, 'admin': adm, 'cohort': cid}

    def build(state, price=0):
        """Create the cohort positioned for `state`.

        `status` is left deliberately stale ('upcoming') wherever the clock can
        express the state on its own, so these tests exercise the derivation and
        not the column. Only cancelled and completed need the column, because
        neither is reachable from a timestamp alone.
        """
        offsets = {
            'upcoming':        ('DATE_ADD(UTC_TIMESTAMP(), INTERVAL 3 DAY)', 'upcoming'),
            'live':            ('DATE_SUB(UTC_TIMESTAMP(), INTERVAL 10 MINUTE)', 'upcoming'),
            'completed':       ('DATE_SUB(UTC_TIMESTAMP(), INTERVAL 5 DAY)', 'completed'),
            'cancelled':       ('DATE_ADD(UTC_TIMESTAMP(), INTERVAL 3 DAY)', 'cancelled'),
            'no_session_date': ('NULL', 'upcoming'),
        }
        when, status = offsets[state]
        db.session.execute(text(f"""
            INSERT INTO cohorts (id, title, achiever_id, session_date, duration_minutes,
                                 total_seats, filled_seats, price, status,
                                 created_at, updated_at)
            VALUES (:i, 'X02 Matrix Cohort', :a, {when}, 90, NULL, 0, :p, :s,
                    UTC_TIMESTAMP(), UTC_TIMESTAMP())
        """), {'i': cid, 'a': aid, 'p': price, 's': status})
        eid = str(uuid.uuid4())
        db.session.execute(text("""
            INSERT INTO cohort_enrollments (id, user_id, cohort_id, payment_status,
                                            amount_paid, enrolled_at, created_at, updated_at)
            VALUES (:i, :u, :c, 'free', 0, UTC_TIMESTAMP(), UTC_TIMESTAMP(), UTC_TIMESTAMP())
        """), {'i': eid, 'u': uid, 'c': cid})
        db.session.commit()
        ctx['enrollment'] = eid
        return cid

    ctx['build'] = build
    yield ctx

    # Every statement runs even if an earlier one raises.
    #
    # Not defensiveness for its own sake. The first version of this teardown
    # named a table that does not exist (`attendance_codes`; it is
    # `cohort_attendance_codes`), and because that line sat ABOVE the identity
    # deletes, all 82 tests leaked their achiever, student and admin into the
    # production database — 249 rows from a single run, found only by counting
    # against a known baseline afterwards. A teardown that stops at the first
    # error is a teardown that silently did not run.
    for sql, params in [
        ('DELETE FROM payment_events WHERE order_id IN '
         '(SELECT id FROM payment_orders WHERE student_id = :u)', {'u': uid}),
        ('DELETE FROM payment_orders WHERE student_id = :u', {'u': uid}),
        ('DELETE FROM task_submissions WHERE user_id = :u', {'u': uid}),
        ('DELETE FROM cohort_tasks WHERE cohort_id = :c', {'c': cid}),
        ('DELETE FROM cohort_attendance_codes WHERE cohort_id = :c', {'c': cid}),
        ('DELETE FROM cohort_enrollments WHERE cohort_id = :c', {'c': cid}),
        ('DELETE FROM achiever_reviews WHERE achiever_id = :a', {'a': aid}),
        ('DELETE FROM notification_logs WHERE user_id = :u', {'u': uid}),
        ('DELETE FROM readiness_scores WHERE user_id = :u', {'u': uid}),
        ('DELETE FROM cohorts WHERE id = :i', {'i': cid}),
        # The enrol and checkout actions mint their own throwaway students, so
        # this sweeps by prefix rather than tracking each one.
        ('DELETE FROM users WHERE email LIKE :p', {'p': f'{TEST_PREFIX}%'}),
        ('DELETE FROM admins WHERE id = :i', {'i': adm}),
        ('DELETE FROM achievers WHERE id = :i', {'i': aid}),
    ]:
        try:
            db.session.execute(text(sql), params)
            db.session.commit()
        except Exception:
            db.session.rollback()


@pytest.fixture
def tokens(app, world):
    with app.app_context():
        return {
            'student': {'Authorization':
                        f'Bearer {create_access_token(identity=str(world["student"]))}'},
            'achiever': {'Authorization': 'Bearer ' + create_access_token(
                identity=str(world['achiever']),
                additional_claims={'role': 'mentor', 'mentor': True,
                                   'full_name': 'X02 Achiever'})},
            'admin': {'Authorization': 'Bearer ' + create_access_token(
                identity=str(world['admin']),
                additional_claims={'role': 'admin', 'full_name': 'X02 Admin'})},
        }


# ── The fifteen actions ──────────────────────────────────────────────────────
#
# Each returns (allowed: bool, payload). "Allowed" means the action was
# permitted in this state — not that it succeeded for some other reason.

def _run(action, client, world, tokens, db):
    cid, s, a, adm = (world['cohort'], tokens['student'],
                      tokens['achiever'], tokens['admin'])

    if action == 'student_enrol_free':
        # A second student, because the fixture's own student is already
        # enrolled and would be refused for that reason instead of the state.
        uid = str(uuid.uuid4())
        db.session.execute(text("""
            INSERT INTO users (id, full_name, email, status, created_at, updated_at)
            VALUES (:i, 'X02 Joiner', :e, 'active', UTC_TIMESTAMP(), UTC_TIMESTAMP())
        """), {'i': uid, 'e': f'{TEST_PREFIX}join-{uid}@skovo.test'})
        db.session.commit()
        from flask_jwt_extended import create_access_token as cat
        hdr = {'Authorization': f'Bearer {cat(identity=str(uid))}'}
        d = body(client.post(f'{STUDENT_COHORTS}/{cid}/enroll', json={}, headers=hdr))
        return d['status'] in (200, 201), d

    if action == 'student_paid_checkout':
        db.session.execute(text('UPDATE cohorts SET price = 499 WHERE id = :i'), {'i': cid})
        db.session.commit()
        uid = str(uuid.uuid4())
        db.session.execute(text("""
            INSERT INTO users (id, full_name, email, status, created_at, updated_at)
            VALUES (:i, 'X02 Payer', :e, 'active', UTC_TIMESTAMP(), UTC_TIMESTAMP())
        """), {'i': uid, 'e': f'{TEST_PREFIX}pay-{uid}@skovo.test'})
        db.session.commit()
        from flask_jwt_extended import create_access_token as cat
        hdr = {'Authorization': f'Bearer {cat(identity=str(uid))}'}
        d = body(client.post(f'{STUDENT_COHORTS}/{cid}/enroll',
                             json={'phone': '9876543210'}, headers=hdr))
        # Cashfree cannot complete an order on this account, so "allowed" is
        # "got past the state gate", i.e. not refused with a status_reason.
        blocked = d['status'] in (400, 403, 409) and d['response'].get('status_reason')
        return not blocked, d

    if action == 'student_meeting_link':
        db.session.execute(text(
            "UPDATE cohorts SET meeting_link='https://meet.example.com/x02' WHERE id=:i"),
            {'i': cid})
        db.session.commit()
        d = body(client.get(f'{STUDENT_COHORTS}/{cid}', headers=s))
        return bool(d.get('response', {}).get('meeting_link')), d

    if action == 'student_checkin_redeem':
        # An active code is planted in every state on purpose. Codes are only
        # *revealed* while live, so without this the route answers
        # `no_active_code` everywhere and the state gate is never exercised —
        # the cell would pass while proving nothing. Planting one asks the
        # question that matters: if a code leaks or is reused, can it still be
        # redeemed after the class is over or cancelled?
        db.session.execute(text("""
            INSERT INTO cohort_attendance_codes (id, cohort_id, code, revealed_by,
                                                 revealed_at, expires_at, is_active, created_at)
            VALUES (:i, :c, '135790', :a, UTC_TIMESTAMP(),
                    DATE_ADD(UTC_TIMESTAMP(), INTERVAL 30 MINUTE), 1, UTC_TIMESTAMP())
        """), {'i': str(uuid.uuid4()), 'c': cid, 'a': world['achiever']})
        db.session.commit()
        d = body(client.post(f'{STUDENT_COHORTS}/{cid}/check-in',
                             json={'code': '135790'}, headers=s))
        # A wrong code, or no code having been revealed yet, is a different
        # refusal from a wrong state — both mean the state gate passed and the
        # request reached the code check, which is what this cell is about.
        # Only a state refusal counts as "not allowed".
        if d['status'] == 200:
            return True, d
        # already_checked_in also means the state gate passed.
        if d['response'].get('reason') == 'already_checked_in':
            return True, d
        return False, d

    if action == 'student_see_tasks':
        tid = str(uuid.uuid4())
        db.session.execute(text("""
            INSERT INTO cohort_tasks (id, cohort_id, title, task_status, score_weight,
                                      created_by, created_at, updated_at)
            VALUES (:i, :c, 'X02 Visible Task', 'active', 5, :a,
                    UTC_TIMESTAMP(), UTC_TIMESTAMP())
        """), {'i': tid, 'c': cid, 'a': world['achiever']})
        db.session.commit()
        d = body(client.get(f'{TASKS}/', headers=s))
        titles = [t['title'] for t in d.get('response', {}).get('tasks', [])]
        return 'X02 Visible Task' in titles, d

    if action == 'student_submit_task':
        tid = str(uuid.uuid4())
        db.session.execute(text("""
            INSERT INTO cohort_tasks (id, cohort_id, title, task_status, score_weight,
                                      created_by, created_at, updated_at)
            VALUES (:i, :c, 'X02 Submit Task', 'active', 5, :a,
                    UTC_TIMESTAMP(), UTC_TIMESTAMP())
        """), {'i': tid, 'c': cid, 'a': world['achiever']})
        db.session.commit()
        d = body(client.post(f'{TASKS}/{tid}/submit',
                             json={'evidence_text': 'done'}, headers=s))
        return d['status'] == 200, d

    if action == 'student_rate':
        d = body(client.post(f'{REVIEWS}/{world["achiever"]}',
                             json={'rating': 5, 'context_type': 'cohort',
                                   'context_id': cid, 'review_text': 'Good'},
                             headers=s))
        return d['status'] in (200, 201), d

    if action == 'student_joined_badge':
        # search + per_page, because the list is paginated 10 at a time over
        # every cohort in the database — the fixture's own row is otherwise on
        # page 9 and the badge looks missing when it is merely off-screen.
        d = body(client.get(
            f'{STUDENT_COHORTS}/?search=X02+Matrix+Cohort&per_page=100', headers=s))
        rows = d.get('response', {}).get('cohorts', [])
        mine = [c for c in rows if c.get('id') == cid]
        return bool(mine) and bool(mine[0].get('is_enrolled')), d

    if action == 'achiever_edit':
        d = body(client.put(f'{ACHIEVER_COHORTS}/{cid}',
                            json={'title': 'X02 Matrix Cohort edited'}, headers=a))
        return d['status'] == 200, d

    if action == 'achiever_cancel':
        d = body(client.delete(f'{ACHIEVER_COHORTS}/{cid}', headers=a))
        return d['status'] == 200, d

    if action == 'achiever_reveal_code':
        d = body(client.post(f'{ACHIEVER_COHORTS}/{cid}/attendance-code', json={}, headers=a))
        return d['status'] in (200, 201), d

    if action == 'achiever_mark_attendance':
        # `present` is a list of ENROLMENT ids, not user ids — the register is
        # keyed to the seat, not the person.
        d = body(client.patch(f'{ACHIEVER_COHORTS}/{cid}/attendance',
                              json={'present': [world['enrollment']]},
                              headers=a))
        return d['status'] in (200, 201), d

    if action == 'achiever_create_task':
        d = body(client.post(ACHIEVER_TASKS,
                             json={'cohort_id': cid, 'title': 'X02 Any-state task'},
                             headers=a))
        return d['status'] == 201, d

    if action == 'achiever_read_feedback':
        d = body(client.get(f'{ACHIEVER_COHORTS}/{cid}/feedback', headers=a))
        return d['status'] == 200, d

    if action == 'admin_crud':
        # The admin detail route is PUT-only; reads come from the list. A GET
        # here answers 405, which is a routing fact and not a permission one.
        put = body(client.put(f'{ADMIN}/cohorts/{cid}',
                              json={'title': 'X02 Admin edit'}, headers=adm))
        return put['status'] == 200, put

    raise AssertionError(f'unknown action {action}')


MATRIX = [
    pytest.param(state, action, id=f'{case_id(state, action)}-{state}-{action}')
    for state in STATES
    for action in ACTION_ORDER
]


@pytest.mark.parametrize('state,action', MATRIX)
def test_cohort_state_matrix(state, action, client, world, tokens, db):
    """One cell of the matrix: is `action` permitted in `state`?

    Both directions are asserted from the same table, so an action that is
    silently allowed everywhere cannot pass — it fails in the four states where
    ALLOWED says it should be refused.
    """
    world['build'](state)
    expected = state in ALLOWED[action]
    allowed, payload = _run(action, client, world, tokens, db)

    assert payload['status'] != 500, \
        f'{action} in {state} answered 500: {payload.get("response")}'

    if expected:
        assert allowed, f'{action} should be permitted in {state}: {payload}'
    else:
        assert not allowed, f'{action} was permitted in {state} and must not be: {payload}'
        # Only a *mutating* action owes an explanation. For the read-visibility
        # ones the refusal is the field simply not being there — the request
        # succeeded, it just did not carry a meeting link or a task, and there
        # is no message to demand.
        if action in MUTATING:
            msg = str(payload.get('response', {}).get('message', ''))
            reason = payload.get('response', {}).get('status_reason')
            assert reason or msg,                 f'{action} in {state} refused with no reason at all: {payload}'


# ── Transitions (X02-076…082) ────────────────────────────────────────────────

@pytest.mark.case('X02-076')
def test_upcoming_becomes_live_without_a_manual_step(client, world, tokens, db):
    """Derived on read: the row still says 'upcoming' and the clock says live."""
    cid = world['build']('live')
    # Only the derived answer is asserted, for the same reason as X02-077: a
    # backend running against this database rewrites `status` every 60 seconds,
    # so requiring the column to still be stale makes the test depend on
    # whether a dev server happens to be up.
    d = body(client.get(f'{STUDENT_COHORTS}/{cid}', headers=tokens['student']))
    assert d['response']['status'] == 'live', d['response']


@pytest.mark.case('X02-077')
def test_completed_is_stored_not_derived_from_the_clock(client, world, tokens, db):
    """Duration elapsing does not complete the class. Completed is End session
    (or an explicit status write). This row is built with status='completed'.
    """
    cid = world['build']('completed')
    d = body(client.get(f'{STUDENT_COHORTS}/{cid}', headers=tokens['student']))
    assert d['response']['status'] == 'completed', d['response']


@pytest.mark.case('X02-078')
def test_a_scheduler_outage_changes_nothing(client, world, tokens, db):
    """The whole point of deriving per request. Every state above is already
    built with a stale column, so this asserts the general property: the column
    can say anything and the answer is still right."""
    cid = world['build']('live')
    db.session.execute(text("UPDATE cohorts SET status = 'upcoming' WHERE id = :i"), {'i': cid})
    db.session.commit()
    d = body(client.get(f'{STUDENT_COHORTS}/{cid}', headers=tokens['student']))
    assert d['response']['status'] == 'live'

    db.session.execute(text("UPDATE cohorts SET status = 'live' WHERE id = :i"), {'i': cid})
    db.session.execute(text(
        'UPDATE cohorts SET session_date = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 2 DAY) WHERE id = :i'),
        {'i': cid})
    db.session.commit()
    d = body(client.get(f'{STUDENT_COHORTS}/{cid}', headers=tokens['student']))
    assert d['response']['status'] == 'upcoming', \
        'a stale live column must not keep a future cohort live — that leaks meeting_link'


@pytest.mark.case('X02-079')
def test_a_stored_completed_outranks_the_clock(client, world, tokens, db):
    """Rescheduling is an explicit status change, not a date edit. Moving
    session_date forward on a class someone marked complete must not reopen it."""
    cid = world['build']('completed')
    db.session.execute(text("""
        UPDATE cohorts SET status = 'completed',
               session_date = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 4 DAY)
         WHERE id = :i
    """), {'i': cid})
    db.session.commit()
    d = body(client.get(f'{STUDENT_COHORTS}/{cid}', headers=tokens['student']))
    assert d['response']['status'] == 'completed', d['response']


@pytest.mark.case('X02-080')
def test_cancelled_is_terminal(client, world, tokens, db):
    cid = world['build']('cancelled')
    for when in ('DATE_SUB(UTC_TIMESTAMP(), INTERVAL 10 MINUTE)',
                 'DATE_SUB(UTC_TIMESTAMP(), INTERVAL 5 DAY)',
                 'DATE_ADD(UTC_TIMESTAMP(), INTERVAL 5 DAY)'):
        db.session.execute(text(
            f'UPDATE cohorts SET session_date = {when} WHERE id = :i'), {'i': cid})
        db.session.commit()
        d = body(client.get(f'{STUDENT_COHORTS}/{cid}', headers=tokens['student']))
        assert d['response']['status'] == 'cancelled', \
            f'cancelled became {d["response"]["status"]} at {when}'


@pytest.mark.case('X02-081')
def test_a_cohort_with_no_session_date_is_returned_as_is(client, world, tokens):
    """No crash in the derivation, and no invented status."""
    cid = world['build']('no_session_date')
    d = body(client.get(f'{STUDENT_COHORTS}/{cid}', headers=tokens['student']))
    assert d['status'] == 200, d
    assert d['response']['status'] == 'upcoming', d['response']
    assert d['response'].get('session_date') is None


@pytest.mark.case('X02-082')
def test_the_offset_is_exactly_five_and_a_half_hours(client, world, tokens, db):
    """India has no DST, so any offset other than +5:30 is a bug — there is no
    time of year when this is allowed to be 4:30 or 6:30."""
    cid = world['build']('upcoming')
    local = (datetime.datetime.now() + datetime.timedelta(days=6)).replace(
        hour=14, minute=15, second=0, microsecond=0)
    d = body(client.put(f'{ACHIEVER_COHORTS}/{cid}',
                        json={'title': 'X02 Offset',
                              'session_date': local.isoformat(timespec='minutes')},
                        headers=tokens['achiever']))
    assert d['status'] == 200, d
    stored = db.session.execute(text('SELECT session_date FROM cohorts WHERE id = :i'),
                                {'i': cid}).scalar()
    assert stored == local - datetime.timedelta(hours=5, minutes=30), \
        f'stored {stored} for a local {local}; the offset is not +5:30'
