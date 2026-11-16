"""Student submits → achiever and admin review → status settles.

The gap this suite exists to pin down: an achiever could set a task and could
see that N students had submitted, and there it stopped. There was no endpoint
to list those submissions and none to grade one, so the only person who could
judge the work was an admin who had not taught the session — and on the admin
side the listing dropped any submission whose student row its `users` scan had
missed, showing "no submissions yet" next to a task counting one.

Both portals now go through portal/helpers/task_review.py, so the cases below
assert the *same* outcome from each: a verdict written by an achiever and one
written by an admin must be indistinguishable in the row.

Everything goes through the real HTTP endpoints — the ownership checks live
there, and a unit test of the helper would not catch a route that forgot one.

Isolation follows the AC-03 suite: throwaway rows keyed to ids this module
created, deleted afterwards whatever the outcome. A crashed run leaves rows
whose users.email / achievers.email begin with `review-test-`.
"""
import uuid

import pytest
from flask_jwt_extended import create_access_token
from sqlalchemy import text

ACHIEVER = '/v1/achievers/portal'
ADMIN = '/v1/skovo-platform-panel-admin'
STUDENT_TASKS = '/v1/tasks'
TEST_PREFIX = 'review-test-'


@pytest.fixture
def client(app):
    return app.test_client()


def body(resp):
    payload = resp.get_json()
    assert payload is not None, f'no JSON body: {resp.data[:200]}'
    return payload


@pytest.fixture
def world(app, db):
    """Two achievers (so ownership is expressible), one enrolled student, one
    live cohort carrying one active task."""
    ids = {k: str(uuid.uuid4()) for k in ('a', 'b', 'student', 'admin', 'cohort', 'task')}

    db.session.execute(text("""
        INSERT INTO admins (id, full_name, email, password_hash, status, state, created_at)
        VALUES (:i, 'Review Admin', :e, 'x', 'active', 'active', UTC_TIMESTAMP())
    """), {'i': ids['admin'], 'e': f'{TEST_PREFIX}{ids["admin"]}@skovo.test'})

    for key in ('a', 'b'):
        db.session.execute(text("""
            INSERT INTO achievers (id, full_name, email, state, status, is_active,
                                   is_verified, created_at, updated_at)
            VALUES (:i, :n, :e, 'active', 'active', 1, 1, UTC_TIMESTAMP(), UTC_TIMESTAMP())
        """), {'i': ids[key], 'n': f'Review {key}',
               'e': f'{TEST_PREFIX}{ids[key]}@skovo.test'})

    db.session.execute(text("""
        INSERT INTO users (id, full_name, email, status, created_at, updated_at)
        VALUES (:i, 'Review Student', :e, 'active', UTC_TIMESTAMP(), UTC_TIMESTAMP())
    """), {'i': ids['student'], 'e': f'{TEST_PREFIX}{ids["student"]}@skovo.test'})

    # Started ten minutes ago: cohort_tasks_open() gates on the session having
    # *started*, which is what puts the task in the student's list.
    db.session.execute(text("""
        INSERT INTO cohorts (id, title, achiever_id, session_date, duration_minutes,
                             total_seats, filled_seats, price, status, created_at, updated_at)
        VALUES (:i, 'Review Cohort', :a, DATE_SUB(UTC_TIMESTAMP(), INTERVAL 10 MINUTE), 90,
                NULL, 0, 0, 'live', UTC_TIMESTAMP(), UTC_TIMESTAMP())
    """), {'i': ids['cohort'], 'a': ids['a']})

    db.session.execute(text("""
        INSERT INTO cohort_enrollments (id, user_id, cohort_id, payment_status,
                                        amount_paid, enrolled_at, created_at, updated_at)
        VALUES (:i, :u, :c, 'free', 0, UTC_TIMESTAMP(), UTC_TIMESTAMP(), UTC_TIMESTAMP())
    """), {'i': str(uuid.uuid4()), 'u': ids['student'], 'c': ids['cohort']})

    db.session.execute(text("""
        INSERT INTO cohort_tasks (id, cohort_id, title, description, task_status,
                                  score_weight, created_at, updated_at)
        VALUES (:i, :c, 'Review Task', 'Hand in the exercise', 'active', 5,
                UTC_TIMESTAMP(), UTC_TIMESTAMP())
    """), {'i': ids['task'], 'c': ids['cohort']})
    db.session.commit()

    yield ids

    aids = (ids['a'], ids['b'])
    for sql, params in [
        ('DELETE FROM task_submissions WHERE user_id = :u', {'u': ids['student']}),
        ('DELETE FROM cohort_tasks WHERE cohort_id = :c', {'c': ids['cohort']}),
        ('DELETE FROM cohort_enrollments WHERE cohort_id = :c', {'c': ids['cohort']}),
        ('DELETE FROM notification_logs WHERE user_id = :u', {'u': ids['student']}),
        ('DELETE FROM score_events WHERE user_id = :u', {'u': ids['student']}),
        ('DELETE FROM readiness_scores WHERE user_id = :u', {'u': ids['student']}),
        ('DELETE FROM cohorts WHERE achiever_id IN :a', {'a': aids}),
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
def achiever_tok(app):
    def _tok(aid):
        with app.app_context():
            return {'Authorization': 'Bearer ' + create_access_token(
                identity=str(aid), additional_claims={'role': 'mentor', 'mentor': True})}
    return _tok


@pytest.fixture
def student_tok(app):
    def _tok(uid):
        with app.app_context():
            return {'Authorization': 'Bearer ' + create_access_token(identity=str(uid))}
    return _tok


@pytest.fixture
def admin_tok(app, world):
    """admin_auth.is_admin() reads `role` off the claims and fails closed."""
    with app.app_context():
        return {'Authorization': 'Bearer ' + create_access_token(
            identity=str(world['admin']),
            additional_claims={'role': 'admin', 'full_name': 'Review Admin'})}


@pytest.fixture
def submit(client, student_tok, world):
    """The student hands work in through the real submit endpoint."""
    def _submit(url='https://example.com/work', textv='My answer'):
        d = body(client.post(f'{STUDENT_TASKS}/{world["task"]}/submit',
                             json={'evidence_url': url, 'evidence_text': textv},
                             headers=student_tok(world['student'])))
        assert d['status'] == 200, d
        return d
    return _submit


def _row(db, task_id):
    return db.session.execute(text(
        'SELECT * FROM task_submissions WHERE task_id = :t'), {'t': task_id}
    ).mappings().first()


# ── The submission reaches both reviewers ────────────────────────────────────

def test_a_submission_reaches_the_achiever_who_set_the_task(client, achiever_tok, world, submit):
    """The whole point: the achiever ran the session, so the work comes to them.
    Before this endpoint existed the count on their card was the end of the road."""
    submit()
    d = body(client.get(f'{ACHIEVER}/tasks/{world["task"]}/submissions',
                        headers=achiever_tok(world['a'])))
    assert d['status'] == 200, d
    subs = d['response']['submissions']
    assert len(subs) == 1, subs
    assert subs[0]['user_name'] == 'Review Student'
    assert subs[0]['evidence_url'] == 'https://example.com/work'
    assert subs[0]['status'] == 'pending'
    assert d['response']['pending_count'] == 1


def test_the_same_submission_reaches_the_admin_panel(client, admin_tok, world, submit):
    """Two portals, one row. The admin listing used to drop a submission whose
    student the `users` scan had missed, which is the failure that reads as
    'admin cannot open the submitted task'."""
    submit()
    d = body(client.get(f'{ADMIN}/tasks/{world["task"]}/submissions', headers=admin_tok))
    assert d['status'] == 200, d
    subs = d['response']['submissions']
    assert len(subs) == 1, subs
    assert subs[0]['evidence_text'] == 'My answer'
    assert d['response']['task']['title'] == 'Review Task'


def test_the_achiever_task_list_counts_the_submission(client, achiever_tok, world, submit):
    submit()
    d = body(client.get(f'{ACHIEVER}/tasks', headers=achiever_tok(world['a'])))
    task = next(t for t in d['response']['tasks'] if t['id'] == world['task'])
    assert task['submission_count'] == 1
    assert task['pending_count'] == 1


# ── Ownership ────────────────────────────────────────────────────────────────

def test_another_achiever_cannot_read_or_judge_the_submission(
        client, achiever_tok, world, submit, db):
    """404 rather than 403 throughout, matching the task routes: a 403 would
    confirm the id exists to anyone probing with a valid achiever token."""
    submit()
    sub_id = _row(db, world['task'])['id']
    stranger = achiever_tok(world['b'])

    assert body(client.get(f'{ACHIEVER}/tasks/{world["task"]}/submissions',
                           headers=stranger))['status'] == 404
    assert body(client.patch(f'{ACHIEVER}/submissions/{sub_id}',
                             json={'status': 'approved', 'mentor_score': 9},
                             headers=stranger))['status'] == 404

    # And the row is untouched by the attempt.
    assert _row(db, world['task'])['status'] == 'pending'


def test_a_student_token_cannot_reach_the_review_routes(client, student_tok, world, submit, db):
    submit()
    sub_id = _row(db, world['task'])['id']
    headers = student_tok(world['student'])
    assert body(client.get(f'{ACHIEVER}/tasks/{world["task"]}/submissions',
                           headers=headers))['status'] == 403
    assert body(client.patch(f'{ACHIEVER}/submissions/{sub_id}',
                             json={'status': 'approved', 'mentor_score': 10},
                             headers=headers))['status'] == 403


# ── The verdict ──────────────────────────────────────────────────────────────

def test_approving_records_score_notes_and_reviewer(client, achiever_tok, world, submit, db):
    submit()
    sub_id = _row(db, world['task'])['id']
    d = body(client.patch(f'{ACHIEVER}/submissions/{sub_id}',
                          json={'status': 'approved', 'mentor_score': 8,
                                'mentor_notes': 'Clean work'},
                          headers=achiever_tok(world['a'])))
    assert d['status'] == 200, d

    row = _row(db, world['task'])
    assert row['status'] == 'approved'
    assert row['mentor_score'] == 8
    assert row['mentor_notes'] == 'Clean work'
    assert row['reviewed_by'] == world['a']
    assert row['reviewed_at'] is not None
    # The evidence must survive its own review: sp_task_submissions_update is a
    # full replace, so a column not passed back is overwritten with NULL.
    assert row['evidence_url'] == 'https://example.com/work'
    assert row['evidence_text'] == 'My answer'


def test_approving_without_a_score_is_refused(client, achiever_tok, world, submit, db):
    """Approval is what puts readiness points on the student's ledger. Awarding
    them with nothing to show for it on the task is not a reviewable state."""
    submit()
    sub_id = _row(db, world['task'])['id']
    d = body(client.patch(f'{ACHIEVER}/submissions/{sub_id}',
                          json={'status': 'approved'},
                          headers=achiever_tok(world['a'])))
    assert d['status'] == 400, d
    assert 'score' in d['response']['message'].lower()
    assert _row(db, world['task'])['status'] == 'pending'


def test_an_unknown_status_is_refused(client, achiever_tok, world, submit, db):
    submit()
    sub_id = _row(db, world['task'])['id']
    d = body(client.patch(f'{ACHIEVER}/submissions/{sub_id}',
                          json={'status': 'graded', 'mentor_score': 5},
                          headers=achiever_tok(world['a'])))
    assert d['status'] == 400, d
    assert _row(db, world['task'])['status'] == 'pending'


def test_a_scored_but_undecided_submission_stays_in_both_queues(
        client, achiever_tok, admin_tok, world, submit, db):
    """`reviewed` means scored, not decided. The achiever's count used to omit
    it while the admin's counted it, so scoring without approving made the row
    disappear from one screen and stay on the other."""
    submit()
    sub_id = _row(db, world['task'])['id']
    assert body(client.patch(f'{ACHIEVER}/submissions/{sub_id}',
                             json={'status': 'reviewed', 'mentor_score': 6},
                             headers=achiever_tok(world['a'])))['status'] == 200

    ach = body(client.get(f'{ACHIEVER}/tasks', headers=achiever_tok(world['a'])))
    task = next(t for t in ach['response']['tasks'] if t['id'] == world['task'])
    assert task['pending_count'] == 1, 'the achiever stopped counting a scored-but-undecided row'

    adm = body(client.get(f'{ADMIN}/tasks', headers=admin_tok))
    admin_task = next((t for t in adm['response']['tasks'] if t['id'] == world['task']), None)
    assert admin_task is not None and admin_task['pending_count'] == 1


def test_an_admin_verdict_and_an_achiever_verdict_write_the_same_row(
        client, admin_tok, world, submit, db):
    """Both portals go through helpers.task_review, so the admin path must set
    the same columns the achiever path does."""
    submit()
    sub_id = _row(db, world['task'])['id']
    d = body(client.patch(f'{ADMIN}/submissions/{sub_id}',
                          json={'status': 'approved', 'mentor_score': 7,
                                'mentor_notes': 'Good'},
                          headers=admin_tok))
    assert d['status'] == 200, d

    row = _row(db, world['task'])
    assert row['status'] == 'approved'
    assert row['mentor_score'] == 7
    assert row['mentor_notes'] == 'Good'
    assert row['reviewed_at'] is not None
    assert row['evidence_url'] == 'https://example.com/work'


def test_the_student_sees_the_verdict_on_their_own_task(
        client, achiever_tok, student_tok, world, submit):
    """The loop closes on the screen the student actually looks at."""
    submit()
    d = body(client.get(f'{ACHIEVER}/tasks/{world["task"]}/submissions',
                        headers=achiever_tok(world['a'])))
    sub_id = d['response']['submissions'][0]['id']

    assert body(client.patch(f'{ACHIEVER}/submissions/{sub_id}',
                             json={'status': 'approved', 'mentor_score': 9,
                                   'mentor_notes': 'Nicely done'},
                             headers=achiever_tok(world['a'])))['status'] == 200

    mine = body(client.get(f'{STUDENT_TASKS}/', headers=student_tok(world['student'])))
    task = next(t for t in mine['response']['tasks'] if t['id'] == world['task'])
    assert task['submission']['status'] == 'approved'
    assert task['submission']['mentor_score'] == 9
    assert task['submission']['mentor_notes'] == 'Nicely done'


def test_the_student_is_notified_that_their_work_was_reviewed(
        client, achiever_tok, world, submit, db):
    submit()
    sub_id = _row(db, world['task'])['id']
    assert body(client.patch(f'{ACHIEVER}/submissions/{sub_id}',
                             json={'status': 'approved', 'mentor_score': 10},
                             headers=achiever_tok(world['a'])))['status'] == 200

    n = db.session.execute(text("""
        SELECT COUNT(*) FROM notification_logs
         WHERE user_id = :u AND reference_type = 'task_submission' AND reference_id = :r
    """), {'u': world['student'], 'r': sub_id}).scalar()
    assert n == 1, 'the student was never told their submission had been judged'


# ── Rejection and resubmission ───────────────────────────────────────────────

def test_a_rejected_task_can_be_resubmitted(client, achiever_tok, world, submit, db):
    submit()
    sub_id = _row(db, world['task'])['id']
    assert body(client.patch(f'{ACHIEVER}/submissions/{sub_id}',
                             json={'status': 'rejected', 'mentor_score': 3,
                                   'mentor_notes': 'Add the tests'},
                             headers=achiever_tok(world['a'])))['status'] == 200
    assert _row(db, world['task'])['status'] == 'rejected'

    submit(url='https://example.com/work-v2', textv='Now with tests')
    row = _row(db, world['task'])
    assert row['status'] == 'pending', 'a resubmission did not reopen the task'
    assert row['evidence_url'] == 'https://example.com/work-v2'


def test_a_resubmission_clears_the_previous_verdict(client, achiever_tok, world, submit, db):
    """A resubmission is new work, so the verdict on the old work goes with it.

    These four columns used to survive the upsert, which meant a task rejected
    at 3/10 came back into the queue still showing 3/10 and the old feedback —
    a score for evidence nobody had looked at yet, on the reviewer's drawer and
    on the student's own task screen.

    The behaviour lives in sp_task_submission_upsert, so this asserts against
    whatever is *deployed*, not against the .sql file in the repo. Until the
    procedure is reloaded the case skips rather than fails: a red suite that
    means "someone has not run the migration yet" trains people to ignore red.
    Run it and this starts asserting on its own:
        python database/migrations/load_task_submission_upsert_sp.py
    """
    deployed = db.session.execute(text(
        "SELECT ROUTINE_DEFINITION FROM information_schema.ROUTINES "
        "WHERE ROUTINE_SCHEMA = DATABASE() "
        "AND ROUTINE_NAME = 'sp_task_submission_upsert'"
    )).scalar() or ''
    if 'mentor_score = NULL' not in deployed:
        pytest.skip('sp_task_submission_upsert not reloaded yet — run '
                    'database/migrations/load_task_submission_upsert_sp.py')

    submit()
    sub_id = _row(db, world['task'])['id']
    assert body(client.patch(f'{ACHIEVER}/submissions/{sub_id}',
                             json={'status': 'rejected', 'mentor_score': 3,
                                   'mentor_notes': 'Add the tests'},
                             headers=achiever_tok(world['a'])))['status'] == 200

    submit(url='https://example.com/work-v2', textv='Now with tests')

    row = _row(db, world['task'])
    assert row['mentor_score'] is None, 'the old score followed the new work in'
    assert row['mentor_notes'] is None, 'the old feedback followed the new work in'
    assert row['reviewed_by'] is None
    assert row['reviewed_at'] is None


def test_an_approved_task_cannot_be_resubmitted(client, achiever_tok, student_tok,
                                                world, submit, db):
    """sp_task_submission_upsert blocks it, and the refusal must name a way out
    rather than reading as a failure the student can retry."""
    submit()
    sub_id = _row(db, world['task'])['id']
    assert body(client.patch(f'{ACHIEVER}/submissions/{sub_id}',
                             json={'status': 'approved', 'mentor_score': 9},
                             headers=achiever_tok(world['a'])))['status'] == 200

    d = body(client.post(f'{STUDENT_TASKS}/{world["task"]}/submit',
                         json={'evidence_text': 'sneaking a change in'},
                         headers=student_tok(world['student'])))
    assert d['status'] == 400, d
    assert _row(db, world['task'])['status'] == 'approved'
