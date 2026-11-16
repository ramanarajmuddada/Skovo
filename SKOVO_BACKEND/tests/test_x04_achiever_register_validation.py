"""
X-04 Field validation — "Achiever register" (X04-020…038). 19 cases.

`POST /v1/achievers/register` is OTP-gated, and this module **never calls
send-otp**. It writes the OTP row directly and posts the matching code.

That is not a shortcut around the guard — it is a deliberate choice about what
these tests are allowed to do to production. send-otp really sends mail, and
driving it nineteen times at addresses like `two@@example.com` would produce
nineteen hard bounces from the live sender. email_hygiene.py opens by naming
that exact hazard: a hard bounce is "the metric Amazon watches most closely, and
the fastest way to lose production access", and SES production access has
already been refused once (case 178792193300608). Field validation on /register
can be proven without sending anything, so it is.

The OTP path itself is ST-01's business, not X-04's.

Rows are keyed to `x04-areg-test-` and removed in teardown.
"""
import datetime
import hashlib
import uuid

import pytest
from sqlalchemy import text

REGISTER = '/v1/achiever/register'
TEST_PREFIX = 'x04-areg-test-'
OTP = '424242'

UNICODE = 'Zoë Café 日本語 🎓'
HTML = '<script>alert("xss")</script>'
SQLI = "O'Brien; DROP TABLE achievers;--"


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
def cleanup(db):
    yield
    db.session.execute(text('DELETE FROM achievers WHERE email LIKE :p'),
                       {'p': f'{TEST_PREFIX}%'})
    db.session.execute(text('DELETE FROM otp_requests WHERE target LIKE :p'),
                       {'p': f'{TEST_PREFIX}%'})
    db.session.commit()


@pytest.fixture
def register(client, db, cleanup):
    """Seed a valid OTP for the address, then POST the registration."""
    def _register(**fields):
        payload = {
            'full_name': 'X04 Achiever Test',
            'email': f'{TEST_PREFIX}{uuid.uuid4().hex[:12]}@example.com',
            'password': 'ValidPass123',
            'otp': OTP,
            'linkedin': 'https://linkedin.com/in/x04-areg',
        }
        payload.update(fields)

        email = (payload.get('email') or '').strip().lower()
        if email:
            # Columns as they actually are: consumption is recorded by
            # `verified_at`, not an is_used flag, and the counter is
            # `attempt_count`. Mirrors sp_otp_requests_create.
            db.session.execute(text("""
                INSERT INTO otp_requests (id, channel, target, otp_hash, purpose,
                                          attempt_count, expires_at, verified_at, created_at)
                VALUES (:i, 'email', :t, :h, 'achiever', 0,
                        DATE_ADD(UTC_TIMESTAMP(), INTERVAL 10 MINUTE), NULL, UTC_TIMESTAMP())
            """), {'i': str(uuid.uuid4()), 't': email,
                   'h': hashlib.sha256(OTP.encode()).hexdigest()})
            db.session.commit()

        d = body(client.post(REGISTER, json=payload))
        return d['status'], d, email
    return _register


@pytest.fixture
def stored(db):
    def _stored(email, column):
        return db.session.execute(
            text(f'SELECT {column} FROM achievers WHERE email = :e'),
            {'e': email}).scalar()
    return _stored


def registered(code, d):
    assert code in (200, 201), d
    return d


# ── Full name ────────────────────────────────────────────────────────────────

@pytest.mark.case('X04-020')
def test_full_name_empty_is_refused(register):
    refused(register(full_name='')[1])


@pytest.mark.case('X04-021')
def test_full_name_only_whitespace_is_refused(register):
    refused(register(full_name='   ')[1])


@pytest.mark.case('X04-022')
def test_full_name_over_the_limit_is_a_400_naming_the_field(register):
    code, d, _ = register(full_name='x' * 200)
    refused(d, naming='Full name')
    assert '120' in d['response']['message']


@pytest.mark.case('X04-023')
def test_full_name_is_trimmed_before_storing(register, stored):
    code, d, email = register(full_name='   Padded Achiever   ')
    registered(code, d)
    assert stored(email, 'full_name') == 'Padded Achiever'


@pytest.mark.case('X04-024')
def test_full_name_unicode_survives(register, stored):
    code, d, email = register(full_name=UNICODE)
    registered(code, d)
    assert stored(email, 'full_name') == UNICODE


@pytest.mark.case('X04-025')
def test_full_name_html_is_stored_verbatim(register, stored):
    code, d, email = register(full_name=HTML)
    registered(code, d)
    assert stored(email, 'full_name') == HTML


@pytest.mark.case('X04-026')
def test_full_name_sql_metacharacters_are_stored_verbatim(register, stored):
    code, d, email = register(full_name=SQLI)
    registered(code, d)
    assert stored(email, 'full_name') == SQLI


# ── Email ────────────────────────────────────────────────────────────────────
#
# Checked on /register and not only on send-otp: a client can post straight
# here, and a rule enforced only on the way in is not enforced.

@pytest.mark.case('X04-027')
def test_email_without_an_at_sign_is_refused(register, db):
    bad = f'{TEST_PREFIX}no-at-sign.example.com'
    code, d, _ = register(email=bad)
    assert d['status'] == 400, f'an address with no @ was accepted: {d}'
    n = db.session.execute(text('SELECT COUNT(*) FROM achievers WHERE email = :e'),
                           {'e': bad}).scalar()
    assert n == 0


@pytest.mark.case('X04-028')
def test_email_with_two_at_signs_is_refused(register):
    code, d, _ = register(email=f'{TEST_PREFIX}two@@example.com')
    assert d['status'] == 400, f'a double-@ address was accepted: {d}'


@pytest.mark.case('X04-029')
def test_email_without_a_tld_is_refused(register):
    code, d, _ = register(email=f'{TEST_PREFIX}user@localhost')
    assert d['status'] == 400, f'an address with no TLD was accepted: {d}'


@pytest.mark.case('X04-030')
def test_email_over_255_chars_is_refused_with_a_stated_limit(register):
    """`achievers.email` is VARCHAR(255) — past it is errno 1406, a 500 on the
    signup form itself."""
    code, d, _ = register(email=f'{TEST_PREFIX}{"x" * 300}@example.com')
    refused(d, naming='Email')
    assert '255' in d['response']['message']


@pytest.mark.case('X04-031')
def test_email_is_normalised_to_lowercase(register, db):
    upper = f'{TEST_PREFIX}{uuid.uuid4().hex[:10]}@EXAMPLE.COM'
    code, d, _ = register(email=upper)
    registered(code, d)
    n = db.session.execute(text('SELECT COUNT(*) FROM achievers WHERE email = :e'),
                           {'e': upper.lower()}).scalar()
    assert n == 1, 'the address was not stored lowercased'


@pytest.mark.case('X04-032')
def test_a_typo_domain_is_offered_never_applied(register, db):
    typo = f'{TEST_PREFIX}{uuid.uuid4().hex[:10]}@gmil.com'
    code, d, _ = register(email=typo)
    assert d['status'] == 400, d
    assert d['response'].get('suggestion'), d['response']
    corrected = typo.replace('gmil.com', 'gmail.com')
    n = db.session.execute(text('SELECT COUNT(*) FROM achievers WHERE email IN (:a, :b)'),
                           {'a': typo, 'b': corrected}).scalar()
    assert n == 0, 'the suggestion was applied instead of offered'


@pytest.mark.case('X04-033')
@pytest.mark.parametrize('domain', ['iitb.ac.in', 'company.co.uk'])
def test_an_unusual_but_valid_domain_is_accepted(register, domain):
    """Achievers are exactly the people with institutional addresses, so this
    must not be narrowed to one dot after the @."""
    code, d, _ = register(email=f'{TEST_PREFIX}{uuid.uuid4().hex[:8]}@{domain}')
    registered(code, d)


# ── Password ─────────────────────────────────────────────────────────────────

@pytest.mark.case('X04-034')
def test_password_below_the_minimum_is_refused(register):
    code, d, _ = register(password='abc12')
    refused(d, naming='Password')
    assert '6' in d['response']['message']


@pytest.mark.case('X04-035')
def test_password_at_the_minimum_is_accepted(register):
    code, d, _ = register(password='abc123')
    registered(code, d)


@pytest.mark.case('X04-036')
def test_a_very_long_password_is_refused_with_a_stated_limit(register):
    code, d, _ = register(password='x' * 500)
    refused(d, naming='Password')
    assert '128' in d['response']['message']


@pytest.mark.case('X04-037')
def test_a_password_of_only_spaces_is_refused(register):
    refused(register(password='        ')[1])


@pytest.mark.case('X04-038')
def test_a_unicode_password_is_accepted(register):
    code, d, _ = register(password='Contraseña☕2024')
    registered(code, d)
