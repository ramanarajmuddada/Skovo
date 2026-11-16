"""Community live chat (feature-updates.md §6), through the API."""
import uuid

import pytest
from flask_jwt_extended import create_access_token
from sqlalchemy import text

A = '/v1/assemble'


def body(r):
    d = r.get_json()
    assert d is not None, r.data[:200]
    return d


@pytest.fixture
def client(app):
    return app.test_client()


@pytest.fixture
def people(db, app):
    made = []

    def make(name):
        uid = str(uuid.uuid4())
        db.session.execute(text(
            "INSERT INTO users (id, full_name, email, status, created_at, updated_at) "
            "VALUES (:i, :n, :e, 'active', UTC_TIMESTAMP(), UTC_TIMESTAMP())"),
            {'i': uid, 'n': name, 'e': f'chat-test-{uid}@skovo.test'})
        db.session.execute(text(
            "INSERT INTO user_profiles (id, user_id, school_name, city, created_at, updated_at) "
            "VALUES (UUID(), :u, 'ZPHS Chat Test', 'Vizag', UTC_TIMESTAMP(), UTC_TIMESTAMP())"), {'u': uid})
        db.session.commit()
        made.append(uid)
        with app.app_context():
            h = {'Authorization': f'Bearer {create_access_token(identity=uid)}'}
        return uid, h
    yield make
    for uid in made:
        gids = [r[0] for r in db.session.execute(text("SELECT id FROM `groups` WHERE created_by = :u"), {'u': uid}).all()]
        for g in gids:
            for t in ('community_messages', 'community_polls', 'community_reports'):
                db.session.execute(text(f"DELETE FROM {t} WHERE group_id = :g"), {'g': g})
            db.session.execute(text("DELETE FROM group_memberships WHERE group_id = :g"), {'g': g})
            db.session.execute(text("DELETE FROM `groups` WHERE id = :g"), {'g': g})
        for t in ('community_reads', 'community_reactions', 'community_poll_votes', 'group_memberships',
                  'score_events', 'readiness_scores', 'notification_logs', 'user_profiles'):
            db.session.execute(text(f"DELETE FROM {t} WHERE user_id = :u"), {'u': uid})
        db.session.execute(text("DELETE FROM users WHERE id = :u"), {'u': uid})
    db.session.commit()


@pytest.fixture
def group(client, people):
    owner, oh = people('Owner Ravi')
    member, mh = people('Member Kiran')
    g = body(client.post(f'{A}/groups', json={'name': f'Chat Test {uuid.uuid4().hex[:6]}', 'join_type': 'open'},
                         headers=oh))
    assert g['status'] in (200, 201), g
    gid = g['response'].get('group', {}).get('id') or g['response'].get('id')
    j = body(client.post(f'{A}/groups/{gid}/join', headers=mh))
    assert j['status'] == 200, j
    return {'id': gid, 'owner': (owner, oh), 'member': (member, mh)}


def test_send_and_poll(client, group):
    _, mh = group['member']
    _, oh = group['owner']
    s = body(client.post(f"{A}/groups/{group['id']}/chat", json={'body': 'Hello class'}, headers=mh))
    assert s['status'] == 201, s
    seq = s['response']['message']['seq']
    lst = body(client.get(f"{A}/groups/{group['id']}/chat?after={seq - 1}", headers=oh))['response']
    assert [m['body'] for m in lst['messages']] == ['Hello class']


def test_phone_masked_and_link_refused(client, group):
    _, mh = group['member']
    s = body(client.post(f"{A}/groups/{group['id']}/chat", json={'body': 'call me 9876543210'}, headers=mh))
    assert '9876543210' not in s['response']['message']['body'] and 'notice' in s['response']
    r = body(client.post(f"{A}/groups/{group['id']}/chat", json={'body': 'join www.example.com'}, headers=mh))
    assert r['status'] == 400


def test_outsider_cannot_read(client, group, people):
    _, xh = people('Stranger')
    assert body(client.get(f"{A}/groups/{group['id']}/chat", headers=xh))['status'] == 404


def test_admin_only_mode(client, group):
    _, oh = group['owner']
    _, mh = group['member']
    body(client.put(f"{A}/groups/{group['id']}/chat-settings", json={'admin_only': True}, headers=oh))
    assert body(client.post(f"{A}/groups/{group['id']}/chat", json={'body': 'hi'}, headers=mh))['status'] == 403
    assert body(client.post(f"{A}/groups/{group['id']}/chat", json={'body': 'exam week'}, headers=oh))['status'] == 201


def test_slow_mode(client, group):
    _, oh = group['owner']
    _, mh = group['member']
    body(client.put(f"{A}/groups/{group['id']}/chat-settings", json={'slow_mode_seconds': 60}, headers=oh))
    assert body(client.post(f"{A}/groups/{group['id']}/chat", json={'body': 'one'}, headers=mh))['status'] == 201
    assert body(client.post(f"{A}/groups/{group['id']}/chat", json={'body': 'two'}, headers=mh))['status'] == 429


def test_doubt_solved_by_classmate(client, group, db):
    member, mh = group['member']
    owner, oh = group['owner']
    d = body(client.post(f"{A}/groups/{group['id']}/chat", json={'body': 'How to find roots?', 'is_doubt': True},
                         headers=mh))['response']['message']
    a = body(client.post(f"{A}/groups/{group['id']}/chat", json={'body': 'Use the formula', 'reply_to': d['id']},
                         headers=oh))['response']['message']
    r = body(client.post(f"{A}/chat/{d['id']}/solve", json={'answer_id': a['id']}, headers=mh))
    assert r['status'] == 200, r
    again = body(client.post(f"{A}/chat/{d['id']}/solve", json={'answer_id': a['id']}, headers=mh))
    assert again['status'] == 409
    th = body(client.get(f"{A}/groups/{group['id']}/top-helpers", headers=mh))['response']['helpers']
    assert th and th[0]['user_id'] == owner


def test_reactions_and_poll(client, group):
    _, mh = group['member']
    _, oh = group['owner']
    m = body(client.post(f"{A}/groups/{group['id']}/chat", json={'body': 'nice'}, headers=mh))['response']['message']
    assert body(client.post(f"{A}/chat/{m['id']}/react", json={'emoji': '👍'}, headers=oh))['response']['result'] == 'added'
    p = body(client.post(f"{A}/groups/{group['id']}/polls", json={'question': 'Best time?', 'options': ['5 pm', '7 pm']},
                         headers=oh))['response']['message']
    v = body(client.post(f"{A}/polls/{p['poll']['id']}/vote", json={'option_index': 1}, headers=mh))['response']['poll']
    assert v['options'][1]['votes'] == 1 and v['options'][1]['mine'] is True


def test_delete_own_message(client, group):
    _, mh = group['member']
    m = body(client.post(f"{A}/groups/{group['id']}/chat", json={'body': 'oops'}, headers=mh))['response']['message']
    assert body(client.delete(f"{A}/chat/{m['id']}", headers=mh))['status'] == 200


def test_invite_link_join(client, group, people):
    _, oh = group['owner']
    code = body(client.post(f"{A}/groups/{group['id']}/invite", headers=oh))['response']['invite_code']
    _, nh = people('New Student')
    r = body(client.post(f'{A}/join/{code}', headers=nh))
    assert r['status'] == 200, r


def test_unread_counts(client, group):
    _, mh = group['member']
    _, oh = group['owner']
    body(client.post(f"{A}/groups/{group['id']}/chat", json={'body': 'unread one'}, headers=mh))
    rows = body(client.get(f'{A}/chat/unread', headers=oh))['response']['groups']
    assert next(r for r in rows if r['group_id'] == group['id'])['unread'] >= 1
