"""
Achiever → Cohort → Task assignment → student My Tasks, end to end.

The bug this suite exists to pin down: an achiever set a task during a live
session, the row landed in `cohort_tasks` correctly, and My Tasks stayed empty
for every student in the cohort until the session's end time had passed. The
old rule opened a task only once `session_date + duration_minutes` was in the
past, so "assign it while we are still on the call" — which is when most
homework is actually set — produced an invisible task and looked like a failed
save. `cohort_tasks_open()` now gates on the session having *started*.

Everything below goes through the real HTTP endpoints, because the gate exists
on two of them (the list and the submit) and a unit test of the helper would
not have caught either one being missed.

Isolation follows tests/conftest.py: throwaway rows, every one keyed to ids
this module created and deleted afterwards, whatever the outcome. Nothing
existing is read, updated or removed — a crashed run leaves rows whose
users.email / achievers.email begin with `cohort-task-test-`.
"""
import datetime
import uuid

import pytest
from flask_jwt_extended import create_access_token
from sqlalchemy import text

TASKS = '/v1/tasks'
ACHIEVER_TASKS = '/v1/achievers/portal/tasks'

TEST_PREFIX = 'cohort-task-test-'


# ── plumbing ─────────────────────────────────────────────────────────────────

@pytest.fixture
def client(app):
    return app.test_client()


def body(resp):
    """Every endpoint answers {bool, status, response} — unwrap it."""
    payload = resp.get_json()
    assert payload is not None, f'no JSON body: {resp.data[:200]}'
    return payload


def tasks_of(client, headers):
    d = body(client.get(f'{TASKS}/', headers=headers))
    assert d['bool'] is True, d
    return d['response']['tasks']


def titles_of(client, headers):
    return [t['title'] for t in tasks_of(client, headers)]


@pytest.fixture
def student_auth(app):
    def _auth(user_id):
        with app.app_context():
            return {'Authorization': f'Bearer {create_access_token(identity=str(user_id))}'}
    return _auth


@pytest.fixture
def achiever_auth(app):
    """The achiever portal reads `role` off the claims, not just the identity."""
    def _auth(achiever_id):
        with app.app_context():
            token = create_access_token(
                identity=str(achiever_id),
                additional_claims={'role': 'mentor', 'mentor': True,
                                   'full_name': 'Cohort Task Test'},
            )
        return {'Authorization': f'Bearer {token}'}
    return _auth


# ── throwaway rows ───────────────────────────────────────────────────────────

@pytest.fixture
def rows(db):
    """Row factory that remembers what it made and removes it afterwards.

    Deletion order matters: submissions before tasks, enrolments before
    cohorts, so nothing is left pointing at something that no longer exists
    even though the schema declares no foreign keys.
    """
    made = {'task_submissions': [], 'cohort_tasks': [], 'cohort_enrollments': [],
            'notification_logs': [], 'cohorts': [], 'users': [], 'achievers': []}

    class Rows:
        def student(self, name='Task Test Student'):
            uid = str(uuid.uuid4())
            db.session.execute(text("""
                INSERT INTO users (id, full_name, email, status, created_at, updated_at)
                VALUES (:i, :n, :e, 'active', UTC_TIMESTAMP(), UTC_TIMESTAMP())
            """), {'i': uid, 'n': name, 'e': f'{TEST_PREFIX}{uid}@skovo.test'})
            db.session.commit()
            made['users'].append(uid)
            made['notification_logs'].append(uid)
            return uid

        def achiever(self, state='active'):
            aid = str(uuid.uuid4())
            db.session.execute(text("""
                INSERT INTO achievers (id, full_name, email, state, status, is_active,
                                       created_at, updated_at)
                VALUES (:i, 'Task Test Achiever', :e, :s, 'active', 1,
                        UTC_TIMESTAMP(), UTC_TIMESTAMP())
            """), {'i': aid, 'e': f'{TEST_PREFIX}{aid}@skovo.test', 's': state})
            db.session.commit()
            made['achievers'].append(aid)
            return aid

        def cohort(self, achiever_id, *, starts_minutes_ago=None, starts_in_minutes=None,
                   duration=90, status='upcoming', title=None, price=0):
            """A cohort positioned relative to now, in minutes.

            Time is expressed as an offset rather than a fixed datetime because
            every rule under test is "has the session started yet", and the DB
            clock is UTC while the team is IST — a literal would pass or fail
            depending on who ran it.
            """
            cid = str(uuid.uuid4())
            if starts_minutes_ago is not None:
                offset = -starts_minutes_ago
            elif starts_in_minutes is not None:
                offset = starts_in_minutes
            else:
                offset = 0
            db.session.execute(text("""
                INSERT INTO cohorts (id, title, achiever_id, session_date, duration_minutes,
                                     total_seats, filled_seats, price, status,
                                     created_at, updated_at)
                VALUES (:i, :t, :a, DATE_ADD(UTC_TIMESTAMP(), INTERVAL :off MINUTE), :d,
                        NULL, 0, :p, :s, UTC_TIMESTAMP(), UTC_TIMESTAMP())
            """), {'i': cid, 't': title or f'Task Test Cohort {cid[:8]}', 'a': achiever_id,
                   'off': offset, 'd': duration, 'p': price, 's': status})
            db.session.commit()
            made['cohorts'].append(cid)
            return cid

        def enroll(self, user_id, cohort_id, payment_status='free'):
            eid = str(uuid.uuid4())
            db.session.execute(text("""
                INSERT INTO cohort_enrollments (id, user_id, cohort_id, payment_status,
                                                amount_paid, enrolled_at, created_at, updated_at)
                VALUES (:i, :u, :c, :p, 0, UTC_TIMESTAMP(), UTC_TIMESTAMP(), UTC_TIMESTAMP())
            """), {'i': eid, 'u': user_id, 'c': cohort_id, 'p': payment_status})
            db.session.commit()
            made['cohort_enrollments'].append(eid)
            return eid

        def track_task(self, task_id):
            """Register a task the API created, so teardown reaches it."""
            made['cohort_tasks'].append(task_id)
            made['task_submissions'].append(task_id)
            return task_id

    yield Rows()

    for tid in made['task_submissions']:
        db.session.execute(text("DELETE FROM task_submissions WHERE task_id = :t"), {'t': tid})
    for cid in made['cohorts']:
        db.session.execute(text("DELETE FROM cohort_tasks WHERE cohort_id = :c"), {'c': cid})
    for eid in made['cohort_enrollments']:
        db.session.execute(text("DELETE FROM cohort_enrollments WHERE id = :i"), {'i': eid})
    for uid in made['notification_logs']:
        db.session.execute(text("DELETE FROM notification_logs WHERE user_id = :u"), {'u': uid})
    for cid in made['cohorts']:
        db.session.execute(text("DELETE FROM cohorts WHERE id = :i"), {'i': cid})
    for uid in made['users']:
        db.session.execute(text("DELETE FROM users WHERE id = :i"), {'i': uid})
    for aid in made['achievers']:
        db.session.execute(text("DELETE FROM achievers WHERE id = :i"), {'i': aid})
    db.session.commit()


@pytest.fixture
def assign(client, achiever_auth, rows):
    """POST a task as the achiever. Returns `(status, body)`.

    `status` is the one inside the envelope, not `resp.status_code`. Every
    route in this codebase answers HTTP 200 and carries its real status as a
    field in the JSON — asserting on the transport code here would pass for a
    403 and a 201 alike.
    """
    def _assign(achiever_id, cohort_id, **fields):
        payload = {'cohort_id': cohort_id, 'title': 'Build the landing page'}
        payload.update(fields)
        d = body(client.post(ACHIEVER_TASKS, json=payload, headers=achiever_auth(achiever_id)))
        if d.get('response', {}).get('task_id'):
            rows.track_task(d['response']['task_id'])
        return d['status'], d
    return _assign


# ── the two cases the report named ───────────────────────────────────────────

@pytest.mark.case("ST06-002")
def test_task_assigned_during_the_meeting_shows_up_immediately(client, rows, assign, student_auth):
    """The reported bug. Session started 10 minutes ago and runs 90, so the old
    rule hid this task for another 80 minutes."""
    achiever = rows.achiever()
    cohort = rows.cohort(achiever, starts_minutes_ago=10, duration=90, status='live')
    student = rows.student()
    rows.enroll(student, cohort)

    code, d = assign(achiever, cohort, title='Mid-session task')
    assert code == 201, d

    assert 'Mid-session task' in titles_of(client, student_auth(student))


@pytest.mark.case("ST06-002")
def test_task_assigned_after_the_meeting_shows_up(client, rows, assign, student_auth):
    achiever = rows.achiever()
    cohort = rows.cohort(achiever, starts_minutes_ago=200, duration=90, status='completed')
    student = rows.student()
    rows.enroll(student, cohort)

    code, d = assign(achiever, cohort, title='Post-session task')
    assert code == 201, d

    assert 'Post-session task' in titles_of(client, student_auth(student))


@pytest.mark.case("ST06-001")
def test_task_on_a_cohort_that_has_not_started_stays_hidden(client, rows, assign, student_auth):
    """The rule the old gate got right, and the new one must keep: homework for
    a class nobody has taught yet is not work, it is a spoiler."""
    achiever = rows.achiever()
    cohort = rows.cohort(achiever, starts_in_minutes=240, status='upcoming')
    student = rows.student()
    rows.enroll(student, cohort)

    assert assign(achiever, cohort, title='Next week task')[0] == 201
    assert titles_of(client, student_auth(student)) == []


@pytest.mark.case("ST06-003")
def test_a_completed_cohort_opens_tasks_even_with_a_future_session_date(client, rows, assign, student_auth):
    """An achiever who ends the class early, or moves the date afterwards,
    leaves status='completed' next to a session_date that has not arrived.
    The stored 'completed' is a person's decision and outranks the clock."""
    achiever = rows.achiever()
    cohort = rows.cohort(achiever, starts_in_minutes=180, status='completed')
    student = rows.student()
    rows.enroll(student, cohort)

    assert assign(achiever, cohort, title='Ended early')[0] == 201
    assert 'Ended early' in titles_of(client, student_auth(student))


@pytest.mark.case("ST06-004")
def test_cancelled_cohort_shows_no_tasks(client, rows, assign, student_auth):
    achiever = rows.achiever()
    cohort = rows.cohort(achiever, starts_minutes_ago=200, status='cancelled')
    student = rows.student()
    rows.enroll(student, cohort)

    assert assign(achiever, cohort, title='Cancelled class task')[0] == 201
    assert titles_of(client, student_auth(student)) == []


@pytest.mark.case("ST06-002")
def test_a_stale_upcoming_status_does_not_hide_a_started_session(client, rows, assign, student_auth):
    """The scheduler writes `status` every 60s and misses the window after a
    restart. The clock, not the column, decides whether the class has begun."""
    achiever = rows.achiever()
    cohort = rows.cohort(achiever, starts_minutes_ago=30, duration=90, status='upcoming')
    student = rows.student()
    rows.enroll(student, cohort)

    assert assign(achiever, cohort, title='Scheduler was asleep')[0] == 201
    assert 'Scheduler was asleep' in titles_of(client, student_auth(student))


# ── assigned to everyone in the cohort, exactly once ─────────────────────────

def test_every_enrolled_student_gets_the_task(client, rows, assign, student_auth):
    achiever = rows.achiever()
    cohort = rows.cohort(achiever, starts_minutes_ago=10, status='live')
    students = [rows.student(f'Student {n}') for n in range(3)]
    for s in students:
        rows.enroll(s, cohort)

    code, d = assign(achiever, cohort, title='Everyone gets this')
    assert code == 201, d
    assert d['response']['students_notified'] == 3

    for s in students:
        assert titles_of(client, student_auth(s)) == ['Everyone gets this']


@pytest.mark.case("ST06-006")
def test_enrolling_after_the_task_was_set_gets_it_once(client, rows, assign, student_auth):
    """A task is assigned to the cohort, not copied per student, so a late
    joiner picks it up on their first load and there is no second copy to
    create. This is the no-duplicate-assignment guarantee."""
    achiever = rows.achiever()
    cohort = rows.cohort(achiever, starts_minutes_ago=10, status='live')
    early = rows.student('Early')
    rows.enroll(early, cohort)

    assert assign(achiever, cohort, title='Set before they joined')[0] == 201

    late = rows.student('Late')
    rows.enroll(late, cohort)

    assert titles_of(client, student_auth(late)) == ['Set before they joined']
    assert titles_of(client, student_auth(early)) == ['Set before they joined']


def test_re_reading_the_list_does_not_multiply_the_task(client, rows, assign, student_auth):
    achiever = rows.achiever()
    cohort = rows.cohort(achiever, starts_minutes_ago=10, status='live')
    student = rows.student()
    rows.enroll(student, cohort)
    assign(achiever, cohort, title='Only once')

    headers = student_auth(student)
    assert titles_of(client, headers) == ['Only once']
    assert titles_of(client, headers) == ['Only once']


def test_a_student_in_another_cohort_sees_nothing(client, rows, assign, student_auth):
    achiever = rows.achiever()
    taught = rows.cohort(achiever, starts_minutes_ago=10, status='live')
    other = rows.cohort(achiever, starts_minutes_ago=10, status='live')
    outsider = rows.student()
    rows.enroll(outsider, other)

    assign(achiever, taught, title='Not for the outsider')
    assert titles_of(client, student_auth(outsider)) == []


def test_a_pending_enrolment_is_not_an_enrolment(client, rows, assign, student_auth):
    """An abandoned checkout holds a seat, it does not join the class."""
    achiever = rows.achiever()
    cohort = rows.cohort(achiever, starts_minutes_ago=10, status='live', price=499)
    student = rows.student()
    rows.enroll(student, cohort, payment_status='pending')

    code, d = assign(achiever, cohort, title='Paid cohort task')
    assert code == 201
    assert d['response']['students_notified'] == 0
    assert titles_of(client, student_auth(student)) == []


def test_paid_enrolment_gets_the_task(client, rows, assign, student_auth):
    achiever = rows.achiever()
    cohort = rows.cohort(achiever, starts_minutes_ago=10, status='live', price=499)
    student = rows.student()
    rows.enroll(student, cohort, payment_status='paid')

    assign(achiever, cohort, title='Paid seat task')
    assert titles_of(client, student_auth(student)) == ['Paid seat task']


# ── what the student is shown ────────────────────────────────────────────────

@pytest.mark.case("ST06-018")
def test_task_details_survive_the_round_trip(client, rows, assign, student_auth, db):
    achiever = rows.achiever()
    cohort = rows.cohort(achiever, starts_minutes_ago=10, status='live',
                         title='Frontend Fundamentals')
    student = rows.student()
    rows.enroll(student, cohort)

    due = (datetime.datetime.now() + datetime.timedelta(days=3)).replace(microsecond=0)
    code, d = assign(
        achiever, cohort,
        title='Ship a responsive nav bar',
        description='Two breakpoints, keyboard accessible.\nPush to a public repo.',
        task_type='assignment', submission_type='github_repo',
        difficulty_level='intermediate',
        attachment_url='https://example.com/brief.pdf',
        due_date=due.isoformat(timespec='minutes'),
        score_weight=8,   # ignored: points are admin-owned
    )
    assert code == 201, d

    task = tasks_of(client, student_auth(student))[0]
    assert task['title'] == 'Ship a responsive nav bar'
    assert task['description'].startswith('Two breakpoints')
    assert task['cohort_title'] == 'Frontend Fundamentals'
    assert task['cohort_id'] == cohort
    assert task['task_type'] == 'assignment'
    assert task['submission_type'] == 'github_repo'
    assert task['difficulty_level'] == 'intermediate'
    assert task['attachment_url'] == 'https://example.com/brief.pdf'
    assert task['score_weight'] == 0
    assert task['cohort_status'] == 'Session in progress'
    assert task['submission'] is None
    assert task['assigned_at'] and task['session_date']


@pytest.mark.case("ST06-015")
def test_dates_go_out_as_utc(client, rows, assign, student_auth, db):
    """Naive datetimes are UTC in this schema. Serialising one without the Z
    makes `new Date()` read it as local time and every deadline on the screen
    lands 5h30m early for an IST student."""
    achiever = rows.achiever()
    cohort = rows.cohort(achiever, starts_minutes_ago=10, status='live')
    student = rows.student()
    rows.enroll(student, cohort)

    due_local = (datetime.datetime.now() + datetime.timedelta(days=2)).replace(
        hour=23, minute=59, second=0, microsecond=0)
    code, d = assign(achiever, cohort, due_date=due_local.isoformat(timespec='minutes'))
    assert code == 201, d

    task = tasks_of(client, student_auth(student))[0]
    assert task['due_date'].endswith('Z')
    assert task['session_date'].endswith('Z')

    stored = db.session.execute(
        text('SELECT due_date FROM cohort_tasks WHERE id = :i'),
        {'i': d['response']['task_id']}).scalar()
    # The form sends naive IST; storage is UTC. Both ends must agree on which.
    assert task['due_date'] == stored.isoformat() + 'Z'
    assert stored == due_local - datetime.timedelta(hours=5, minutes=30)


@pytest.mark.case("ST06-007")
def test_soonest_deadline_first_and_undated_last(client, rows, assign, student_auth):
    achiever = rows.achiever()
    cohort = rows.cohort(achiever, starts_minutes_ago=10, status='live')
    student = rows.student()
    rows.enroll(student, cohort)

    now = datetime.datetime.now()
    assign(achiever, cohort, title='Later', due_date=(now + datetime.timedelta(days=9)).isoformat(timespec='minutes'))
    assign(achiever, cohort, title='No deadline')
    assign(achiever, cohort, title='Sooner', due_date=(now + datetime.timedelta(days=2)).isoformat(timespec='minutes'))

    assert titles_of(client, student_auth(student)) == ['Sooner', 'Later', 'No deadline']


@pytest.mark.parametrize('status', ['inactive', 'archived'])
@pytest.mark.case("ST06-005")
def test_a_withdrawn_task_is_not_shown(client, rows, assign, student_auth, status):
    achiever = rows.achiever()
    cohort = rows.cohort(achiever, starts_minutes_ago=10, status='live')
    student = rows.student()
    rows.enroll(student, cohort)

    code, d = assign(achiever, cohort, title='Withdrawn', task_status=status)
    assert code == 201, d
    assert d['response']['students_notified'] == 0
    assert titles_of(client, student_auth(student)) == []


def test_a_deleted_task_disappears_from_my_tasks(client, rows, assign, student_auth,
                                                 achiever_auth):
    achiever = rows.achiever()
    cohort = rows.cohort(achiever, starts_minutes_ago=10, status='live')
    student = rows.student()
    rows.enroll(student, cohort)

    _, d = assign(achiever, cohort, title='Withdrawn later')
    task_id = d['response']['task_id']
    assert titles_of(client, student_auth(student)) == ['Withdrawn later']

    assert body(client.delete(f'{ACHIEVER_TASKS}/{task_id}',
                              headers=achiever_auth(achiever)))['status'] == 200
    assert titles_of(client, student_auth(student)) == []


# ── submitting against the same gate ─────────────────────────────────────────

@pytest.mark.case("ST06-009")
def test_a_student_can_submit_during_the_live_session(client, rows, assign, student_auth):
    achiever = rows.achiever()
    cohort = rows.cohort(achiever, starts_minutes_ago=10, status='live')
    student = rows.student()
    rows.enroll(student, cohort)
    _, d = assign(achiever, cohort, title='Submit me')
    task_id = d['response']['task_id']

    r = client.post(f'{TASKS}/{task_id}/submit',
                    json={'evidence_url': 'https://github.com/me/work'},
                    headers=student_auth(student))
    assert body(r)['status'] == 200, body(r)

    task = tasks_of(client, student_auth(student))[0]
    assert task['submission']['evidence_url'] == 'https://github.com/me/work'
    assert task['submission']['submitted_at'].endswith('Z')


@pytest.mark.case("ST06-011")
def test_submitting_before_the_class_starts_is_refused(client, rows, assign, student_auth):
    achiever = rows.achiever()
    cohort = rows.cohort(achiever, starts_in_minutes=240, status='upcoming')
    student = rows.student()
    rows.enroll(student, cohort)
    _, d = assign(achiever, cohort, title='Too early')

    r = client.post(f'{TASKS}/{d["response"]["task_id"]}/submit',
                    json={'evidence_text': 'done'}, headers=student_auth(student))
    assert body(r)['status'] == 403
    assert 'starts' in body(r)['response']['message']


@pytest.mark.case("ST06-012")
def test_submitting_without_an_enrolment_is_refused(client, rows, assign, student_auth):
    achiever = rows.achiever()
    cohort = rows.cohort(achiever, starts_minutes_ago=10, status='live')
    _, d = assign(achiever, cohort, title='Not yours')
    outsider = rows.student()

    r = client.post(f'{TASKS}/{d["response"]["task_id"]}/submit',
                    json={'evidence_text': 'done'}, headers=student_auth(outsider))
    assert body(r)['status'] == 403
    assert 'enrolled' in body(r)['response']['message']


@pytest.mark.case("ST06-013")
def test_submitting_needs_evidence(client, rows, assign, student_auth):
    achiever = rows.achiever()
    cohort = rows.cohort(achiever, starts_minutes_ago=10, status='live')
    student = rows.student()
    rows.enroll(student, cohort)
    _, d = assign(achiever, cohort, title='Needs evidence')

    r = client.post(f'{TASKS}/{d["response"]["task_id"]}/submit', json={},
                    headers=student_auth(student))
    assert body(r)['status'] == 400


def test_submitting_to_a_missing_task_is_404(client, rows, student_auth):
    student = rows.student()
    r = client.post(f'{TASKS}/{uuid.uuid4()}/submit', json={'evidence_text': 'x'},
                    headers=student_auth(student))
    assert body(r)['status'] == 404


def test_the_list_needs_a_token(client):
    assert client.get(f'{TASKS}/').status_code == 401


# ── assignment API validation ────────────────────────────────────────────────

def test_a_title_is_required(client, rows, assign):
    achiever = rows.achiever()
    cohort = rows.cohort(achiever, starts_minutes_ago=10, status='live')
    code, d = assign(achiever, cohort, title='   ')
    assert d['status'] == 400
    assert 'Title' in d['response']['message']


def test_a_cohort_is_required(client, rows, achiever_auth):
    achiever = rows.achiever()
    r = client.post(ACHIEVER_TASKS, json={'title': 'Orphan'}, headers=achiever_auth(achiever))
    assert body(r)['status'] == 400


def test_an_over_long_title_is_a_400_not_a_500(client, rows, assign):
    """It used to reach MySQL and come back as an internal error with an id the
    achiever could do nothing with."""
    achiever = rows.achiever()
    cohort = rows.cohort(achiever, starts_minutes_ago=10, status='live')
    code, d = assign(achiever, cohort, title='x' * 256)
    assert d['status'] == 400
    assert '255' in d['response']['message']
    assert d['response'].get('error_id') is None


def test_a_title_at_the_limit_is_accepted(client, rows, assign):
    achiever = rows.achiever()
    cohort = rows.cohort(achiever, starts_minutes_ago=10, status='live')
    assert assign(achiever, cohort, title='x' * 255)[0] == 201


@pytest.mark.case("ST06-017")
def test_an_unopenable_attachment_is_refused(client, rows, assign):
    achiever = rows.achiever()
    cohort = rows.cohort(achiever, starts_minutes_ago=10, status='live')
    code, d = assign(achiever, cohort, attachment_url='brief.pdf')
    assert d['status'] == 400
    assert 'http' in d['response']['message']


@pytest.mark.case("ST06-017")
def test_an_uploaded_attachment_path_is_accepted(client, rows, assign):
    """What /v1/upload hands back for a stored file."""
    achiever = rows.achiever()
    cohort = rows.cohort(achiever, starts_minutes_ago=10, status='live')
    assert assign(achiever, cohort, attachment_url='/uploads/brief.pdf')[0] == 201


def test_a_bad_due_date_is_refused(client, rows, assign):
    achiever = rows.achiever()
    cohort = rows.cohort(achiever, starts_minutes_ago=10, status='live')
    code, d = assign(achiever, cohort, due_date='next friday')
    assert d['status'] == 400
    assert 'due date' in d['response']['message'].lower()


def test_an_unknown_task_status_is_refused(client, rows, assign):
    achiever = rows.achiever()
    cohort = rows.cohort(achiever, starts_minutes_ago=10, status='live')
    code, d = assign(achiever, cohort, task_status='published')
    assert d['status'] == 400


def test_an_achiever_cannot_set_a_task_on_someone_elses_cohort(client, rows, assign):
    """Same 404 as a cohort that does not exist — a 403 would confirm the id."""
    owner = rows.achiever()
    stranger = rows.achiever()
    cohort = rows.cohort(owner, starts_minutes_ago=10, status='live')

    code, d = assign(stranger, cohort, title='Hijack')
    assert d['status'] == 404


def test_a_student_token_cannot_assign_tasks(client, rows, student_auth):
    student = rows.student()
    r = client.post(ACHIEVER_TASKS, json={'title': 'x', 'cohort_id': str(uuid.uuid4())},
                    headers=student_auth(student))
    assert body(r)['status'] == 403


def test_a_pending_achiever_cannot_assign_tasks(client, rows, assign):
    """can_take_bookings is active only. A pending account has not been
    reviewed and has no session to follow up."""
    achiever = rows.achiever(state='pending')
    cohort = rows.cohort(achiever, starts_minutes_ago=10, status='live')
    code, d = assign(achiever, cohort, title='Not approved yet')
    assert d['status'] == 403


# ── the assignment is what actually landed in the database ───────────────────

def test_the_assignment_is_persisted(client, rows, assign, db):
    achiever = rows.achiever()
    cohort = rows.cohort(achiever, starts_minutes_ago=10, status='live')
    code, d = assign(achiever, cohort, title='On disk', description='Persisted',
                     task_type='quiz', score_weight=7)
    assert code == 201

    row = db.session.execute(text("""
        SELECT cohort_id, title, description, task_type, task_status, score_weight,
               created_by, deleted_at
          FROM cohort_tasks WHERE id = :i
    """), {'i': d['response']['task_id']}).mappings().first()
    assert row['cohort_id'] == cohort
    assert row['title'] == 'On disk'
    assert row['description'] == 'Persisted'
    assert row['task_type'] == 'quiz'
    assert row['task_status'] == 'active'
    assert row['score_weight'] == 0   # achiever's 7 is ignored
    assert row['created_by'] == achiever
    assert row['deleted_at'] is None


def test_every_enrolled_student_is_notified_once(client, rows, assign, db):
    achiever = rows.achiever()
    cohort = rows.cohort(achiever, starts_minutes_ago=10, status='live')
    students = [rows.student(), rows.student()]
    for s in students:
        rows.enroll(s, cohort)

    _, d = assign(achiever, cohort, title='Notify me')
    task_id = d['response']['task_id']

    for s in students:
        n = db.session.execute(text("""
            SELECT COUNT(*) FROM notification_logs
             WHERE user_id = :u AND reference_id = :t AND reference_type = 'cohort_task'
        """), {'u': s, 't': task_id}).scalar()
        assert n == 1


def test_no_notification_before_the_class_starts(client, rows, assign, db):
    """The notification would point at a My Tasks list that does not show it."""
    achiever = rows.achiever()
    cohort = rows.cohort(achiever, starts_in_minutes=240, status='upcoming')
    student = rows.student()
    rows.enroll(student, cohort)

    _, d = assign(achiever, cohort, title='Silent')
    assert d['response']['students_notified'] == 0
    n = db.session.execute(
        text("SELECT COUNT(*) FROM notification_logs WHERE user_id = :u"),
        {'u': student}).scalar()
    assert n == 0


# ── submission cases the suite did not cover ─────────────────────────────────

@pytest.mark.case("ST06-008")
def test_a_student_can_submit_evidence_text(client, rows, assign, student_auth):
    """Every existing submit test used evidence_url, or sent nothing at all to
    prove the refusal — the plain-text path was never asserted to work."""
    achiever = rows.achiever()
    cohort = rows.cohort(achiever, starts_minutes_ago=10, status='live')
    student = rows.student()
    rows.enroll(student, cohort)
    _, d = assign(achiever, cohort, title='Write it up')

    r = client.post(f'{TASKS}/{d["response"]["task_id"]}/submit',
                    json={'evidence_text': 'Finished the exercise; notes below.'},
                    headers=student_auth(student))
    assert body(r)['status'] == 200, body(r)

    task = tasks_of(client, student_auth(student))[0]
    assert task['submission'] is not None
    assert 'Finished the exercise' in task['submission']['evidence_text']


@pytest.mark.case("ST06-010")
def test_resubmitting_updates_rather_than_duplicating(client, rows, assign,
                                                      student_auth, db):
    """Update-or-insert, asserted at the row level. Counting through the API
    would pass even if a second row existed, because the payload carries one
    `submission` either way and would simply show whichever was read first."""
    achiever = rows.achiever()
    cohort = rows.cohort(achiever, starts_minutes_ago=10, status='live')
    student = rows.student()
    rows.enroll(student, cohort)
    _, d = assign(achiever, cohort, title='Two attempts')
    task_id = d['response']['task_id']
    headers = student_auth(student)

    first = client.post(f'{TASKS}/{task_id}/submit',
                        json={'evidence_text': 'first attempt'}, headers=headers)
    assert body(first)['status'] == 200, body(first)
    second = client.post(f'{TASKS}/{task_id}/submit',
                         json={'evidence_text': 'second attempt'}, headers=headers)
    assert body(second)['status'] == 200, body(second)

    n = db.session.execute(text(
        'SELECT COUNT(*) FROM task_submissions WHERE task_id = :t AND user_id = :u'),
        {'t': task_id, 'u': student}).scalar()
    assert n == 1, f'resubmission created {n} rows; it must update in place'

    task = tasks_of(client, headers)[0]
    assert 'second attempt' in task['submission']['evidence_text']


@pytest.mark.case("ST06-014")
def test_a_very_long_submission_is_never_a_500(client, rows, assign, student_auth):
    """P2, and the reason it matters is the shape of the failure, not the limit.
    Either answer is acceptable — accept it, or refuse with a stated limit — but
    letting it reach MySQL returns a 500 carrying an error id the student can do
    nothing with, which is the pattern this codebase keeps hitting."""
    achiever = rows.achiever()
    cohort = rows.cohort(achiever, starts_minutes_ago=10, status='live')
    student = rows.student()
    rows.enroll(student, cohort)
    _, d = assign(achiever, cohort, title='Long answer')

    r = client.post(f'{TASKS}/{d["response"]["task_id"]}/submit',
                    json={'evidence_text': 'x' * 100_000},
                    headers=student_auth(student))
    payload = body(r)
    assert payload['status'] in (200, 400), payload
    if payload['status'] == 400:
        assert payload['response'].get('error_id') is None,             'a length refusal must be a plain 400, not a captured server error'
