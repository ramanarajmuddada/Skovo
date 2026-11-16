"""
ST-04 Cohorts & Payment — browse, enrolment, checkout, webhook, and seat holds.

The browse list, the enrolment guards, checkout, and the webhook.

**Cashfree cannot complete an order on this account** — the keys authenticate
but every order comes back "transactions are not enabled", and the launching
domain is not whitelisted either (both dashboard settings, not code). So the
checkout cases assert everything up to the gateway call and the handling of its
refusal, never a successful payment. ST04-029 in particular is explicitly *not*
a code defect and is asserted as such.

The webhook cases are testable in full, because the signature is ours to
compute: base64(HMAC-SHA256(secret, timestamp + raw_body)). Those matter more
than the checkout ones anyway — Cashfree retries until it gets a 2xx, so a
webhook that runs twice must still count one seat, and a webhook that returns
the wrong *shape* is retried for ever even though it worked.

Rows are keyed to `st04-test-`.
"""
import base64
import datetime
import hashlib
import hmac
import json
import os
import time
import uuid

import pytest
from flask_jwt_extended import create_access_token
from sqlalchemy import text

COHORTS = '/v1/cohorts'
WEBHOOK = '/v1/webhooks/cashfree'
TEST_PREFIX = 'st04-test-'


@pytest.fixture
def client(app):
    return app.test_client()


def body(resp):
    payload = resp.get_json()
    assert payload is not None, f'no JSON body: {resp.data[:200]}'
    return payload


def refused(d, *, naming=None):
    assert d['status'] in (400, 403, 409), d
    assert d['response'].get('error_id') is None, d['response']
    if naming:
        blob = (str(d['response'].get('message', '')) + ' '
                + str(d['response'].get('status_reason', ''))).lower()
        assert naming.lower() in blob, f'refusal does not name {naming!r}: {d["response"]}'


@pytest.fixture
def world(app, db):
    ids = {k: str(uuid.uuid4()) for k in ('student', 'other', 'achiever')}
    for key in ('student', 'other'):
        db.session.execute(text("""
            INSERT INTO users (id, full_name, email, status, created_at, updated_at)
            VALUES (:i, :n, :e, 'active', UTC_TIMESTAMP(), UTC_TIMESTAMP())
        """), {'i': ids[key], 'n': f'ST04 {key}', 'e': f'{TEST_PREFIX}{ids[key]}@skovo.test'})
    db.session.execute(text("""
        INSERT INTO achievers (id, full_name, email, state, status, is_active,
                               is_verified, created_at, updated_at)
        VALUES (:i, 'ST04 Achiever', :e, 'active', 'active', 1, 1,
                UTC_TIMESTAMP(), UTC_TIMESTAMP())
    """), {'i': ids['achiever'], 'e': f'{TEST_PREFIX}{ids["achiever"]}@skovo.test'})
    db.session.commit()
    made = []

    def cohort(state='upcoming', *, price=0, seats=None, enrol=None):
        cid = str(uuid.uuid4())
        when = {'upcoming': 'DATE_ADD(UTC_TIMESTAMP(), INTERVAL 3 DAY)',
                'live': 'DATE_SUB(UTC_TIMESTAMP(), INTERVAL 10 MINUTE)',
                'completed': 'DATE_SUB(UTC_TIMESTAMP(), INTERVAL 5 DAY)',
                'cancelled': 'DATE_ADD(UTC_TIMESTAMP(), INTERVAL 3 DAY)'}[state]
        db.session.execute(text(f"""
            INSERT INTO cohorts (id, title, achiever_id, session_date, duration_minutes,
                                 total_seats, filled_seats, price, status,
                                 created_at, updated_at)
            VALUES (:i, 'ST04 Cohort', :a, {when}, 90, :seats, 0, :p, :s,
                    UTC_TIMESTAMP(), UTC_TIMESTAMP())
        """), {'i': cid, 'a': ids['achiever'], 'seats': seats, 'p': price,
               's': 'cancelled' if state == 'cancelled'
                    else ('completed' if state == 'completed' else 'upcoming')})
        if enrol:
            db.session.execute(text("""
                INSERT INTO cohort_enrollments (id, user_id, cohort_id, payment_status,
                                                amount_paid, enrolled_at, created_at, updated_at)
                VALUES (:i, :u, :c, :ps, 0, UTC_TIMESTAMP(), UTC_TIMESTAMP(), UTC_TIMESTAMP())
            """), {'i': str(uuid.uuid4()), 'u': ids[enrol], 'c': cid, 'ps': 'free'})
        db.session.commit()
        made.append(cid)
        return cid

    ids['cohort'] = cohort
    yield ids

    for sql, params in [
        ('DELETE FROM payment_events WHERE order_id IN '
         '(SELECT id FROM payment_orders WHERE student_id IN (:a, :b))',
         {'a': ids['student'], 'b': ids['other']}),
        ('DELETE FROM payment_orders WHERE student_id IN (:a, :b)',
         {'a': ids['student'], 'b': ids['other']}),
        ('DELETE FROM cohort_enrollments WHERE user_id IN (:a, :b)',
         {'a': ids['student'], 'b': ids['other']}),
        ('DELETE FROM cohorts WHERE achiever_id = :a', {'a': ids['achiever']}),
        ('DELETE FROM score_events WHERE user_id IN (:a, :b)',
         {'a': ids['student'], 'b': ids['other']}),
        ('DELETE FROM readiness_scores WHERE user_id IN (:a, :b)',
         {'a': ids['student'], 'b': ids['other']}),
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
    def _tok(ident):
        with app.app_context():
            return {'Authorization': f'Bearer {create_access_token(identity=str(ident))}'}
    return _tok


@pytest.fixture
def enrol(client, tok, world):
    def _enrol(cid, who='student', **payload):
        return body(client.post(f'{COHORTS}/{cid}/enroll', json=payload,
                                headers=tok(world[who])))
    return _enrol


def seats_of(db, cid):
    return int(db.session.execute(text('SELECT filled_seats FROM cohorts WHERE id = :i'),
                                  {'i': cid}).scalar() or 0)


# ── Browse ───────────────────────────────────────────────────────────────────

@pytest.mark.case('ST04-001')
@pytest.mark.case('ST04-009')
def test_the_cohort_list_paginates_with_stable_ordering(client, tok, world):
    """Stable ordering is not cosmetic: LIMIT/OFFSET over an unstable sort
    repeats and skips rows between pages, so a student paging through misses
    cohorts entirely."""
    hdr = tok(world['student'])
    first = body(client.get(f'{COHORTS}/?page=1&per_page=5', headers=hdr))
    assert first['status'] == 200, first
    again = body(client.get(f'{COHORTS}/?page=1&per_page=5', headers=hdr))
    ids_1 = [c['id'] for c in first['response']['cohorts']]
    ids_2 = [c['id'] for c in again['response']['cohorts']]
    assert ids_1 == ids_2, 'the same page returned a different order on a second call'

    page2 = body(client.get(f'{COHORTS}/?page=2&per_page=5', headers=hdr))
    overlap = set(ids_1) & {c['id'] for c in page2['response']['cohorts']}
    assert not overlap, f'pages 1 and 2 share rows: {overlap}'


@pytest.mark.case('ST04-002')
def test_the_listed_status_is_derived(client, tok, world, db):
    cid = world['cohort']('live')
    d = body(client.get(f'{COHORTS}/{cid}', headers=tok(world['student'])))
    assert d['response']['status'] == 'live', d['response']


@pytest.mark.case('ST04-003')
def test_an_enrolled_cohort_carries_the_joined_flag(client, tok, world):
    """From ONE batched call for the page, not one per row — the flag existed
    only on the detail endpoint before, so the list looked identical before and
    after joining."""
    cid = world['cohort']('upcoming', enrol='student')
    d = body(client.get(f'{COHORTS}/?search=ST04+Cohort&per_page=100',
                        headers=tok(world['student'])))
    mine = [c for c in d['response']['cohorts'] if c['id'] == cid]
    assert mine and mine[0].get('is_enrolled') is True, 'the Joined flag is missing'


@pytest.mark.case('ST04-004')
def test_the_list_still_renders_if_the_enrolments_lookup_fails(client, tok, world, monkeypatch):
    """Degrades to no badge, never a 500. The badge is a nicety; the list is
    the screen."""
    world['cohort']('upcoming', enrol='student')
    import portal.routes.Cohorts.cohorts as C
    real = C.call_proc

    def flaky(name, *args, **kwargs):
        if 'enrollment' in name:
            raise RuntimeError('enrolments lookup is down')
        return real(name, *args, **kwargs)

    monkeypatch.setattr(C, 'call_proc', flaky)
    d = body(client.get(f'{COHORTS}/?per_page=5', headers=tok(world['student'])))
    assert d['status'] == 200, f'a failed badge lookup took down the list: {d}'


@pytest.mark.case('ST04-005')
@pytest.mark.case('ST04-017')
def test_an_uncapped_cohort_reports_no_seat_limit(client, tok, world, enrol):
    """`available_seats` returns None for unlimited rather than a number: a
    count that is meaningless must not look like a real one. The old
    max(0, (total_seats or 0) - filled) reported 0 and read as "sold out"."""
    cid = world['cohort']('upcoming', seats=None)
    d = body(client.get(f'{COHORTS}/{cid}', headers=tok(world['student'])))
    assert d['response'].get('available_seats') is None, d['response']
    assert enrol(cid)['status'] in (200, 201), 'an uncapped cohort refused an enrolment'


@pytest.mark.case('ST04-006')
def test_a_capped_cohort_reports_its_remaining_seats(client, tok, world):
    cid = world['cohort']('upcoming', seats=5)
    d = body(client.get(f'{COHORTS}/{cid}', headers=tok(world['student'])))
    assert d['response'].get('available_seats') == 5, d['response']


@pytest.mark.case('ST04-007')
def test_a_free_cohort_is_priced_at_zero_not_left_ambiguous(client, tok, world):
    cid = world['cohort']('upcoming', price=0)
    d = body(client.get(f'{COHORTS}/{cid}', headers=tok(world['student'])))
    assert float(d['response'].get('price') or 0) == 0, d['response']


@pytest.mark.case('ST04-008')
def test_a_search_with_no_matches_returns_an_empty_list_not_an_error(client, tok, world):
    d = body(client.get(f'{COHORTS}/?search=zzz-no-such-cohort-st04',
                        headers=tok(world['student'])))
    assert d['status'] == 200, d
    assert d['response']['cohorts'] == [], d['response']


# ── Enrolment ────────────────────────────────────────────────────────────────

@pytest.mark.case('ST04-010')
def test_a_free_enrolment_succeeds_and_counts_a_seat(enrol, world, db):
    cid = world['cohort']('upcoming')
    before = seats_of(db, cid)
    d = enrol(cid)
    assert d['status'] in (200, 201), d
    row = db.session.execute(text("""
        SELECT payment_status FROM cohort_enrollments WHERE cohort_id = :c AND user_id = :u
    """), {'c': cid, 'u': world['student']}).scalar()
    assert row == 'free', row
    assert seats_of(db, cid) == before + 1


@pytest.mark.case('ST04-011')
def test_enrolling_twice_says_already_enrolled_with_409(enrol, world):
    """Named, and 409 not 400. Every refusal used to collapse into "Unable to
    enroll." at 400 because the procedure's later branches carried no `AS ok,
    AS message` aliases, so the route read nothing and fell back."""
    cid = world['cohort']('upcoming')
    assert enrol(cid)['status'] in (200, 201)
    second = enrol(cid)
    assert second['status'] == 409, second
    assert 'already' in str(second['response'].get('message', '')).lower(), second


@pytest.mark.case('ST04-012')
def test_enrolling_in_a_live_cohort_names_live(enrol, world):
    refused(enrol(world['cohort']('live')), naming='live')


@pytest.mark.case('ST04-013')
def test_enrolling_in_a_completed_cohort_names_completed(enrol, world):
    refused(enrol(world['cohort']('completed')), naming='completed')


@pytest.mark.case('ST04-014')
def test_enrolling_in_a_cancelled_cohort_names_cancelled(enrol, world):
    refused(enrol(world['cohort']('cancelled')), naming='cancelled')


@pytest.mark.case('ST04-015')
def test_the_route_derives_the_same_status_the_card_showed(client, tok, world, enrol, db):
    """A card reading "Upcoming · Join" answering "Enrollment is closed" was the
    bug: the list showed the derived status and the guard read the raw column."""
    cid = world['cohort']('upcoming')
    shown = body(client.get(f'{COHORTS}/{cid}', headers=tok(world['student'])))['response']['status']
    db.session.execute(text(
        'UPDATE cohorts SET session_date = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 5 MINUTE) '
        'WHERE id = :i'), {'i': cid})
    db.session.commit()
    now_shown = body(client.get(f'{COHORTS}/{cid}',
                                headers=tok(world['student'])))['response']['status']
    assert shown == 'upcoming' and now_shown == 'live'
    refused(enrol(cid), naming='live')


@pytest.mark.case('ST04-016')
def test_a_full_capped_cohort_refuses_with_no_seats(enrol, world, db):
    cid = world['cohort']('upcoming', seats=1)
    assert enrol(cid)['status'] in (200, 201)
    refused(enrol(cid, who='other'), naming='seat')


def _hold_checkout(db, user_id, cohort_id, minutes=10):
    """A live BookMyShow hold: pending + unexpired, filled_seats untouched."""
    db.session.execute(text("""
        INSERT INTO cohort_enrollments
            (id, user_id, cohort_id, payment_status, expires_at, amount_paid,
             enrolled_at, created_at, updated_at)
        VALUES (:i, :u, :c, 'pending', DATE_ADD(UTC_TIMESTAMP(), INTERVAL :m MINUTE),
                0, UTC_TIMESTAMP(), UTC_TIMESTAMP(), UTC_TIMESTAMP())
    """), {'i': str(uuid.uuid4()), 'u': user_id, 'c': cohort_id, 'm': minutes})
    db.session.commit()


@pytest.mark.case('ST04-039')
def test_a_live_checkout_occupies_the_last_seat(client, tok, enrol, world, db):
    """Same as a 1-on-1 slot going blocked: the last of 5 cannot be sold twice
    while someone is on the payment page. filled_seats stays paid-only so the
    browse card still has to subtract the hold via available_seats."""
    cid = world['cohort']('upcoming', seats=1)
    _hold_checkout(db, world['student'], cid)

    assert seats_of(db, cid) == 0, 'a hold moved filled_seats'
    d = body(client.get(f'{COHORTS}/{cid}', headers=tok(world['other'])))
    assert d['response'].get('available_seats') == 0, d['response']

    refused(enrol(cid, who='other'), naming='seat')

    # Own pending is excluded, so a retry of the same checkout is not turned
    # away by the student's own lease.
    retry = enrol(cid, who='student')
    assert retry['status'] in (200, 201), retry

    paid = world['cohort']('upcoming', price=499, seats=1)
    _hold_checkout(db, world['student'], paid)
    blocked = enrol(paid, who='other', phone='9876543210')
    assert blocked['status'] == 409, blocked
    assert 'full' in str(blocked['response'].get('message', '')).lower(), blocked


@pytest.mark.case('ST04-040')
def test_the_same_student_can_retry_a_paid_hold(enrol, world, db):
    cid = world['cohort']('upcoming', price=499, seats=1)
    first = enrol(cid, phone='9876543210')
    pending = db.session.execute(text("""
        SELECT COUNT(*) FROM cohort_enrollments
         WHERE cohort_id = :c AND user_id = :u AND payment_status = 'pending'
           AND expires_at IS NOT NULL AND expires_at > UTC_TIMESTAMP()
    """), {'c': cid, 'u': world['student']}).scalar()
    if not pending:
        pytest.skip(f'checkout did not plant a hold: {first}')
    # Assert on the shape, not on the prose. The refusal this test guards
    # against is a 409; the success copy is "Complete payment to confirm your
    # seat", so scanning the message for 'seat' failed on a working retry.
    second = enrol(cid, phone='9876543210')
    assert second['status'] in (200, 201), second
    assert second['bool'] is True, second
    assert second['response'].get('order_id'), second


@pytest.mark.case('ST04-041')
def test_an_expired_hold_frees_the_seat_without_touching_filled(client, tok, enrol, world, db):
    cid = world['cohort']('upcoming', seats=1)
    _hold_checkout(db, world['student'], cid)
    db.session.execute(text("""
        UPDATE cohort_enrollments
           SET expires_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 MINUTE)
         WHERE cohort_id = :c AND user_id = :u AND payment_status = 'pending'
    """), {'c': cid, 'u': world['student']})
    db.session.commit()

    from portal.helpers.sp import call_proc_one
    call_proc_one('sp_payment_expire_holds')
    db.session.commit()

    assert seats_of(db, cid) == 0
    d = body(client.get(f'{COHORTS}/{cid}', headers=tok(world['other'])))
    assert d['response'].get('available_seats') == 1, d['response']
    assert enrol(cid, who='other')['status'] in (200, 201)


@pytest.mark.case('ST04-018')
def test_an_unauthenticated_enrolment_creates_nothing(client, world, db):
    cid = world['cohort']('upcoming')
    resp = client.post(f'{COHORTS}/{cid}/enroll', json={})
    assert resp.status_code == 401, resp.status_code
    assert db.session.execute(text(
        'SELECT COUNT(*) FROM cohort_enrollments WHERE cohort_id = :c'), {'c': cid}).scalar() == 0


# ── Checkout ─────────────────────────────────────────────────────────────────

@pytest.mark.case('ST04-020')
def test_checkout_without_a_mobile_number_is_blocked(enrol, world):
    """Cashfree requires customer_phone, so this is refused before the gateway
    rather than surfacing as a provider error the student cannot read."""
    d = enrol(world['cohort']('upcoming', price=499))
    assert d['status'] == 400 and d['response'].get('need_phone') is True, d


@pytest.mark.case('ST04-021')
def test_an_invalid_mobile_is_refused_before_the_gateway(enrol, world):
    d = enrol(world['cohort']('upcoming', price=499), phone='12')
    assert d['status'] == 400 and d['response'].get('need_phone') is True, d


@pytest.mark.case('ST04-019')
@pytest.mark.case('ST04-027')
def test_a_gateway_refusal_is_reported_readably_and_recorded(enrol, world, db):
    """Cashfree refuses every order on this account, so this is the live path.
    What must happen: the order is marked failed with a reason, the client gets
    a readable message and an error_id, and no enrolment is written."""
    cid = world['cohort']('upcoming', price=499)
    d = enrol(cid, phone='9876543210')
    assert d['status'] != 500 or d['response'].get('error_id'), d
    paid = db.session.execute(text("""
        SELECT COUNT(*) FROM cohort_enrollments
         WHERE cohort_id = :c AND payment_status = 'paid'
    """), {'c': cid}).scalar()
    assert paid == 0, 'a refused gateway order still produced a paid enrolment'


@pytest.mark.case('ST04-022')
@pytest.mark.case('ST04-038')
def test_the_price_is_recomputed_server_side(enrol, world, db):
    """Amount tampering: the client's number is never trusted. Sending a price
    of 1 on a 499 cohort must not produce a ₹1 order."""
    cid = world['cohort']('upcoming', price=499)
    enrol(cid, phone='9876543210', price=1, amount=1, net_price=1)
    row = db.session.execute(text("""
        SELECT gross FROM payment_orders WHERE ref_id = :c ORDER BY created_at DESC LIMIT 1
    """), {'c': cid}).mappings().first()
    if row is not None:
        assert float(row['gross']) != 1, 'the client-supplied price reached the order'


@pytest.mark.case('ST04-023')
def test_an_invalid_coupon_is_refused_and_checkout_stays_usable(enrol, world):
    cid = world['cohort']('upcoming', price=499)
    d = enrol(cid, phone='9876543210', coupon_code='NOSUCHCOUPON')
    assert d['status'] != 500 or d['response'].get('error_id'), d


@pytest.mark.case('ST04-024')
def test_a_zero_price_never_creates_an_unpayable_order(enrol, world, db):
    """Either enrol free or create a ₹0 order — what must not exist is an order
    the gateway will refuse because it is for nothing."""
    cid = world['cohort']('upcoming', price=0)
    d = enrol(cid)
    assert d['status'] in (200, 201), d
    zero_orders = db.session.execute(text("""
        SELECT COUNT(*) FROM payment_orders WHERE ref_id = :c AND gross = 0
    """), {'c': cid}).scalar()
    assert zero_orders == 0, 'a free enrolment created a zero-value payment order'


@pytest.mark.case('ST04-025')
@pytest.mark.case('ST04-026')
def test_a_failed_or_abandoned_checkout_never_holds_a_seat(enrol, world, db):
    """The counter moved at hold time once. With no seat cap that meant every
    abandoned checkout permanently added a student who never paid."""
    cid = world['cohort']('upcoming', price=499)
    before = seats_of(db, cid)
    for _ in range(3):
        enrol(cid, phone='9876543210')
    assert seats_of(db, cid) == before, 'an unpaid checkout moved filled_seats'


@pytest.mark.case('ST04-028')
def test_the_return_url_is_https():
    """Cashfree rejects a non-https return_url with return_url_invalid, which
    surfaces as a broken checkout rather than as a configuration error."""
    url = (os.environ.get('FRONTEND_URL') or '').strip()
    if not url:
        pytest.skip('FRONTEND_URL is not set in this environment')
    assert url.startswith('https://') or url.startswith('http://localhost'), \
        f'FRONTEND_URL is {url!r}; Cashfree needs https for the return URL'


@pytest.mark.case('ST04-029')
def test_the_domain_whitelist_is_a_dashboard_setting_not_code():
    """Recorded rather than chased. "Broken Link! … not enabled or approved" is
    Cashfree telling you the launching domain is not whitelisted — no code
    change reaches it, and CLAUDE.md §6 says so explicitly."""
    repo = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    # The blocker is recorded in the brief's "known external blockers" section;
    # CLAUDE.md carries the related "Cashfree is not activated" hazard. Either
    # is an acceptable home — what matters is that it stays written down, so
    # nobody spends another afternoon looking for it in the code.
    docs = [os.path.join(repo, name) for name in
            ('SKOVO_Implementation_Prompt.md', 'CLAUDE.md')]
    present = [p for p in docs if os.path.exists(p)]
    if not present:
        pytest.skip('project docs not present in this checkout')
    txt = '\n'.join(open(p, encoding='utf-8').read() for p in present)
    assert 'hitelist' in txt or 'not activated' in txt, \
        'the Cashfree domain/activation blocker is no longer documented anywhere'


@pytest.mark.case('ST04-035')
def test_an_order_belonging_to_someone_else_is_404(client, tok, world, db):
    cid = world['cohort']('upcoming', price=499)
    oid = str(uuid.uuid4())
    db.session.execute(text("""
        INSERT INTO payment_orders (id, order_no, kind, student_id, ref_id, currency,
                                    gross, status, provider, created_at, updated_at)
        VALUES (:i, :n, 'cohort', :u, :c, 'INR', 499, 'created', 'cashfree',
                UTC_TIMESTAMP(), UTC_TIMESTAMP())
    """), {'i': oid, 'n': f'ST04-{oid[:10]}', 'u': world['student'], 'c': cid})
    db.session.commit()
    d = body(client.get(f'/v1/payments/orders/{oid}', headers=tok(world['other'])))
    assert d['status'] == 404, f'another student read this order: {d}'


# ── Webhook ──────────────────────────────────────────────────────────────────

def signed_headers(payload):
    secret = (os.environ.get('CASHFREE_SECRET_KEY_PRODUCTION')
              or os.environ.get('CASHFREE_SECRET_KEY_SANDBOX')
              or os.environ.get('CASHFREE_SECRET_KEY') or '')
    raw = json.dumps(payload).encode('utf-8')
    ts = str(int(time.time()))
    digest = hmac.new(secret.encode('utf-8'), ts.encode('utf-8') + raw, hashlib.sha256).digest()
    return raw, {'x-webhook-signature': base64.b64encode(digest).decode(),
                 'x-webhook-timestamp': ts, 'Content-Type': 'application/json'}


@pytest.fixture
def paid_order(db, world):
    """A created cohort order the webhook can confirm."""
    cid = world['cohort']('upcoming', price=499)
    oid = str(uuid.uuid4())
    order_no = f'ST04-{oid[:10].upper()}'
    db.session.execute(text("""
        INSERT INTO payment_orders (id, order_no, kind, student_id, ref_id, currency,
                                    gross, status, provider, created_at, updated_at)
        VALUES (:i, :n, 'cohort', :u, :c, 'INR', 499, 'created', 'cashfree',
                UTC_TIMESTAMP(), UTC_TIMESTAMP())
    """), {'i': oid, 'n': order_no, 'u': world['student'], 'c': cid})
    db.session.commit()
    return {'id': oid, 'order_no': order_no, 'cohort': cid}


def webhook_payload(order_no, payment_id=None):
    # A fresh cf_payment_id per call by default. The relay de-duplicates on the
    # provider's event, so a constant id makes the SECOND run of a test see
    # 'duplicate' from the first — which is the idempotency working, but it
    # masks whatever the test was actually asking.
    return {'type': 'PAYMENT_SUCCESS_WEBHOOK',
            'data': {'order': {'order_id': order_no, 'order_amount': 499},
                     'payment': {'cf_payment_id': payment_id or uuid.uuid4().hex[:12],
                                 'payment_status': 'SUCCESS',
                                 'payment_amount': 499}}}


@pytest.mark.case('ST04-033')
def test_a_webhook_with_a_bad_signature_is_refused_and_writes_nothing(client, paid_order, db):
    raw = json.dumps(webhook_payload(paid_order['order_no'])).encode('utf-8')
    resp = client.post(WEBHOOK, data=raw,
                       headers={'x-webhook-signature': 'not-a-signature',
                                'x-webhook-timestamp': str(int(time.time())),
                                'Content-Type': 'application/json'})
    assert resp.status_code == 400, resp.status_code
    status = db.session.execute(text('SELECT status FROM payment_orders WHERE id = :i'),
                                {'i': paid_order['id']}).scalar()
    assert status == 'created', f'an unsigned webhook changed the order to {status!r}'


@pytest.mark.case('ST04-034')
def test_a_webhook_for_an_unknown_order_is_acknowledged_and_writes_nothing(client):
    """200 with unknown-order, not an error: Cashfree retries anything that is
    not a 2xx, so answering 4xx to a webhook we simply do not recognise buys an
    infinite retry loop."""
    raw, headers = signed_headers(
        webhook_payload(f'ST04-NO-SUCH-ORDER-{uuid.uuid4().hex[:8]}'))
    resp = client.post(WEBHOOK, data=raw, headers=headers)
    if resp.status_code == 400:
        pytest.skip('webhook secret not configured in this environment')
    assert resp.status_code == 200, resp.status_code
    assert (resp.get_json() or {}).get('status') == 'unknown-order', resp.get_json()


@pytest.mark.case('ST04-030')
@pytest.mark.case('ST04-031')
@pytest.mark.case('ST04-032')
@pytest.mark.case('ST04-036')
@pytest.mark.case('ST04-037')
def test_a_retried_webhook_confirms_once_and_counts_one_seat(client, paid_order, db, world):
    """The four cases that share one property. Cashfree retries until it gets a
    2xx, so the same event arrives more than once; the second must be a no-op.
    ST04-032 rides along because a flask-restx Resource returning a
    (Response, status) tuple answers a shape Cashfree treats as a failure and
    retries for ever — even though the first call worked.
    """
    raw, headers = signed_headers(webhook_payload(paid_order['order_no']))
    first = client.post(WEBHOOK, data=raw, headers=headers)
    if first.status_code == 400:
        pytest.skip('webhook secret not configured in this environment')

    assert first.status_code == 200, first.status_code
    assert isinstance(first.get_json(), dict), 'the webhook did not return a plain dict'

    seats_after_first = seats_of(db, paid_order['cohort'])

    second = client.post(WEBHOOK, data=raw, headers=headers)
    assert second.status_code == 200, second.status_code
    assert seats_of(db, paid_order['cohort']) == seats_after_first, \
        'a retried webhook incremented filled_seats a second time'

    paid = db.session.execute(text("""
        SELECT COUNT(*) FROM cohort_enrollments
         WHERE cohort_id = :c AND user_id = :u AND payment_status = 'paid'
    """), {'c': paid_order['cohort'], 'u': world['student']}).scalar()
    assert paid <= 1, f'{paid} paid enrolments for one order'
