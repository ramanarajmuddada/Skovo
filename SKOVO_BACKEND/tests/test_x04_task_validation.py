"""
X-04 Field validation — "Task create" (X04-108…135) and "Task submission"
(X04-148…157). 38 cases.

Two areas in one file because they are two ends of one field: the achiever's
`attachment_url` and the student's `evidence_url` are both rendered as an
`<a href>` by the other party, so they must enforce the same scheme allowlist.
They did not always — `evidence_url` had NO validation at all, which made
`javascript:` there stored XSS aimed at the one person guaranteed to click it.
`helpers/links.py` now owns that rule for both; these cases are what keeps the
two from drifting apart again.

Where the sheet says "refused", the assertion is a 400 that names the field and
carries no `error_id` — a 500 also refuses the input, and a test that only
checks "not saved" cannot tell the two apart.

Rows are keyed to `x04-task-test-` and removed in teardown.
"""
import datetime
import uuid

import pytest
from flask_jwt_extended import create_access_token
from sqlalchemy import text

ACHIEVER_TASKS = '/v1/achievers/portal/tasks'
TASKS = '/v1/tasks'
TEST_PREFIX = 'x04-task-test-'

UNICODE = 'Café ☕ 日本語 — Ω 🎓'
HTML = '<script>alert("xss")</script><b>bold</b>'
SQLI = "O'Brien; DROP TABLE cohort_tasks;--"
NEWLINES = 'Step one\nStep two\n\nStep four'


@pytest.fixture
def client(app):
    return app.test_client()


def body(resp):
    payload = resp.get_json()
    assert payload is not None, f'no JSON body: {resp.data[:200]}'
    return payload


def refused(d, *, naming):
    assert d['status'] == 400, d
    msg = d['response'].get('message', '')
    assert naming.lower() in msg.lower(), f'message does not name {naming!r}: {msg!r}'
    assert d['response'].get('error_id') is None, \
        f'refusal was captured as a server error: {d["response"]}'


def never_a_500(d):
    """For the cases the sheet leaves open ("accepted or a stated limit")."""
    assert d['status'] in (200, 201, 400), d
    if d['status'] == 400:
        assert d['response'].get('error_id') is None, d['response']


@pytest.fixture
def world(app, db):
    """An active achiever, a live cohort and one enrolled student.

    Live, not upcoming: task visibility and submission both gate on the session
    having started, so an upcoming cohort would fail every submission case for a
    reason that has nothing to do with the field under test.
    """
    aid, uid, cid = (str(uuid.uuid4()) for _ in range(3))
    db.session.execute(text("""
        INSERT INTO achievers (id, full_name, email, state, status, is_active,
                               is_verified, created_at, updated_at)
        VALUES (:i, 'X04 Task Test', :e, 'active', 'active', 1, 1,
                UTC_TIMESTAMP(), UTC_TIMESTAMP())
    """), {'i': aid, 'e': f'{TEST_PREFIX}{aid}@skovo.test'})
    db.session.execute(text("""
        INSERT INTO users (id, full_name, email, status, created_at, updated_at)
        VALUES (:i, 'X04 Task Student', :e, 'active', UTC_TIMESTAMP(), UTC_TIMESTAMP())
    """), {'i': uid, 'e': f'{TEST_PREFIX}{uid}@skovo.test'})
    db.session.execute(text("""
        INSERT INTO cohorts (id, title, achiever_id, session_date, duration_minutes,
                             total_seats, filled_seats, price, status, created_at, updated_at)
        VALUES (:i, 'X04 Task Cohort', :a,
                DATE_SUB(UTC_TIMESTAMP(), INTERVAL 10 MINUTE), 90,
                NULL, 0, 0, 'live', UTC_TIMESTAMP(), UTC_TIMESTAMP())
    """), {'i': cid, 'a': aid})
    db.session.execute(text("""
        INSERT INTO cohort_enrollments (id, user_id, cohort_id, payment_status,
                                        amount_paid, enrolled_at, created_at, updated_at)
        VALUES (:i, :u, :c, 'free', 0, UTC_TIMESTAMP(), UTC_TIMESTAMP(), UTC_TIMESTAMP())
    """), {'i': str(uuid.uuid4()), 'u': uid, 'c': cid})
    db.session.commit()

    yield {'achiever': aid, 'student': uid, 'cohort': cid}

    db.session.execute(text(
        'DELETE FROM task_submissions WHERE task_id IN '
        '(SELECT id FROM cohort_tasks WHERE cohort_id = :c)'), {'c': cid})
    db.session.execute(text('DELETE FROM cohort_tasks WHERE cohort_id = :c'), {'c': cid})
    db.session.execute(text('DELETE FROM cohort_enrollments WHERE cohort_id = :c'), {'c': cid})
    db.session.execute(text('DELETE FROM notification_logs WHERE user_id = :u'), {'u': uid})
    db.session.execute(text('DELETE FROM cohorts WHERE id = :i'), {'i': cid})
    db.session.execute(text('DELETE FROM users WHERE id = :i'), {'i': uid})
    db.session.execute(text('DELETE FROM achievers WHERE id = :i'), {'i': aid})
    db.session.commit()


@pytest.fixture
def achiever_auth(app, world):
    with app.app_context():
        token = create_access_token(
            identity=str(world['achiever']),
            additional_claims={'role': 'mentor', 'mentor': True,
                               'full_name': 'X04 Task Test'})
    return {'Authorization': f'Bearer {token}'}


@pytest.fixture
def student_auth(app, world):
    with app.app_context():
        return {'Authorization':
                f'Bearer {create_access_token(identity=str(world["student"]))}'}


@pytest.fixture
def assign(client, achiever_auth, world):
    def _assign(**fields):
        payload = {'cohort_id': world['cohort'], 'title': 'X04 task'}
        payload.update(fields)
        d = body(client.post(ACHIEVER_TASKS, json=payload, headers=achiever_auth))
        return d['status'], d
    return _assign


@pytest.fixture
def submit(client, student_auth, assign):
    """Create a task, then submit against it. Returns (status, body)."""
    def _submit(**evidence):
        code, d = assign(title=f'Submit target {uuid.uuid4().hex[:6]}')
        assert code == 201, d
        task_id = d['response']['task_id']
        r = client.post(f'{TASKS}/{task_id}/submit', json=evidence,
                        headers=student_auth)
        return body(r)['status'], body(r), task_id
    return _submit


@pytest.fixture
def stored_task(db):
    def _stored(task_id, *columns):
        row = db.session.execute(
            text(f'SELECT {", ".join(columns)} FROM cohort_tasks WHERE id = :i'),
            {'i': task_id}).mappings().first()
        assert row is not None, f'task {task_id} not stored'
        return row
    return _stored


def made(code, d):
    assert code == 201, d
    return d['response']['task_id']


# ── Task title ───────────────────────────────────────────────────────────────

@pytest.mark.case('X04-108')
def test_task_title_empty_is_refused(assign):
    refused(assign(title='')[1], naming='Title')


@pytest.mark.case('X04-109')
def test_task_title_only_whitespace_is_refused(assign):
    refused(assign(title='   ')[1], naming='Title')


@pytest.mark.case('X04-110')
def test_task_title_over_255_is_a_400_not_a_500(assign):
    code, d = assign(title='x' * 256)
    refused(d, naming='Title')
    assert '255' in d['response']['message']


@pytest.mark.case('X04-111')
def test_task_title_is_trimmed_before_storing(assign, stored_task):
    tid = made(*assign(title='   Padded task   '))
    assert stored_task(tid, 'title')['title'] == 'Padded task'


@pytest.mark.case('X04-112')
def test_task_title_unicode_survives(assign, stored_task):
    tid = made(*assign(title=UNICODE))
    assert stored_task(tid, 'title')['title'] == UNICODE


@pytest.mark.case('X04-113')
def test_task_title_html_is_stored_verbatim(assign, stored_task):
    tid = made(*assign(title=HTML))
    assert stored_task(tid, 'title')['title'] == HTML


@pytest.mark.case('X04-114')
def test_task_title_sql_metacharacters_are_stored_verbatim(assign, stored_task):
    tid = made(*assign(title=SQLI))
    assert stored_task(tid, 'title')['title'] == SQLI


# ── Description ──────────────────────────────────────────────────────────────

@pytest.mark.case('X04-115')
def test_description_empty_is_allowed(assign):
    code, d = assign(description='')
    assert code == 201, d


@pytest.mark.case('X04-116')
def test_description_of_50k_never_500s(assign):
    """`description` is TEXT with no application cap, so 50k lands in the column
    (65535 bytes). Either outcome is allowed; a 500 is not."""
    never_a_500(assign(description='x' * 50000)[1])


@pytest.mark.case('X04-117')
def test_description_preserves_newlines(assign, stored_task):
    tid = made(*assign(description=NEWLINES))
    assert stored_task(tid, 'description')['description'] == NEWLINES


@pytest.mark.case('X04-118')
def test_description_html_is_stored_verbatim(assign, stored_task):
    tid = made(*assign(description=HTML))
    assert stored_task(tid, 'description')['description'] == HTML


# ── Attachment URL ───────────────────────────────────────────────────────────

@pytest.mark.case('X04-119')
def test_attachment_empty_is_allowed_and_stores_null(assign, stored_task):
    tid = made(*assign(attachment_url=''))
    assert stored_task(tid, 'attachment_url')['attachment_url'] is None


@pytest.mark.case('X04-120')
def test_attachment_without_a_scheme_is_refused(assign):
    refused(assign(attachment_url='example.com/brief.pdf')[1], naming='Attachment')


@pytest.mark.case('X04-121')
def test_attachment_bare_filename_is_refused(assign):
    """A dead link is worse than no attachment: the student cannot tell it from
    a file that failed to load, and reports it as a broken upload."""
    refused(assign(attachment_url='brief.pdf')[1], naming='Attachment')


@pytest.mark.case('X04-122')
def test_attachment_javascript_scheme_is_refused(assign):
    refused(assign(attachment_url='javascript:alert(1)')[1], naming='Attachment')


@pytest.mark.case('X04-123')
def test_attachment_very_long_url_never_500s(assign):
    never_a_500(assign(attachment_url='https://example.com/' + 'a' * 3000)[1])


@pytest.mark.case('X04-124')
def test_attachment_to_a_non_existent_host_is_saved(assign, stored_task):
    url = 'https://no-such-host-skovo.invalid/brief.pdf'
    tid = made(*assign(attachment_url=url))
    assert stored_task(tid, 'attachment_url')['attachment_url'] == url


@pytest.mark.case('X04-119')
def test_an_uploaded_relative_path_is_accepted(assign, stored_task):
    """Root-relative is what /v1/upload returns, so refusing it would reject the
    app's own upload flow — the reason links.py has two functions and not one."""
    tid = made(*assign(attachment_url='/uploads/brief.pdf'))
    assert stored_task(tid, 'attachment_url')['attachment_url'] == '/uploads/brief.pdf'


# ── Due date ─────────────────────────────────────────────────────────────────

@pytest.mark.case('X04-125')
def test_due_date_empty_stores_null(assign, stored_task):
    tid = made(*assign(due_date=''))
    assert stored_task(tid, 'due_date')['due_date'] is None


@pytest.mark.case('X04-126')
def test_due_date_in_the_past_is_accepted(assign):
    """Defined behaviour, not an oversight: an achiever catching up on a class
    they already taught sets a deadline that has passed, and the student's My
    Tasks sorts it first as overdue rather than hiding it."""
    past = (datetime.datetime.now() - datetime.timedelta(days=3)).replace(microsecond=0)
    code, d = assign(due_date=past.isoformat(timespec='minutes'))
    assert code == 201, d


@pytest.mark.case('X04-127')
def test_due_date_invalid_format_is_refused(assign):
    refused(assign(due_date='next friday')[1], naming='due date')


@pytest.mark.case('X04-128')
def test_due_date_round_trips_utc_with_no_ist_drift(assign, stored_task):
    """The bug this pins is live in /admin/tasks, which still used raw
    fromisoformat until 5 Sep: the form sends naive IST and storage is UTC, so
    parsing it raw put every deadline 5h30m late."""
    local = (datetime.datetime.now() + datetime.timedelta(days=4)).replace(
        hour=23, minute=59, second=0, microsecond=0)
    tid = made(*assign(due_date=local.isoformat(timespec='minutes')))
    assert stored_task(tid, 'due_date')['due_date'] == \
        local - datetime.timedelta(hours=5, minutes=30)


@pytest.mark.case('X04-129')
def test_a_due_date_before_the_session_is_accepted(assign):
    """A task has no start field — the "start" it could precede is the cohort's
    session_date, and that is deliberately not enforced: an achiever may set
    homework due before the *next* session of a running cohort. Recorded so the
    next reader does not go hunting for a constraint that was never intended."""
    before = (datetime.datetime.now() - datetime.timedelta(hours=1)).replace(microsecond=0)
    code, d = assign(due_date=before.isoformat(timespec='minutes'))
    assert code == 201, d


@pytest.mark.case('X04-130')
def test_due_date_far_future_is_accepted(assign):
    code, d = assign(due_date='2099-12-31T23:59')
    assert code == 201, d


# ── Score weight ─────────────────────────────────────────────────────────────
#
# Points are admin-owned (feature-updates.md §5). An achiever never sets a
# task's weight: whatever `score_weight` the request carries is ignored and the
# task is stored at 0. Admin sets it from /admin/tasks.

@pytest.mark.case('X04-131')
@pytest.mark.parametrize('sent', ['', 0, -40, 'heavy', 8, 10 ** 9])
def test_achiever_score_weight_is_ignored(assign, stored_task, sent):
    tid = made(*assign(score_weight=sent))
    assert int(stored_task(tid, 'score_weight')['score_weight']) == 0


@pytest.mark.case('X04-132')
def test_achiever_task_without_weight_is_worth_nothing(assign, stored_task):
    """Nothing earns points by default — only what admin switches on."""
    tid = made(*assign())
    assert int(stored_task(tid, 'score_weight')['score_weight']) == 0


# ── Evidence text (student submission) ───────────────────────────────────────

@pytest.mark.case('X04-148')
def test_evidence_empty_is_refused(submit):
    """Optional individually, required collectively: a submission with neither
    text nor URL is an empty claim of having done the work."""
    code, d, _ = submit()
    assert d['status'] == 400, d


@pytest.mark.case('X04-149')
def test_evidence_text_of_50k_never_500s(submit):
    code, d, _ = submit(evidence_text='x' * 50000)
    never_a_500(d)


@pytest.mark.case('X04-150')
def test_evidence_text_preserves_newlines(submit, db):
    code, d, task_id = submit(evidence_text=NEWLINES)
    assert code == 200, d
    stored = db.session.execute(text(
        'SELECT evidence_text FROM task_submissions WHERE task_id = :t'),
        {'t': task_id}).scalar()
    assert stored == NEWLINES


@pytest.mark.case('X04-151')
def test_evidence_text_html_is_stored_verbatim(submit, db):
    code, d, task_id = submit(evidence_text=HTML)
    assert code == 200, d
    stored = db.session.execute(text(
        'SELECT evidence_text FROM task_submissions WHERE task_id = :t'),
        {'t': task_id}).scalar()
    assert stored == HTML


# ── Evidence URL (student submission) ────────────────────────────────────────

@pytest.mark.case('X04-152')
def test_evidence_url_empty_with_text_is_allowed(submit):
    code, d, _ = submit(evidence_text='done', evidence_url='')
    assert code == 200, d


@pytest.mark.case('X04-153')
def test_evidence_url_without_a_scheme_is_refused(submit):
    code, d, _ = submit(evidence_url='github.com/me/work')
    assert d['status'] == 400, d
    assert d['response'].get('error_id') is None, d['response']


@pytest.mark.case('X04-154')
def test_evidence_url_bare_filename_is_refused(submit):
    code, d, _ = submit(evidence_url='homework.zip')
    assert d['status'] == 400, d
    assert d['response'].get('error_id') is None, d['response']


@pytest.mark.case('X04-155')
def test_evidence_url_javascript_scheme_is_refused(submit):
    """The stored-XSS case. The achiever opens this from the review screen, so
    an unvalidated `javascript:` here targets the one person certain to click
    it. `evidence_url` had no validation at all until links.py was shared."""
    code, d, _ = submit(evidence_url='javascript:alert(document.cookie)')
    assert d['status'] == 400, d
    assert d['response'].get('error_id') is None, d['response']


@pytest.mark.case('X04-156')
def test_evidence_url_very_long_never_500s(submit):
    code, d, _ = submit(evidence_url='https://github.com/' + 'a' * 3000)
    never_a_500(d)


@pytest.mark.case('X04-157')
def test_evidence_url_to_a_non_existent_host_is_saved(submit, db):
    url = 'https://no-such-host-skovo.invalid/repo'
    code, d, task_id = submit(evidence_url=url)
    assert code == 200, d
    stored = db.session.execute(text(
        'SELECT evidence_url FROM task_submissions WHERE task_id = :t'),
        {'t': task_id}).scalar()
    assert stored == url
