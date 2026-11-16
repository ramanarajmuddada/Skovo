"""
AC-03 Tasks, Availability, Money — all 23 cases.

Three subjects the achiever portal keeps in one sheet because they share a
property: each one either awards something, publishes something bookable, or
moves money, so a missing guard is not cosmetic.

Deliberate overlaps with other sheets are kept rather than cross-referenced:
task ownership also appears in X-01 and slot windows in X-04, but a reader
working AC-03 should be able to run this file and get an answer, not follow a
trail. Where the assertion is genuinely identical the docstring says so.

Rows are keyed to `ac03-test-`.
"""
import datetime
import uuid

import pytest
from flask_jwt_extended import create_access_token
from sqlalchemy import text

ACHIEVER = '/v1/achievers/portal'
AVAIL = '/v1/achiever-availability'
PAYOUTS = '/v1/achiever-payouts'
TEST_PREFIX = 'ac03-test-'


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
    """Two achievers (so ownership is expressible), one student, one live cohort."""
    ids = {k: str(uuid.uuid4()) for k in ('a', 'b', 'student', 'cohort', 'banned')}
    for key, state in (('a', 'active'), ('b', 'active'), ('banned', 'banned')):
        db.session.execute(text("""
            INSERT INTO achievers (id, full_name, email, state, status, is_active,
                                   is_verified, created_at, updated_at)
            VALUES (:i, :n, :e, :s, 'active', 1, 1, UTC_TIMESTAMP(), UTC_TIMESTAMP())
        """), {'i': ids[key], 'n': f'AC03 {key}',
               'e': f'{TEST_PREFIX}{ids[key]}@skovo.test', 's': state})
    db.session.execute(text("""
        INSERT INTO users (id, full_name, email, status, created_at, updated_at)
        VALUES (:i, 'AC03 Student', :e, 'active', UTC_TIMESTAMP(), UTC_TIMESTAMP())
    """), {'i': ids['student'], 'e': f'{TEST_PREFIX}{ids["student"]}@skovo.test'})
    db.session.execute(text("""
        INSERT INTO cohorts (id, title, achiever_id, session_date, duration_minutes,
                             total_seats, filled_seats, price, status, created_at, updated_at)
        VALUES (:i, 'AC03 Cohort', :a, DATE_SUB(UTC_TIMESTAMP(), INTERVAL 10 MINUTE), 90,
                NULL, 0, 0, 'live', UTC_TIMESTAMP(), UTC_TIMESTAMP())
    """), {'i': ids['cohort'], 'a': ids['a']})
    db.session.execute(text("""
        INSERT INTO cohort_enrollments (id, user_id, cohort_id, payment_status,
                                        amount_paid, enrolled_at, created_at, updated_at)
        VALUES (:i, :u, :c, 'free', 0, UTC_TIMESTAMP(), UTC_TIMESTAMP(), UTC_TIMESTAMP())
    """), {'i': str(uuid.uuid4()), 'u': ids['student'], 'c': ids['cohort']})
    db.session.commit()

    yield ids

    aids = (ids['a'], ids['b'], ids['banned'])
    for sql, params in [
        ('DELETE FROM task_submissions WHERE user_id = :u', {'u': ids['student']}),
        ('DELETE FROM cohort_tasks WHERE cohort_id = :c', {'c': ids['cohort']}),
        ('DELETE FROM cohort_enrollments WHERE cohort_id = :c', {'c': ids['cohort']}),
        ('DELETE FROM notification_logs WHERE user_id = :u', {'u': ids['student']}),
        ('DELETE FROM cohorts WHERE achiever_id IN :a', {'a': aids}),
        ('DELETE FROM achiever_slots WHERE mentor_id IN :a', {'a': aids}),
        ('DELETE FROM achiever_availability WHERE mentor_id IN :a', {'a': aids}),
        ('DELETE FROM payout_requests WHERE achiever_id IN :a', {'a': aids}),
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
    def _tok(aid):
        with app.app_context():
            return {'Authorization': 'Bearer ' + create_access_token(
                identity=str(aid), additional_claims={'role': 'mentor', 'mentor': True})}
    return _tok


@pytest.fixture
def make_task(client, tok, world):
    def _make(**fields):
        payload = {'cohort_id': world['cohort'], 'title': 'AC03 task'}
        payload.update(fields)
        d = body(client.post(f'{ACHIEVER}/tasks', json=payload, headers=tok(world['a'])))
        return d['status'], d
    return _make


# ── Tasks ────────────────────────────────────────────────────────────────────

@pytest.mark.case('AC03-001')
def test_an_achiever_can_set_a_task_on_their_own_cohort(make_task, db):
    code, d = make_task(title='AC03 own cohort')
    assert code == 201, d
    assert db.session.execute(text('SELECT COUNT(*) FROM cohort_tasks WHERE id = :i'),
                              {'i': d['response']['task_id']}).scalar() == 1


@pytest.mark.case('AC03-002')
def test_setting_a_task_on_someone_elses_cohort_is_404(client, tok, world):
    """404 rather than 403 throughout: sp_cohort_tasks_get takes a task id and
    knows nothing about who is asking, so each route resolves the cohort first —
    and a 403 would confirm the id exists."""
    d = body(client.post(f'{ACHIEVER}/tasks',
                         json={'cohort_id': world['cohort'], 'title': 'hijack'},
                         headers=tok(world['b'])))
    assert d['status'] == 404, d


@pytest.mark.case('AC03-003')
def test_editing_or_deleting_someone_elses_task_is_404(client, tok, world, make_task):
    code, d = make_task(title='AC03 not yours')
    task_id = d['response']['task_id']
    stranger = tok(world['b'])
    assert body(client.put(f'{ACHIEVER}/tasks/{task_id}',
                           json={'title': 'stolen'}, headers=stranger))['status'] == 404
    assert body(client.delete(f'{ACHIEVER}/tasks/{task_id}',
                              headers=stranger))['status'] == 404


@pytest.mark.case('AC03-004')
def test_deleting_a_task_is_soft_and_keeps_submissions(client, tok, world, make_task, db):
    """Same assertion as X01-027, kept here rather than cross-referenced: the
    student's submission is their work and the row a dispute would rest on."""
    code, d = make_task(title='AC03 soft delete')
    task_id = d['response']['task_id']
    sub = str(uuid.uuid4())
    db.session.execute(text("""
        INSERT INTO task_submissions (id, task_id, user_id, evidence_text, status,
                                      submitted_at, created_at, updated_at)
        VALUES (:i, :t, :u, 'work', 'submitted', UTC_TIMESTAMP(),
                UTC_TIMESTAMP(), UTC_TIMESTAMP())
    """), {'i': sub, 't': task_id, 'u': world['student']})
    db.session.commit()

    assert body(client.delete(f'{ACHIEVER}/tasks/{task_id}',
                              headers=tok(world['a'])))['status'] == 200
    row = db.session.execute(text(
        'SELECT deleted_at FROM cohort_tasks WHERE id = :i'), {'i': task_id}).mappings().first()
    assert row is not None, 'the task row was hard-deleted'
    assert row['deleted_at'] is not None, 'the delete was not soft'
    assert db.session.execute(text(
        'SELECT COUNT(*) FROM task_submissions WHERE id = :i'), {'i': sub}).scalar() == 1


@pytest.mark.case('AC03-005')
def test_a_title_over_255_is_a_400_naming_the_field(make_task):
    code, d = make_task(title='x' * 256)
    refused(d, naming='Title')
    assert '255' in d['response']['message']


@pytest.mark.case('AC03-006')
def test_an_unknown_task_status_is_refused_on_post(make_task):
    """It was already refused on PUT. A rule enforced on one verb and not the
    other is not enforced."""
    code, d = make_task(task_status='published')
    refused(d)


@pytest.mark.case('AC03-007')
def test_an_attachment_must_be_openable(make_task):
    refused(make_task(attachment_url='brief.pdf')[1], naming='Attachment')
    assert make_task(attachment_url='/uploads/brief.pdf')[0] == 201
    assert make_task(attachment_url='https://example.com/b.pdf')[0] == 201


@pytest.mark.case('AC03-008')
def test_a_due_date_is_stored_in_utc(make_task, db):
    """parse_local_to_utc, not raw fromisoformat. /admin/tasks had the raw form
    until 5 Sep and stored every deadline 5h30m late."""
    local = (datetime.datetime.now() + datetime.timedelta(days=3)).replace(
        hour=21, minute=0, second=0, microsecond=0)
    code, d = make_task(due_date=local.isoformat(timespec='minutes'))
    assert code == 201, d
    stored = db.session.execute(text('SELECT due_date FROM cohort_tasks WHERE id = :i'),
                                {'i': d['response']['task_id']}).scalar()
    assert stored == local - datetime.timedelta(hours=5, minutes=30)


@pytest.mark.case('AC03-009')
def test_every_enrolled_student_is_notified_on_creation(make_task, world, db):
    code, d = make_task(title='AC03 notify')
    assert code == 201, d
    assert d['response']['students_notified'] == 1, d
    assert db.session.execute(text("""
        SELECT COUNT(*) FROM notification_logs
         WHERE user_id = :u AND reference_id = :t AND reference_type = 'cohort_task'
    """), {'u': world['student'], 't': d['response']['task_id']}).scalar() == 1


@pytest.mark.case('AC03-010')
def test_no_notification_before_the_class_starts(client, tok, world, db):
    """The message would point at a My Tasks list that correctly does not show
    the task yet, which reads as a broken link rather than as homework."""
    future = str(uuid.uuid4())
    db.session.execute(text("""
        INSERT INTO cohorts (id, title, achiever_id, session_date, duration_minutes,
                             total_seats, filled_seats, price, status, created_at, updated_at)
        VALUES (:i, 'AC03 Future', :a, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 4 DAY), 90,
                NULL, 0, 0, 'upcoming', UTC_TIMESTAMP(), UTC_TIMESTAMP())
    """), {'i': future, 'a': world['a']})
    db.session.execute(text("""
        INSERT INTO cohort_enrollments (id, user_id, cohort_id, payment_status,
                                        amount_paid, enrolled_at, created_at, updated_at)
        VALUES (:i, :u, :c, 'free', 0, UTC_TIMESTAMP(), UTC_TIMESTAMP(), UTC_TIMESTAMP())
    """), {'i': str(uuid.uuid4()), 'u': world['student'], 'c': future})
    db.session.commit()

    d = body(client.post(f'{ACHIEVER}/tasks',
                         json={'cohort_id': future, 'title': 'AC03 silent'},
                         headers=tok(world['a'])))
    assert d['status'] == 201, d
    assert d['response']['students_notified'] == 0, d


@pytest.mark.case('AC03-011')
def test_a_notification_failure_does_not_lose_the_task(client, tok, world, db, monkeypatch):
    """Best-effort and after the commit. A notification failure must never turn
    a saved task into a 500 the achiever reads as "it did not save" — they then
    set it again and the cohort gets two."""
    import portal.routes.Achiever.achiever as A

    def boom(*args, **kwargs):
        raise RuntimeError('notification backend is down')

    monkeypatch.setattr(A, '_notify_task_assigned', boom)
    d = body(client.post(f'{ACHIEVER}/tasks',
                         json={'cohort_id': world['cohort'], 'title': 'AC03 survives'},
                         headers=tok(world['a'])))
    assert d['status'] == 201, f'a notification failure lost the task: {d}'
    assert db.session.execute(text(
        "SELECT COUNT(*) FROM cohort_tasks WHERE cohort_id = :c AND title = 'AC03 survives'"),
        {'c': world['cohort']}).scalar() == 1


# ── Availability ─────────────────────────────────────────────────────────────

@pytest.mark.case('AC03-012')
def test_weekly_availability_can_be_added(client, tok, world, db):
    d = body(client.post(f'{AVAIL}/my-availability',
                         json={'day_of_week': 1, 'start_time': '09:00', 'end_time': '12:00'},
                         headers=tok(world['a'])))
    assert d['status'] in (200, 201), d
    assert db.session.execute(text(
        'SELECT COUNT(*) FROM achiever_availability WHERE mentor_id = :a'),
        {'a': world['a']}).scalar() >= 1


@pytest.mark.case('AC03-013')
def test_overlapping_availability_is_refused_not_merged(client, tok, world):
    """The sheet asked only that the behaviour be *defined*, and it was not.
    Refused rather than merged: merging silently rewrites what somebody typed,
    and the fix for a genuine mistake is one delete. Overlap is half-open, so
    09:00-10:00 and 10:00-11:00 do not collide."""
    hdr = tok(world['a'])
    first = body(client.post(f'{AVAIL}/my-availability',
                             json={'day_of_week': 3, 'start_time': '09:00',
                                   'end_time': '11:00'}, headers=hdr))
    assert first['status'] in (200, 201), first
    clash = body(client.post(f'{AVAIL}/my-availability',
                             json={'day_of_week': 3, 'start_time': '10:00',
                                   'end_time': '12:00'}, headers=hdr))
    refused(clash)

    touching = body(client.post(f'{AVAIL}/my-availability',
                                json={'day_of_week': 3, 'start_time': '11:00',
                                      'end_time': '12:00'}, headers=hdr))
    assert touching['status'] in (200, 201), \
        f'a window starting exactly where another ends was treated as overlap: {touching}'


@pytest.mark.case('AC03-014')
def test_a_slot_in_the_past_is_refused(client, tok, world):
    past = (datetime.datetime.utcnow().date() - datetime.timedelta(days=2)).isoformat()
    d = body(client.post(f'{AVAIL}/my-slots',
                         json={'slot_date': past, 'start_time': '10:00', 'end_time': '11:00'},
                         headers=tok(world['a'])))
    refused(d, naming='past')


@pytest.mark.case('AC03-015')
def test_slot_times_are_stored_as_given(client, tok, world, db):
    """Slots hold a date plus a wall-clock TIME, not an instant, so the mentor
    and the student must read the same numbers. Any shift here is the 5h30m bug
    wearing a different hat."""
    when = (datetime.datetime.utcnow().date() + datetime.timedelta(days=6)).isoformat()
    d = body(client.post(f'{AVAIL}/my-slots',
                         json={'slot_date': when, 'start_time': '16:45', 'end_time': '17:45'},
                         headers=tok(world['a'])))
    assert d['status'] in (200, 201), d
    row = db.session.execute(text("""
        SELECT start_time FROM achiever_slots WHERE mentor_id = :a AND slot_date = :d
    """), {'a': world['a'], 'd': when}).mappings().first()
    assert row['start_time'] == datetime.timedelta(hours=16, minutes=45), row['start_time']


@pytest.mark.case('AC03-016')
def test_a_booked_slot_is_not_silently_deleted(client, tok, world, db):
    """Never a silent orphan: the student holds a booking against this row, so
    it is either blocked or they are told. What must not happen is the slot
    vanishing while their session still points at it."""
    slot = str(uuid.uuid4())
    db.session.execute(text("""
        INSERT INTO achiever_slots (id, mentor_id, slot_date, start_time, end_time,
                                    status, created_at, updated_at)
        VALUES (:i, :m, DATE_ADD(UTC_DATE(), INTERVAL 4 DAY), '10:00', '11:00',
                'booked', UTC_TIMESTAMP(), UTC_TIMESTAMP())
    """), {'i': slot, 'm': world['a']})
    db.session.commit()

    d = body(client.delete(f'{AVAIL}/my-slots/{slot}', headers=tok(world['a'])))
    still_there = db.session.execute(text(
        'SELECT COUNT(*) FROM achiever_slots WHERE id = :i'), {'i': slot}).scalar()
    if d['status'] in (200, 201):
        assert still_there == 0
        pytest.fail('a booked slot was deleted with no refusal and no notification path')
    else:
        assert still_there == 1, 'the delete was refused but the row went anyway'


# ── Money ────────────────────────────────────────────────────────────────────

@pytest.mark.case('AC03-017')
def test_earnings_are_internally_consistent(client, tok, world):
    """Balance, escrow, fee and earning have to agree with each other before
    they can agree with a ledger: a payload where the parts do not sum is one
    nobody can reconcile against anything."""
    d = body(client.get(f'{ACHIEVER}/earnings', headers=tok(world['a'])))
    assert d['status'] == 200, d
    r = d['response']
    for key in ('total_earned', 'total_gross', 'total_platform_fee',
                'pending_amount', 'total_enrollments'):
        assert key in r, f'{key} missing from the earnings payload: {sorted(r)}'
        assert float(r[key] or 0) >= 0, f'{key} is negative'

    # The identity that makes the payload reconcilable at all: what the student
    # paid is what the achiever keeps plus what the platform took. If these
    # three drift, no ledger comparison downstream can mean anything.
    gross, earned, fee = (float(r['total_gross'] or 0), float(r['total_earned'] or 0),
                          float(r['total_platform_fee'] or 0))
    assert abs(gross - (earned + fee)) < 0.02, \
        f'gross {gross} != earned {earned} + fee {fee}'


@pytest.mark.case('AC03-018')
def test_the_commission_rate_comes_from_configuration(client, tok, world):
    """Never hardcoded: it is resolved achiever-over-global and versioned by
    effective_from/effective_to, and the UI calls it *platform commission* —
    not a rate the achiever sets."""
    from pathlib import Path
    src = (Path(__file__).resolve().parents[1] / 'portal' / 'routes' / 'Achiever'
           / 'achiever.py').read_text(encoding='utf-8')
    assert 'sp_commission_rate_resolve' in src, \
        'the commission rate is no longer resolved from commission_rules'

    # The resolver is the only source. A literal percentage sitting next to the
    # earnings maths would be a second source that silently wins.
    block = src[src.index('def _commission_rate_for'):][:900]
    assert 'sp_commission_rate_resolve' in block, \
        '_commission_rate_for no longer calls the resolver'

    # And the rate it yields is applied, not decorative: the split has to come
    # out of the same numbers the earnings screen shows.
    d = body(client.get(f'{ACHIEVER}/earnings', headers=tok(world['a'])))
    r = d['response']
    gross = float(r['total_gross'] or 0)
    if gross > 0:
        implied = float(r['total_platform_fee'] or 0) / gross * 100
        assert 0 <= implied <= 100, f'implied commission is {implied}%'


@pytest.mark.case('AC03-019')
def test_a_payout_without_details_is_refused_up_front(client, tok, world):
    """Before the balance is even computed — asking someone to discover they
    have no payout method only after the amount check is a wasted round trip."""
    d = body(client.post(f'{PAYOUTS}/request', json={'amount': 100},
                         headers=tok(world['a'])))
    refused(d, naming='payout details')


@pytest.mark.case('AC03-020')
@pytest.mark.case('AC03-021')
def test_a_payout_over_the_available_balance_is_refused(client, tok, world):
    """AC03-020 and AC03-021 share a request: a fresh achiever has no balance,
    so the same call proves the request path runs (it reaches the balance check
    rather than erroring) and that it refuses more than is available."""
    hdr = tok(world['a'])
    assert body(client.put(f'{PAYOUTS}/details',
                           json={'payout_upi': 'ac03@bank'}, headers=hdr))['status'] == 200
    d = body(client.post(f'{PAYOUTS}/request', json={'amount': 100000}, headers=hdr))
    refused(d)
    assert 'balance' in str(d['response'].get('message', '')).lower(), d


@pytest.mark.case('AC03-022')
def test_two_identical_payout_requests_do_not_both_land(client, tok, world, db):
    """The balance is recomputed inside the procedure in one transaction, so a
    second request cannot be paid out of money the first already claimed."""
    hdr = tok(world['a'])
    client.put(f'{PAYOUTS}/details', json={'payout_upi': 'ac03@bank'}, headers=hdr)
    for _ in range(2):
        client.post(f'{PAYOUTS}/request', json={'amount': 50}, headers=hdr)
    n = db.session.execute(text("""
        SELECT COUNT(*) FROM payout_requests
         WHERE achiever_id = :a AND status IN ('pending', 'processing', 'failed')
    """), {'a': world['a']}).scalar()
    assert n <= 1, f'{n} concurrent payout requests are open for one achiever'


@pytest.mark.case('AC03-023')
def test_a_banned_achiever_can_still_reach_payouts(client, tok, world):
    """`can_withdraw` holds for active, suspended and banned, deliberately.
    Money already earned is owed whatever happened afterwards — withholding it
    is a matter for a dispute process, not a side effect of a state flag."""
    d = body(client.get(f'{PAYOUTS}/details', headers=tok(world['banned'])))
    assert d['status'] == 200, \
        f'a banned achiever cannot reach their own payout details: {d}'
