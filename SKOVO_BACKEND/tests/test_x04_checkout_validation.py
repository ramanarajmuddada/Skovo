"""
X-04 Field validation — "Checkout" (X04-136…147). 12 cases.

Mobile number and coupon code on `POST /v1/cohorts/<id>/enroll`.

**Cashfree is not able to complete an order on this account** — the live keys
authenticate but every order comes back "transactions are not enabled for your
payment gateway account", which CLAUDE.md records as a KYC/activation step and
explicitly not a code bug. That does not block these cases, because both fields
are validated *before* the gateway is called. It does shape the assertions: a
valid phone cannot be proven by "the payment succeeded", only by "the request
got past the phone check and failed later, at the gateway". Asserting success
here would be asserting something no one can make true today.

Every attempt that reaches `sp_payment_cohort_hold` writes a payment_orders row
and an enrolment hold, so teardown removes both.

Rows are keyed to `x04-checkout-test-`.
"""
import uuid

import pytest
from flask_jwt_extended import create_access_token
from sqlalchemy import text

TEST_PREFIX = 'x04-checkout-test-'

UNICODE = 'CAFÉ☕2024'
HTML = '<script>alert(1)</script>'
SQLI = "SAVE10' OR '1'='1"


@pytest.fixture
def client(app):
    return app.test_client()


def body(resp):
    payload = resp.get_json()
    assert payload is not None, f'no JSON body: {resp.data[:200]}'
    return payload


def never_a_500(d):
    assert d['status'] != 500, d
    assert d['response'].get('error_id') is None, \
        f'reached the server as an unhandled error: {d["response"]}'


def phone_was_refused(d):
    """The specific refusal these cases are about, not any 400."""
    return d['status'] == 400 and d['response'].get('need_phone') is True


@pytest.fixture
def world(app, db):
    """A student with no stored phone, and a paid cohort open for enrolment.

    No phone on the user row on purpose: `normalise_phone(args.phone or
    me.phone)` falls back to the profile, so a student who already had one
    would make the "empty" case pass without the field being read at all.
    """
    aid, uid, cid = (str(uuid.uuid4()) for _ in range(3))
    db.session.execute(text("""
        INSERT INTO achievers (id, full_name, email, state, status, is_active,
                               is_verified, created_at, updated_at)
        VALUES (:i, 'X04 Checkout Achiever', :e, 'active', 'active', 1, 1,
                UTC_TIMESTAMP(), UTC_TIMESTAMP())
    """), {'i': aid, 'e': f'{TEST_PREFIX}{aid}@skovo.test'})
    db.session.execute(text("""
        INSERT INTO users (id, full_name, email, phone, status, created_at, updated_at)
        VALUES (:i, 'X04 Checkout Student', :e, NULL, 'active',
                UTC_TIMESTAMP(), UTC_TIMESTAMP())
    """), {'i': uid, 'e': f'{TEST_PREFIX}{uid}@skovo.test'})
    db.session.execute(text("""
        INSERT INTO cohorts (id, title, achiever_id, session_date, duration_minutes,
                             total_seats, filled_seats, price, status, created_at, updated_at)
        VALUES (:i, 'X04 Checkout Cohort', :a,
                DATE_ADD(UTC_TIMESTAMP(), INTERVAL 5 DAY), 90,
                NULL, 0, 499, 'upcoming', UTC_TIMESTAMP(), UTC_TIMESTAMP())
    """), {'i': cid, 'a': aid})
    db.session.commit()

    yield {'achiever': aid, 'student': uid, 'cohort': cid}

    # payment_orders keys the payer as `student_id`, not `user_id` — the table
    # serves cohorts, courses, sessions and subscriptions, so it names the role
    # rather than the table it came from.
    db.session.execute(text('DELETE FROM payment_events WHERE order_id IN '
                            '(SELECT id FROM payment_orders WHERE student_id = :u)'), {'u': uid})
    db.session.execute(text('DELETE FROM payment_orders WHERE student_id = :u'), {'u': uid})
    db.session.execute(text('DELETE FROM cohort_enrollments WHERE cohort_id = :c'), {'c': cid})
    db.session.execute(text('DELETE FROM cohorts WHERE id = :i'), {'i': cid})
    db.session.execute(text('DELETE FROM users WHERE id = :i'), {'i': uid})
    db.session.execute(text('DELETE FROM achievers WHERE id = :i'), {'i': aid})
    db.session.commit()


@pytest.fixture
def auth(app, world):
    with app.app_context():
        return {'Authorization':
                f'Bearer {create_access_token(identity=str(world["student"]))}'}


@pytest.fixture
def checkout(client, auth, world):
    def _checkout(**fields):
        d = body(client.post(f'/v1/cohorts/{world["cohort"]}/enroll',
                             json=fields, headers=auth))
        return d['status'], d
    return _checkout


# ── Mobile number ────────────────────────────────────────────────────────────

@pytest.mark.case('X04-136')
def test_mobile_empty_is_refused_with_a_named_reason(checkout):
    """`need_phone` in the body, not just a message: the client has to know to
    open the phone field rather than show a generic checkout error."""
    code, d = checkout(phone='')
    assert phone_was_refused(d), d


@pytest.mark.case('X04-137')
def test_mobile_too_short_is_refused(checkout):
    """normalise_phone drops anything it cannot read into a 10-digit Indian
    number. At signup that is right — the field is optional and must never cost
    a registration — but at checkout the number is how the gateway reaches the
    payer, so the same unreadable value has to become a refusal."""
    code, d = checkout(phone='98765')
    assert phone_was_refused(d), d


@pytest.mark.case('X04-138')
def test_mobile_with_letters_is_refused(checkout):
    code, d = checkout(phone='98765abcde')
    assert phone_was_refused(d), d


@pytest.mark.case('X04-139')
def test_mobile_with_country_code_and_spaces_is_accepted(checkout):
    """+91 98765 43210 is what people paste. Getting past the phone check is
    the whole assertion — the request then fails at Cashfree, which is not
    activated on this account."""
    code, d = checkout(phone='+91 98765 43210')
    assert not phone_was_refused(d), f'a valid pasted number was refused: {d}'
    never_a_500(d)


@pytest.mark.case('X04-140')
def test_a_plain_ten_digit_indian_mobile_is_accepted(checkout):
    code, d = checkout(phone='9876543210')
    assert not phone_was_refused(d), f'a plain 10-digit number was refused: {d}'
    never_a_500(d)


# ── Coupon code ──────────────────────────────────────────────────────────────
#
# A coupon that does not exist must refuse cleanly. These cases matter less for
# the discount than for what they prove about the lookup: every one of the
# strings below goes to sp_student_coupon_validate as a bound parameter, so a
# quote or a script tag is compared and not executed.

@pytest.mark.case('X04-141')
def test_no_coupon_is_fine(checkout):
    code, d = checkout(phone='9876543210')
    assert not phone_was_refused(d), d
    never_a_500(d)


@pytest.mark.case('X04-142')
def test_a_whitespace_coupon_is_treated_as_none(checkout):
    """Trimmed to empty, so it must behave exactly as sending no coupon —
    not as an invalid code, which would block a checkout over a stray space."""
    code, d = checkout(phone='9876543210', coupon_code='   ')
    assert not phone_was_refused(d), d
    never_a_500(d)
    assert 'coupon' not in str(d['response'].get('message', '')).lower()


@pytest.mark.case('X04-143')
def test_an_over_long_coupon_never_500s(checkout):
    code, d = checkout(phone='9876543210', coupon_code='X' * 300)
    never_a_500(d)


@pytest.mark.case('X04-144')
def test_a_padded_coupon_is_trimmed_before_lookup(checkout):
    """'  SAVE10  ' and 'SAVE10' must reach the validator as the same code, or
    a copy-paste with a trailing space silently loses someone their discount."""
    code, d = checkout(phone='9876543210', coupon_code='  NOSUCHCODE  ')
    never_a_500(d)


@pytest.mark.case('X04-145')
def test_a_unicode_coupon_never_500s(checkout):
    code, d = checkout(phone='9876543210', coupon_code=UNICODE)
    never_a_500(d)


@pytest.mark.case('X04-146')
def test_an_html_coupon_never_500s(checkout):
    code, d = checkout(phone='9876543210', coupon_code=HTML)
    never_a_500(d)


@pytest.mark.case('X04-147')
def test_a_sql_injection_coupon_is_compared_not_executed(checkout, db, world):
    """`SAVE10' OR '1'='1` must not match a coupon, and must leave the table
    intact. Both halves matter: the first says the lookup is parameterised, the
    second says nothing was executed."""
    code, d = checkout(phone='9876543210', coupon_code=SQLI)
    never_a_500(d)
    still_there = db.session.execute(text('SELECT COUNT(*) FROM cohorts WHERE id = :i'),
                                     {'i': world['cohort']}).scalar()
    assert still_there == 1, 'the cohort row did not survive the injection attempt'
