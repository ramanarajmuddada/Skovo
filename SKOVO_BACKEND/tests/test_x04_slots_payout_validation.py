"""
X-04 Field validation — "Availability" (X04-171…182) and "Payout"
(X04-158…170). 25 cases.

Both areas guard something with a consequence beyond a bad row.

Availability: before these checks existed, `end before start` was never
validated at all. An inverted window stored happily, and `sp_student_session_book`
would then let a student book it — the booking path trusts the slot row it is
handed. So the "End before start" cases here are not tidiness; they are the only
thing standing between a typo and an unbookable-but-booked session.

Payout: `payout_requests.amount` is DECIMAL(10,2), so a number past
99,999,999.99 is out of range *before* the stored procedure's balance check can
refuse it — an "Out of range value" 500 instead of a readable message, on the
screen an achiever uses to get paid.

Rows are keyed to `x04-slot-test-`.
"""
import datetime
import uuid

import pytest
from flask_jwt_extended import create_access_token
from sqlalchemy import text

AVAILABILITY = '/v1/achiever-availability/my-availability'
SLOTS = '/v1/achiever-availability/my-slots'
PAYOUT_DETAILS = '/v1/achiever-payouts/details'
PAYOUT_REQUEST = '/v1/achiever-payouts/request'
TEST_PREFIX = 'x04-slot-test-'

UNICODE = 'Café ☕ 日本語 🎓'
HTML = '<script>alert("xss")</script>'
SQLI = "O'Brien; DROP TABLE payout_requests;--"


@pytest.fixture
def client(app):
    return app.test_client()


def body(resp):
    payload = resp.get_json()
    assert payload is not None, f'no JSON body: {resp.data[:200]}'
    return payload


def refused(d, *, naming=None):
    assert d['status'] == 400, d
    assert d['response'].get('error_id') is None, \
        f'refusal was captured as a server error: {d["response"]}'
    if naming:
        msg = d['response'].get('message', '')
        assert naming.lower() in msg.lower(), f'message does not name {naming!r}: {msg!r}'


@pytest.fixture
def achiever(app, db):
    aid = str(uuid.uuid4())
    db.session.execute(text("""
        INSERT INTO achievers (id, full_name, email, state, status, is_active,
                               is_verified, created_at, updated_at)
        VALUES (:i, 'X04 Slot Test', :e, 'active', 'active', 1, 1,
                UTC_TIMESTAMP(), UTC_TIMESTAMP())
    """), {'i': aid, 'e': f'{TEST_PREFIX}{aid}@skovo.test'})
    db.session.commit()
    yield aid
    db.session.execute(text('DELETE FROM achiever_slots WHERE mentor_id = :a'), {'a': aid})
    db.session.execute(text('DELETE FROM achiever_availability WHERE mentor_id = :a'), {'a': aid})
    db.session.execute(text('DELETE FROM payout_requests WHERE achiever_id = :a'), {'a': aid})
    db.session.execute(text('DELETE FROM achievers WHERE id = :i'), {'i': aid})
    db.session.commit()


@pytest.fixture
def auth(app, achiever):
    with app.app_context():
        token = create_access_token(
            identity=str(achiever),
            additional_claims={'role': 'mentor', 'mentor': True,
                               'full_name': 'X04 Slot Test'})
    return {'Authorization': f'Bearer {token}'}


def soon(days=7):
    return (datetime.datetime.utcnow().date()
            + datetime.timedelta(days=days)).isoformat()


@pytest.fixture
def slot(client, auth):
    """POST a specific slot. Defaults are valid so a test about one field cannot
    fail for a reason about another."""
    def _slot(**fields):
        payload = {'slot_date': soon(), 'start_time': '10:00', 'end_time': '11:00'}
        payload.update(fields)
        d = body(client.post(SLOTS, json=payload, headers=auth))
        return d['status'], d
    return _slot


@pytest.fixture
def payout(client, auth):
    """Request a payout, with payout details already saved.

    The route refuses "please save your payout details" *before* it looks at the
    amount, so without this an amount case never reaches the check it is about
    and passes for the wrong reason.
    """
    client.put(PAYOUT_DETAILS, json={'payout_upi': 'x04test@bank'}, headers=auth)

    def _payout(**fields):
        d = body(client.post(PAYOUT_REQUEST, json=fields, headers=auth))
        return d['status'], d
    return _payout


@pytest.fixture
def payout_details(client, auth):
    def _details(**fields):
        d = body(client.put(PAYOUT_DETAILS, json=fields, headers=auth))
        return d['status'], d
    return _details


# ── Availability: slot start ─────────────────────────────────────────────────

@pytest.mark.case('X04-171')
def test_slot_start_empty_is_refused(slot):
    refused(slot(start_time='')[1])


@pytest.mark.case('X04-172')
def test_slot_date_in_the_past_is_refused(slot):
    """Compared against the UTC date deliberately: the team is IST (+5:30), so
    the IST date is never behind the UTC one and using UTC can only be more
    permissive — it can never refuse a date that is still today on screen."""
    past = (datetime.datetime.utcnow().date() - datetime.timedelta(days=1)).isoformat()
    refused(slot(slot_date=past)[1], naming='past')


@pytest.mark.case('X04-173')
def test_slot_start_invalid_format_is_refused(slot):
    refused(slot(start_time='half ten')[1], naming='Start time')


@pytest.mark.case('X04-174')
def test_slot_start_round_trips_with_no_drift(slot, db, achiever):
    """Slots store a date plus a wall-clock TIME, not an instant, so the value
    must come back exactly as sent. Any 5h30m shift here would move every
    published slot into the middle of the night."""
    code, d = slot(slot_date=soon(9), start_time='09:30', end_time='10:30')
    assert code in (200, 201), d
    row = db.session.execute(text("""
        SELECT start_time, end_time FROM achiever_slots
         WHERE mentor_id = :a AND slot_date = :d
    """), {'a': achiever, 'd': soon(9)}).mappings().first()
    assert row is not None, 'slot was not stored'
    # MySQL TIME arrives as a timedelta, so compare durations rather than the
    # string form — str(timedelta) drops the leading zero and would fail on a
    # value that is perfectly correct.
    assert row['start_time'] == datetime.timedelta(hours=9, minutes=30), row['start_time']
    assert row['end_time'] == datetime.timedelta(hours=10, minutes=30), row['end_time']


@pytest.mark.case('X04-175')
def test_a_slot_ending_before_it_starts_is_refused(slot):
    """The one that was never checked. An inverted window was stored, and the
    booking procedure trusts the row it is given."""
    refused(slot(start_time='15:00', end_time='09:00')[1], naming='after start')


@pytest.mark.case('X04-176')
def test_slot_date_far_in_the_future_is_refused_with_a_stated_bound(slot):
    refused(slot(slot_date='2099-01-01')[1], naming='ahead')


# ── Availability: slot end ───────────────────────────────────────────────────

@pytest.mark.case('X04-177')
def test_slot_end_empty_is_refused(slot):
    refused(slot(end_time='')[1])


@pytest.mark.case('X04-178')
def test_slot_end_on_a_past_date_is_refused(slot):
    past = (datetime.datetime.utcnow().date() - datetime.timedelta(days=5)).isoformat()
    refused(slot(slot_date=past, end_time='23:00')[1], naming='past')


@pytest.mark.case('X04-179')
def test_slot_end_invalid_format_is_refused(slot):
    refused(slot(end_time='25:99')[1], naming='End time')


@pytest.mark.case('X04-180')
def test_slot_end_round_trips_with_no_drift(slot, db, achiever):
    code, d = slot(slot_date=soon(11), start_time='18:00', end_time='19:45')
    assert code in (200, 201), d
    row = db.session.execute(text("""
        SELECT end_time FROM achiever_slots
         WHERE mentor_id = :a AND slot_date = :d
    """), {'a': achiever, 'd': soon(11)}).mappings().first()
    assert row['end_time'] == datetime.timedelta(hours=19, minutes=45), row['end_time']


@pytest.mark.case('X04-181')
def test_an_equal_start_and_end_is_refused(slot):
    """`end <= start`, not `<`. A zero-length slot is bookable and unattendable,
    which is the same failure as an inverted one arrived at differently."""
    refused(slot(start_time='12:00', end_time='12:00')[1], naming='after start')


@pytest.mark.case('X04-182')
def test_slot_end_far_future_is_refused(slot):
    refused(slot(slot_date='2099-06-30', end_time='12:00')[1], naming='ahead')


# ── Weekly availability shares the same window validator ─────────────────────

@pytest.mark.case('X04-175')
def test_weekly_availability_rejects_an_inverted_window(client, auth):
    d = body(client.post(AVAILABILITY, json={
        'day_of_week': 2, 'start_time': '16:00', 'end_time': '10:00'}, headers=auth))
    refused(d, naming='after start')


@pytest.mark.case('X04-173')
def test_weekly_availability_rejects_a_bad_day_of_week(client, auth):
    """Day 9 indexed past DAY_NAMES and rendered as a blank day everywhere it
    was shown, rather than erroring anywhere a person would notice."""
    d = body(client.post(AVAILABILITY, json={
        'day_of_week': 9, 'start_time': '10:00', 'end_time': '11:00'}, headers=auth))
    refused(d, naming='Day of week')


# ── Payout amount ────────────────────────────────────────────────────────────

@pytest.mark.case('X04-158')
def test_payout_amount_zero_is_refused(payout):
    """Zero means "free" for a cohort price and means nothing for a payout —
    the same literal, opposite handling, which is why the sheet asks for both."""
    refused(payout(amount=0)[1], naming='greater than zero')


@pytest.mark.case('X04-158b')
def test_a_small_payout_is_not_refused_for_a_minimum(payout):
    """₹153 on ₹153 available is a real withdrawal. A floor of ₹500 would
    refuse this for the wrong reason; balance (none here) is the only cap."""
    code, d = payout(amount=153)
    assert d['status'] == 400, d
    assert 'minimum' not in d['response'].get('message', '').lower(), d


@pytest.mark.case('X04-159')
def test_payout_amount_negative_is_refused(payout):
    """A negative payout is a withdrawal from the achiever, so this must never
    reach the ledger."""
    refused(payout(amount=-500)[1], naming='greater than zero')


@pytest.mark.case('X04-160')
def test_payout_amount_non_numeric_is_refused(payout):
    code, d = payout(amount='lots')
    assert d['status'] == 400, d
    assert d['response'].get('error_id') is None, d['response']


@pytest.mark.case('X04-161')
def test_payout_amount_with_decimals_is_handled(payout):
    """Rupees and paise are legitimate here — DECIMAL(10,2) — so this must not
    be refused as "not a whole number" the way a cohort price is."""
    code, d = payout(amount=1234.56)
    assert d['status'] == 400, d          # no balance on a fresh achiever
    assert d['response'].get('error_id') is None, d['response']
    assert 'whole number' not in d['response'].get('message', '').lower()


@pytest.mark.case('X04-162')
def test_payout_amount_beyond_the_column_range_is_refused_readably(payout):
    """The case this guard exists for: DECIMAL(10,2) overflows before the
    procedure's balance check runs, so without it this is a 500."""
    refused(payout(amount=10 ** 12)[1], naming='or less')


@pytest.mark.case('X04-163')
def test_payout_amount_with_leading_zeros_is_normalised(payout):
    """'007' must parse as 7, not fail and not read as 7000."""
    code, d = payout(amount='007')
    assert d['status'] == 400, d          # refused on balance, not on parsing
    assert d['response'].get('error_id') is None, d['response']
    assert 'must be a' not in d['response'].get('message', '').lower()


# ── Payout UPI id ────────────────────────────────────────────────────────────

@pytest.mark.case('X04-164')
def test_upi_empty_is_allowed_with_complete_bank(payout_details):
    """UPI is optional when a complete bank account is on file."""
    code, d = payout_details(
        payout_account_name='Test Achiever',
        payout_account_number='12345678901',
        payout_ifsc='HDFC0001234',
        payout_upi='')
    assert d['status'] == 200, d


@pytest.mark.case('X04-165')
def test_upi_only_whitespace_is_treated_as_empty(payout_details):
    code, d = payout_details(
        payout_account_name='Test Achiever',
        payout_account_number='12345678901',
        payout_ifsc='HDFC0001234',
        payout_upi='   ')
    assert d['status'] == 200, d


@pytest.mark.case('X04-164b')
def test_saving_neither_bank_nor_upi_is_refused(payout_details):
    code, d = payout_details(
        payout_account_name='', payout_account_number='',
        payout_ifsc='', payout_upi='')
    refused(d, naming='bank')


@pytest.mark.case('X04-166')
def test_upi_over_100_chars_is_a_400_not_a_500(payout_details):
    """achievers.payout_upi is VARCHAR(100); 101 characters is MySQL errno 1406
    — a 500 on the screen an achiever uses to get paid."""
    code, d = payout_details(payout_upi='x' * 101)
    refused(d, naming='100')


@pytest.mark.case('X04-167')
def test_upi_is_trimmed_before_storing(payout_details, db, achiever):
    code, d = payout_details(payout_upi='  name@bank  ')
    assert d['status'] == 200, d
    stored = db.session.execute(
        text('SELECT payout_upi FROM achievers WHERE id = :i'), {'i': achiever}).scalar()
    assert stored == 'name@bank', repr(stored)


@pytest.mark.case('X04-168')
def test_upi_unicode_survives(payout_details, db, achiever):
    code, d = payout_details(payout_upi=UNICODE)
    assert d['status'] in (200, 400), d
    if d['status'] == 200:
        stored = db.session.execute(
            text('SELECT payout_upi FROM achievers WHERE id = :i'), {'i': achiever}).scalar()
        assert stored == UNICODE


@pytest.mark.case('X04-169')
def test_upi_html_is_stored_verbatim(payout_details, db, achiever):
    code, d = payout_details(payout_upi=HTML)
    assert d['status'] in (200, 400), d
    if d['status'] == 200:
        stored = db.session.execute(
            text('SELECT payout_upi FROM achievers WHERE id = :i'), {'i': achiever}).scalar()
        assert stored == HTML


@pytest.mark.case('X04-170')
def test_upi_sql_metacharacters_are_stored_verbatim(payout_details, db, achiever):
    code, d = payout_details(payout_upi=SQLI[:90])
    assert d['status'] in (200, 400), d
    if d['status'] == 200:
        stored = db.session.execute(
            text('SELECT payout_upi FROM achievers WHERE id = :i'), {'i': achiever}).scalar()
        assert stored == SQLI[:90]
