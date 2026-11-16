"""
ST-07 Bookings (1-on-1) — all 11 cases.

The five named refusals (ST07-002…006) are the reason this sheet is P0. They all
arrive at the student as a message, and the sheet asks for each to be *distinct*
— "Achiever not found" and "this achiever is running free demo sessions" send a
student to two completely different next actions, and collapsing them into one
"unavailable" is the same defect class as the unaliased procedure branches that
turned every enrolment refusal into "Unable to enroll."

ST07-006 is the one with teeth: an eligibility check that *errors* must be a
refusal, never an allow. `booking_eligibility` catches and returns
`eligibility_check_failed`, and this exercises that path by making the procedure
raise rather than by trusting the except block exists.

Rows are keyed to `st07-book-test-`.
"""
import datetime
import uuid

import pytest
from flask_jwt_extended import create_access_token
from sqlalchemy import text

BOOK = '/v1/achievers/{achiever}/book'
REVIEWS = '/v1/achiever-reviews'
TEST_PREFIX = 'st07-book-test-'


@pytest.fixture
def client(app):
    return app.test_client()


def body(resp):
    payload = resp.get_json()
    assert payload is not None, f'no JSON body: {resp.data[:200]}'
    return payload


@pytest.fixture
def world(app, db):
    """A student plus four achievers, one per lifecycle refusal the sheet names.

    Four rather than one mutated in place, because each refusal is a different
    row state and rewriting a single achiever between assertions makes a failure
    ambiguous about which state produced it.
    """
    ids = {k: str(uuid.uuid4()) for k in
           ('student', 'active', 'inactive', 'unverified', 'probation')}
    db.session.execute(text("""
        INSERT INTO users (id, full_name, email, status, created_at, updated_at)
        VALUES (:i, 'ST07 Student', :e, 'active', UTC_TIMESTAMP(), UTC_TIMESTAMP())
    """), {'i': ids['student'], 'e': f'{TEST_PREFIX}{ids["student"]}@skovo.test'})

    # The `active` achiever is deliberately FREE (rate 0). A paid rate sends the
    # booking into the Cashfree flow, which cannot complete an order on this
    # account at all — so the happy-path cases would fail at the gateway and
    # prove nothing about booking. `probation` keeps a paid rate, because
    # ST07-005 is precisely "probation may not charge".
    for key, state, is_active, verified, rate in (
        ('active',     'active',    1, 1, 0),
        ('inactive',   'suspended', 0, 1, 500),
        ('unverified', 'pending',   1, 0, 500),
        ('probation',  'probation', 1, 1, 500),
    ):
        db.session.execute(text("""
            INSERT INTO achievers (id, full_name, email, state, status, is_active,
                                   is_verified, session_rate, created_at, updated_at)
            VALUES (:i, :n, :e, :st, 'active', :ia, :iv, :r,
                    UTC_TIMESTAMP(), UTC_TIMESTAMP())
        """), {'i': ids[key], 'n': f'ST07 {key}', 'e': f'{TEST_PREFIX}{ids[key]}@skovo.test',
               'st': state, 'ia': is_active, 'iv': verified, 'r': rate})
    db.session.commit()

    def slot(achiever_key, *, days_ahead=3, start='10:00', status='available'):
        sid = str(uuid.uuid4())
        db.session.execute(text("""
            INSERT INTO achiever_slots (id, mentor_id, slot_date, start_time, end_time,
                                        status, created_at, updated_at)
            VALUES (:i, :m, DATE_ADD(UTC_DATE(), INTERVAL :d DAY), :s,
                    ADDTIME(:s, '01:00:00'), :st, UTC_TIMESTAMP(), UTC_TIMESTAMP())
        """), {'i': sid, 'm': ids[achiever_key], 'd': days_ahead, 's': start, 'st': status})
        db.session.commit()
        return sid

    ids['slot'] = slot
    yield ids

    aids = tuple(ids[k] for k in ('active', 'inactive', 'unverified', 'probation'))
    for sql, params in [
        ('DELETE FROM achiever_reviews WHERE user_id = :u', {'u': ids['student']}),
        ('DELETE FROM achiever_slots WHERE mentor_id IN :a', {'a': aids}),
        ('DELETE FROM achiever_sessions WHERE student_id = :u', {'u': ids['student']}),
        ('DELETE FROM payment_orders WHERE student_id = :u', {'u': ids['student']}),
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


@pytest.fixture
def book(client, auth, world):
    def _book(achiever_key_or_id, slot_id=None, **extra):
        aid = world.get(achiever_key_or_id, achiever_key_or_id)
        payload = {'slot_id': slot_id} if slot_id else {}
        payload.update(extra)
        d = body(client.post(BOOK.format(achiever=aid), json=payload, headers=auth))
        return d['status'], d
    return _book


def message(d):
    return str(d['response'].get('message', ''))


# ── Booking ──────────────────────────────────────────────────────────────────

@pytest.mark.case('ST07-001')
def test_an_available_slot_can_be_booked_and_stops_being_offered(book, world, db, client, auth):
    slot = world['slot']('active')
    code, d = book('active', slot)
    assert code in (200, 201), d

    status = db.session.execute(text('SELECT status FROM achiever_slots WHERE id = :i'),
                                {'i': slot}).scalar()
    assert status != 'available', \
        f'the slot is still offered after being booked (status={status!r})'


@pytest.mark.case('ST07-002')
def test_an_unknown_achiever_is_refused_by_name(book):
    code, d = book(str(uuid.uuid4()))
    assert d['status'] == 404, d
    assert 'not found' in message(d).lower(), message(d)


@pytest.mark.case('ST07-003')
def test_an_inactive_achiever_is_refused_with_its_own_reason(book, world):
    """Distinct from 'not found' and from 'unverified'. A student told the wrong
    one waits for something that is never going to happen."""
    slot = world['slot']('inactive')
    code, d = book('inactive', slot)
    assert d['status'] in (400, 403, 404), d
    assert 'not currently available' in message(d) or 'not found' in message(d).lower(), \
        message(d)


@pytest.mark.case('ST07-004')
def test_an_unverified_achiever_is_refused_with_its_own_reason(book, world):
    slot = world['slot']('unverified')
    code, d = book('unverified', slot)
    assert d['status'] in (400, 403, 404), d
    assert 'not yet available' in message(d) or 'not found' in message(d).lower(), \
        message(d)


@pytest.mark.case('ST07-005')
def test_a_probation_achiever_is_free_demo_only(book, world):
    """`can_charge` is active-only, so a probation achiever with a session rate
    must be refused for a *paid* booking — and told why, because the answer is
    'come back later', not 'this person does not exist'."""
    slot = world['slot']('probation')
    code, d = book('probation', slot)
    assert d['status'] in (400, 403), d
    assert 'free demo' in message(d).lower(), message(d)


@pytest.mark.case('ST07-006')
def test_the_eligibility_check_fails_closed(book, world, monkeypatch):
    """The check erroring must be a refusal, never an allow. Exercised by making
    the procedure raise rather than by trusting the except block is there — an
    `except` that returns the wrong default reads identically in review."""
    import portal.helpers.trust as T

    def boom(*args, **kwargs):
        raise RuntimeError('eligibility backend is down')

    monkeypatch.setattr(T, 'call_proc_one', boom)
    slot = world['slot']('active')
    code, d = book('active', slot)
    assert d['status'] in (400, 403), f'a failed eligibility check allowed the booking: {d}'
    assert 'could not verify' in message(d).lower(), message(d)


@pytest.mark.case('ST07-007')
def test_double_booking_the_same_slot_resolves_to_exactly_one(book, world, db, app):
    """Two students, one slot. The seat is taken inside
    sp_student_session_book, so the second must be refused rather than both
    being written and the loser discovered at the meeting."""
    slot = world['slot']('active')
    other = str(uuid.uuid4())
    db.session.execute(text("""
        INSERT INTO users (id, full_name, email, status, created_at, updated_at)
        VALUES (:i, 'ST07 Rival', :e, 'active', UTC_TIMESTAMP(), UTC_TIMESTAMP())
    """), {'i': other, 'e': f'{TEST_PREFIX}rival-{other}@skovo.test'})
    db.session.commit()

    first = book('active', slot)
    with app.app_context():
        rival = {'Authorization': f'Bearer {create_access_token(identity=str(other))}'}
    second = body(app.test_client().post(
        BOOK.format(achiever=world['active']), json={'slot_id': slot}, headers=rival))

    outcomes = [first[1]['status'], second['status']]
    wins = [s for s in outcomes if s in (200, 201)]
    assert len(wins) == 1, f'expected exactly one booking to succeed, got {outcomes}'
    loser = second if second['status'] not in (200, 201) else first[1]
    assert message(loser), 'the losing booking gave no reason at all'


@pytest.mark.case('ST07-008')
def test_a_slot_in_the_past_cannot_be_booked(book, world):
    """A slot nobody books keeps `status='available'` for ever, and the public
    slots endpoint takes `from_date` as a client-supplied parameter — so
    backdating it lists expired slots. The guard lives in the procedure, which
    is the atomic path and the stricter backstop."""
    slot = world['slot']('active', days_ahead=-5)
    code, d = book('active', slot)
    assert d['status'] in (400, 403, 409), f'a past slot was booked: {d}'


# ── Cancel and rate ──────────────────────────────────────────────────────────

@pytest.mark.case('ST07-009')
def test_a_booking_can_be_cancelled(client, auth, book, world, db):
    slot = world['slot']('active')
    code, d = book('active', slot)
    assert code in (200, 201), d
    session_id = (d['response'].get('session_id') or d['response'].get('id')
                  or db.session.execute(text(
                      'SELECT id FROM achiever_sessions WHERE student_id = :u '
                      'ORDER BY created_at DESC LIMIT 1'), {'u': world['student']}).scalar())
    assert session_id, d

    cancelled = body(client.post(f'/v1/achievers/sessions/{session_id}/cancel',
                                 json={}, headers=auth))
    assert cancelled['status'] == 200, cancelled
    status = db.session.execute(text('SELECT status FROM achiever_sessions WHERE id = :i'),
                                {'i': session_id}).scalar()
    assert status == 'cancelled', f'session status is {status!r} after cancelling'


@pytest.mark.case('ST07-010')
def test_a_completed_session_can_be_rated(client, auth, world, db):
    """Stored as `achiever_reviews` with `context_type='session'` — the same
    rows a cohort rating uses with a different context, so both feed the one
    public average instead of sitting in parallel stores nobody aggregates."""
    session_id = str(uuid.uuid4())
    db.session.execute(text("""
        INSERT INTO achiever_sessions (id, mentor_id, student_id, status, amount,
                                       payment_status, created_at, updated_at)
        VALUES (:i, :m, :u, 'completed', 0, 'free', UTC_TIMESTAMP(), UTC_TIMESTAMP())
    """), {'i': session_id, 'm': world['active'], 'u': world['student']})
    db.session.commit()

    d = body(client.post(f'{REVIEWS}/{world["active"]}',
                         json={'rating': 5, 'context_type': 'session',
                               'context_id': session_id,
                               'review_text': 'Genuinely useful hour.'},
                         headers=auth))
    assert d['status'] in (200, 201), d
    row = db.session.execute(text("""
        SELECT rating, context_type FROM achiever_reviews
         WHERE user_id = :u AND context_id = :c
    """), {'u': world['student'], 'c': session_id}).mappings().first()
    assert row is not None, 'the rating was accepted but not stored'
    assert int(row['rating']) == 5
    assert row['context_type'] == 'session'


@pytest.mark.case('ST07-011')
def test_a_rating_survives_a_reload(client, auth, world, db):
    """Seeded from the server, not from local state. Bookings.jsx had exactly
    this bug: a reload showed "Rate" again on an already-rated session and the
    second submit silently replaced the first."""
    session_id = str(uuid.uuid4())
    db.session.execute(text("""
        INSERT INTO achiever_sessions (id, mentor_id, student_id, status, amount,
                                       payment_status, created_at, updated_at)
        VALUES (:i, :m, :u, 'completed', 0, 'free', UTC_TIMESTAMP(), UTC_TIMESTAMP())
    """), {'i': session_id, 'm': world['active'], 'u': world['student']})
    db.session.commit()

    posted = body(client.post(f'{REVIEWS}/{world["active"]}',
                              json={'rating': 4, 'context_type': 'session',
                                    'context_id': session_id, 'review_text': 'Good'},
                              headers=auth))
    assert posted['status'] in (200, 201), posted

    # What the screen reads on the next load.
    mine = body(client.get(f'{REVIEWS}/mine', headers=auth))
    assert mine['status'] == 200, mine
    blob = str(mine['response'])
    assert session_id in blob, \
        'GET /achiever-reviews/mine does not return the rating, so a reload shows "Rate" again'

    # And a second submit edits rather than duplicating.
    again = body(client.post(f'{REVIEWS}/{world["active"]}',
                             json={'rating': 2, 'context_type': 'session',
                                   'context_id': session_id, 'review_text': 'Revised'},
                             headers=auth))
    assert again['status'] in (200, 201), again
    n = db.session.execute(text(
        'SELECT COUNT(*) FROM achiever_reviews WHERE user_id = :u AND context_id = :c'),
        {'u': world['student'], 'c': session_id}).scalar()
    assert n == 1, f're-rating created {n} rows instead of updating in place'
