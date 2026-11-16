"""Version 1 platform pieces (feature-updates.md §16): data rights, parent view, school merge."""
import uuid

import pytest
from flask_jwt_extended import create_access_token
from sqlalchemy import text


def body(r):
    return r.get_json()


@pytest.fixture
def ctx(db, app):
    made = {'users': [], 'admins': []}
    c = app.test_client()

    def student(name='Platform Test'):
        uid = str(uuid.uuid4())
        db.session.execute(text("INSERT INTO users (id, full_name, email, status, created_at, updated_at) "
                                "VALUES (:i, :n, :e, 'active', UTC_TIMESTAMP(), UTC_TIMESTAMP())"),
                           {'i': uid, 'n': name, 'e': f'plat-test-{uid}@skovo.test'})
        db.session.execute(text("INSERT INTO user_profiles (id, user_id, school_name, created_at, updated_at) "
                                "VALUES (UUID(), :u, :s, UTC_TIMESTAMP(), UTC_TIMESTAMP())"),
                           {'u': uid, 's': f'ZPHS Plat {uid[:4]}'})
        db.session.commit()
        made['users'].append(uid)
        with app.app_context():
            return uid, {'Authorization': f'Bearer {create_access_token(identity=uid)}'}

    def admin():
        aid = str(uuid.uuid4())
        db.session.execute(text("INSERT INTO admins (id, full_name, email, password_hash, status, state, created_at) "
                                "VALUES (:i, 'Plat Admin', :e, 'x', 'active', 'active', UTC_TIMESTAMP())"),
                           {'i': aid, 'e': f'plat-test-{aid}@skovo.test'})
        db.session.commit()
        made['admins'].append(aid)
        with app.app_context():
            return {'Authorization': f'Bearer {create_access_token(identity=aid, additional_claims={"role": "admin"})}'}

    with app.app_context():
        yield {'c': c, 'student': student, 'admin': admin}
    for u in made['users']:
        for t in ('wallet_ledger', 'wallet_bonus_lots', 'wallets', 'account_deletions', 'lb_profiles', 'user_profiles',
                  'parental_consents', 'student_stages'):
            db.session.execute(text(f"DELETE FROM {t} WHERE user_id = :u"), {'u': u})
        db.session.execute(text("DELETE FROM admin_alerts WHERE ref = :u"), {'u': u})
        db.session.execute(text("DELETE FROM users WHERE id = :u"), {'u': u})
    for a in made['admins']:
        db.session.execute(text("DELETE FROM admins WHERE id = :a"), {'a': a})
    db.session.execute(text("DELETE FROM institution_aliases WHERE canonical LIKE 'ZPHS Plat%'"))
    db.session.commit()


def test_my_data_export(ctx):
    _, h = ctx['student']()
    d = body(ctx['c'].get('/v1/profile/my-data', headers=h))['response']
    assert 'account' in d and 'points_history' in d and 'wallet' in d
    assert 'phone' not in str(d['profile'])


def test_delete_needs_wallet_decision(ctx, db):
    from portal.helpers import wallet
    uid, h = ctx['student']()
    wallet.credit_refund(uid, 250, 'seed')
    db.session.commit()
    r = body(ctx['c'].post('/v1/profile/delete-account', json={'confirm': 'DELETE'}, headers=h))
    assert r['status'] == 409 and r['response']['needs_wallet_decision']
    r = body(ctx['c'].post('/v1/profile/delete-account', json={'confirm': 'DELETE', 'forfeit_wallet': True}, headers=h))
    assert r['status'] == 200
    u = db.session.execute(text("SELECT full_name, deleted_at, email FROM users WHERE id = :u"), {'u': uid}).mappings().first()
    assert u['full_name'] == 'Deleted student' and u['deleted_at'] and u['email'].endswith('@deleted.skovo')
    assert wallet.balances(uid)['refund_money'] == 0


def test_delete_requires_typed_confirmation(ctx):
    _, h = ctx['student']()
    assert body(ctx['c'].post('/v1/profile/delete-account', json={}, headers=h))['status'] == 400


def test_parent_overview(ctx, db):
    uid, _ = ctx['student']('Child Ravi')
    token = str(uuid.uuid4())
    db.session.execute(text("INSERT INTO parental_consents (id, user_id, parent_email, parent_name, token, status, "
                            "requested_at, confirmed_at) VALUES (UUID(), :u, 'p@x.test', 'Parent', :t, 'confirmed', "
                            "UTC_TIMESTAMP(), UTC_TIMESTAMP())"), {'u': uid, 't': token})
    db.session.commit()
    r = body(ctx['c'].get(f'/v1/auth/parent/overview?token={token}'))
    assert r['status'] == 200 and r['response']['child_name'] == 'Child Ravi' and 'wallet' in r['response']
    assert body(ctx['c'].get('/v1/auth/parent/overview?token=bad'))['status'] == 404


def test_institution_merge(ctx, db):
    uid, _ = ctx['student']()
    h = ctx['admin']()
    old = db.session.execute(text("SELECT school_name FROM user_profiles WHERE user_id = :u"), {'u': uid}).scalar()
    canonical = f'ZPHS Plat Canonical {uuid.uuid4().hex[:4]}'
    r = body(ctx['c'].post('/v1/skovo-platform-panel-admin/institutions/merge',
                           json={'canonical': canonical, 'variants': [old]}, headers=h))
    assert r['status'] == 200, r
    assert db.session.execute(text("SELECT school_name FROM user_profiles WHERE user_id = :u"), {'u': uid}).scalar() == canonical
