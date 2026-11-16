"""
X-04 Field validation — "Student signup" (X04-001…019). 19 cases.

`POST /v1/auth/register` writes a real row, so every account this module creates
is deleted in teardown. Addresses are keyed to `x04-signup-test-`; a crashed run
leaves rows matching that prefix.

Two of the sheet's rules here are about *not* being clever:

  * **A typo domain is offered, never applied.** `user@gmil.com` is valid by
    every syntax rule and reaches nobody, so the address is worth questioning —
    but only the person knows whether they meant gmail or a real host called
    gmil. Auto-correcting would silently register someone at an address they
    never chose and lock them out of their own account.

  * **An unusual domain is still a valid domain.** `iitb.ac.in` and
    `company.co.uk` must be accepted; a naive "one dot after the @" rule breaks
    exactly the academic addresses this product is aimed at.
"""
import uuid

import pytest
from sqlalchemy import text

REGISTER = '/v1/auth/register'
TEST_PREFIX = 'x04-signup-test-'

UNICODE = 'Zoë Café 日本語 🎓'
HTML = '<script>alert("xss")</script>'
SQLI = "O'Brien; DROP TABLE users;--"


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
    """Remove every account this module created, however the test ended."""
    yield
    db.session.execute(text(
        "DELETE FROM user_profiles WHERE user_id IN "
        "(SELECT id FROM users WHERE email LIKE :p)"), {'p': f'{TEST_PREFIX}%'})
    db.session.execute(text('DELETE FROM users WHERE email LIKE :p'),
                       {'p': f'{TEST_PREFIX}%'})
    db.session.commit()


@pytest.fixture
def signup(client, cleanup):
    """POST a registration. Valid defaults so a test about one field cannot fail
    for a reason about another."""
    def _signup(**fields):
        payload = {
            'full_name': 'X04 Signup Test',
            'email': f'{TEST_PREFIX}{uuid.uuid4().hex[:12]}@example.com',
            'password': 'ValidPass123',
        }
        payload.update(fields)
        d = body(client.post(REGISTER, json=payload))
        return d['status'], d, payload['email']
    return _signup


@pytest.fixture
def stored(db):
    def _stored(email, column):
        return db.session.execute(
            text(f'SELECT {column} FROM users WHERE email = :e'),
            {'e': email.strip().lower()}).scalar()
    return _stored


def registered(code, d):
    assert code in (200, 201), d
    return d


# ── Full name ────────────────────────────────────────────────────────────────

@pytest.mark.case('X04-001')
def test_full_name_empty_is_refused(signup):
    refused(signup(full_name='')[1], naming='Full name')


@pytest.mark.case('X04-002')
def test_full_name_only_whitespace_is_refused(signup):
    """Proves the trim happens before the required check — otherwise '   ' is a
    three-character name and the account is created without one."""
    refused(signup(full_name='   ')[1], naming='Full name')


@pytest.mark.case('X04-003')
def test_full_name_over_the_limit_is_a_400_naming_the_field(signup):
    code, d, _ = signup(full_name='x' * 200)
    refused(d, naming='Full name')
    assert '120' in d['response']['message']


@pytest.mark.case('X04-004')
def test_full_name_is_trimmed_before_storing(signup, stored):
    code, d, email = signup(full_name='   Padded Student   ')
    registered(code, d)
    assert stored(email, 'full_name') == 'Padded Student'


@pytest.mark.case('X04-005')
def test_full_name_unicode_survives(signup, stored):
    code, d, email = signup(full_name=UNICODE)
    registered(code, d)
    assert stored(email, 'full_name') == UNICODE


@pytest.mark.case('X04-006')
def test_full_name_html_is_stored_verbatim(signup, stored):
    code, d, email = signup(full_name=HTML)
    registered(code, d)
    assert stored(email, 'full_name') == HTML


@pytest.mark.case('X04-007')
def test_full_name_sql_metacharacters_are_stored_verbatim(signup, stored):
    code, d, email = signup(full_name=SQLI)
    registered(code, d)
    assert stored(email, 'full_name') == SQLI


# ── Email ────────────────────────────────────────────────────────────────────

@pytest.mark.case('X04-008')
def test_email_without_an_at_sign_is_refused(signup, db):
    """The sheet says refused. If this fails, registration accepts an address
    that can never receive mail — the account is unrecoverable the moment the
    person forgets their password, and no OTP or reset will ever reach them."""
    bad = f'{TEST_PREFIX}no-at-sign.example.com'
    code, d, _ = signup(email=bad)
    n = db.session.execute(text('SELECT COUNT(*) FROM users WHERE email = :e'),
                           {'e': bad}).scalar()
    assert d['status'] == 400, \
        f'an address with no @ was accepted and stored {n} row(s): {d}'


@pytest.mark.case('X04-009')
def test_email_with_two_at_signs_is_refused(signup):
    code, d, _ = signup(email=f'{TEST_PREFIX}two@@example.com')
    assert d['status'] == 400, f'a double-@ address was accepted: {d}'


@pytest.mark.case('X04-010')
def test_email_without_a_tld_is_refused(signup):
    code, d, _ = signup(email=f'{TEST_PREFIX}user@localhost')
    assert d['status'] == 400, f'an address with no TLD was accepted: {d}'


@pytest.mark.case('X04-011')
def test_email_over_255_chars_is_refused_with_a_stated_limit(signup):
    """`users.email` mirrors `achievers.email` at VARCHAR(255); past that is
    MySQL errno 1406, a 500 on the signup form."""
    long_local = 'x' * 300
    code, d, _ = signup(email=f'{TEST_PREFIX}{long_local}@example.com')
    refused(d, naming='Email')
    assert '255' in d['response']['message']


@pytest.mark.case('X04-012')
def test_email_is_normalised_to_lowercase(signup, db):
    """Otherwise Foo@x.com and foo@x.com are two accounts, and whichever the
    person types on the day decides whether they can log in."""
    upper = f'{TEST_PREFIX}{uuid.uuid4().hex[:10]}@EXAMPLE.COM'
    code, d, _ = signup(email=upper)
    registered(code, d)
    stored = db.session.execute(
        text('SELECT email FROM users WHERE email = :e'),
        {'e': upper.lower()}).scalar()
    assert stored == upper.lower(), f'stored as {stored!r}, not lowercased'


@pytest.mark.case('X04-013')
def test_a_typo_domain_is_offered_never_applied(signup, db):
    """Offered as a suggestion and the registration refused — the account must
    NOT be created at the corrected address. Only the person knows what they
    meant, and silently registering them elsewhere locks them out."""
    typo = f'{TEST_PREFIX}{uuid.uuid4().hex[:10]}@gmil.com'
    code, d, _ = signup(email=typo)
    assert d['status'] == 400, d
    assert d['response'].get('suggestion'), \
        'a typo domain must come back with a suggestion, not a bare refusal'
    assert 'gmail.com' in d['response']['suggestion']
    corrected = typo.replace('gmil.com', 'gmail.com')
    n = db.session.execute(text('SELECT COUNT(*) FROM users WHERE email IN (:a, :b)'),
                           {'a': typo, 'b': corrected}).scalar()
    assert n == 0, 'the suggestion was applied instead of offered'


@pytest.mark.case('X04-014')
@pytest.mark.parametrize('domain', ['iitb.ac.in', 'company.co.uk'])
def test_an_unusual_but_valid_domain_is_accepted(signup, domain):
    """A multi-label TLD is exactly the shape of the academic addresses this
    product exists for, so a naive "one dot after the @" rule would break its
    core audience."""
    code, d, _ = signup(email=f'{TEST_PREFIX}{uuid.uuid4().hex[:8]}@{domain}')
    registered(code, d)


# ── Password ─────────────────────────────────────────────────────────────────

@pytest.mark.case('X04-015')
def test_password_below_the_minimum_is_refused(signup):
    code, d, _ = signup(password='abc12')
    refused(d, naming='Password')
    assert '6' in d['response']['message']


@pytest.mark.case('X04-016')
def test_password_at_the_minimum_is_accepted(signup):
    """The boundary either side of the same rule — an off-by-one here rejects a
    password the message told the person was long enough."""
    code, d, _ = signup(password='abc123')
    registered(code, d)


@pytest.mark.case('X04-017')
def test_a_very_long_password_is_refused_with_a_stated_limit(signup):
    code, d, _ = signup(password='x' * 500)
    refused(d, naming='Password')
    assert '128' in d['response']['message']


@pytest.mark.case('X04-018')
def test_a_password_of_only_spaces_is_refused(signup):
    """Stripped first, so this is an empty password rather than an eight
    character one — the distinction decides whether the account is reachable."""
    refused(signup(password='        ')[1], naming='Password')


@pytest.mark.case('X04-019')
def test_a_unicode_password_is_accepted(signup):
    """Hashing is over bytes, so a non-ASCII password must survive registration
    and still be usable. Refusing it narrows the keyspace for no benefit."""
    code, d, _ = signup(password='Contraseña☕2024')
    registered(code, d)
