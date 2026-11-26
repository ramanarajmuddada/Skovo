"""Admin Achievers activity dossier + reinstate restores prior state."""
import uuid
from pathlib import Path

import pytest
from flask_jwt_extended import create_access_token
from sqlalchemy import text

from portal.helpers.sql_file import apply_sql_file

ADMIN = '/v1/skovo-platform-panel-admin'
TEST_PREFIX = 'adm-ach-act-'
REPO = Path(__file__).resolve().parents[1]


@pytest.fixture
def client(app):
    return app.test_client()


def body(resp):
    payload = resp.get_json()
    assert payload is not None, f'no JSON body: {resp.data[:200]}'
    return payload


@pytest.fixture
def procs(app, db):
    with app.app_context():
        apply_sql_file(str(REPO / 'database/stored_procedures/business/admin_achiever_activity.sql'))
        apply_sql_file(
            str(REPO / 'database/stored_procedures/business/achiever_lifecycle.sql'),
            only_containing='sp_achiever_pre_suspension_state',
        )


@pytest.fixture
def world(app, db, procs):
    ids = {k: str(uuid.uuid4()) for k in ('achiever', 'admin', 'student')}
    db.session.execute(text("""
        INSERT INTO achievers (id, full_name, email, state, status, is_active,
                               is_verified, created_at, updated_at)
        VALUES (:i, 'Activity Test Achiever', :e, 'active', 'active', 1, 1,
                UTC_TIMESTAMP(), UTC_TIMESTAMP())
    """), {'i': ids['achiever'], 'e': f'{TEST_PREFIX}{ids["achiever"]}@skovo.test'})
    db.session.execute(text("""
        INSERT INTO admins (id, full_name, email, password_hash, status, state, created_at)
        VALUES (:i, 'Activity Admin', :e, 'x', 'active', 'active', UTC_TIMESTAMP())
    """), {'i': ids['admin'], 'e': f'{TEST_PREFIX}{ids["admin"]}@skovo.test'})
    db.session.execute(text("""
        INSERT INTO users (id, full_name, email, status, created_at, updated_at)
        VALUES (:i, 'Activity Student', :e, 'active', UTC_TIMESTAMP(), UTC_TIMESTAMP())
    """), {'i': ids['student'], 'e': f'{TEST_PREFIX}{ids["student"]}@skovo.test'})
    db.session.commit()
    yield ids
    for sql, params in [
        ('DELETE FROM achiever_reviews WHERE achiever_id = :a', {'a': ids['achiever']}),
        ('DELETE FROM achiever_sessions WHERE mentor_id = :a', {'a': ids['achiever']}),
        ('DELETE FROM cohort_enrollments WHERE cohort_id IN '
         '(SELECT id FROM cohorts WHERE achiever_id = :a)', {'a': ids['achiever']}),
        ('DELETE FROM cohorts WHERE achiever_id = :a', {'a': ids['achiever']}),
        ('DELETE FROM achiever_state_events WHERE achiever_id = :a', {'a': ids['achiever']}),
        ('DELETE FROM achievers WHERE id = :a', {'a': ids['achiever']}),
        ('DELETE FROM admins WHERE id = :i', {'i': ids['admin']}),
        ('DELETE FROM users WHERE id = :u', {'u': ids['student']}),
    ]:
        db.session.execute(text(sql), params)
    db.session.commit()


def admin_headers(admin_id):
    return {'Authorization': 'Bearer ' + create_access_token(
        identity=str(admin_id),
        additional_claims={'role': 'admin', 'full_name': 'Activity Admin'})}


@pytest.mark.case('ADM-ACH-001')
def test_activity_counts_cohorts_students_sessions_and_reviews(app, client, db, world):
    cid = str(uuid.uuid4())
    sid = str(uuid.uuid4())
    rid = str(uuid.uuid4())
    db.session.execute(text("""
        INSERT INTO cohorts (id, title, achiever_id, session_date, duration_minutes,
                             total_seats, filled_seats, price, status,
                             created_at, updated_at)
        VALUES (:i, 'Activity Cohort', :a, UTC_TIMESTAMP(), 90, 10, 1, 0, 'live',
                UTC_TIMESTAMP(), UTC_TIMESTAMP())
    """), {'i': cid, 'a': world['achiever']})
    db.session.execute(text("""
        INSERT INTO cohort_enrollments (id, user_id, cohort_id, payment_status,
                                        amount_paid, enrolled_at, created_at, updated_at)
        VALUES (:i, :u, :c, 'free', 0, UTC_TIMESTAMP(), UTC_TIMESTAMP(), UTC_TIMESTAMP())
    """), {'i': str(uuid.uuid4()), 'u': world['student'], 'c': cid})
    db.session.execute(text("""
        INSERT INTO achiever_sessions (id, mentor_id, student_id, status, amount,
                                       payment_status, is_demo, created_at, updated_at)
        VALUES (:i, :a, :u, 'completed', 0, 'free', 0, UTC_TIMESTAMP(), UTC_TIMESTAMP())
    """), {'i': sid, 'a': world['achiever'], 'u': world['student']})
    db.session.execute(text("""
        INSERT INTO achiever_reviews (id, achiever_id, user_id, rating, review_text,
                                      is_active, created_at, updated_at)
        VALUES (:i, :a, :u, 5, 'Clear and useful.', 1, UTC_TIMESTAMP(), UTC_TIMESTAMP())
    """), {'i': rid, 'a': world['achiever'], 'u': world['student']})
    db.session.commit()

    with app.app_context():
        hdr = admin_headers(world['admin'])
    listed = body(client.get(f'{ADMIN}/achievers', headers=hdr))
    assert listed['status'] == 200, listed
    row = next((x for x in listed['response']['achievers'] if x['id'] == world['achiever']), None)
    assert row is not None, 'directory should include the achiever'
    assert row['cohorts_created'] >= 1
    assert row['students_joined'] >= 1
    assert row['sessions_1on1'] >= 1
    assert row['review_count'] >= 1

    d = body(client.get(f'{ADMIN}/achievers/{world["achiever"]}/activity', headers=hdr))
    assert d['status'] == 200, d
    s = d['response']['summary']
    assert s['cohorts_created'] >= 1
    assert s['students_joined'] >= 1
    assert s['sessions_completed'] >= 1
    assert s['review_count'] >= 1
    assert any(c['id'] == cid for c in d['response']['cohorts'])
    assert any(x['student_name'] == 'Activity Student' for x in d['response']['students'])
    assert any(x['id'] == sid for x in d['response']['sessions'])
    assert any(x['id'] == rid and x['rating'] == 5 for x in d['response']['reviews'])


@pytest.mark.case('ADM-ACH-002')
def test_reinstate_returns_a_pending_achiever_to_pending(app, client, db, world):
    db.session.execute(text("""
        UPDATE achievers SET state = 'pending' WHERE id = :i
    """), {'i': world['achiever']})
    db.session.commit()

    with app.app_context():
        hdr = admin_headers(world['admin'])
    sus = body(client.post(
        f'{ADMIN}/achiever-lifecycle/{world["achiever"]}/suspend',
        json={'period': '1m', 'reason': 'Activity-test suspension'},
        headers=hdr,
    ))
    assert sus['status'] == 200, sus
    assert sus['response']['to_state'] == 'suspended'

    rein = body(client.post(
        f'{ADMIN}/achiever-lifecycle/{world["achiever"]}/reinstate',
        json={'reason': 'Activity-test reinstate'},
        headers=hdr,
    ))
    assert rein['status'] == 200, rein
    assert rein['response']['to_state'] == 'pending', rein
    state = db.session.execute(
        text('SELECT state FROM achievers WHERE id = :i'), {'i': world['achiever']}
    ).scalar()
    assert state == 'pending'
