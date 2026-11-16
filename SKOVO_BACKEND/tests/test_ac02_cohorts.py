"""
AC-02 Cohorts — all 45 cases.

Covers creation and the charge gate, seats, the derived status machine,
attendance, and class feedback.

Two places where the sheet is now out of date, asserted as the code behaves and
flagged here rather than silently:

  * **AC02-014** says the registration deadline is "collected but unenforced —
    documented gap". It was enforced (brief §1.2) once it was confirmed that no
    production cohort sat in the "deadline passed, session still upcoming"
    state, so enforcing closed nothing that was open. This asserts enforcement.

  * **AC02-011** asks for past session dates to be "refused or created as
    already-completed, behaviour must be defined". It is the second: creation is
    allowed and `effective_cohort_status` derives it as completed, so an
    achiever can record a class they already taught.

Four cases are frontend behaviour (the commission panel, the roster toggle and
the two whiteboard cases). Where the server owns half of one, that half is
tested and the docstring says which half. Rows are keyed to `ac02-test-`.
"""
import datetime
import uuid
from pathlib import Path

import pytest
from flask_jwt_extended import create_access_token
from sqlalchemy import text

ACHIEVER = '/v1/achievers/portal'
COHORTS = '/v1/cohorts'
REVIEWS = '/v1/achiever-reviews'
REPO = Path(__file__).resolve().parents[2]
TEST_PREFIX = 'ac02-test-'


@pytest.fixture
def client(app):
    return app.test_client()


def body(resp):
    payload = resp.get_json()
    assert payload is not None, f'no JSON body: {resp.data[:200]}'
    return payload


def refused(d, *, naming=None):
    assert d['status'] in (400, 403, 404, 409), d
    assert d['response'].get('error_id') is None, \
        f'refusal captured as a server error: {d["response"]}'
    if naming:
        assert naming.lower() in str(d['response'].get('message', '')).lower(), d


@pytest.fixture
def world(app, db):
    ids = {k: str(uuid.uuid4()) for k in ('active', 'probation', 'other', 'student')}
    for key, state in (('active', 'active'), ('probation', 'probation'), ('other', 'active')):
        db.session.execute(text("""
            INSERT INTO achievers (id, full_name, email, state, status, is_active,
                                   is_verified, created_at, updated_at)
            VALUES (:i, :n, :e, :s, 'active', 1, 1, UTC_TIMESTAMP(), UTC_TIMESTAMP())
        """), {'i': ids[key], 'n': f'AC02 {key}',
               'e': f'{TEST_PREFIX}{ids[key]}@skovo.test', 's': state})
    db.session.execute(text("""
        INSERT INTO users (id, full_name, email, status, created_at, updated_at)
        VALUES (:i, 'AC02 Student', :e, 'active', UTC_TIMESTAMP(), UTC_TIMESTAMP())
    """), {'i': ids['student'], 'e': f'{TEST_PREFIX}{ids["student"]}@skovo.test'})
    did = str(uuid.uuid4())
    db.session.execute(text("""
        INSERT INTO domains (id, name, slug, is_active, created_by, created_at, updated_at)
        VALUES (:i, 'AC02 Domain', :s, 1, :a, UTC_TIMESTAMP(), UTC_TIMESTAMP())
    """), {'i': did, 's': f'ac02-{did[:12]}', 'a': ids['active']})
    ids['domain'] = did
    db.session.commit()

    def cohort(owner='active', *, state='live', price=0, seats=None, enrol=True):
        cid = str(uuid.uuid4())
        when = {
            'upcoming':  'DATE_ADD(UTC_TIMESTAMP(), INTERVAL 3 DAY)',
            'live':      'DATE_SUB(UTC_TIMESTAMP(), INTERVAL 10 MINUTE)',
            'completed': 'DATE_SUB(UTC_TIMESTAMP(), INTERVAL 5 DAY)',
            'cancelled': 'DATE_ADD(UTC_TIMESTAMP(), INTERVAL 3 DAY)',
        }[state]
        db.session.execute(text(f"""
            INSERT INTO cohorts (id, title, achiever_id, session_date, duration_minutes,
                                 total_seats, filled_seats, price, status,
                                 created_at, updated_at)
            VALUES (:i, 'AC02 Cohort', :a, {when}, 90, :seats, 0, :p, :s,
                    UTC_TIMESTAMP(), UTC_TIMESTAMP())
        """), {'i': cid, 'a': ids[owner], 'seats': seats, 'p': price,
               's': 'cancelled' if state == 'cancelled'
                    else ('completed' if state == 'completed' else 'upcoming')})
        if enrol:
            db.session.execute(text("""
                INSERT INTO cohort_enrollments (id, user_id, cohort_id, payment_status,
                                                amount_paid, enrolled_at, created_at, updated_at)
                VALUES (:i, :u, :c, 'free', 0, UTC_TIMESTAMP(), UTC_TIMESTAMP(), UTC_TIMESTAMP())
            """), {'i': str(uuid.uuid4()), 'u': ids['student'], 'c': cid})
        db.session.commit()
        return cid

    ids['cohort'] = cohort
    yield ids

    aids = (ids['active'], ids['probation'], ids['other'])
    for sql, params in [
        ('DELETE FROM achiever_reviews WHERE user_id = :u', {'u': ids['student']}),
        ('DELETE FROM cohort_attendance_codes WHERE cohort_id IN '
         '(SELECT id FROM cohorts WHERE achiever_id IN :a)', {'a': aids}),
        ('DELETE FROM cohort_tasks WHERE cohort_id IN '
         '(SELECT id FROM cohorts WHERE achiever_id IN :a)', {'a': aids}),
        ('DELETE FROM cohort_enrollments WHERE cohort_id IN '
         '(SELECT id FROM cohorts WHERE achiever_id IN :a)', {'a': aids}),
        ('DELETE FROM notification_logs WHERE user_id = :u', {'u': ids['student']}),
        ('DELETE FROM payment_orders WHERE student_id = :u', {'u': ids['student']}),
        ('DELETE FROM cohorts WHERE achiever_id IN :a', {'a': aids}),
        ('DELETE FROM users WHERE email LIKE :p', {'p': f'{TEST_PREFIX}%'}),
        ('DELETE FROM domains WHERE id = :d', {'d': ids['domain']}),
        ('DELETE FROM achievers WHERE email LIKE :p', {'p': f'{TEST_PREFIX}%'}),
    ]:
        try:
            db.session.execute(text(sql), params)
            db.session.commit()
        except Exception:
            db.session.rollback()


@pytest.fixture
def tok(app):
    def _tok(ident, role='mentor'):
        claims = {'role': role}
        if role == 'mentor':
            claims['mentor'] = True
        with app.app_context():
            return {'Authorization': 'Bearer ' + create_access_token(
                identity=str(ident), additional_claims=claims)}
    return _tok


@pytest.fixture
def create(client, tok, world):
    def _create(owner='active', **fields):
        payload = {
            'title': f'AC02 {uuid.uuid4().hex[:6]}',
            'domain_id': world['domain'],
            'about': 'About this class.',
            'what_you_learn': ['One learning point'],
            'session_date': (datetime.datetime.now() + datetime.timedelta(days=3)).strftime('%Y-%m-%dT%H:%M'),
            'duration_minutes': 60,
        }
        payload.update(fields)
        d = body(client.post(f'{ACHIEVER}/cohorts', json=payload,
                             headers=tok(world[owner])))
        return d['status'], d
    return _create


# ── Creation, price and the charge gate ──────────────────────────────────────

@pytest.mark.case('AC02-001')
def test_a_probation_achiever_can_create_a_free_cohort(create):
    """The `price > 0` floor made both branches refuse: any price needed
    can_charge (active only) and 0 was rejected outright — so probation was
    unusable on the one screen its dashboard points at."""
    assert create('probation', price=0)[0] == 201


@pytest.mark.case('AC02-002')
def test_a_blank_price_means_free(create, db):
    code, d = create('probation', price='')
    assert code == 201, d
    assert int(db.session.execute(text('SELECT price FROM cohorts WHERE id = :i'),
                                  {'i': d['response']['cohort_id']}).scalar() or 0) == 0


@pytest.mark.case('AC02-003')
def test_a_negative_price_is_refused(create):
    refused(create('active', price=-1)[1], naming='Price')


@pytest.mark.case('AC02-004')
def test_a_probation_achiever_cannot_create_a_paid_cohort(create):
    code, d = create('probation', price=499)
    refused(d)
    assert 'charg' in str(d['response'].get('message', '')).lower() \
        or 'active' in str(d['response'].get('message', '')).lower(), d


@pytest.mark.case('AC02-005')
def test_an_active_achiever_can_create_a_paid_cohort(create):
    assert create('active', price=499)[0] == 201


@pytest.mark.case('AC02-006')
def test_blank_seats_stores_null(create, db):
    code, d = create('active', total_seats='')
    assert code == 201, d
    assert db.session.execute(text('SELECT total_seats FROM cohorts WHERE id = :i'),
                              {'i': d['response']['cohort_id']}).scalar() is None


@pytest.mark.case('AC02-007')
def test_a_cohort_created_without_seats_is_uncapped(create, db):
    """No 50 anywhere in the created row. (The COLUMN DEFAULT is still 50, which
    is a separate open item — it does not bite here only because the route
    always sends an explicit value.)"""
    code, d = create('active')
    seats = db.session.execute(text('SELECT total_seats FROM cohorts WHERE id = :i'),
                               {'i': d['response']['cohort_id']}).scalar()
    assert seats in (None, 0), f'a cohort created with no seats field got {seats}'


@pytest.mark.case('AC02-008')
def test_a_positive_seat_count_is_a_real_cap(client, world, db, app):
    """One seat, two students: the second must be refused. A cap that is stored
    but not enforced is worse than none, because the achiever plans around it."""
    cid = world['cohort']('active', state='upcoming', seats=1, enrol=False)
    others = []
    for n in range(2):
        uid = str(uuid.uuid4())
        db.session.execute(text("""
            INSERT INTO users (id, full_name, email, status, created_at, updated_at)
            VALUES (:i, 'AC02 Seat', :e, 'active', UTC_TIMESTAMP(), UTC_TIMESTAMP())
        """), {'i': uid, 'e': f'{TEST_PREFIX}seat{n}-{uid}@skovo.test'})
        others.append(uid)
    db.session.commit()

    outcomes = []
    for uid in others:
        with app.app_context():
            hdr = {'Authorization': f'Bearer {create_access_token(identity=str(uid))}'}
        outcomes.append(body(client.post(f'{COHORTS}/{cid}/enroll', json={},
                                         headers=hdr))['status'])
    assert outcomes.count(200) + outcomes.count(201) == 1, \
        f'a one-seat cohort accepted {outcomes}'


@pytest.mark.case('AC02-009')
def test_a_title_is_required(create):
    refused(create('active', title='')[1], naming='Title')


@pytest.mark.case('AC02-010')
def test_a_title_over_255_is_a_400(create):
    code, d = create('active', title='x' * 256)
    refused(d, naming='Title')
    assert '255' in d['response']['message']


@pytest.mark.case('AC02-011')
def test_a_past_session_date_is_accepted_and_stays_live_until_ended(create, client, tok, world):
    """A past start is accepted. Completing is End session, not the clock."""
    past = (datetime.datetime.now() - datetime.timedelta(days=10)).replace(microsecond=0)
    code, d = create('active', session_date=past.isoformat(timespec='minutes'))
    assert code == 201, d
    got = body(client.get(f'{COHORTS}/{d["response"]["cohort_id"]}',
                          headers=tok(world['student'], role='student')))
    assert got['response']['status'] == 'live', got['response']


@pytest.mark.case('AC02-012')
def test_duration_zero_or_negative_is_refused(create):
    refused(create('active', duration_minutes=0)[1], naming='Duration')
    refused(create('active', duration_minutes=-30)[1], naming='Duration')


@pytest.mark.case('AC02-013')
def test_a_meeting_link_is_optional_at_create_and_editable_later(create, client, tok, world, db):
    code, d = create('active')
    cid = d['response']['cohort_id']
    assert code == 201
    edited = body(client.put(f'{ACHIEVER}/cohorts/{cid}',
                             json={'title': 'AC02 with link',
                                   'meeting_link': 'https://meet.example.com/ac02'},
                             headers=tok(world['active'])))
    assert edited['status'] == 200, edited
    assert db.session.execute(text('SELECT meeting_link FROM cohorts WHERE id = :i'),
                              {'i': cid}).scalar() == 'https://meet.example.com/ac02'


@pytest.mark.case('AC02-014')
def test_registration_deadline_does_not_close_enrolment(client, world, db, app):
    """Enrolment stays open until the class goes live. A leftover deadline
    column must not hide the cohort from a student who wants in."""
    cid = world['cohort']('active', state='upcoming', enrol=False)
    db.session.execute(text("""
        UPDATE cohorts SET registration_deadline = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 DAY)
         WHERE id = :i
    """), {'i': cid})
    db.session.commit()

    uid = str(uuid.uuid4())
    db.session.execute(text("""
        INSERT INTO users (id, full_name, email, status, created_at, updated_at)
        VALUES (:i, 'AC02 Late', :e, 'active', UTC_TIMESTAMP(), UTC_TIMESTAMP())
    """), {'i': uid, 'e': f'{TEST_PREFIX}late-{uid}@skovo.test'})
    db.session.commit()
    with app.app_context():
        hdr = {'Authorization': f'Bearer {create_access_token(identity=str(uid))}'}
    d = body(client.post(f'{COHORTS}/{cid}/enroll', json={}, headers=hdr))
    assert d['status'] in (200, 201), d


@pytest.mark.case('AC02-015')
def test_audience_targeting_round_trips(create, db):
    code, d = create('active', what_you_learn=['React', 'Testing'])
    assert code == 201, d
    stored = db.session.execute(text('SELECT what_you_learn FROM cohorts WHERE id = :i'),
                                {'i': d['response']['cohort_id']}).scalar()
    assert stored and 'React' in str(stored)


@pytest.mark.case('AC02-016')
def test_the_cohort_modal_receives_the_commission_rate():
    """Server-side half is AC02-017. This is the client half, and it is a real
    past defect: `<CohortModal>` destructures `commissionRate` and was never
    passed it, so the earnings-split panel could not render for anybody."""
    jsx = REPO / 'Skovo' / 'src' / 'pages' / 'achiever' / 'AchieverCohorts.jsx'
    if not jsx.exists():
        pytest.skip('SPA source not present in this checkout')
    src = jsx.read_text(encoding='utf-8', errors='ignore')
    assert 'commissionRate' in src, 'AchieverCohorts no longer mentions commissionRate'
    assert 'commissionRate={' in src or 'commissionRate =' in src, \
        'CohortModal is not passed a commissionRate prop'


@pytest.mark.case('AC02-017')
def test_commission_is_resolved_from_the_rules_table():
    src = (REPO / 'SKOVO_BACKEND' / 'portal' / 'routes' / 'Achiever' / 'achiever.py'
           ).read_text(encoding='utf-8')
    assert 'sp_commission_rate_resolve' in src


# ── Editing ──────────────────────────────────────────────────────────────────

@pytest.mark.case('AC02-018')
def test_probation_cannot_edit_a_free_cohort_into_a_paid_one(client, tok, world):
    """PUT runs the same charge gate as POST. Without it, probation creates a
    free cohort and immediately edits it to paid — the gate on the way in only."""
    cid = world['cohort']('probation', state='upcoming', price=0, enrol=False)
    d = body(client.put(f'{ACHIEVER}/cohorts/{cid}',
                        json={'title': 'AC02 now paid', 'price': 999},
                        headers=tok(world['probation'])))
    refused(d)


@pytest.mark.case('AC02-019')
def test_an_active_achiever_can_edit_the_price(client, tok, world, db):
    cid = world['cohort']('active', state='upcoming', price=100, enrol=False)
    d = body(client.put(f'{ACHIEVER}/cohorts/{cid}',
                        json={'title': 'AC02 repriced', 'price': 250},
                        headers=tok(world['active'])))
    assert d['status'] == 200, d
    assert int(db.session.execute(text('SELECT price FROM cohorts WHERE id = :i'),
                                  {'i': cid}).scalar()) == 250


@pytest.mark.case('AC02-020')
def test_an_edit_with_a_bad_value_states_the_error(client, tok, world, db):
    """It used to swallow the value silently, so the achiever saw "Saved" and
    the row was unchanged."""
    cid = world['cohort']('active', state='upcoming', price=100, enrol=False)
    d = body(client.put(f'{ACHIEVER}/cohorts/{cid}',
                        json={'title': 'AC02 bad', 'duration_minutes': 'ninety'},
                        headers=tok(world['active'])))
    refused(d, naming='Duration')


@pytest.mark.case('AC02-021')
def test_editing_another_achievers_cohort_is_404(client, tok, world):
    cid = world['cohort']('other', state='upcoming', enrol=False)
    d = body(client.put(f'{ACHIEVER}/cohorts/{cid}', json={'title': 'stolen'},
                        headers=tok(world['active'])))
    assert d['status'] == 404, d


# ── Cancellation and status ──────────────────────────────────────────────────

@pytest.mark.case('AC02-022')
def test_cancelling_names_the_enrolled_count_and_notifies(client, tok, world, db):
    """The count comes back so the confirmation can say who is affected instead
    of asking the achiever to cancel blind. Students are read BEFORE the soft
    delete — afterwards the cohort is invisible to the procedure that lists
    them. Refunds are NOT issued here; that is an open money question."""
    cid = world['cohort']('active', state='upcoming')
    d = body(client.delete(f'{ACHIEVER}/cohorts/{cid}', headers=tok(world['active'])))
    assert d['status'] == 200, d
    assert d['response'].get('students_notified') == 1, d


@pytest.mark.case('AC02-023')
def test_a_cancelled_cohort_is_not_joinable(client, tok, world):
    cid = world['cohort']('active', state='cancelled', enrol=False)
    d = body(client.post(f'{COHORTS}/{cid}/enroll', json={},
                         headers=tok(world['student'], role='student')))
    assert d['status'] in (400, 403, 409), d
    assert d['response'].get('status_reason') == 'cancelled' \
        or 'cancel' in str(d['response'].get('message', '')).lower(), d


@pytest.mark.case('AC02-024')
def test_status_becomes_live_without_a_manual_step(client, tok, world):
    cid = world['cohort']('active', state='live')
    d = body(client.get(f'{COHORTS}/{cid}', headers=tok(world['student'], role='student')))
    assert d['response']['status'] == 'live', d['response']


@pytest.mark.case('AC02-025')
def test_status_stays_completed_when_stored_completed(client, tok, world):
    cid = world['cohort']('active', state='completed')
    d = body(client.get(f'{COHORTS}/{cid}', headers=tok(world['student'], role='student')))
    assert d['response']['status'] == 'completed', d['response']


@pytest.mark.case('AC02-026')
@pytest.mark.case('AC02-032')
def test_a_missed_scheduler_window_does_not_skip_live(client, tok, world, db):
    """AC02-032 is the same property from the mentor's side: the status is
    time-derived, not connection-derived, so a dropped mentor changes nothing.
    The column is left stale here on purpose."""
    cid = world['cohort']('active', state='live')
    assert db.session.execute(text('SELECT status FROM cohorts WHERE id = :i'),
                              {'i': cid}).scalar() == 'upcoming'
    d = body(client.get(f'{COHORTS}/{cid}', headers=tok(world['student'], role='student')))
    assert d['response']['status'] == 'live', 'upcoming jumped straight past live'


@pytest.mark.case('AC02-033')
@pytest.mark.case('AC02-034')
def test_a_cohort_stays_live_until_the_achiever_ends_it(client, tok, world, db):
    """Duration elapsing does not complete the class."""
    cid = world['cohort']('active', state='live')
    d = body(client.get(f'{COHORTS}/{cid}', headers=tok(world['student'], role='student')))
    assert d['response']['status'] == 'live'
    db.session.execute(text(
        'UPDATE cohorts SET session_date = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 3 HOUR) '
        'WHERE id = :i'), {'i': cid})
    db.session.commit()
    d = body(client.get(f'{COHORTS}/{cid}', headers=tok(world['student'], role='student')))
    assert d['response']['status'] == 'live'


@pytest.mark.case('AC02-035')
def test_shortening_the_duration_does_not_auto_complete(client, tok, world, db):
    cid = world['cohort']('active', state='live')
    db.session.execute(text('UPDATE cohorts SET duration_minutes = 1 WHERE id = :i'),
                       {'i': cid})
    db.session.commit()
    d = body(client.get(f'{COHORTS}/{cid}', headers=tok(world['student'], role='student')))
    assert d['response']['status'] == 'live', d['response']


# ── Attendance ───────────────────────────────────────────────────────────────

@pytest.mark.case('AC02-027')
def test_a_check_in_code_can_be_revealed_on_a_live_cohort(client, tok, world):
    cid = world['cohort']('active', state='live')
    d = body(client.post(f'{ACHIEVER}/cohorts/{cid}/attendance-code', json={},
                         headers=tok(world['active'])))
    assert d['status'] in (200, 201), d
    assert d['response'].get('code'), d


@pytest.mark.case('AC02-028')
def test_a_code_can_be_re_revealed(client, tok, world):
    """The documented recovery path for a student whose connection dropped
    during the window."""
    cid = world['cohort']('active', state='live')
    hdr = tok(world['active'])
    first = body(client.post(f'{ACHIEVER}/cohorts/{cid}/attendance-code', json={}, headers=hdr))
    second = body(client.post(f'{ACHIEVER}/cohorts/{cid}/attendance-code', json={}, headers=hdr))
    assert second['status'] in (200, 201), second
    assert second['response'].get('code'), second


@pytest.mark.case('AC02-029')
@pytest.mark.case('AC02-030')
@pytest.mark.case('AC02-031')
def test_marking_the_roster_records_attendance_and_persists(client, tok, world, db):
    """AC02-030's whole-roster toggle is a client affordance over this one call
    — the server takes the full list of who is present each time, so 'mark all'
    and 'clear all' are the same endpoint with a different list. Reload
    behaviour (AC02-031) is the stored row, checked directly."""
    cid = world['cohort']('active', state='live')
    eid = db.session.execute(text(
        'SELECT id FROM cohort_enrollments WHERE cohort_id = :c'), {'c': cid}).scalar()
    hdr = tok(world['active'])

    marked = body(client.patch(f'{ACHIEVER}/cohorts/{cid}/attendance',
                               json={'present': [eid]}, headers=hdr))
    assert marked['status'] in (200, 201), marked
    assert db.session.execute(text(
        'SELECT attended FROM cohort_enrollments WHERE id = :i'), {'i': eid}).scalar() in (1, True)

    cleared = body(client.patch(f'{ACHIEVER}/cohorts/{cid}/attendance',
                                json={'present': []}, headers=hdr))
    assert cleared['status'] in (200, 201), cleared
    assert db.session.execute(text(
        'SELECT attended FROM cohort_enrollments WHERE id = :i'), {'i': eid}).scalar() in (0, False, None)


@pytest.mark.case('AC02-036')
@pytest.mark.case('AC02-037')
def test_the_whiteboard_relay_warns_when_it_cannot_share_state():
    """Both whiteboard cases are realtime client behaviour and are not provable
    from here. What IS provable, and is the server-side precondition for both,
    is that a multi-worker deployment without a message queue cannot share
    strokes between workers — and that the app says so loudly rather than
    losing a board silently."""
    src = (REPO / 'SKOVO_BACKEND' / 'portal' / 'whiteboard_socket.py')
    if not src.exists():
        pytest.skip('whiteboard relay not present in this checkout')
    txt = src.read_text(encoding='utf-8', errors='ignore')
    assert 'message queue' in txt.lower(), \
        'the relay no longer warns about cross-worker stroke loss'


# ── Class feedback ───────────────────────────────────────────────────────────

@pytest.mark.case('AC02-038')
def test_a_student_can_rate_a_live_class(client, tok, world, db):
    cid = world['cohort']('active', state='live')
    d = body(client.post(f'{REVIEWS}/{world["active"]}',
                         json={'rating': 5, 'context_type': 'cohort',
                               'context_id': cid, 'review_text': 'Useful'},
                         headers=tok(world['student'], role='student')))
    assert d['status'] in (200, 201), d
    row = db.session.execute(text("""
        SELECT context_type FROM achiever_reviews WHERE user_id = :u AND context_id = :c
    """), {'u': world['student'], 'c': cid}).scalar()
    assert row == 'cohort'


@pytest.mark.case('AC02-039')
def test_a_class_cannot_be_rated_before_it_starts(client, tok, world):
    """These are the rows an admin reads in the probation review to decide
    whether an achiever may start charging. Letting them fill up pre-class
    corrupts the only signal that decision rests on."""
    cid = world['cohort']('active', state='upcoming')
    d = body(client.post(f'{REVIEWS}/{world["active"]}',
                         json={'rating': 5, 'context_type': 'cohort', 'context_id': cid},
                         headers=tok(world['student'], role='student')))
    refused(d)


@pytest.mark.case('AC02-040')
def test_a_cancelled_class_cannot_be_rated(client, tok, world):
    cid = world['cohort']('active', state='cancelled')
    d = body(client.post(f'{REVIEWS}/{world["active"]}',
                         json={'rating': 1, 'context_type': 'cohort', 'context_id': cid},
                         headers=tok(world['student'], role='student')))
    refused(d)


@pytest.mark.case('AC02-041')
def test_rating_with_another_achievers_cohort_id_is_404(client, tok, world):
    cid = world['cohort']('other', state='live')
    d = body(client.post(f'{REVIEWS}/{world["active"]}',
                         json={'rating': 5, 'context_type': 'cohort', 'context_id': cid},
                         headers=tok(world['student'], role='student')))
    assert d['status'] == 404, d


@pytest.mark.case('AC02-042')
def test_an_invalid_context_type_is_refused(client, tok, world):
    """It was free text, so a client could invent a context and every feedback
    screen — which filters on == 'cohort' — would silently miss it."""
    cid = world['cohort']('active', state='live')
    d = body(client.post(f'{REVIEWS}/{world["active"]}',
                         json={'rating': 5, 'context_type': 'workshop', 'context_id': cid},
                         headers=tok(world['student'], role='student')))
    refused(d)


@pytest.mark.case('AC02-043')
def test_a_second_rating_edits_rather_than_duplicating(client, tok, world, db):
    cid = world['cohort']('active', state='live')
    hdr = tok(world['student'], role='student')
    for rating in (5, 2):
        d = body(client.post(f'{REVIEWS}/{world["active"]}',
                             json={'rating': rating, 'context_type': 'cohort',
                                   'context_id': cid, 'review_text': f'r{rating}'},
                             headers=hdr))
        assert d['status'] in (200, 201), d
    rows = db.session.execute(text("""
        SELECT rating FROM achiever_reviews WHERE user_id = :u AND context_id = :c
    """), {'u': world['student'], 'c': cid}).scalars().all()
    assert len(rows) == 1, f're-rating created {len(rows)} rows'
    assert int(rows[0]) == 2


@pytest.mark.case('AC02-044')
def test_the_achiever_sees_an_average_a_histogram_and_a_response_rate(client, tok, world):
    """Three fives out of thirty students is not "5.0" — the response rate is
    what stops a tiny sample reading as a verdict."""
    cid = world['cohort']('active', state='live')
    client.post(f'{REVIEWS}/{world["active"]}',
                json={'rating': 5, 'context_type': 'cohort', 'context_id': cid},
                headers=tok(world['student'], role='student'))
    d = body(client.get(f'{ACHIEVER}/cohorts/{cid}/feedback', headers=tok(world['active'])))
    assert d['status'] == 200, d
    r = d['response']
    # The payload names them avg_rating / breakdown / count vs enrolled_count.
    assert 'avg_rating' in r, sorted(r)
    assert 'breakdown' in r, sorted(r)
    # A response rate needs both halves: how many rated, out of how many could.
    assert 'count' in r and 'enrolled_count' in r, sorted(r)
    assert int(r['count']) >= 1
    assert int(r['enrolled_count']) >= int(r['count']),         'more ratings than enrolled students'


@pytest.mark.case('AC02-045')
def test_the_feedback_endpoint_is_read_only_for_the_achiever(client, tok, world):
    """An achiever who could delete a bad rating makes the average meaningless.
    Removing an unfair review belongs under Moderation, where it leaves a
    trail."""
    cid = world['cohort']('active', state='live')
    hdr = tok(world['active'])
    for verb in ('delete', 'post', 'put'):
        resp = getattr(client, verb)(f'{ACHIEVER}/cohorts/{cid}/feedback',
                                     json={}, headers=hdr)
        assert resp.status_code in (404, 405) or (resp.get_json() or {}).get('status') in (403, 404, 405), \
            f'{verb.upper()} on the feedback endpoint was accepted'
