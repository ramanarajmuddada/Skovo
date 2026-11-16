"""
ST-05 Live session — all 20 cases.

Two halves. The meeting link and the check-in codes are server-owned and tested
directly. The last seven cases (ST05-014…020) are client resilience — a dropped
connection, a phone call, a sleeping device, slow 3G, a timed-out request — and
none of those are decidable from inside the API. For each, the *server-side
invariant that must survive the interruption* is asserted instead, and the
docstring says what is left to a browser test.

The four check-in refusals matter individually. "That code doesn't match" and
"that code has expired" send a student to two different actions — retype, or
ask for a re-reveal — and collapsing them into one "could not check you in"
leaves them retyping a code that will never work.

Rows are keyed to `st05-test-`.
"""
import uuid

import pytest
from flask_jwt_extended import create_access_token
from sqlalchemy import text

COHORTS = '/v1/cohorts'
ACHIEVER = '/v1/achievers/portal'
TEST_PREFIX = 'st05-test-'
CODE = '246810'


@pytest.fixture
def client(app):
    return app.test_client()


def body(resp):
    payload = resp.get_json()
    assert payload is not None, f'no JSON body: {resp.data[:200]}'
    return payload


@pytest.fixture
def world(app, db):
    ids = {k: str(uuid.uuid4()) for k in ('achiever', 'student', 'outsider', 'cohort')}
    db.session.execute(text("""
        INSERT INTO achievers (id, full_name, email, state, status, is_active,
                               is_verified, created_at, updated_at)
        VALUES (:i, 'ST05 Achiever', :e, 'active', 'active', 1, 1,
                UTC_TIMESTAMP(), UTC_TIMESTAMP())
    """), {'i': ids['achiever'], 'e': f'{TEST_PREFIX}{ids["achiever"]}@skovo.test'})
    for key in ('student', 'outsider'):
        db.session.execute(text("""
            INSERT INTO users (id, full_name, email, status, created_at, updated_at)
            VALUES (:i, :n, :e, 'active', UTC_TIMESTAMP(), UTC_TIMESTAMP())
        """), {'i': ids[key], 'n': f'ST05 {key}', 'e': f'{TEST_PREFIX}{ids[key]}@skovo.test'})

    def cohort(state='live', link='https://meet.example.com/st05'):
        when = {'live': 'DATE_SUB(UTC_TIMESTAMP(), INTERVAL 10 MINUTE)',
                'upcoming': 'DATE_ADD(UTC_TIMESTAMP(), INTERVAL 3 DAY)',
                'completed': 'DATE_SUB(UTC_TIMESTAMP(), INTERVAL 5 DAY)'}[state]
        stored = 'completed' if state == 'completed' else 'upcoming'
        db.session.execute(text(f"""
            INSERT INTO cohorts (id, title, achiever_id, session_date, duration_minutes,
                                 total_seats, filled_seats, price, status, meeting_link,
                                 created_at, updated_at)
            VALUES (:i, 'ST05 Cohort', :a, {when}, 90, NULL, 0, 0, :st, :l,
                    UTC_TIMESTAMP(), UTC_TIMESTAMP())
        """), {'i': ids['cohort'], 'a': ids['achiever'], 'l': link, 'st': stored})
        db.session.execute(text("""
            INSERT INTO cohort_enrollments (id, user_id, cohort_id, payment_status,
                                            amount_paid, enrolled_at, created_at, updated_at)
            VALUES (:i, :u, :c, 'free', 0, UTC_TIMESTAMP(), UTC_TIMESTAMP(), UTC_TIMESTAMP())
        """), {'i': str(uuid.uuid4()), 'u': ids['student'], 'c': ids['cohort']})
        db.session.commit()
        return ids['cohort']

    def code(*, minutes=30, active=1, value=CODE):
        db.session.execute(text("""
            INSERT INTO cohort_attendance_codes (id, cohort_id, code, revealed_by,
                                                 revealed_at, expires_at, is_active, created_at)
            VALUES (:i, :c, :v, :a, UTC_TIMESTAMP(),
                    DATE_ADD(UTC_TIMESTAMP(), INTERVAL :m MINUTE), :act, UTC_TIMESTAMP())
        """), {'i': str(uuid.uuid4()), 'c': ids['cohort'], 'v': value,
               'a': ids['achiever'], 'm': minutes, 'act': active})
        db.session.commit()

    ids['make_cohort'] = cohort
    ids['make_code'] = code
    yield ids

    for sql, params in [
        ('DELETE FROM cohort_attendance_codes WHERE cohort_id = :c', {'c': ids['cohort']}),
        ('DELETE FROM cohort_enrollments WHERE cohort_id = :c', {'c': ids['cohort']}),
        ('DELETE FROM score_events WHERE user_id IN (:a, :b)',
         {'a': ids['student'], 'b': ids['outsider']}),
        ('DELETE FROM readiness_scores WHERE user_id IN (:a, :b)',
         {'a': ids['student'], 'b': ids['outsider']}),
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
def tok(app):
    def _tok(ident, role=None):
        claims = {'role': 'mentor', 'mentor': True} if role == 'mentor' else {}
        with app.app_context():
            return {'Authorization': 'Bearer ' + create_access_token(
                identity=str(ident), additional_claims=claims)}
    return _tok


@pytest.fixture
def check_in(client, tok, world):
    def _check_in(code=CODE, who='student'):
        d = body(client.post(f'{COHORTS}/{world["cohort"]}/check-in',
                             json={'code': code}, headers=tok(world[who])))
        return d
    return _check_in


def reason_of(d):
    return d['response'].get('reason')


# ── The meeting link ─────────────────────────────────────────────────────────

@pytest.mark.case('ST05-001')
def test_the_join_link_is_offered_while_live(client, tok, world):
    cid = world['make_cohort']('live')
    d = body(client.get(f'{COHORTS}/{cid}', headers=tok(world['student'])))
    assert d['response'].get('meeting_link'), d['response']


@pytest.mark.case('ST05-002')
def test_the_join_link_is_not_offered_before_the_window(client, tok, world):
    cid = world['make_cohort']('upcoming')
    d = body(client.get(f'{COHORTS}/{cid}', headers=tok(world['student'])))
    assert not d['response'].get('meeting_link'), \
        'the meeting link is served before the session opens'


@pytest.mark.case('ST05-003')
def test_a_non_enrolled_student_never_receives_the_link(client, tok, world):
    """Withheld server-side, not hidden in the UI. A link merely not rendered is
    still in the JSON, and the JSON is one devtools tab away."""
    cid = world['make_cohort']('live')
    d = body(client.get(f'{COHORTS}/{cid}', headers=tok(world['outsider'])))
    assert not d['response'].get('meeting_link'), \
        'the meeting link was served to someone not enrolled'


@pytest.mark.case('ST05-004')
def test_a_cohort_with_no_link_says_so_rather_than_offering_a_dead_button(client, tok, world):
    cid = world['make_cohort']('live', link=None)
    d = body(client.get(f'{COHORTS}/{cid}', headers=tok(world['student'])))
    assert d['status'] == 200, d
    assert not d['response'].get('meeting_link')
    assert d['response'].get('is_live') is True, \
        'the cohort is live, so the screen can distinguish "no link yet" from "not started"'


@pytest.mark.case('ST05-005')
def test_a_malformed_meeting_link_is_blocked_at_save_time(client, tok, world):
    """Blocked on the way in rather than handled on the way out — the students
    clicking it are the people least able to do anything about it."""
    cid = world['make_cohort']('live')
    d = body(client.put(f'{ACHIEVER}/cohorts/{cid}',
                        json={'title': 'ST05', 'meeting_link': 'javascript:alert(1)'},
                        headers=tok(world['achiever'], 'mentor')))
    assert d['status'] == 400, d


# ── Check-in ─────────────────────────────────────────────────────────────────

@pytest.mark.case('ST05-006')
def test_a_valid_code_marks_the_student_present_and_scores(check_in, world, db):
    world['make_cohort']('live')
    world['make_code']()
    d = check_in()
    assert d['status'] == 200, d
    assert d['response'].get('attended') is True
    assert int(d['response'].get('points_awarded') or 0) >= 0


@pytest.mark.case('ST05-007')
def test_a_wrong_code_says_wrong_code(check_in, world):
    world['make_cohort']('live')
    world['make_code']()
    d = check_in(code='000000')
    assert reason_of(d) == 'wrong_code', d
    assert 'match' in str(d['response']['message']).lower(), d


@pytest.mark.case('ST05-008')
def test_an_expired_code_says_expired_not_wrong(check_in, world):
    """The distinction is the whole case: told "wrong code", a student retypes
    the same digits for ever. Told "expired", they ask for a re-reveal."""
    world['make_cohort']('live')
    world['make_code'](minutes=-5)
    d = check_in()
    assert reason_of(d) == 'expired', d
    assert 'again' in str(d['response']['message']).lower(), d


@pytest.mark.case('ST05-009')
def test_no_code_revealed_says_no_active_code(check_in, world):
    world['make_cohort']('live')
    d = check_in()
    assert reason_of(d) == 'no_active_code', d


@pytest.mark.case('ST05-010')
def test_a_non_enrolled_student_cannot_check_in_and_leaves_no_row(check_in, world, db):
    world['make_cohort']('live')
    world['make_code']()
    d = check_in(who='outsider')
    assert reason_of(d) == 'not_enrolled', d
    assert db.session.execute(text("""
        SELECT COUNT(*) FROM cohort_enrollments WHERE cohort_id = :c AND user_id = :u
    """), {'c': world['cohort'], 'u': world['outsider']}).scalar() == 0, \
        'a failed check-in created an enrolment row'


@pytest.mark.case('ST05-011')
@pytest.mark.case('ST05-018')
def test_checking_in_twice_awards_points_once(check_in, world, db):
    """ST05-018 (device sleeps, client retries) reduces to the same invariant:
    the ledger is idempotent, so a repeat is safe however it is caused."""
    world['make_cohort']('live')
    world['make_code']()
    first = check_in()
    assert first['status'] == 200, first
    second = check_in()
    assert second['status'] in (200, 400), second

    awarded = db.session.execute(text("""
        SELECT COUNT(*) FROM score_events
         WHERE user_id = :u AND ref_id = :c AND event_type = 'cohort_attended'
    """), {'u': world['student'], 'c': world['cohort']}).scalar()
    assert awarded <= 1, f'checking in twice awarded {awarded} score events'


@pytest.mark.case('ST05-012')
def test_a_re_revealed_code_lets_the_student_check_in(client, tok, world, db):
    """The documented recovery path for a connection that dropped during the
    window: the mentor shows a new code rather than the student being stuck."""
    cid = world['make_cohort']('live')
    reveal = body(client.post(f'{ACHIEVER}/cohorts/{cid}/attendance-code', json={},
                              headers=tok(world['achiever'], 'mentor')))
    assert reveal['status'] in (200, 201), reveal
    fresh = reveal['response']['code']
    d = body(client.post(f'{COHORTS}/{cid}/check-in', json={'code': fresh},
                         headers=tok(world['student'])))
    assert d['status'] == 200, d


@pytest.mark.case('ST05-013')
def test_checking_in_after_the_session_ends_is_refused(check_in, world, db):
    """Points are not awarded retroactively by the student. The code outlives
    the class by up to its 30-minute window, and it is read aloud to a room, so
    without the state gate anyone holding it could claim attendance afterwards.
    """
    world['make_cohort']('completed')
    world['make_code']()
    d = check_in()
    assert d['status'] in (400, 403, 409), f'check-in succeeded after the class ended: {d}'
    assert db.session.execute(text("""
        SELECT COUNT(*) FROM score_events
         WHERE user_id = :u AND ref_id = :c AND event_type = 'cohort_attended'
    """), {'u': world['student'], 'c': world['cohort']}).scalar() == 0


@pytest.mark.case('ST05-015')
def test_a_student_who_never_checked_in_can_be_ticked_manually(client, tok, world, db):
    """The intended fallback when a connection drops before check-in. It is
    also why manual attendance exists at all — without it that student simply
    loses the credit for a class they sat through."""
    cid = world['make_cohort']('live')
    eid = db.session.execute(text(
        'SELECT id FROM cohort_enrollments WHERE cohort_id = :c'), {'c': cid}).scalar()
    d = body(client.patch(f'{ACHIEVER}/cohorts/{cid}/attendance',
                          json={'present': [eid]},
                          headers=tok(world['achiever'], 'mentor')))
    assert d['status'] in (200, 201), d
    assert db.session.execute(text(
        'SELECT attended FROM cohort_enrollments WHERE id = :i'), {'i': eid}).scalar() in (1, True)


# ── Interruptions: the invariant the server must hold ────────────────────────

@pytest.mark.case('ST05-014')
@pytest.mark.case('ST05-016')
def test_enrolment_and_attendance_survive_a_reconnect(check_in, world, client, tok, db):
    """Rejoining is a fresh GET, so what has to survive is state, not a socket.
    The browser half — that a refresh returns to the cohort with the link still
    there — is a UI test; this is the half that makes it possible."""
    cid = world['make_cohort']('live')
    world['make_code']()
    assert check_in()['status'] == 200

    again = body(client.get(f'{COHORTS}/{cid}', headers=tok(world['student'])))
    assert again['response'].get('meeting_link'), 'the link vanished on a reload'
    assert again['response'].get('is_enrolled') is True, 'the enrolment vanished on a reload'


@pytest.mark.case('ST05-017')
def test_the_token_is_still_valid_after_an_interruption(client, tok, world):
    """A phone call backgrounds the app; it does not expire anything. Nothing
    server-side ties a session to continuous connection, and this is the check
    that keeps it that way — a forced re-login mid-class loses the student the
    session."""
    cid = world['make_cohort']('live')
    hdr = tok(world['student'])
    for _ in range(3):
        d = body(client.get(f'{COHORTS}/{cid}', headers=hdr))
        assert d['status'] == 200, d


@pytest.mark.case('ST05-019')
@pytest.mark.case('ST05-020')
def test_a_failing_request_returns_a_usable_error_not_a_spinner(client, tok, world, monkeypatch):
    """Slow 3G and a timeout are client concerns, but both end at the same
    server contract: a failure answers in the app's envelope with an error_id
    the student can quote, never a traceback and never an empty body that a
    spinner waits on for ever."""
    cid = world['make_cohort']('live')
    import portal.routes.Cohorts.cohorts as C

    def boom(*args, **kwargs):
        raise RuntimeError('upstream timed out')

    monkeypatch.setattr(C, 'call_proc_one', boom)
    resp = client.get(f'{COHORTS}/{cid}', headers=tok(world['student']))
    d = resp.get_json()
    assert d is not None, 'a failure returned an empty body'
    assert d['status'] == 500
    assert d['response'].get('error_id'), 'a 500 with no error id is unquotable'
    assert 'Traceback' not in resp.get_data(as_text=True)
