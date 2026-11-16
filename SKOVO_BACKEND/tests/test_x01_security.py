"""
X-01 Security & Data — all 28 cases.

Most of this sheet is runtime behaviour and is tested as such. Four cases are
about the *deployed build* rather than the running code (CORS origins, the
Werkzeug debugger, S3 object disposition, migration baselining); those assert
the mechanism from here and say so in their docstring, because a test that
claims to have checked production when it has not is worse than no test.

One case is expected to FAIL, and should: X01-021 asserts `error_logs` contains
nothing already fixed. It currently holds rows for bugs that were fixed days
ago, and the working agreement is that a fixed error's row is deleted. A red
result there is the sheet doing its job — do not soften it to green.

Rows are keyed to `x01-sec-test-`.
"""
import os
import re
import uuid
from pathlib import Path

import pytest
from flask_jwt_extended import create_access_token
from sqlalchemy import text

TEST_PREFIX = 'x01-sec-test-'
REPO = Path(__file__).resolve().parents[2]

ADMIN = '/v1/skovo-platform-panel-admin'
ACHIEVER = '/v1/achievers/portal'
COHORTS = '/v1/cohorts'
VAULT = '/v1/document-vault'
REVIEWS = '/v1/achiever-reviews'

SECRET_MARKERS = ('mysql+pymysql', 'rds.amazonaws.com', 'AWS_SECRET', 'SECRET_KEY',
                  'Traceback (most recent call last)', 'CASHFREE_SECRET')


@pytest.fixture
def client(app):
    return app.test_client()


def body(resp):
    payload = resp.get_json()
    assert payload is not None, f'no JSON body: {resp.data[:200]}'
    return payload


@pytest.fixture
def two_worlds(app, db):
    """Two unrelated students and two unrelated achievers, each with a cohort.

    Two of everything, because every escalation case is "A must not reach B" and
    a single-tenant fixture cannot express that.
    """
    ids = {k: str(uuid.uuid4()) for k in
           ('sa', 'sb', 'aa', 'ab', 'ca', 'cb', 'admin_pending')}
    for key, name in (('sa', 'X01 Student A'), ('sb', 'X01 Student B')):
        db.session.execute(text("""
            INSERT INTO users (id, full_name, email, status, created_at, updated_at)
            VALUES (:i, :n, :e, 'active', UTC_TIMESTAMP(), UTC_TIMESTAMP())
        """), {'i': ids[key], 'n': name, 'e': f'{TEST_PREFIX}{ids[key]}@skovo.test'})
    for key, name in (('aa', 'X01 Achiever A'), ('ab', 'X01 Achiever B')):
        db.session.execute(text("""
            INSERT INTO achievers (id, full_name, email, state, status, is_active,
                                   is_verified, created_at, updated_at)
            VALUES (:i, :n, :e, 'active', 'active', 1, 1, UTC_TIMESTAMP(), UTC_TIMESTAMP())
        """), {'i': ids[key], 'n': name, 'e': f'{TEST_PREFIX}{ids[key]}@skovo.test'})
    for ckey, akey in (('ca', 'aa'), ('cb', 'ab')):
        db.session.execute(text("""
            INSERT INTO cohorts (id, title, achiever_id, session_date, duration_minutes,
                                 total_seats, filled_seats, price, status, created_at, updated_at)
            VALUES (:i, 'X01 Cohort', :a, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 2 DAY), 90,
                    NULL, 0, 0, 'upcoming', UTC_TIMESTAMP(), UTC_TIMESTAMP())
        """), {'i': ids[ckey], 'a': ids[akey]})
    db.session.execute(text("""
        INSERT INTO admins (id, full_name, email, password_hash, status, state, created_at)
        VALUES (:i, 'X01 Pending Admin', :e, 'x', 'active', 'pending', UTC_TIMESTAMP())
    """), {'i': ids['admin_pending'], 'e': f'{TEST_PREFIX}{ids["admin_pending"]}@skovo.test'})
    db.session.commit()

    yield ids

    for sql, params in [
        ('DELETE FROM document_vault WHERE user_id IN (:a, :b)', {'a': ids['sa'], 'b': ids['sb']}),
        ('DELETE FROM task_submissions WHERE user_id IN (:a, :b)', {'a': ids['sa'], 'b': ids['sb']}),
        ('DELETE FROM cohort_tasks WHERE cohort_id IN (:a, :b)', {'a': ids['ca'], 'b': ids['cb']}),
        ('DELETE FROM cohort_enrollments WHERE cohort_id IN (:a, :b)', {'a': ids['ca'], 'b': ids['cb']}),
        ('DELETE FROM cohorts WHERE id IN (:a, :b)', {'a': ids['ca'], 'b': ids['cb']}),
        ('DELETE FROM otp_requests WHERE target LIKE :p', {'p': f'{TEST_PREFIX}%'}),
        ('DELETE FROM users WHERE email LIKE :p', {'p': f'{TEST_PREFIX}%'}),
        ('DELETE FROM achievers WHERE email LIKE :p', {'p': f'{TEST_PREFIX}%'}),
        ('DELETE FROM admins WHERE email LIKE :p', {'p': f'{TEST_PREFIX}%'}),
    ]:
        try:
            db.session.execute(text(sql), params)
            db.session.commit()
        except Exception:
            db.session.rollback()


@pytest.fixture
def tok(app):
    def _tok(identity, role=None):
        claims = {'role': role} if role else {}
        if role == 'mentor':
            claims['mentor'] = True
        with app.app_context():
            return {'Authorization':
                    'Bearer ' + create_access_token(identity=str(identity),
                                                    additional_claims=claims)}
    return _tok


# ── Escalation ───────────────────────────────────────────────────────────────

@pytest.mark.case('X01-001')
def test_a_student_cannot_read_another_students_vault(client, two_worlds, tok, db):
    """The vault holds government IDs and marksheets — the highest-value rows a
    student owns. Ownership is enforced by the query, not by the URL, so B's
    document must be absent from A's list rather than merely unlinked."""
    doc = str(uuid.uuid4())
    db.session.execute(text("""
        INSERT INTO document_vault (id, user_id, name, file_url, is_active,
                                    created_at, updated_at)
        VALUES (:i, :u, 'X01 B private doc', '/uploads/b.pdf', 1,
                UTC_TIMESTAMP(), UTC_TIMESTAMP())
    """), {'i': doc, 'u': two_worlds['sb']})
    db.session.commit()

    d = body(client.get(f'{VAULT}/', headers=tok(two_worlds['sa'])))
    assert d['status'] == 200, d
    blob = str(d['response'])
    assert 'X01 B private doc' not in blob, "student A can see student B's document"
    assert doc not in blob


@pytest.mark.case('X01-002')
def test_an_achiever_gets_404_on_another_achievers_cohort(client, two_worlds, tok):
    """404, not 403. A 403 confirms the id exists to anyone probing with a
    valid token, which is a working id oracle."""
    hdr = tok(two_worlds['aa'], 'mentor')
    edit = body(client.put(f'{ACHIEVER}/cohorts/{two_worlds["cb"]}',
                           json={'title': 'stolen'}, headers=hdr))
    assert edit['status'] == 404, edit
    task = body(client.post(f'{ACHIEVER}/tasks',
                            json={'cohort_id': two_worlds['cb'], 'title': 'stolen'},
                            headers=hdr))
    assert task['status'] == 404, task


@pytest.mark.case('X01-003')
@pytest.mark.parametrize('path,method', [
    (f'{ADMIN}/cohorts', 'get'),
    (f'{ADMIN}/achievers', 'get'),
    (f'{ACHIEVER}/cohorts', 'get'),
    (f'{ACHIEVER}/tasks', 'get'),
    (f'{ACHIEVER}/earnings', 'get'),
])
def test_a_student_token_is_refused_on_privileged_endpoints(client, two_worlds, tok,
                                                            path, method):
    d = body(getattr(client, method)(path, headers=tok(two_worlds['sa'])))
    assert d['status'] in (401, 403), f'{path} accepted a student token: {d}'


@pytest.mark.case('X01-004')
def test_a_pending_admin_is_refused_on_admin_paths(client, two_worlds, tok):
    """One before_request over the whole admin prefix, with a self-service
    allowlist — approval is the gate, and it must not be per-route."""
    hdr = tok(two_worlds['admin_pending'], 'admin')
    d = body(client.get(f'{ADMIN}/cohorts', headers=hdr))
    assert d['status'] in (401, 403), f'a pending admin reached /cohorts: {d}'


@pytest.mark.case('X01-005')
def test_a_foreign_payment_order_is_404(client, two_worlds, tok):
    d = body(client.get(f'{COHORTS}/orders/{uuid.uuid4()}', headers=tok(two_worlds['sa'])))
    assert d['status'] in (404, 405), d


@pytest.mark.case('X01-006')
def test_feedback_on_a_foreign_cohort_is_404(client, two_worlds, tok):
    """The guard checks the *specific* cohort, not merely "has this student ever
    been in any cohort of this achiever's" — otherwise a student in one class
    could post a rating carrying another class's id."""
    # Achiever B, but a cohort belonging to achiever A: the id is foreign to the
    # achiever named in the URL, so the answer must be 404. A 403 there would
    # confirm that cohort exists to anyone holding a valid student token.
    #
    # Note the case this does NOT cover, deliberately: posting a cohort the
    # achiever really does own, while simply not being enrolled, answers 403 —
    # and that is right, since it discloses nothing the caller did not supply.
    d = body(client.post(f'{REVIEWS}/{two_worlds["ab"]}',
                         json={'rating': 1, 'context_type': 'cohort',
                               'context_id': two_worlds['ca'], 'review_text': 'x'},
                         headers=tok(two_worlds['sa'])))
    assert d['status'] == 404, d


@pytest.mark.case('X01-007')
def test_extra_json_fields_are_ignored_not_written(client, two_worlds, tok, db):
    """Structurally impossible rather than merely unchecked: every write goes to
    a stored procedure as positional arguments built from an explicit field
    list, so an extra key has no path to a column. This test is the tripwire for
    anyone introducing a `**data` splat into an SP call."""
    hdr = tok(two_worlds['aa'], 'mentor')
    d = body(client.put(f'{ACHIEVER}/cohorts/{two_worlds["ca"]}',
                        json={'title': 'X01 Mass assignment',
                              'achiever_id': two_worlds['ab'],   # steal ownership
                              'filled_seats': 999,
                              'status': 'completed',
                              'commission_rate': 0},
                        headers=hdr))
    assert d['status'] == 200, d
    row = db.session.execute(text(
        'SELECT achiever_id, filled_seats FROM cohorts WHERE id = :i'),
        {'i': two_worlds['ca']}).mappings().first()
    assert row['achiever_id'] == two_worlds['aa'], 'ownership was reassigned from the payload'
    assert int(row['filled_seats'] or 0) == 0, 'filled_seats was written from the payload'


# ── Transport and configuration ──────────────────────────────────────────────

@pytest.mark.case('X01-008')
def test_otp_send_is_throttled(client, db):
    """Five prior requests are written straight to `otp_requests` rather than
    made through the endpoint, so the throttle is proven without sending five
    real emails to a fake address — every one of those would be a hard bounce
    against the live sender."""
    email = f'{TEST_PREFIX}{uuid.uuid4().hex[:10]}@example.com'
    for _ in range(5):
        db.session.execute(text("""
            INSERT INTO otp_requests (id, channel, target, otp_hash, purpose,
                                      attempt_count, expires_at, created_at)
            VALUES (:i, 'email', :t, 'x', 'achiever', 0,
                    DATE_ADD(UTC_TIMESTAMP(), INTERVAL 10 MINUTE), UTC_TIMESTAMP())
        """), {'i': str(uuid.uuid4()), 't': email})
    db.session.commit()
    try:
        d = body(client.post('/v1/achiever/register/send-otp', json={'email': email}))
        assert d['status'] == 429, f'a sixth OTP request was not throttled: {d}'
    finally:
        db.session.execute(text('DELETE FROM otp_requests WHERE target = :t'), {'t': email})
        db.session.commit()


@pytest.mark.case('X01-009')
def test_cors_origins_come_from_configuration(client):
    """Deployment case, asserted at the mechanism. The allowlist is read from
    `CORS_ORIGINS`; the default is `*`, which is one of the four dev shortcuts
    CLAUDE.md §5 says must be closed before the production build. This asserts
    the value is configurable — that setting the variable actually narrows it —
    which is the part code can be responsible for."""
    src = (REPO / 'SKOVO_BACKEND' / 'portal' / '__init__.py').read_text(encoding='utf-8')
    assert "os.environ.get('CORS_ORIGINS'" in src, \
        'the origin allowlist is no longer read from the environment'
    assert re.search(r"CORS_ORIGINS['\"]\s*,\s*['\"]\*['\"]", src), \
        'the documented default changed; update CLAUDE.md §5 if that was deliberate'


@pytest.mark.case('X01-010')
@pytest.mark.case('X01-018')
def test_the_api_sends_its_security_headers(client):
    """Clickjacking (X01-018) rides on the same response. DENY rather than
    SAMEORIGIN: the SPA legitimately wants SAMEORIGIN, an API response should
    never be framed at all."""
    resp = client.get('/v1/auth/masters?type=college_type')
    assert resp.headers.get('X-Content-Type-Options') == 'nosniff'
    assert resp.headers.get('X-Frame-Options') == 'DENY'
    assert resp.headers.get('Referrer-Policy') == 'strict-origin-when-cross-origin'
    assert "frame-ancestors 'none'" in (resp.headers.get('Content-Security-Policy') or '')


@pytest.mark.case('X01-011')
def test_no_endpoint_echoes_secrets_or_a_traceback(client, two_worlds, tok):
    """A 500 must return an error_id and nothing else. The traceback stays
    server-side in `error_logs`, which is the entire point of capture_error."""
    for resp in (client.get('/v1/auth/masters'),
                 client.get(f'{COHORTS}/{uuid.uuid4()}', headers=tok(two_worlds['sa'])),
                 client.get(f'{ACHIEVER}/cohorts', headers=tok(two_worlds['sa'])),
                 client.post('/v1/auth/register', json={'email': 'x'})):
        blob = resp.get_data(as_text=True)
        for marker in SECRET_MARKERS:
            assert marker not in blob, f'{marker!r} leaked in a response body'


@pytest.mark.case('X01-012')
def test_dev_otp_is_absent_when_backend_is_prod(client, monkeypatch):
    """The single most dangerous dev shortcut in the codebase: the guard is
    `os.getenv('Backend', 'DEV') == 'DEV'`, which **fails open** — an unset
    variable means DEV, and `.env.example` ships `Backend=DEV`. Anyone who can
    submit an email address reads the OTP out of the JSON and takes the account.
    """
    monkeypatch.setenv('Backend', 'PROD')
    resp = client.post('/v1/auth/send-otp',
                       json={'email': f'{TEST_PREFIX}{uuid.uuid4().hex[:8]}@example.com'})
    payload = resp.get_json() or {}
    assert 'dev_otp' not in payload, \
        'dev_otp is returned even with Backend=PROD — this is account takeover'
    assert 'dev_otp' not in resp.get_data(as_text=True)


@pytest.mark.case('X01-013')
def test_the_werkzeug_debugger_is_bound_to_the_environment(app):
    """Deployment case, asserted at the binding.

    The debugger is remote code execution, so what matters is that it can never
    be on in production — not that it is off in this process, which runs as DEV
    and therefore legitimately has it on. `portal/__init__.py` sets
    `APP.debug = environment == 'DEV'`, so PROD turns it off with no other
    change. This pins that line and checks the running app agrees with its own
    environment; if the binding is ever replaced by a literal, it fails.
    """
    src = (REPO / 'SKOVO_BACKEND' / 'portal' / '__init__.py').read_text(encoding='utf-8')
    assert "APP.debug = environment == 'DEV'" in src, \
        'debug is no longer derived from the environment'
    assert app.debug is (os.getenv('Backend', 'DEV') == 'DEV'), \
        'the app disagrees with its own environment about debug'


@pytest.mark.case('X01-014')
def test_an_html_or_svg_upload_is_refused(client, two_worlds, tok):
    """An SVG is a script container and HTML served from our own origin is
    same-origin XSS, so neither belongs in the allowlist whatever the magic
    bytes say."""
    import io as _io
    for name, content in (('evil.html', b'<script>alert(1)</script>'),
                          ('evil.svg', b'<svg onload="alert(1)"/>')):
        resp = client.post('/v1/upload/',
                           data={'file': (_io.BytesIO(content), name)},
                           headers=tok(two_worlds['sa']),
                           content_type='multipart/form-data')
        d = resp.get_json() or {}
        assert d.get('status') != 200, f'{name} was accepted as an upload: {d}'


@pytest.mark.case('X01-015')
def test_presigned_urls_carry_a_bounded_expiry(client):
    """Deployment-adjacent: the redirect must not be replayable for ever."""
    src = (REPO / 'SKOVO_BACKEND' / 'portal' / 'helpers' / 'storage.py').read_text(encoding='utf-8')
    assert 'ExpiresIn' in src, 'presigned URLs no longer set an expiry'
    caps = [int(n) for n in re.findall(r'expires\s*=\s*(\d+)', src)]
    assert caps, 'no default expiry found to check'
    assert max(caps) <= 24 * 3600, f'a presigned URL lives for {max(caps)}s'


# ── Data integrity ───────────────────────────────────────────────────────────

@pytest.mark.case('X01-016')
def test_quotes_and_sql_metacharacters_are_stored_verbatim(client, two_worlds, tok, db):
    payload = "Robert'); DROP TABLE cohorts;--"
    d = body(client.put(f'{ACHIEVER}/cohorts/{two_worlds["ca"]}',
                        json={'title': payload}, headers=tok(two_worlds['aa'], 'mentor')))
    assert d['status'] == 200, d
    stored = db.session.execute(text('SELECT title FROM cohorts WHERE id = :i'),
                                {'i': two_worlds['ca']}).scalar()
    assert stored == payload
    assert db.session.execute(text(
        "SELECT COUNT(*) FROM information_schema.tables "
        "WHERE table_schema = DATABASE() AND table_name = 'cohorts'")).scalar() == 1


@pytest.mark.case('X01-017')
def test_the_spa_never_uses_dangerouslysetinnerhtml():
    """React escapes by default, so the only way to introduce XSS in this client
    is to opt out. Grepping is the right check here: one instance anywhere is a
    hole, and no runtime test would find it in an unvisited component."""
    src_dir = REPO / 'Skovo' / 'src'
    if not src_dir.exists():
        pytest.skip('SPA source not present in this checkout')
    offenders = []
    for path in src_dir.rglob('*.js*'):
        txt = path.read_text(encoding='utf-8', errors='ignore')
        if 'dangerouslySetInnerHTML' in txt or re.search(r'\.innerHTML\s*=', txt):
            offenders.append(str(path.relative_to(REPO)))
    assert not offenders, f'unescaped HTML injection points: {offenders}'


@pytest.mark.case('X01-019')
def test_filled_seats_equals_the_count_of_real_enrolments(db):
    """A whole-table invariant, not a sampled one. Drift means the counter moved
    without a real student behind it — the exact bug that put phantom students
    in a cohort when the increment sat at hold time instead of payment time."""
    drift = db.session.execute(text("""
        SELECT c.id, c.filled_seats,
               (SELECT COUNT(*) FROM cohort_enrollments e
                 WHERE e.cohort_id = c.id AND e.payment_status IN ('paid', 'free')) AS real_count
          FROM cohorts c
         WHERE c.deleted_at IS NULL
        HAVING c.filled_seats <> real_count
    """)).mappings().all()
    assert not drift, f'filled_seats disagrees with enrolments: {[dict(r) for r in drift]}'


@pytest.mark.case('X01-020')
def test_failed_checkouts_do_not_move_filled_seats(client, two_worlds, tok, db):
    """Five in a row, because the counter moving is cumulative: one attempt
    could hide a drift of one behind a rounding assumption."""
    db.session.execute(text('UPDATE cohorts SET price = 499 WHERE id = :i'),
                       {'i': two_worlds['ca']})
    db.session.commit()
    before = db.session.execute(text('SELECT filled_seats FROM cohorts WHERE id = :i'),
                                {'i': two_worlds['ca']}).scalar()
    for _ in range(5):
        client.post(f'{COHORTS}/{two_worlds["ca"]}/enroll',
                    json={'phone': '9876543210'}, headers=tok(two_worlds['sa']))
    after = db.session.execute(text('SELECT filled_seats FROM cohorts WHERE id = :i'),
                               {'i': two_worlds['ca']}).scalar()
    assert int(after or 0) == int(before or 0), \
        f'five failed checkouts moved filled_seats {before} -> {after}'
    db.session.execute(text('DELETE FROM payment_orders WHERE ref_id = :c'),
                       {'c': two_worlds['ca']})
    db.session.commit()


@pytest.mark.case('X01-021')
def test_error_logs_holds_nothing_already_fixed(db):
    """EXPECTED TO FAIL while stale rows remain, and that is the point.

    The working agreement is that a fixed error's row is deleted, because the
    table is meant to show what is broken *now* — a fixed error left sitting
    there sends the next person chasing something that no longer exists.

    Two groups are provably stale: the synthetic `database is on fire` rows,
    which `test_score_api.py` injects to prove capture_error works and which
    never represented a real fault, and the `doesn't exist` rows for tables that
    have since been created. Deleting them needs a permission this session does
    not have; until someone does, this stays red.
    """
    stale = db.session.execute(text("""
        SELECT error_type, COUNT(*) n FROM error_logs
         WHERE error_message LIKE '%database is on fire%'
            OR error_message LIKE '%doesn''t exist%'
            OR error_type = 'ProfileNotFound'
         GROUP BY error_type
    """)).mappings().all()
    assert not stale, (
        'error_logs still holds rows for bugs that are fixed or were never real: '
        f'{[dict(r) for r in stale]}')


@pytest.mark.case('X01-022')
def test_error_logs_records_the_whole_exception(db):
    """The columns support triage, so a row missing traceback or endpoint is a
    row nobody can act on."""
    cols = {r[0] for r in db.session.execute(text(
        "SELECT column_name FROM information_schema.columns "
        "WHERE table_schema = DATABASE() AND table_name = 'error_logs'"))}
    assert {'error_id', 'endpoint', 'method', 'status_code', 'error_type',
            'error_message', 'traceback', 'created_at'} <= cols
    row = db.session.execute(text(
        'SELECT error_id, endpoint, traceback FROM error_logs '
        'ORDER BY created_at DESC LIMIT 1')).mappings().first()
    if row:
        assert row['error_id'] and len(row['error_id']) <= 16
        assert row['endpoint'] and row['traceback']


@pytest.mark.case('X01-023')
def test_checkout_failures_are_wired_into_error_logs():
    """The sheet records this as a KNOWN GAP; it was closed on 5 Sep. Asserted
    at the source because provoking a real gateway failure needs Cashfree, which
    cannot complete an order on this account at all."""
    src = (REPO / 'SKOVO_BACKEND' / 'portal' / 'routes' / 'Cohorts' / 'cohorts.py'
           ).read_text(encoding='utf-8')
    assert 'CashfreeError' in src
    block = src[src.index('CashfreeError'):]
    assert 'capture_error' in block, \
        'the gateway failure path no longer captures the error'


@pytest.mark.case('X01-024')
def test_a_404_never_reaches_error_logs(client, db, two_worlds, tok):
    """HTTPException is deliberately re-raised rather than logged: 400s and 404s
    are the API working, and logging them buries the real faults."""
    before = db.session.execute(text('SELECT COUNT(*) FROM error_logs')).scalar()
    client.get(f'{COHORTS}/{uuid.uuid4()}', headers=tok(two_worlds['sa']))
    client.get('/v1/definitely-not-a-route')
    after = db.session.execute(text('SELECT COUNT(*) FROM error_logs')).scalar()
    assert after == before, 'a 404 was written to error_logs'


@pytest.mark.case('X01-025')
def test_timestamps_are_stored_utc(db, two_worlds):
    """`created_at` is written with UTC_TIMESTAMP(), so a row created moments ago
    must be within a minute of UTC now — not 5h30m away from it."""
    delta = db.session.execute(text("""
        SELECT ABS(TIMESTAMPDIFF(MINUTE, created_at, UTC_TIMESTAMP()))
          FROM cohorts WHERE id = :i
    """), {'i': two_worlds['ca']}).scalar()
    assert delta is not None and delta <= 2, \
        f'created_at is {delta} minutes from UTC now — storage is not UTC'


@pytest.mark.case('X01-026')
def test_the_migration_runner_can_baseline_without_replaying_master_data():
    """`--procs-only` also loads `seeds/master_data.sql`, whose ON DUPLICATE
    clause writes `is_active=VALUES(is_active)` — so any row it carries as
    inactive is forced inactive, silently undoing an activation made through the
    admin Masters screen. The opt-out has to exist."""
    runner = REPO / 'SKOVO_BACKEND' / 'apply_all.py'
    if not runner.exists():
        pytest.skip('apply_all.py not present in this checkout')
    src = runner.read_text(encoding='utf-8')
    assert '--skip-master-data' in src, 'the master-data opt-out is gone'
    assert '--baseline' in src


@pytest.mark.case('X01-027')
def test_a_soft_deleted_task_leaves_its_submissions_intact(client, two_worlds, tok, db):
    """Deleting the assignment must not destroy the evidence a student
    submitted against it — that is someone's work, and the row is also what a
    dispute would rest on."""
    hdr = tok(two_worlds['aa'], 'mentor')
    made = body(client.post(f'{ACHIEVER}/tasks',
                            json={'cohort_id': two_worlds['ca'], 'title': 'X01 Soft delete'},
                            headers=hdr))
    task_id = made['response']['task_id']
    sub = str(uuid.uuid4())
    db.session.execute(text("""
        INSERT INTO task_submissions (id, task_id, user_id, evidence_text, status,
                                      submitted_at, created_at, updated_at)
        VALUES (:i, :t, :u, 'my work', 'submitted',
                UTC_TIMESTAMP(), UTC_TIMESTAMP(), UTC_TIMESTAMP())
    """), {'i': sub, 't': task_id, 'u': two_worlds['sa']})
    db.session.commit()

    gone = body(client.delete(f'{ACHIEVER}/tasks/{task_id}', headers=hdr))
    assert gone['status'] == 200, gone

    still = db.session.execute(text(
        'SELECT COUNT(*) FROM task_submissions WHERE id = :i'), {'i': sub}).scalar()
    assert still == 1, 'deleting a task destroyed the student submission under it'
    db.session.execute(text('DELETE FROM task_submissions WHERE id = :i'), {'i': sub})
    db.session.commit()


@pytest.mark.case('X01-028')
def test_one_address_cannot_exist_in_two_identity_tables(client, two_worlds, db):
    """The users table's UNIQUE key cannot see the achievers table, so
    uniqueness across all four portals is enforced by sp_identity_email_lookup.
    The same person must not be both a student and an achiever."""
    taken = db.session.execute(text('SELECT email FROM achievers WHERE id = :i'),
                               {'i': two_worlds['aa']}).scalar()
    d = body(client.post('/v1/auth/register', json={
        'full_name': 'X01 Clash', 'email': taken, 'password': 'ValidPass123'}))
    assert d['status'] == 409, f'an achiever address registered as a student too: {d}'
    n = db.session.execute(text('SELECT COUNT(*) FROM users WHERE email = :e'),
                           {'e': taken}).scalar()
    assert n == 0
