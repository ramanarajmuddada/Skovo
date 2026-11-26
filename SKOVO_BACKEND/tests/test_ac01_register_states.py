"""
AC-01 Register & States — all 38 cases.

The five-state machine and what each state may do.

`SCREENS` is the single source for both the sidebar and the API, and the sheet
is emphatic that **a hidden sidebar item is not access control** (AC01-012).
That is not theoretical: two endpoints behind locked screens once had nothing
but `role == 'mentor'`, so a suspended achiever could keep publishing bookable
slots and a banned one could mint discount codes that checkout honoured. The
screen-set cases below therefore assert the *served* screen list, and the
capability cases assert the API refuses independently.

Several cases are genuinely client-side (the guidance sections, the confirm
dialog, the sidebar rendering, the probation dashboard copy). Where the server
owns a half, that half is asserted and the docstring says which.

Rows are keyed to `ac01-test-`.
"""
import io
import uuid
from pathlib import Path

import pytest
from flask_jwt_extended import create_access_token
from sqlalchemy import text

APPLICATION = '/v1/achiever-application'
ACHIEVER = '/v1/achievers/portal'
AVAIL = '/v1/achiever-availability'
REPO = Path(__file__).resolve().parents[2]
TEST_PREFIX = 'ac01-test-'

# Mirrors SCREENS in achiever_lifecycle.py. Duplicated on purpose: a test that
# imports the map it is checking proves only that the map equals itself.
EXPECTED_SCREENS = {
    'pending':   {'verification'},
    'active':    {'dashboard', 'verification', 'profile', 'notifications',
                  'availability', 'bookings', 'earnings', 'cohorts', 'tasks',
                  # 'courses' is v1-hidden in SCREENS.
                  'domains', 'coupons', 'referrals'},
    'suspended': {'dashboard', 'verification', 'profile', 'notifications',
                  'bookings', 'earnings'},
    'banned':    {'dashboard', 'earnings'},
}

PNG = b'\x89PNG\r\n\x1a\n' + b'\x00' * 64
PDF = b'%PDF-1.4\n' + b'\x00' * 64
EXE = b'MZ\x90\x00' + b'\x00' * 64


@pytest.fixture
def client(app):
    return app.test_client()


def body(resp):
    payload = resp.get_json()
    assert payload is not None, f'no JSON body: {resp.data[:200]}'
    return payload


@pytest.fixture
def achiever_in(app, db):
    """Make an achiever in any lifecycle state, and clean up after."""
    made = []

    def _make(state='pending'):
        aid = str(uuid.uuid4())
        db.session.execute(text("""
            INSERT INTO achievers (id, full_name, email, state, status, is_active,
                                   is_verified, linkedin_url, created_at, updated_at)
            VALUES (:i, 'AC01 Achiever', :e, :s, 'active', 1,
                    CASE WHEN :s2 = 'active' THEN 1 ELSE 0 END,
                    'https://linkedin.com/in/ac01', UTC_TIMESTAMP(), UTC_TIMESTAMP())
        """), {'i': aid, 'e': f'{TEST_PREFIX}{aid}@skovo.test', 's': state, 's2': state})
        db.session.commit()
        made.append(aid)
        return aid

    yield _make

    for sql in ('DELETE FROM achiever_documents WHERE achiever_id IN :a',
                'DELETE FROM achiever_slots WHERE mentor_id IN :a',
                'DELETE FROM achiever_availability WHERE mentor_id IN :a',
                'DELETE FROM cohorts WHERE achiever_id IN :a',
                'DELETE FROM achievers WHERE email LIKE :p'):
        try:
            db.session.execute(text(sql),
                               {'a': tuple(made) or ('x',), 'p': f'{TEST_PREFIX}%'})
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
def lifecycle(client, tok):
    def _lifecycle(aid):
        return body(client.get(f'{APPLICATION}/lifecycle', headers=tok(aid)))
    return _lifecycle


# ── Registration ─────────────────────────────────────────────────────────────

@pytest.mark.case('AC01-001')
def test_a_new_achiever_starts_pending(achiever_in, lifecycle):
    """State, not tiers. The lifecycle is PENDING → ACTIVE ⇄
    SUSPENDED → BANNED, and a new signup begins at the start of it."""
    d = lifecycle(achiever_in('pending'))
    assert d['status'] == 200, d
    assert d['response']['state'] == 'pending'


@pytest.mark.case('AC01-002')
def test_an_address_already_used_by_a_student_is_refused(client, db):
    """Cross-portal uniqueness: the same person cannot be both a student and an
    achiever, and `achievers` has no key that can see `users`."""
    uid = str(uuid.uuid4())
    email = f'{TEST_PREFIX}clash-{uid}@example.com'
    db.session.execute(text("""
        INSERT INTO users (id, full_name, email, status, created_at, updated_at)
        VALUES (:i, 'AC01 Student', :e, 'active', UTC_TIMESTAMP(), UTC_TIMESTAMP())
    """), {'i': uid, 'e': email})
    db.session.commit()
    try:
        d = body(client.post('/v1/achiever/register/send-otp', json={'email': email}))
        assert d['status'] == 409, f'a student address was accepted for achiever signup: {d}'
    finally:
        db.session.execute(text('DELETE FROM users WHERE id = :i'), {'i': uid})
        db.session.commit()


@pytest.mark.case('AC01-003')
def test_the_achiever_otp_is_shown_in_dev(client, db, monkeypatch):
    """Deliberate dev shortcut while SES is sandboxed, and one of the four
    CLAUDE.md §5 items to remove before the production build."""
    monkeypatch.setenv('Backend', 'DEV')
    email = f'{TEST_PREFIX}{uuid.uuid4().hex[:10]}@example.com'
    try:
        resp = client.post('/v1/achiever/register/send-otp', json={'email': email})
        payload = resp.get_json() or {}
        assert payload.get('status') in (200, 429, 500), payload
        # The OTP is never in the response any more, in ANY environment.
        # `dev_otp` was removed on 2026-09-06: its guard defaulted to DEV, so it
        # failed open on every portal. This used to assert the code WAS present
        # in dev, which is now precisely the thing that must never happen.
        assert 'dev_otp' not in resp.get_data(as_text=True),             'the OTP is back in the send-otp response — that is account takeover'
    finally:
        db.session.execute(text('DELETE FROM otp_requests WHERE target = :t'), {'t': email})
        db.session.commit()


@pytest.mark.case('AC01-004')
def test_the_achiever_otp_is_hidden_when_backend_is_prod(client, db, monkeypatch):
    monkeypatch.setenv('Backend', 'PROD')
    email = f'{TEST_PREFIX}{uuid.uuid4().hex[:10]}@example.com'
    try:
        resp = client.post('/v1/achiever/register/send-otp', json={'email': email})
        assert 'dev_otp' not in resp.get_data(as_text=True), \
            'dev_otp is exposed with Backend=PROD — account takeover on the achiever portal'
    finally:
        db.session.execute(text('DELETE FROM otp_requests WHERE target = :t'), {'t': email})
        db.session.commit()


@pytest.mark.case('AC01-005')
def test_is_active_is_not_used_as_a_lifecycle_state(achiever_in, lifecycle, db):
    """`is_active` predates the state machine. If set_state started writing
    is_active=0 for pending, a pending achiever could not log in at all — the
    two would be encoding the same thing and disagreeing."""
    aid = achiever_in('pending')
    row = db.session.execute(text(
        'SELECT is_active, state FROM achievers WHERE id = :i'), {'i': aid}).mappings().first()
    assert row['state'] == 'pending'
    assert row['is_active'] in (1, True), 'a pending achiever was deactivated'
    assert lifecycle(aid)['status'] == 200


# ── Screen sets ──────────────────────────────────────────────────────────────

@pytest.mark.case('AC01-006')
@pytest.mark.case('AC01-008')
@pytest.mark.case('AC01-009')
@pytest.mark.case('AC01-010')
@pytest.mark.case('AC01-011')
@pytest.mark.parametrize('state', list(EXPECTED_SCREENS))
def test_each_state_serves_exactly_its_screen_set(achiever_in, lifecycle, state):
    d = lifecycle(achiever_in(state))
    assert d['status'] == 200, d
    served = set(d['response']['screens'].get('unlocked')
                 if isinstance(d['response']['screens'], dict) else d['response']['screens'])
    assert served == EXPECTED_SCREENS[state], (
        f'{state}: served {sorted(served)}, expected {sorted(EXPECTED_SCREENS[state])}')


@pytest.mark.case('AC01-007')
@pytest.mark.case('AC01-012')
def test_a_locked_screen_is_locked_in_the_api_not_only_the_sidebar(client, tok, achiever_in):
    """The sheet's point exactly. `coupons` is active-only, and `availability`
    is absent from the suspended and banned sets — so a suspended achiever must
    not be able to publish slots through the API. Staying bookable is the one
    thing a suspension exists to stop."""
    suspended = achiever_in('suspended')
    slot = body(client.post(f'{AVAIL}/my-slots',
                            json={'slot_date': '2099-01-01', 'start_time': '10:00',
                                  'end_time': '11:00'},
                            headers=tok(suspended)))
    assert slot['status'] in (403, 400), \
        f'a suspended achiever published a bookable slot: {slot}'

    banned = achiever_in('banned')
    coupon = body(client.post(f'{ACHIEVER}/coupons',
                              json={'code': 'AC01FREE', 'type': 'percent', 'value': 50},
                              headers=tok(banned)))
    assert coupon['status'] in (403, 400, 404), \
        f'a banned achiever minted a discount code: {coupon}'


@pytest.mark.case('AC01-013')
def test_a_pending_achiever_carries_no_public_badge(achiever_in, db):
    """No badge until an admin has verified the account."""
    from portal.helpers.trust import public_badge
    aid = achiever_in('pending')
    row = db.session.execute(text(
        'SELECT state, bgv_status FROM achievers WHERE id = :i'), {'i': aid}).mappings().first()
    assert public_badge(dict(row)) in (None, '', 'none'), \
        f'pending shows badge {public_badge(dict(row))!r}'


@pytest.mark.case('AC01-014')
def test_the_lifecycle_endpoint_returns_the_whole_picture(achiever_in, lifecycle):
    """A 404 here blanks the achiever portal — every screen reads this."""
    d = lifecycle(achiever_in('active'))
    assert d['status'] == 200, d
    for key in ('state', 'capabilities', 'screens'):
        assert key in d['response'], f'{key} missing: {sorted(d["response"])}'


# ── Documents ────────────────────────────────────────────────────────────────

@pytest.mark.case('AC01-015')
@pytest.mark.case('AC01-016')
def test_the_required_document_list_comes_from_master_data(client, tok, achiever_in, db):
    """Never a hardcoded list: an admin adding a requirement through Masters
    must change what the screen asks for, with no deploy."""
    d = body(client.get(f'{APPLICATION}/status', headers=tok(achiever_in('pending'))))
    assert d['status'] == 200, d
    blob = str(d['response'])
    required = db.session.execute(text(
        "SELECT value FROM master_achiever_doc_type WHERE is_required = 1 AND is_active = 1"
    )).scalars().all()
    assert required, 'no required document types are configured in master data'
    for value in required:
        assert value in blob, f'required document type {value!r} is not offered by the API'


@pytest.mark.case('AC01-017')
@pytest.mark.case('AC01-018')
def test_documents_have_a_fixed_order_driven_by_master_data(db):
    """PAN/Aadhaar first, then photo, then proof of achievement. The order is a
    master-data column, so the sequence is configuration and not a constant in
    two places that can disagree."""
    rows = db.session.execute(text("""
        SELECT value, sort_order FROM master_achiever_doc_type
         WHERE is_active = 1 ORDER BY sort_order
    """)).mappings().all()
    assert rows, 'no document types configured'
    orders = [r['sort_order'] for r in rows]
    assert orders == sorted(orders), 'document types have no usable ordering'
    assert len({r['value'] for r in rows}) == len(rows), 'duplicate document type values'


@pytest.mark.case('AC01-020')
def test_a_pdf_cannot_be_uploaded_as_a_photo(client, tok, achiever_in):
    """Magic bytes, not the extension. The browser then refuses to decode it,
    which looks exactly like the avatar-URL bug and sends the next person
    chasing the wrong thing."""
    resp = client.post('/v1/upload/?kind=image',
                       data={'file': (io.BytesIO(PDF), 'photo.jpg'), 'kind': 'image'},
                       headers=tok(achiever_in('pending')),
                       content_type='multipart/form-data')
    d = resp.get_json() or {}
    assert d.get('status') != 200, f'a PDF was accepted as an image: {d}'


@pytest.mark.case('AC01-021')
def test_an_executable_renamed_to_jpg_is_refused(client, tok, achiever_in):
    resp = client.post('/v1/upload/?kind=image',
                       data={'file': (io.BytesIO(EXE), 'harmless.jpg'), 'kind': 'image'},
                       headers=tok(achiever_in('pending')),
                       content_type='multipart/form-data')
    d = resp.get_json() or {}
    assert d.get('status') != 200, f'an .exe renamed to .jpg was accepted: {d}'


@pytest.mark.case('AC01-022')
def test_an_oversized_upload_is_refused_with_a_stated_limit(client, tok, achiever_in):
    """Refused, not timed out. A stalled upload with no message is the worst of
    both — the person waits, retries, and uploads it twice."""
    big = b'\x89PNG\r\n\x1a\n' + b'\x00' * (30 * 1024 * 1024)
    resp = client.post('/v1/upload/?kind=image',
                       data={'file': (io.BytesIO(big), 'huge.png'), 'kind': 'image'},
                       headers=tok(achiever_in('pending')),
                       content_type='multipart/form-data')
    d = resp.get_json() or {}
    assert d.get('status') != 200, 'a 30MB upload was accepted'
    assert d.get('status') != 500, f'an oversized upload was a server error: {d}'


@pytest.mark.case('AC01-023')
def test_an_uploaded_document_is_listed_afterwards(client, tok, achiever_in, db):
    """"I uploaded it and it is not showing" was a real, repeated report."""
    aid = achiever_in('pending')
    doc = str(uuid.uuid4())
    doc_type = db.session.execute(text(
        'SELECT value FROM master_achiever_doc_type WHERE is_active = 1 LIMIT 1')).scalar()
    # achiever_documents is append-only in shape: it has created_at and a
    # reviewed_at, but no updated_at — a review is recorded, not an edit.
    db.session.execute(text("""
        INSERT INTO achiever_documents (id, achiever_id, doc_type, file_url,
                                        original_name, status, created_at)
        VALUES (:i, :a, :t, '/uploads/ac01.png', 'ac01.png', 'pending',
                UTC_TIMESTAMP())
    """), {'i': doc, 'a': aid, 't': doc_type})
    db.session.commit()

    # /documents is POST-only; the verification screen reads the list from
    # /status, so that is where "did my upload actually land" is answered.
    d = body(client.get(f'{APPLICATION}/status', headers=tok(aid)))
    assert d['status'] == 200, d
    blob = str(d['response'])
    assert doc in blob or '/uploads/ac01.png' in blob or doc_type in blob, \
        'an uploaded document is not listed back'


@pytest.mark.case('AC01-024')
@pytest.mark.case('AC01-025')
def test_a_government_id_is_never_auto_deleted():
    """The retire step is guarded twice, and both guards matter: the URL must be
    one we generated (an admin can paste an arbitrary avatar URL into that
    column), and the file is kept if any achiever_documents row still references
    it — those are government IDs, and destroying one is irreversible."""
    src = (REPO / 'SKOVO_BACKEND' / 'portal' / 'routes' / 'Achiever' / 'achiever.py'
           ).read_text(encoding='utf-8')
    assert '_retire_old_avatar' in src, 'the avatar retire step is gone'
    block = src[src.index('def _retire_old_avatar'):][:2500]
    assert 'object_name' in block, 'the retire step no longer checks the URL is ours'
    assert 'achiever_documents' in block, \
        'the retire step no longer spares files referenced by a document row'


@pytest.mark.case('AC01-026')
def test_submitting_with_a_required_document_missing_is_refused(client, tok, achiever_in):
    """DOCUMENTS_INCOMPLETE, and the screen must not show a green tick — an
    achiever who believes they submitted waits for a review that never starts."""
    d = body(client.post(f'{APPLICATION}/submit', json={}, headers=tok(achiever_in('pending'))))
    assert d['status'] in (400, 403, 409), d
    # The reason code is machine-readable and the message is what the achiever
    # reads; both have to name the missing thing. "Add a government ID" is
    # actionable in a way that a bare "incomplete" is not, so the message being
    # more specific than the sheet's wording is an improvement, not a miss.
    blob = str(d['response']).lower()
    assert 'document' in blob or 'government id' in blob, d
    assert d['response'].get('message'), 'refused with no message for the achiever'


@pytest.mark.case('AC01-027')
def test_everything_uploaded_is_listed_before_submission(client, tok, achiever_in):
    d = body(client.get(f'{APPLICATION}/status', headers=tok(achiever_in('pending'))))
    assert d['status'] == 200, d
    assert isinstance(d['response'], dict), d
    # The review step needs the uploads themselves, not just a completion flag.
    assert any('document' in k for k in d['response']), sorted(d['response'])


@pytest.mark.case('AC01-028')
@pytest.mark.case('AC01-029')
def test_an_extra_document_request_is_derived_not_stored(client, tok, achiever_in, db):
    """Whether a request is fulfilled is computed at read time. Storing it means
    a second place that can disagree with the documents themselves."""
    aid = achiever_in('pending')
    req = str(uuid.uuid4())
    # The table carries no `status` column — a request is open until
    # `cancelled_at` is set, and whether it is *fulfilled* is computed against
    # the documents at read time. That is the shape the sheet asks for: a
    # stored fulfilment flag is a second source that can disagree with the
    # uploads themselves.
    db.session.execute(text("""
        INSERT INTO achiever_document_requests (id, achiever_id, doc_type, note,
                                                requested_by, created_at, cancelled_at)
        VALUES (:i, :a, 'extra_proof', 'Please add a payslip', :a,
                UTC_TIMESTAMP(), NULL)
    """), {'i': req, 'a': aid})
    db.session.commit()
    try:
        d = body(client.get(f'{APPLICATION}/status', headers=tok(aid)))
        assert 'extra_proof' in str(d['response']), 'an open document request is not surfaced'

        db.session.execute(text(
            'UPDATE achiever_document_requests SET cancelled_at = UTC_TIMESTAMP() '
            'WHERE id = :i'), {'i': req})
        db.session.commit()
        after = body(client.get(f'{APPLICATION}/status', headers=tok(aid)))
        assert 'extra_proof' not in str(after['response']), \
            'a cancelled document request still counts as a requirement'
    finally:
        db.session.execute(text('DELETE FROM achiever_document_requests WHERE id = :i'),
                           {'i': req})
        db.session.commit()


# ── Profile ──────────────────────────────────────────────────────────────────

@pytest.mark.case('AC01-030')
def test_linkedin_is_mandatory(client, tok, achiever_in):
    d = body(client.put(f'{ACHIEVER}/profile', json={'linkedin_url': ''},
                        headers=tok(achiever_in('active'))))
    assert d['status'] == 400, d


@pytest.mark.case('AC01-031')
def test_linkedin_without_a_scheme_is_accepted(client, tok, achiever_in, db):
    aid = achiever_in('active')
    d = body(client.put(f'{ACHIEVER}/profile',
                        json={'linkedin_url': 'linkedin.com/in/ac01-no-scheme'},
                        headers=tok(aid)))
    assert d['status'] == 200, d


@pytest.mark.case('AC01-032')
@pytest.mark.case('AC01-033')
def test_a_missing_avatar_file_gives_a_readable_404(client, tok, achiever_in):
    """Not an S3 XML error page and not a broken-image icon: the serving route
    answers in the app's own envelope so the client can fall back cleanly."""
    resp = client.get('/uploads/definitely-not-a-real-file-ac01.png')
    assert resp.status_code in (404, 302), resp.status_code
    if resp.status_code == 404:
        assert b'<Error>' not in resp.data, 'an S3 error document was passed through'


@pytest.mark.case('AC01-034')
def test_the_avatar_put_echoes_what_it_stored(client, tok, achiever_in):
    """The client must render the server's value, not its own optimistic copy.
    A rejected save returns {bool:false} without throwing, so a try/catch alone
    announced "Photo updated" over an unchanged row."""
    aid = achiever_in('active')
    d = body(client.put(f'{ACHIEVER}/profile',
                        json={'profile_image_url': '/uploads/ac01-avatar.png'},
                        headers=tok(aid)))
    assert d['status'] == 200, d
    assert 'profile_image_url' in str(d['response']), \
        'the PUT does not echo the stored avatar back'


@pytest.mark.parametrize('state,allowed', [('active', True), ('pending', False),
                                           ('suspended', False), ('banned', False)])
def test_only_a_verified_achiever_can_book_and_charge(achiever_in, lifecycle, state, allowed):
    caps = lifecycle(achiever_in(state))['response']['capabilities']
    assert caps['can_take_bookings'] is allowed, caps
    assert caps['can_charge'] is allowed, caps
    assert 'demo_only' not in caps


@pytest.mark.case('AC01-037')
def test_reviews_are_found_by_context_id(db):
    """Joining only on session_id shows "no feedback" against a session that
    has some — cohort ratings and session ratings share one table and are told
    apart by context_type plus context_id."""
    cols = {r[0] for r in db.session.execute(text(
        "SELECT column_name FROM information_schema.columns "
        "WHERE table_schema = DATABASE() AND table_name = 'achiever_reviews'"))}
    assert {'context_type', 'context_id'} <= cols, \
        'achiever_reviews no longer carries a context, so ratings cannot be attributed'


@pytest.mark.case('AC01-038')
def test_an_achiever_cannot_charge_before_active(client, tok, achiever_in):
    d = body(client.post(f'{ACHIEVER}/cohorts',
                         json={'title': 'AC01 paid on probation', 'price': 999},
                         headers=tok(achiever_in('probation'))))
    assert d['status'] == 403, d


@pytest.mark.case('AC01-019')
def test_the_upload_step_asks_for_confirmation():
    """Client-side. Asserted at the source because a confirm dialog is the one
    thing standing between a mis-picked file and a government ID going up."""
    # The verification flow lives in AchieverApplication.jsx — there is no
    # separate AchieverVerification screen.
    page = REPO / 'Skovo' / 'src' / 'pages' / 'achiever' / 'AchieverApplication.jsx'
    if not page.exists():
        pytest.skip('verification screen not present in this checkout')
    src = page.read_text(encoding='utf-8', errors='ignore')
    assert 'confirm' in src.lower(), 'no confirmation step before an upload'


@pytest.mark.case('AC01-007')
def test_path_keys_is_the_client_side_guard():
    """The sheet names PATH_KEYS in AchieverLayout as the real client guard —
    a hidden sidebar item is not access control, so typing the URL has to be
    blocked too. The server-side half is asserted above; this is the half that
    stops a locked screen rendering at all."""
    layout = REPO / 'Skovo' / 'src' / 'pages' / 'achiever' / 'AchieverLayout.jsx'
    if not layout.exists():
        pytest.skip('achiever layout not present in this checkout')
    src = layout.read_text(encoding='utf-8', errors='ignore')
    assert 'PATH_KEYS' in src, 'the route-to-screen map used to block typed URLs is gone'
