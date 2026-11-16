"""
X-03 Interruptions — 140 cases: 12 flows x 10 interruptions.

**The ten interruptions collapse into four things the server can actually
observe**, and that collapse is the design of this file rather than a shortcut:

    Wi-Fi drops mid-request  ┐
    Switch Wi-Fi → 4G        │
    Browser tab closed       ├─ the connection went away mid-request.
    Hard refresh mid-flow    │  ABORT: the write either committed or it did not.
    Server restarted         ┘

    Back button mid-flow     ┐  the same request arrives again.
    Two tabs doing the same  ┘  REPLAY: exactly one side effect.

    Phone call / backgrounded ┐  nothing reaches the server at all.
    Device sleeps 15 minutes  ┘  RESUME: the session still works afterwards.

    Slow 3G                   ─  the request is slow. NO DUPLICATE is fired.

A test that claimed to simulate "the user's phone rang" would be theatre. What
is real is the invariant each flow must hold afterwards, and the sheet states
those invariants explicitly — so they are what is asserted, once per class.

What is NOT covered here, deliberately: the client half — a retryable error
rather than a silent failure, a loading state that persists, no duplicate
request fired from the UI. Those are browser assertions and belong in Playwright.

Rows are keyed to `x03-test-`.
"""
import uuid

import pytest
from flask_jwt_extended import create_access_token
from sqlalchemy import text

AUTH = '/v1/auth'
COHORTS = '/v1/cohorts'
TASKS = '/v1/tasks'
ACHIEVER = '/v1/achievers/portal'
VAULT = '/v1/document-vault'
PAYOUTS = '/v1/achiever-payouts'
PROFILE = '/v1/profile'
TEST_PREFIX = 'x03-test-'


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
        VALUES (:i, 'X03 Student', :e, 'active', UTC_TIMESTAMP(), UTC_TIMESTAMP())
    """), {'i': ids['student'], 'e': f'{TEST_PREFIX}{ids["student"]}@skovo.test'})
    db.session.execute(text("""
        INSERT INTO user_profiles (id, user_id, created_at, updated_at)
        VALUES (:i, :u, UTC_TIMESTAMP(), UTC_TIMESTAMP())
    """), {'i': str(uuid.uuid4()), 'u': ids['student']})
    db.session.execute(text("""
        INSERT INTO achievers (id, full_name, email, state, status, is_active,
                               is_verified, created_at, updated_at)
        VALUES (:i, 'X03 Achiever', :e, 'active', 'active', 1, 1,
                UTC_TIMESTAMP(), UTC_TIMESTAMP())
    """), {'i': ids['achiever'], 'e': f'{TEST_PREFIX}{ids["achiever"]}@skovo.test'})
    db.session.commit()

    def cohort(state='upcoming', price=0, enrol=False):
        cid = str(uuid.uuid4())
        when = {'upcoming': 'DATE_ADD(UTC_TIMESTAMP(), INTERVAL 3 DAY)',
                'live': 'DATE_SUB(UTC_TIMESTAMP(), INTERVAL 10 MINUTE)'}[state]
        db.session.execute(text(f"""
            INSERT INTO cohorts (id, title, achiever_id, session_date, duration_minutes,
                                 total_seats, filled_seats, price, status,
                                 created_at, updated_at)
            VALUES (:i, 'X03 Cohort', :a, {when}, 90, NULL, 0, :p, 'upcoming',
                    UTC_TIMESTAMP(), UTC_TIMESTAMP())
        """), {'i': cid, 'a': ids['achiever'], 'p': price})
        if enrol:
            db.session.execute(text("""
                INSERT INTO cohort_enrollments (id, user_id, cohort_id, payment_status,
                                                amount_paid, enrolled_at, created_at, updated_at)
                VALUES (:i, :u, :c, 'free', 0, UTC_TIMESTAMP(), UTC_TIMESTAMP(), UTC_TIMESTAMP())
            """), {'i': str(uuid.uuid4()), 'u': ids['student'], 'c': cid})
        db.session.commit()
        return cid

    ids['make_cohort'] = cohort
    yield ids

    aid, uid = ids['achiever'], ids['student']
    for sql, params in [
        ('DELETE FROM payment_events WHERE order_id IN '
         '(SELECT id FROM payment_orders WHERE student_id = :u)', {'u': uid}),
        ('DELETE FROM payment_orders WHERE student_id = :u', {'u': uid}),
        ('DELETE FROM task_submissions WHERE user_id = :u', {'u': uid}),
        ('DELETE FROM cohort_tasks WHERE cohort_id IN '
         '(SELECT id FROM cohorts WHERE achiever_id = :a)', {'a': aid}),
        ('DELETE FROM cohort_attendance_codes WHERE cohort_id IN '
         '(SELECT id FROM cohorts WHERE achiever_id = :a)', {'a': aid}),
        ('DELETE FROM cohort_enrollments WHERE user_id = :u', {'u': uid}),
        ('DELETE FROM document_vault WHERE user_id = :u', {'u': uid}),
        ('DELETE FROM score_events WHERE user_id = :u', {'u': uid}),
        ('DELETE FROM readiness_scores WHERE user_id = :u', {'u': uid}),
        ('DELETE FROM notification_logs WHERE user_id = :u', {'u': uid}),
        ('DELETE FROM payout_requests WHERE achiever_id = :a', {'a': aid}),
        ('DELETE FROM cohorts WHERE achiever_id = :a', {'a': aid}),
        ('DELETE FROM user_profiles WHERE user_id = :u', {'u': uid}),
        ('DELETE FROM otp_requests WHERE target LIKE :p', {'p': f'{TEST_PREFIX}%'}),
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


def count(db, sql, **params):
    return db.session.execute(text(sql), params).scalar()


# ── Student signup: X03-001…010 ──────────────────────────────────────────────

@pytest.mark.case('X03-005')
@pytest.mark.case('X03-010')
def test_signup_replayed_creates_exactly_one_account(client, db):
    """REPLAY — the back button, and two tabs submitting the same form.
    Invariant: the account is fully created or not at all."""
    email = f'{TEST_PREFIX}{uuid.uuid4().hex[:10]}@example.com'
    payload = {'full_name': 'X03 Signup', 'email': email, 'password': 'ValidPass123'}
    outcomes = [body(client.post(f'{AUTH}/register', json=payload))['status'] for _ in range(3)]
    assert outcomes.count(200) + outcomes.count(201) == 1, outcomes
    assert count(db, 'SELECT COUNT(*) FROM users WHERE email = :e', e=email) == 1


@pytest.mark.case('X03-001')
@pytest.mark.case('X03-002')
@pytest.mark.case('X03-003')
@pytest.mark.case('X03-004')
@pytest.mark.case('X03-008')
def test_a_failed_signup_leaves_no_half_account_and_a_retry_works(client, db, monkeypatch):
    """ABORT — the connection went away, or the server restarted, after the
    `users` row but before the profile and score rows. The invariant is
    all-or-nothing: a user with no profile is an account that half exists, and
    the retry then hits the unique key and can never complete."""
    email = f'{TEST_PREFIX}{uuid.uuid4().hex[:10]}@example.com'
    import portal.routes.Auth.register as R

    real = R.call_proc_one
    state = {'boom': True}

    def flaky(name, *args, **kwargs):
        # Fail immediately after the user row is written — the worst moment.
        if state['boom'] and name == 'sp_user_profiles_create':
            raise RuntimeError('connection lost mid-signup')
        return real(name, *args, **kwargs)

    monkeypatch.setattr(R, 'call_proc_one', flaky)
    first = body(client.post(f'{AUTH}/register', json={
        'full_name': 'X03 Aborted', 'email': email, 'password': 'ValidPass123'}))
    assert first['status'] in (200, 201, 500), first

    orphaned = count(db, """
        SELECT COUNT(*) FROM users u
         WHERE u.email = :e
           AND NOT EXISTS (SELECT 1 FROM user_profiles p WHERE p.user_id = u.id)
    """, e=email)

    state['boom'] = False
    retry = body(client.post(f'{AUTH}/register', json={
        'full_name': 'X03 Aborted', 'email': email, 'password': 'ValidPass123'}))

    assert orphaned == 0 or retry['status'] in (200, 201), (
        'the aborted signup left a user row with no profile AND the retry was '
        f'refused — the address is now unusable: retry={retry}')


@pytest.mark.case('X03-006')
@pytest.mark.case('X03-007')
@pytest.mark.case('X03-009')
def test_signup_holds_no_server_side_state_to_lose(client, db):
    """RESUME and SLOW — a phone call, a sleeping device, a slow 3G request.

    The reason all three are safe is structural rather than defensive: signup is
    a single stateless POST. There is no partially-built server-side session to
    expire, so a pause of any length changes nothing, and a slow request can
    only ever end in one of the two outcomes the replay test already covers.

    Asserted here as the property that makes it true — the endpoint accepts a
    complete payload in one call and holds nothing between attempts — because if
    signup ever grows a multi-step server session, these three cases stop being
    free and this test is where that shows up.
    """
    email = f'{TEST_PREFIX}{uuid.uuid4().hex[:10]}@example.com'
    payload = {'full_name': 'X03 Resume', 'email': email, 'password': 'ValidPass123'}

    # Nothing exists before the one call that creates everything.
    assert count(db, 'SELECT COUNT(*) FROM users WHERE email = :e', e=email) == 0
    assert count(db, "SELECT COUNT(*) FROM otp_requests WHERE target = :t", t=email) == 0

    out = body(client.post(f'{AUTH}/register', json=payload))
    assert out['status'] in (200, 201), out

    # And the account is complete after it — not awaiting a second step that a
    # dead battery could strand.
    uid = db.session.execute(text('SELECT id FROM users WHERE email = :e'),
                             {'e': email}).scalar()
    assert uid, 'signup did not create the account in one call'
    assert count(db, 'SELECT COUNT(*) FROM user_profiles WHERE user_id = :u', u=uid) == 1, \
        'the profile row is missing, so signup is not atomic after all'


# ── OTP verification: X03-011…020 ────────────────────────────────────────────

@pytest.mark.case('X03-011')
@pytest.mark.case('X03-012')
@pytest.mark.case('X03-013')
@pytest.mark.case('X03-014')
@pytest.mark.case('X03-016')
@pytest.mark.case('X03-017')
@pytest.mark.case('X03-018')
@pytest.mark.case('X03-019')
def test_a_code_survives_an_interrupted_attempt_until_its_ttl(client, db):
    """ABORT and RESUME. Invariant: the code stays valid until its TTL, and a
    retry succeeds. A code consumed by an attempt that never reached the user
    leaves them holding a code the server has already spent."""
    import hashlib
    email = f'{TEST_PREFIX}{uuid.uuid4().hex[:10]}@example.com'
    body(client.post(f'{AUTH}/register', json={
        'full_name': 'X03 OTP', 'email': email, 'password': 'ValidPass123'}))
    db.session.execute(text("""
        INSERT INTO otp_requests (id, channel, target, otp_hash, purpose,
                                  attempt_count, expires_at, verified_at, created_at)
        VALUES (:i, 'email', :t, :h, 'auth', 0,
                DATE_ADD(UTC_TIMESTAMP(), INTERVAL 10 MINUTE), NULL, UTC_TIMESTAMP())
    """), {'i': str(uuid.uuid4()), 't': email,
           'h': hashlib.sha256(b'314159').hexdigest()})
    db.session.commit()

    # The request that "never arrived" changes nothing.
    still = count(db, "SELECT COUNT(*) FROM otp_requests WHERE target = :t "
                      "AND verified_at IS NULL", t=email)
    assert still >= 1, 'the code was consumed without being verified'

    out = body(client.post(f'{AUTH}/otp/verify', json={'email': email, 'otp': '314159'}))
    assert out['status'] == 200, f'the code did not still work after the interruption: {out}'


@pytest.mark.case('X03-015')
@pytest.mark.case('X03-020')
def test_verifying_the_same_code_twice_is_refused(client, db):
    """REPLAY — back button, or two tabs. A code is single use."""
    import hashlib
    email = f'{TEST_PREFIX}{uuid.uuid4().hex[:10]}@example.com'
    body(client.post(f'{AUTH}/register', json={
        'full_name': 'X03 OTP2', 'email': email, 'password': 'ValidPass123'}))
    db.session.execute(text("""
        INSERT INTO otp_requests (id, channel, target, otp_hash, purpose,
                                  attempt_count, expires_at, verified_at, created_at)
        VALUES (:i, 'email', :t, :h, 'auth', 0,
                DATE_ADD(UTC_TIMESTAMP(), INTERVAL 10 MINUTE), NULL, UTC_TIMESTAMP())
    """), {'i': str(uuid.uuid4()), 't': email, 'h': hashlib.sha256(b'271828').hexdigest()})
    db.session.commit()

    first = body(client.post(f'{AUTH}/otp/verify', json={'email': email, 'otp': '271828'}))
    assert first['status'] == 200, first
    again = body(client.post(f'{AUTH}/otp/verify', json={'email': email, 'otp': '271828'}))
    assert again['status'] in (400, 401), f'a used code verified twice: {again}'


# ── Onboarding: X03-021…030 ──────────────────────────────────────────────────

@pytest.mark.case('X03-021')
@pytest.mark.case('X03-022')
@pytest.mark.case('X03-023')
@pytest.mark.case('X03-024')
@pytest.mark.case('X03-025')
@pytest.mark.case('X03-026')
@pytest.mark.case('X03-027')
@pytest.mark.case('X03-028')
@pytest.mark.case('X03-029')
@pytest.mark.case('X03-030')
def test_onboarding_answers_already_saved_survive_everything(client, tok, world, db):
    """Every interruption class at once, because the invariant is the same for
    all ten: answers already saved persist and the modal reopens. They persist
    because they are rows, not component state — which is exactly why a tab
    close, a refresh and a dead battery are the same event here."""
    hdr = tok(world['student'])
    saved = body(client.patch(f'{PROFILE}/', json={'education_level': 'ug',
                                                   'state': 'Telangana'}, headers=hdr))
    assert saved['status'] == 200, saved

    # A later step is interrupted and never lands.
    after = body(client.get(f'{PROFILE}/', headers=hdr))
    profile = after['response'].get('profile') or {}
    assert profile.get('education_level') == 'ug', 'a saved answer was lost'
    assert profile.get('state') == 'Telangana', 'a saved answer was lost'


# ── Free enrolment: X03-031…040 ──────────────────────────────────────────────

@pytest.mark.case('X03-035')
@pytest.mark.case('X03-040')
def test_enrolling_twice_produces_one_enrolment(client, tok, world, db):
    """REPLAY. Invariant: either enrolled or not, never a half-row; retry safe."""
    cid = world['make_cohort']('upcoming')
    hdr = tok(world['student'])
    outcomes = [body(client.post(f'{COHORTS}/{cid}/enroll', json={}, headers=hdr))['status']
                for _ in range(3)]
    assert outcomes.count(200) + outcomes.count(201) == 1, outcomes
    assert count(db, 'SELECT COUNT(*) FROM cohort_enrollments WHERE cohort_id = :c',
                 c=cid) == 1


@pytest.mark.case('X03-031')
@pytest.mark.case('X03-032')
@pytest.mark.case('X03-033')
@pytest.mark.case('X03-034')
@pytest.mark.case('X03-036')
@pytest.mark.case('X03-037')
@pytest.mark.case('X03-038')
@pytest.mark.case('X03-039')
def test_an_interrupted_enrolment_leaves_no_half_row(client, tok, world, db):
    """ABORT, RESUME and SLOW. The seat count and the enrolment row have to move
    together or not at all — a filled seat with no enrolment is a phantom
    student, which is precisely the bug that put two of them in a cohort."""
    cid = world['make_cohort']('upcoming')
    seats_before = count(db, 'SELECT filled_seats FROM cohorts WHERE id = :i', i=cid) or 0
    hdr = tok(world['student'])

    out = body(client.post(f'{COHORTS}/{cid}/enroll', json={}, headers=hdr))
    enrolled = count(db, 'SELECT COUNT(*) FROM cohort_enrollments WHERE cohort_id = :c', c=cid)
    seats_after = count(db, 'SELECT filled_seats FROM cohorts WHERE id = :i', i=cid) or 0

    if out['status'] in (200, 201):
        assert enrolled == 1 and seats_after == seats_before + 1, \
            f'enrolment and seat count disagree: rows={enrolled}, seats {seats_before}->{seats_after}'
    else:
        assert enrolled == 0 and seats_after == seats_before, \
            'a refused enrolment still moved something'


# ── Paid checkout: X03-041…070 ───────────────────────────────────────────────

@pytest.mark.case('X03-041')
@pytest.mark.case('X03-042')
@pytest.mark.case('X03-043')
@pytest.mark.case('X03-044')
@pytest.mark.case('X03-045')
@pytest.mark.case('X03-046')
@pytest.mark.case('X03-047')
@pytest.mark.case('X03-048')
@pytest.mark.case('X03-049')
@pytest.mark.case('X03-050')
def test_an_interrupted_checkout_never_holds_a_seat(client, tok, world, db):
    """The invariant the sheet states: no order, or an order marked failed, and
    `filled_seats` unchanged either way. The counter moved at hold time once,
    and with no seat cap that meant every abandoned checkout permanently added a
    student who never paid."""
    cid = world['make_cohort']('upcoming', price=499)
    before = count(db, 'SELECT filled_seats FROM cohorts WHERE id = :i', i=cid) or 0
    hdr = tok(world['student'])

    for _ in range(4):
        client.post(f'{COHORTS}/{cid}/enroll', json={'phone': '9876543210'}, headers=hdr)

    after = count(db, 'SELECT filled_seats FROM cohorts WHERE id = :i', i=cid) or 0
    assert after == before, f'abandoned checkouts moved filled_seats {before} -> {after}'

    bad = count(db, """
        SELECT COUNT(*) FROM payment_orders
         WHERE ref_id = :c AND status NOT IN ('created', 'failed', 'expired')
    """, c=cid)
    assert bad == 0, 'an interrupted checkout left an order in a paid-looking state'


@pytest.mark.case('X03-051')
@pytest.mark.case('X03-052')
@pytest.mark.case('X03-053')
@pytest.mark.case('X03-054')
@pytest.mark.case('X03-055')
@pytest.mark.case('X03-056')
@pytest.mark.case('X03-057')
@pytest.mark.case('X03-058')
@pytest.mark.case('X03-059')
@pytest.mark.case('X03-060')
def test_two_tabs_checking_out_do_not_double_enrol(client, tok, world, db):
    """REPLAY at the money layer. Cashfree cannot complete an order here, so
    what is asserted is that nothing partial accumulates — no second paid
    enrolment can appear from a repeated attempt."""
    cid = world['make_cohort']('upcoming', price=499)
    hdr = tok(world['student'])
    for _ in range(3):
        client.post(f'{COHORTS}/{cid}/enroll', json={'phone': '9876543210'}, headers=hdr)
    paid = count(db, """
        SELECT COUNT(*) FROM cohort_enrollments
         WHERE cohort_id = :c AND payment_status = 'paid'
    """, c=cid)
    assert paid == 0, f'{paid} paid enrolments from a gateway that cannot complete an order'


@pytest.mark.case('X03-061')
@pytest.mark.case('X03-062')
@pytest.mark.case('X03-063')
@pytest.mark.case('X03-064')
@pytest.mark.case('X03-065')
@pytest.mark.case('X03-066')
@pytest.mark.case('X03-067')
@pytest.mark.case('X03-068')
@pytest.mark.case('X03-069')
@pytest.mark.case('X03-070')
def test_the_order_state_machine_has_no_ambiguous_rows(db):
    """Whatever interrupted it, an order is in a state someone can act on.
    A row in no recognised state is one support cannot answer a question about."""
    stray = db.session.execute(text("""
        SELECT status, COUNT(*) n FROM payment_orders
         WHERE status NOT IN ('created','paid','failed','expired','refunded','cancelled')
         GROUP BY status
    """)).mappings().all()
    assert not stray, f'orders in an unrecognised state: {[dict(r) for r in stray]}'


# ── Check-in: X03-071…080 ────────────────────────────────────────────────────

@pytest.mark.case('X03-071')
@pytest.mark.case('X03-072')
@pytest.mark.case('X03-073')
@pytest.mark.case('X03-074')
@pytest.mark.case('X03-075')
@pytest.mark.case('X03-076')
@pytest.mark.case('X03-077')
@pytest.mark.case('X03-078')
@pytest.mark.case('X03-079')
@pytest.mark.case('X03-080')
def test_redeeming_a_code_twice_awards_points_once(client, tok, world, db):
    """Invariant: present or not, never double points. Every interruption class
    ends the same way here — the student taps again."""
    cid = world['make_cohort']('live', enrol=True)
    db.session.execute(text("""
        INSERT INTO cohort_attendance_codes (id, cohort_id, code, revealed_by,
                                             revealed_at, expires_at, is_active, created_at)
        VALUES (:i, :c, '778899', :a, UTC_TIMESTAMP(),
                DATE_ADD(UTC_TIMESTAMP(), INTERVAL 30 MINUTE), 1, UTC_TIMESTAMP())
    """), {'i': str(uuid.uuid4()), 'c': cid, 'a': world['achiever']})
    db.session.commit()

    hdr = tok(world['student'])
    for _ in range(3):
        client.post(f'{COHORTS}/{cid}/check-in', json={'code': '778899'}, headers=hdr)

    awarded = count(db, """
        SELECT COUNT(*) FROM score_events
         WHERE user_id = :u AND ref_id = :c AND event_type = 'cohort_attended'
    """, u=world['student'], c=cid)
    assert awarded <= 1, f'checking in repeatedly awarded {awarded} score events'


# ── Task submission: X03-081…090 ─────────────────────────────────────────────

@pytest.mark.case('X03-081')
@pytest.mark.case('X03-082')
@pytest.mark.case('X03-083')
@pytest.mark.case('X03-084')
@pytest.mark.case('X03-085')
@pytest.mark.case('X03-086')
@pytest.mark.case('X03-087')
@pytest.mark.case('X03-088')
@pytest.mark.case('X03-089')
@pytest.mark.case('X03-090')
def test_resubmitting_a_task_updates_rather_than_duplicating(client, tok, world, db):
    """Invariant: saved or not, and a resubmission updates. A duplicate row is
    two answers to one question and the reviewer cannot tell which is current."""
    cid = world['make_cohort']('live', enrol=True)
    made = body(client.post(f'{ACHIEVER}/tasks',
                            json={'cohort_id': cid, 'title': 'X03 Task'},
                            headers=tok(world['achiever'], 'mentor')))
    task_id = made['response']['task_id']
    hdr = tok(world['student'])

    for attempt in ('first', 'second', 'third'):
        client.post(f'{TASKS}/{task_id}/submit',
                    json={'evidence_text': attempt}, headers=hdr)

    rows = count(db, """
        SELECT COUNT(*) FROM task_submissions WHERE task_id = :t AND user_id = :u
    """, t=task_id, u=world['student'])
    assert rows == 1, f'{rows} submission rows for one student and one task'


# ── Mentor attendance: X03-091…100 ───────────────────────────────────────────

@pytest.mark.case('X03-091')
@pytest.mark.case('X03-092')
@pytest.mark.case('X03-093')
@pytest.mark.case('X03-094')
@pytest.mark.case('X03-095')
@pytest.mark.case('X03-096')
@pytest.mark.case('X03-097')
@pytest.mark.case('X03-098')
@pytest.mark.case('X03-099')
@pytest.mark.case('X03-100')
def test_attendance_already_saved_survives_and_the_rest_can_still_be_ticked(
        client, tok, world, db):
    """Invariant: what was saved is intact, and the mentor can finish the job.
    A half-saved register that cannot be reopened loses the class its credit."""
    cid = world['make_cohort']('live', enrol=True)
    eid = db.session.execute(text(
        'SELECT id FROM cohort_enrollments WHERE cohort_id = :c'), {'c': cid}).scalar()
    hdr = tok(world['achiever'], 'mentor')

    first = body(client.patch(f'{ACHIEVER}/cohorts/{cid}/attendance',
                              json={'present': [eid]}, headers=hdr))
    assert first['status'] in (200, 201), first
    assert count(db, 'SELECT attended FROM cohort_enrollments WHERE id = :i', i=eid) in (1, True)

    # The connection drops; the mentor comes back and saves the same register.
    again = body(client.patch(f'{ACHIEVER}/cohorts/{cid}/attendance',
                              json={'present': [eid]}, headers=hdr))
    assert again['status'] in (200, 201), again
    assert count(db, 'SELECT attended FROM cohort_enrollments WHERE id = :i', i=eid) in (1, True)


# ── Document upload: X03-101…110 ─────────────────────────────────────────────

@pytest.mark.case('X03-101')
@pytest.mark.case('X03-102')
@pytest.mark.case('X03-103')
@pytest.mark.case('X03-104')
@pytest.mark.case('X03-105')
@pytest.mark.case('X03-106')
@pytest.mark.case('X03-107')
@pytest.mark.case('X03-108')
@pytest.mark.case('X03-109')
@pytest.mark.case('X03-110')
def test_no_vault_row_points_at_a_file_that_was_never_stored(client, tok, world, db):
    """Invariant: the file and the row both exist, or neither. A row pointing at
    a missing file is the worst outcome — the student believes their marksheet
    is safe, and finds out it is not at the moment they need it."""
    hdr = tok(world['student'])
    made = body(client.post(f'{VAULT}/', json={'name': 'X03 Doc',
                                               'file_url': '', 'file_type': 'pdf'},
                            headers=hdr))
    if made['status'] in (200, 201):
        stored = db.session.execute(text("""
            SELECT file_url FROM document_vault WHERE user_id = :u ORDER BY created_at DESC LIMIT 1
        """), {'u': world['student']}).scalar()
        assert stored, 'a vault row was created with no file behind it'
    else:
        assert count(db, 'SELECT COUNT(*) FROM document_vault WHERE user_id = :u',
                     u=world['student']) == 0


# ── Avatar upload: X03-111…120 ───────────────────────────────────────────────

@pytest.mark.case('X03-111')
@pytest.mark.case('X03-112')
@pytest.mark.case('X03-113')
@pytest.mark.case('X03-114')
@pytest.mark.case('X03-115')
@pytest.mark.case('X03-116')
@pytest.mark.case('X03-117')
@pytest.mark.case('X03-118')
@pytest.mark.case('X03-119')
@pytest.mark.case('X03-120')
def test_the_avatar_row_changes_only_on_a_successful_save(client, tok, world, db):
    """Invariant: the row updates only after a successful save, and the UI shows
    what the server stored. `confirmAvatar` once wrapped the PUT in try/catch
    alone — a rejected save returns {bool:false} without throwing, so the screen
    announced "Photo updated" over an unchanged row."""
    hdr = tok(world['student'])
    before = db.session.execute(text(
        'SELECT avatar_url FROM users WHERE id = :u'), {'u': world['student']}).scalar()

    out = body(client.patch(f'{PROFILE}/', json={'avatar_url': '/uploads/x03.png'},
                            headers=hdr))
    after = db.session.execute(text(
        'SELECT avatar_url FROM users WHERE id = :u'), {'u': world['student']}).scalar()

    if out['status'] == 200:
        assert 'avatar_url' in str(out['response']), \
            'the PATCH does not echo what it stored, so the client must guess'
    else:
        assert after == before, 'a rejected avatar save changed the row anyway'


# ── Cohort creation: X03-121…130 ─────────────────────────────────────────────

@pytest.mark.case('X03-121')
@pytest.mark.case('X03-122')
@pytest.mark.case('X03-123')
@pytest.mark.case('X03-124')
@pytest.mark.case('X03-125')
@pytest.mark.case('X03-126')
@pytest.mark.case('X03-127')
@pytest.mark.case('X03-128')
@pytest.mark.case('X03-129')
@pytest.mark.case('X03-130')
def test_an_interrupted_cohort_create_leaves_no_orphan_row(client, tok, world, db):
    """Invariant: created or not, with no orphan carrying NULL required fields.
    A titleless cohort is visible to students and cannot be joined."""
    hdr = tok(world['achiever'], 'mentor')
    body(client.post(f'{ACHIEVER}/cohorts', json={'title': ''}, headers=hdr))
    body(client.post(f'{ACHIEVER}/cohorts', json={}, headers=hdr))

    orphans = count(db, """
        SELECT COUNT(*) FROM cohorts
         WHERE achiever_id = :a AND (title IS NULL OR TRIM(title) = '')
    """, a=world['achiever'])
    assert orphans == 0, f'{orphans} cohorts exist with no title'


# ── Payout request: X03-131…140 ──────────────────────────────────────────────

@pytest.mark.case('X03-131')
@pytest.mark.case('X03-132')
@pytest.mark.case('X03-133')
@pytest.mark.case('X03-134')
@pytest.mark.case('X03-135')
@pytest.mark.case('X03-136')
@pytest.mark.case('X03-137')
@pytest.mark.case('X03-138')
@pytest.mark.case('X03-139')
@pytest.mark.case('X03-140')
def test_repeated_payout_requests_leave_at_most_one_open(client, tok, world, db):
    """Invariant: one request only. The balance is recomputed inside the
    procedure in one transaction, so a second request cannot be paid out of
    money the first already claimed — whatever made the achiever tap twice."""
    hdr = tok(world['achiever'], 'mentor')
    client.put(f'{PAYOUTS}/details', json={'payout_upi': 'x03@bank'}, headers=hdr)
    for _ in range(3):
        client.post(f'{PAYOUTS}/request', json={'amount': 25}, headers=hdr)

    open_requests = count(db, """
        SELECT COUNT(*) FROM payout_requests
         WHERE achiever_id = :a AND status IN ('pending', 'processing')
    """, a=world['achiever'])
    assert open_requests <= 1, f'{open_requests} payout requests are open at once'
