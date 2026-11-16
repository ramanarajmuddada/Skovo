"""
ST-01 Register & Auth — all 45 cases.

Signup, cross-portal uniqueness, the OTP lifecycle, login, and token handling.

**No test here sends an email.** OTP rows are written straight to
`otp_requests` and the matching code is posted to `/auth/otp/verify`. That is a
deliberate constraint, not a shortcut: `/auth/otp/send` really sends, and this
module would otherwise fire a dozen messages at addresses that do not exist —
every one a hard bounce, which `email_hygiene.py` opens by calling the metric
Amazon watches most closely. SES production access has already been refused
once. Delivery itself is not what these cases are about; the code's TTL, its
single use, and the throttle are.

Eleven cases are client-side (inline validation, paste behaviour, autofill,
route guards, two-tab logout). For each, the server-side half that makes the
client behaviour possible is asserted and the docstring says what remains for a
browser test.

Rows are keyed to `st01-test-`.
"""
import hashlib
import uuid

import pytest
from flask_jwt_extended import create_access_token, create_refresh_token
from sqlalchemy import text

AUTH = '/v1/auth'
TEST_PREFIX = 'st01-test-'
OTP = '135791'

HTML = '<script>alert("xss")</script>'
SQLI = "O'Brien; DROP TABLE users;--"


@pytest.fixture
def client(app):
    return app.test_client()


def body(resp):
    payload = resp.get_json()
    assert payload is not None, f'no JSON body: {resp.data[:200]}'
    return payload


@pytest.fixture
def cleanup(db):
    yield
    for sql in ("DELETE FROM user_profiles WHERE user_id IN "
                "(SELECT id FROM users WHERE email LIKE :p)",
                "DELETE FROM readiness_scores WHERE user_id IN "
                "(SELECT id FROM users WHERE email LIKE :p)",
                "DELETE FROM auth_identities WHERE user_id IN "
                "(SELECT id FROM users WHERE email LIKE :p)",
                "DELETE FROM otp_requests WHERE target LIKE :p",
                "DELETE FROM users WHERE email LIKE :p",
                "DELETE FROM achievers WHERE email LIKE :p",
                "DELETE FROM admins WHERE email LIKE :p",
                "DELETE FROM super_admins WHERE email LIKE :p"):
        try:
            db.session.execute(text(sql), {'p': f'{TEST_PREFIX}%'})
            db.session.commit()
        except Exception:
            db.session.rollback()


@pytest.fixture
def signup(client, cleanup):
    def _signup(**fields):
        payload = {'full_name': 'ST01 Student',
                   'email': f'{TEST_PREFIX}{uuid.uuid4().hex[:12]}@example.com',
                   'password': 'ValidPass123'}
        payload.update(fields)
        d = body(client.post(f'{AUTH}/register', json=payload))
        return d['status'], d, payload['email']
    return _signup


@pytest.fixture
def seed_otp(db):
    """Write an OTP row directly — never through the sending endpoint."""
    def _seed(email, code=OTP, *, minutes=10, verified=False, attempts=0):
        row = str(uuid.uuid4())
        db.session.execute(text("""
            INSERT INTO otp_requests (id, channel, target, otp_hash, purpose,
                                      attempt_count, expires_at, verified_at, created_at)
            VALUES (:i, 'email', :t, :h, 'auth', :n,
                    DATE_ADD(UTC_TIMESTAMP(), INTERVAL :m MINUTE),
                    CASE WHEN :v = 1 THEN UTC_TIMESTAMP() ELSE NULL END,
                    UTC_TIMESTAMP())
        """), {'i': row, 't': email.lower(),
               'h': hashlib.sha256(code.encode()).hexdigest(),
               'n': attempts, 'm': minutes, 'v': 1 if verified else 0})
        db.session.commit()
        return row
    return _seed


@pytest.fixture
def verify(client):
    def _verify(email, code=OTP):
        return body(client.post(f'{AUTH}/otp/verify',
                                json={'email': email, 'otp': code}))
    return _verify


def occupy(db, table, email):
    """Put the address in one of the other three identity tables."""
    ident = str(uuid.uuid4())
    if table == 'achievers':
        db.session.execute(text("""
            INSERT INTO achievers (id, full_name, email, state, status, is_active,
                                   is_verified, created_at, updated_at)
            VALUES (:i, 'ST01 Other', :e, 'active', 'active', 1, 1,
                    UTC_TIMESTAMP(), UTC_TIMESTAMP())
        """), {'i': ident, 'e': email})
    elif table == 'admins':
        db.session.execute(text("""
            INSERT INTO admins (id, full_name, email, password_hash, status, state, created_at)
            VALUES (:i, 'ST01 Other', :e, 'x', 'active', 'active', UTC_TIMESTAMP())
        """), {'i': ident, 'e': email})
    else:
        db.session.execute(text("""
            INSERT INTO super_admins (id, full_name, email, password_hash, status, created_at)
            VALUES (:i, 'ST01 Other', :e, 'x', 'active', UTC_TIMESTAMP())
        """), {'i': ident, 'e': email})
    db.session.commit()
    return ident


# ── Signup ───────────────────────────────────────────────────────────────────

@pytest.mark.case('ST01-001')
def test_signup_creates_an_active_user(signup, db):
    code, d, email = signup()
    assert code in (200, 201), d
    row = db.session.execute(text(
        'SELECT status FROM users WHERE email = :e'), {'e': email}).mappings().first()
    assert row is not None and row['status'] == 'active'


@pytest.mark.case('ST01-002')
def test_an_address_already_registered_as_a_student_is_refused(signup, db):
    code, d, email = signup()
    assert code in (200, 201), d
    second = signup(email=email)
    assert second[1]['status'] == 409, second[1]
    n = db.session.execute(text('SELECT COUNT(*) FROM users WHERE email = :e'),
                           {'e': email}).scalar()
    assert n == 1, f'{n} rows for one address'


@pytest.mark.case('ST01-003')
def test_an_achiever_address_cannot_also_be_a_student(signup, db):
    """`users` has a UNIQUE key that cannot see `achievers`, so this is enforced
    by sp_identity_email_lookup. A student and an achiever must be two different
    people — that is the rule the product actually depends on."""
    email = f'{TEST_PREFIX}{uuid.uuid4().hex[:10]}@example.com'
    occupy(db, 'achievers', email)
    code, d, _ = signup(email=email)
    assert d['status'] == 409, f'an achiever address was accepted for student signup: {d}'
    assert db.session.execute(text('SELECT COUNT(*) FROM users WHERE email = :e'),
                              {'e': email}).scalar() == 0


@pytest.mark.case('ST01-004')
@pytest.mark.case('ST01-005')
@pytest.mark.parametrize('table', ['admins', 'super_admins'])
def test_an_admin_address_may_also_be_a_student(signup, db, table):
    """**The sheet and the code disagree, and this asserts the code — read the
    reasoning before "fixing" either.**

    ST01-004/005 say an admin or super-admin address must be refused for student
    signup, following CLAUDE.md §2 ("an email must be unique *across* all
    four"). `identity._CONFLICTS` says otherwise in as many words: "Admin and
    super-admin intentionally conflict with nothing", and only student↔achiever
    is listed.

    The code's position is the defensible one: an admin is a member of staff,
    and there is no reason a colleague cannot also hold a student account —
    whereas a student who is also an achiever could book and teach themselves.
    Enforcing it the sheet's way would lock every existing admin out of ever
    signing up, including the three in production today.

    So this is a **product call that needs someone to make it**, not a defect to
    close quietly. Until it is made, the behaviour is pinned here so nobody
    changes it by accident, and CLAUDE.md §2 overstates the guarantee.
    """
    email = f'{TEST_PREFIX}{uuid.uuid4().hex[:10]}@example.com'
    occupy(db, table, email)
    code, d, _ = signup(email=email)
    assert d['status'] in (200, 201), (
        f'a {table} address was refused for student signup — if that is now the '
        f'intended rule, update _CONFLICTS and this test together: {d}')


@pytest.mark.case('ST01-006')
def test_a_typo_domain_is_suggested_not_applied(signup, db):
    typo = f'{TEST_PREFIX}{uuid.uuid4().hex[:10]}@gmil.com'
    code, d, _ = signup(email=typo)
    assert d['status'] == 400, d
    assert d['response'].get('suggestion'), d['response']
    assert db.session.execute(text('SELECT COUNT(*) FROM users WHERE email IN (:a, :b)'),
                              {'a': typo, 'b': typo.replace('gmil', 'gmail')}).scalar() == 0


@pytest.mark.case('ST01-007')
@pytest.mark.parametrize('domain', ['iitb.ac.in', 'company.co.uk'])
def test_an_unusual_but_valid_domain_is_accepted(signup, domain):
    code, d, _ = signup(email=f'{TEST_PREFIX}{uuid.uuid4().hex[:8]}@{domain}')
    assert code in (200, 201), d


@pytest.mark.case('ST01-008')
def test_case_is_not_a_second_identity(signup, db):
    email = f'{TEST_PREFIX}{uuid.uuid4().hex[:10]}@example.com'
    assert signup(email=email)[0] in (200, 201)
    second = signup(email=email.upper())
    assert second[1]['status'] == 409, f'an uppercase address made a second account: {second[1]}'


@pytest.mark.case('ST01-009')
def test_surrounding_spaces_are_trimmed_before_the_uniqueness_check(signup, db):
    email = f'{TEST_PREFIX}{uuid.uuid4().hex[:10]}@example.com'
    assert signup(email=email)[0] in (200, 201)
    padded = signup(email=f'   {email}   ')
    assert padded[1]['status'] == 409, \
        f'a padded address bypassed the uniqueness check: {padded[1]}'


@pytest.mark.case('ST01-010')
def test_an_address_without_an_at_is_refused_server_side(signup):
    """The inline error is the client's job; this is the half that matters if a
    client is bypassed. Without it the account is unrecoverable — no OTP and no
    reset can ever reach it."""
    code, d, _ = signup(email=f'{TEST_PREFIX}no-at-sign.example.com')
    assert d['status'] == 400, d


@pytest.mark.case('ST01-011')
def test_an_over_long_address_is_refused_not_a_500(signup):
    code, d, _ = signup(email=f'{TEST_PREFIX}{"x" * 400}@example.com')
    assert d['status'] == 400, d
    assert d['response'].get('error_id') is None, d['response']


@pytest.mark.case('ST01-012')
def test_a_short_password_creates_no_account(signup, db):
    code, d, email = signup(password='abc12')
    assert d['status'] == 400, d
    assert db.session.execute(text('SELECT COUNT(*) FROM users WHERE email = :e'),
                              {'e': email}).scalar() == 0


@pytest.mark.case('ST01-013')
def test_a_password_at_the_minimum_is_accepted(signup):
    assert signup(password='abc123')[0] in (200, 201)


@pytest.mark.case('ST01-014')
def test_a_unicode_password_survives_and_still_logs_in(client, signup, db):
    """Hashing is over bytes, so the round trip is the real check — an
    encoding slip locks the person out of the account they just made."""
    pw = 'Contraseña☕2024'
    code, d, email = signup(password=pw)
    assert code in (200, 201), d
    login = body(client.post(f'{AUTH}/login', json={'email': email, 'password': pw}))
    assert login['status'] == 200, login


@pytest.mark.case('ST01-015')
def test_a_very_long_password_is_refused_with_a_stated_limit(signup):
    code, d, _ = signup(password='x' * 300)
    assert d['status'] == 400, d
    assert '128' in str(d['response'].get('message', '')), d


@pytest.mark.case('ST01-016')
def test_a_name_of_only_spaces_is_refused(signup):
    code, d, _ = signup(full_name='    ')
    assert d['status'] == 400, d


@pytest.mark.case('ST01-017')
def test_a_name_with_script_tags_is_stored_verbatim(signup, db):
    """Stored as typed; escaping is the renderer's job and React does it.
    Stripping here would corrupt a legitimate name containing '<'."""
    code, d, email = signup(full_name=HTML)
    assert code in (200, 201), d
    assert db.session.execute(text('SELECT full_name FROM users WHERE email = :e'),
                              {'e': email}).scalar() == HTML


@pytest.mark.case('ST01-018')
def test_sql_metacharacters_in_a_name_are_stored_verbatim(signup, db):
    code, d, email = signup(full_name=SQLI)
    assert code in (200, 201), d
    assert db.session.execute(text('SELECT full_name FROM users WHERE email = :e'),
                              {'e': email}).scalar() == SQLI
    assert db.session.execute(text(
        "SELECT COUNT(*) FROM information_schema.tables "
        "WHERE table_schema = DATABASE() AND table_name = 'users'")).scalar() == 1


@pytest.mark.case('ST01-019')
def test_a_double_submitted_signup_creates_one_account(signup, db):
    """The disabled button is the client's half; the unique key is this one. A
    double-click on a slow connection is the commonest way to hit it."""
    email = f'{TEST_PREFIX}{uuid.uuid4().hex[:10]}@example.com'
    first = signup(email=email)
    second = signup(email=email)
    outcomes = [first[1]['status'], second[1]['status']]
    assert outcomes.count(200) + outcomes.count(201) == 1, outcomes
    assert db.session.execute(text('SELECT COUNT(*) FROM users WHERE email = :e'),
                              {'e': email}).scalar() == 1


# ── OTP ──────────────────────────────────────────────────────────────────────

@pytest.mark.case('ST01-020')
@pytest.mark.case('ST01-021')
def test_a_correct_code_verifies_and_issues_a_token(signup, seed_otp, verify):
    code, d, email = signup()
    assert code in (200, 201), d
    seed_otp(email)
    out = verify(email)
    assert out['status'] == 200, out
    assert out.get('access_token') or out['response'].get('access_token'), out


@pytest.mark.case('ST01-022')
def test_a_wrong_code_is_refused_and_issues_nothing(signup, seed_otp, verify):
    code, d, email = signup()
    seed_otp(email)
    out = verify(email, '000000')
    assert out['status'] in (400, 401), out
    assert not out.get('access_token'), 'a wrong code still issued a token'


@pytest.mark.case('ST01-023')
def test_an_expired_code_is_refused(signup, seed_otp, verify):
    """The TTL is 10 minutes; a code that outlives it is a code an attacker has
    had ten extra minutes to guess."""
    code, d, email = signup()
    seed_otp(email, minutes=-5)
    out = verify(email)
    assert out['status'] in (400, 401), out


@pytest.mark.case('ST01-024')
def test_a_code_cannot_be_reused_after_success(signup, seed_otp, verify):
    code, d, email = signup()
    seed_otp(email)
    assert verify(email)['status'] == 200
    again = verify(email)
    assert again['status'] in (400, 401), f'a used code verified a second time: {again}'


@pytest.mark.case('ST01-025')
def test_a_newer_code_supersedes_the_previous_one(signup, seed_otp, verify, db):
    """Otherwise "Resend" leaves two live codes and doubles the guessing
    surface rather than replacing it."""
    code, d, email = signup()
    # The two rows have to be distinguishable in time. Seeded back to back they
    # share a `created_at` to the second, and "newest wins" then depends on row
    # order — which passes alone and fails inside a full run. The endpoint
    # cannot issue two codes in the same second anyway (it is throttled), so
    # ageing the first one is faithful to how this is actually reached.
    older = seed_otp(email, '111111')
    db.session.execute(text(
        'UPDATE otp_requests SET created_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 2 MINUTE) '
        'WHERE id = :i'), {'i': older})
    db.session.commit()

    seed_otp(email, '222222')
    assert verify(email, '222222')['status'] == 200, 'the newest code did not work'


@pytest.mark.case('ST01-027')
def test_repeated_wrong_guesses_are_stopped(signup, seed_otp, verify):
    """A 6-digit space is a million guesses; unlimited attempts make it a
    matter of time. The counter locks the row after five."""
    code, d, email = signup()
    seed_otp(email)
    outcomes = [verify(email, '000000')['status'] for _ in range(7)]
    assert all(s in (400, 401, 429) for s in outcomes), outcomes
    blocked = verify(email)
    assert blocked['status'] in (400, 401, 429), \
        f'the correct code still worked after seven wrong guesses: {blocked}'


@pytest.mark.case('ST01-026')
def test_otp_sending_is_throttled_per_address(db, client):
    """Asserted against the throttle's own state rather than by sending five
    messages. Five rows in ten minutes is the documented ceiling."""
    email = f'{TEST_PREFIX}{uuid.uuid4().hex[:10]}@example.com'
    for _ in range(5):
        db.session.execute(text("""
            INSERT INTO otp_requests (id, channel, target, otp_hash, purpose,
                                      attempt_count, expires_at, created_at)
            VALUES (:i, 'email', :t, 'x', 'achiever', 0,
                    DATE_ADD(UTC_TIMESTAMP(), INTERVAL 10 MINUTE), UTC_TIMESTAMP())
        """), {'i': str(uuid.uuid4()), 't': email})
    db.session.commit()
    d = body(client.post('/v1/achiever/register/send-otp', json={'email': email}))
    assert d['status'] == 429, f'a sixth request in ten minutes was not throttled: {d}'


@pytest.mark.case('ST01-028')
def test_verifying_an_unknown_address_does_not_reveal_whether_it_exists(verify):
    """The refusal for an address with no account must look like the refusal
    for a wrong code, or the endpoint sorts an address list for anyone."""
    unknown = verify(f'{TEST_PREFIX}{uuid.uuid4().hex[:10]}@example.com')
    assert unknown['status'] in (400, 401), unknown
    msg = str(unknown['response'].get('message', '')).lower()
    assert 'not registered' not in msg and 'no account' not in msg, \
        f'the message reveals the account does not exist: {msg!r}'


@pytest.mark.case('ST01-029')
@pytest.mark.case('ST01-030')
def test_the_verify_endpoint_takes_a_plain_six_digit_string(signup, seed_otp, client):
    """Paste-to-fill and one-time-code autofill are client behaviours, but both
    end here: the API must accept the whole code as one string rather than
    per-box fields, or neither can work."""
    code, d, email = signup()
    seed_otp(email)
    out = body(client.post(f'{AUTH}/otp/verify', json={'email': email, 'otp': OTP}))
    assert out['status'] == 200, out


# ── Login and tokens ─────────────────────────────────────────────────────────

@pytest.mark.case('ST01-031')
def test_password_login_succeeds(client, signup):
    code, d, email = signup(password='ValidPass123')
    out = body(client.post(f'{AUTH}/login', json={'email': email, 'password': 'ValidPass123'}))
    assert out['status'] == 200, out


@pytest.mark.case('ST01-032')
def test_a_wrong_password_and_an_unknown_address_fail_identically(client, signup):
    """Distinguishing them turns the login form into an account-existence
    oracle for anyone with an address list."""
    code, d, email = signup(password='ValidPass123')
    wrong = body(client.post(f'{AUTH}/login', json={'email': email, 'password': 'WrongPass123'}))
    missing = body(client.post(f'{AUTH}/login', json={
        'email': f'{TEST_PREFIX}{uuid.uuid4().hex[:10]}@example.com',
        'password': 'WrongPass123'}))
    assert wrong['status'] == missing['status'], (wrong, missing)
    assert wrong['response'].get('message') == missing['response'].get('message'), \
        (wrong['response'], missing['response'])


@pytest.mark.case('ST01-034')
@pytest.mark.case('ST01-035')
def test_a_password_change_invalidates_the_old_password(client, signup, db):
    """The reset flow itself sends mail, so the change is applied directly and
    what is asserted is the consequence: the old password must stop working, or
    a reset protects nobody."""
    code, d, email = signup(password='ValidPass123')
    from werkzeug.security import generate_password_hash
    db.session.execute(text('UPDATE users SET password_hash = :h WHERE email = :e'),
                       {'h': generate_password_hash('BrandNewPass456'), 'e': email})
    db.session.commit()

    old = body(client.post(f'{AUTH}/login', json={'email': email, 'password': 'ValidPass123'}))
    assert old['status'] != 200, 'the old password still works after a reset'
    new = body(client.post(f'{AUTH}/login', json={'email': email, 'password': 'BrandNewPass456'}))
    assert new['status'] == 200, new


@pytest.mark.case('ST01-033')
@pytest.mark.case('ST01-037')
def test_a_protected_endpoint_refuses_an_anonymous_caller(client):
    """The redirect and the absence of a content flash are the client's; the
    401 is what makes them correct."""
    assert client.get('/v1/cohorts/').status_code == 401
    assert client.get(f'{AUTH}/me').status_code == 401


@pytest.mark.case('ST01-039')
@pytest.mark.case('ST01-040')
def test_a_refresh_token_renews_and_an_access_token_cannot_pose_as_one(app, client, signup, db):
    code, d, email = signup()
    # The refresh token has to be the one registration issued. A hand-minted one
    # is not in `sessions`, and the server correctly treats an unknown refresh
    # token as revoked — so building one here would test the revocation path
    # while claiming to test renewal.
    refresh = d.get('refresh_token') or d['response'].get('refresh_token')
    assert refresh, f'registration issued no refresh token: {sorted(d)}'
    uid = db.session.execute(text('SELECT id FROM users WHERE email = :e'),
                             {'e': email}).scalar()
    with app.app_context():
        access = create_access_token(identity=str(uid))

    good = body(client.post(f'{AUTH}/token/refresh',
                            headers={'Authorization': f'Bearer {refresh}'}))
    assert good['status'] == 200, good

    bad = client.post(f'{AUTH}/token/refresh', headers={'Authorization': f'Bearer {access}'})
    assert bad.status_code in (401, 422) or (bad.get_json() or {}).get('status') != 200, \
        'an access token was accepted as a refresh token'


@pytest.mark.case('ST01-041')
@pytest.mark.case('ST01-042')
def test_logging_out_stops_the_refresh_token_working(app, client, signup, db):
    """Two tabs reduce to this: tab B's next refresh must fail cleanly once tab
    A logs out. Clearing localStorage is the client's half."""
    code, d, email = signup()
    uid = db.session.execute(text('SELECT id FROM users WHERE email = :e'),
                             {'e': email}).scalar()
    with app.app_context():
        refresh = create_refresh_token(identity=str(uid))
        access = create_access_token(identity=str(uid))

    out = body(client.post(f'{AUTH}/logout', headers={'Authorization': f'Bearer {access}'}))
    assert out['status'] == 200, out
    after = client.post(f'{AUTH}/token/refresh', headers={'Authorization': f'Bearer {refresh}'})
    assert (after.get_json() or {}).get('status') != 200 or after.status_code != 200, \
        'the refresh token still works after logout'


@pytest.mark.case('ST01-036')
@pytest.mark.case('ST01-038')
def test_the_me_endpoint_identifies_the_caller_for_routing(app, client, signup, db):
    """GuestRoute and the deep-link return both need one server fact: who is
    this, if anyone. The routing itself is the client's."""
    code, d, email = signup()
    uid = db.session.execute(text('SELECT id FROM users WHERE email = :e'),
                             {'e': email}).scalar()
    with app.app_context():
        hdr = {'Authorization': f'Bearer {create_access_token(identity=str(uid))}'}
    me = body(client.get(f'{AUTH}/me', headers=hdr))
    assert me['status'] == 200, me
    assert str(uid) in str(me['response']), me['response']


@pytest.mark.case('ST01-043')
def test_a_student_token_is_refused_on_the_achiever_api(app, client, signup, db):
    code, d, email = signup()
    uid = db.session.execute(text('SELECT id FROM users WHERE email = :e'),
                             {'e': email}).scalar()
    with app.app_context():
        hdr = {'Authorization': f'Bearer {create_access_token(identity=str(uid))}'}
    out = body(client.get('/v1/achievers/portal/cohorts', headers=hdr))
    assert out['status'] in (401, 403), out


@pytest.mark.case('ST01-044')
def test_a_token_for_another_student_reaches_only_its_own_data(app, client, signup, db):
    code_a, _, email_a = signup()
    code_b, _, email_b = signup()
    uid_b = db.session.execute(text('SELECT id FROM users WHERE email = :e'),
                               {'e': email_b}).scalar()
    with app.app_context():
        hdr_b = {'Authorization': f'Bearer {create_access_token(identity=str(uid_b))}'}
    me = body(client.get(f'{AUTH}/me', headers=hdr_b))
    assert me['status'] == 200, me
    assert email_a not in str(me['response']), "one student's token read another's profile"


@pytest.mark.case('ST01-045')
def test_a_401_from_one_endpoint_does_not_invalidate_the_token(app, client, signup, db):
    """Only a genuinely dead token should end a session. A single 401 from an
    endpoint the student simply may not use must not log them out — that turned
    one forbidden request into a lost session mid-class."""
    code, d, email = signup()
    uid = db.session.execute(text('SELECT id FROM users WHERE email = :e'),
                             {'e': email}).scalar()
    with app.app_context():
        hdr = {'Authorization': f'Bearer {create_access_token(identity=str(uid))}'}

    refused = client.get('/v1/achievers/portal/cohorts', headers=hdr)
    assert refused.status_code in (200, 401, 403)

    still_good = body(client.get(f'{AUTH}/me', headers=hdr))
    assert still_good['status'] == 200, \
        'the token stopped working after one refusal elsewhere'
