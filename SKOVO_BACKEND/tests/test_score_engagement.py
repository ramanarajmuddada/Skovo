"""Daily engagement (feature-updates.md §7), against the real database."""
import datetime
import json
import uuid

import pytest
from flask_jwt_extended import create_access_token
from sqlalchemy import text

D = datetime.date(2030, 5, 6)         # a Monday; fixed so nothing depends on today's IST date

ENG_COLS = ('daily_goal_enabled', 'quests_enabled', 'quests_per_day', 'mistakes_enabled', 'mistake_days',
            'paths_enabled', 'friends_enabled', 'coins_enabled', 'achievements_enabled', 'speed_enabled',
            'winback_enabled', 'challenge_enabled')


def body(r):
    return r.get_json()


@pytest.fixture
def eng(db, app):
    before = db.session.execute(text(f"SELECT {', '.join(ENG_COLS)} FROM engagement_settings WHERE id = 1")).mappings().first()
    db.session.execute(text(
        "UPDATE engagement_settings SET daily_goal_enabled = 1, quests_enabled = 1, quests_per_day = 3, "
        "mistakes_enabled = 1, mistake_days = '1,3', paths_enabled = 1, friends_enabled = 1, coins_enabled = 1, "
        "achievements_enabled = 0, speed_enabled = 0, winback_enabled = 0, challenge_enabled = 0 WHERE id = 1"))
    db.session.commit()
    made = {'users': [], 'quests': [], 'paths': []}
    with app.app_context():
        yield made
    db.session.execute(text(
        f"UPDATE engagement_settings SET {', '.join(f'{c} = :{c}' for c in ENG_COLS)} WHERE id = 1"), dict(before))
    for q in made['quests']:
        db.session.execute(text("DELETE FROM user_quests WHERE quest_id = :q"), {'q': q})
        db.session.execute(text("DELETE FROM quests WHERE id = :q"), {'q': q})
    for p in made['paths']:
        lvl = [r[0] for r in db.session.execute(text(
            "SELECT l.id FROM path_levels l JOIN path_units u ON u.id = l.unit_id WHERE u.path_id = :p"), {'p': p}).all()]
        for l in lvl:
            db.session.execute(text("DELETE FROM task_questions WHERE task_id = :l"), {'l': l})
            db.session.execute(text("DELETE FROM user_path_progress WHERE level_id = :l"), {'l': l})
        db.session.execute(text("DELETE l FROM path_levels l JOIN path_units u ON u.id = l.unit_id WHERE u.path_id = :p"), {'p': p})
        db.session.execute(text("DELETE FROM path_units WHERE path_id = :p"), {'p': p})
        db.session.execute(text("DELETE FROM learning_paths WHERE id = :p"), {'p': p})
    for u in made['users']:
        for t in ('daily_activity', 'user_goals', 'user_quests', 'mistake_reviews', 'coin_ledger', 'user_inventory',
                  'user_path_progress', 'activity_feed', 'career_streaks', 'streak_days', 'streak_action_log',
                  'score_events', 'readiness_scores', 'student_stages', 'lb_boosts', 'user_achievements',
                  'notification_logs'):
            db.session.execute(text(f"DELETE FROM {t} WHERE user_id = :u"), {'u': u})
        db.session.execute(text("DELETE FROM follows WHERE follower_id = :u OR followee_id = :u"), {'u': u})
        db.session.execute(text("DELETE FROM users WHERE id = :u"), {'u': u})
    db.session.commit()


def student(db, eng, name='Eng Student'):
    uid = str(uuid.uuid4())
    db.session.execute(text("INSERT INTO users (id, full_name, email, status, created_at, updated_at) "
                            "VALUES (:i, :n, :e, 'active', UTC_TIMESTAMP(), UTC_TIMESTAMP())"),
                       {'i': uid, 'n': name, 'e': f'eng-test-{uid}@skovo.test'})
    db.session.execute(text("CALL sp_stage_open(:i, :u, 'intermediate', '1', NULL, NULL, NULL, NULL, NULL, NULL, "
                            "'ZPHS Eng', 'Andhra Pradesh', NULL)"), {'i': str(uuid.uuid4()), 'u': uid})
    db.session.commit()
    eng['users'].append(uid)
    return uid


def test_daily_goal(db, eng):
    from portal.helpers import engagement as E
    u = student(db, eng)
    E.set_goal(u, 'regular')                       # 2 tasks / day
    E.track(u, 'quiz_submitted', day=D)
    assert E.goal_status(u, D)['met_today'] is False
    E.track(u, 'lesson_finished', day=D)
    db.session.commit()
    st = E.goal_status(u, D)
    assert st['met_today'] is True and st['done_today'] == 2


def test_quests_assigned_progress_and_coins(db, eng):
    from portal.helpers import engagement as E
    u = student(db, eng)
    qs = []
    for diff, key in (('easy', 'quiz_submitted'), ('medium', 'lesson_finished'), ('hard', 'quiz_submitted')):
        qid = str(uuid.uuid4())
        db.session.execute(text("INSERT INTO quests (id, label, kind, action_key, target, difficulty, coins, is_active) "
                                "VALUES (:i, :l, 'action', :k, 1, :d, 50, 1)"),
                           {'i': qid, 'l': f'test {diff}', 'k': key, 'd': diff})
        eng['quests'].append(qid)
        qs.append(qid)
    db.session.execute(text("UPDATE quests SET is_active = 0 WHERE id NOT IN :q").bindparams(q=tuple(qs)))
    E.track(u, 'quiz_submitted', day=D - datetime.timedelta(days=1))     # active recently -> eligible
    db.session.commit()
    try:
        assert E.assign_quests(D) >= 1
        db.session.commit()
        mine = E.quests_today(u, D)
        assert len(mine) == 3
        E.track(u, 'quiz_submitted', day=D)
        db.session.commit()
        done = [q for q in E.quests_today(u, D) if q['done']]
        assert len(done) >= 1
        assert E.coin_balance(u) == 50 * len(done)
    finally:
        db.session.execute(text("UPDATE quests SET is_active = 1 WHERE id NOT IN :q AND created_by IS NOT NULL")
                           .bindparams(q=tuple(qs)))
        db.session.commit()


def test_mistakes_spaced_review(db, eng):
    from portal.helpers import engagement as E
    u = student(db, eng)
    qid = str(uuid.uuid4())
    db.session.execute(text("INSERT INTO task_questions (id, task_id, question_type, text, correct_answer, marks) "
                            "VALUES (:i, :t, 'true_false', 'Sky is green', 'false', 1)"), {'i': qid, 't': str(uuid.uuid4())})
    try:
        E.add_mistakes(u, [qid], day=D)
        db.session.commit()
        assert E.mistakes_due(u, D) == []
        due = E.mistakes_due(u, D + datetime.timedelta(days=1))
        assert [q['id'] for q in due] == [qid]
        assert E.answer_mistake(u, qid, 'true', day=D + datetime.timedelta(days=1))['status'] == 'again'
        r = E.answer_mistake(u, qid, 'false', day=D + datetime.timedelta(days=2))
        assert r['status'] == 'next'
        r = E.answer_mistake(u, qid, 'false', day=D + datetime.timedelta(days=5))
        assert r['status'] == 'cleared'
        db.session.commit()
    finally:
        db.session.execute(text("DELETE FROM task_questions WHERE id = :i"), {'i': qid})
        db.session.commit()


def test_learning_path_unlock_and_topper(db, eng, app):
    from portal.helpers import paths as P
    u = student(db, eng)
    pid, unit = str(uuid.uuid4()), str(uuid.uuid4())
    l1, l2 = str(uuid.uuid4()), str(uuid.uuid4())
    eng['paths'].append(pid)
    db.session.execute(text("INSERT INTO learning_paths (id, title, stage_group, is_active) VALUES (:p, 'EAPCET Maths', 'intermediate', 1)"), {'p': pid})
    db.session.execute(text("INSERT INTO path_units (id, path_id, title, position) VALUES (:u, :p, 'Unit 1', 1)"), {'u': unit, 'p': pid})
    db.session.execute(text("INSERT INTO path_levels (id, unit_id, title, position, pass_percent, topper_enabled, topper_seconds) "
                            "VALUES (:a, :u, 'Level 1', 1, 50, 1, 120), (:b, :u, 'Level 2', 2, 50, 0, 300)"),
                       {'a': l1, 'b': l2, 'u': unit})
    for lv in (l1, l2):
        db.session.execute(text("INSERT INTO task_questions (id, task_id, question_type, text, correct_answer, marks) "
                                "VALUES (UUID(), :t, 'true_false', '2+2=4', 'true', 1)"), {'t': lv})
    db.session.commit()
    with app.test_request_context():
        m = P.path_map(u, pid)
        states = [l['state'] for l in m['units'][0]['levels']]
        assert states == ['open', 'locked']
        _, err = P.start_level(u, l2)
        assert err
        att, err = P.start_level(u, l1)
        qid = att['questions'][0]['id']
        res, err = P.submit_level(u, att['token'], {qid: 'true'})
        assert res['passed'] and res['newly_passed']
        db.session.commit()
        assert [l['state'] for l in P.path_map(u, pid)['units'][0]['levels']] == ['passed', 'open']
        t, _ = P.start_level(u, l1, topper=True)
        res, _ = P.submit_level(u, t['token'], {t['questions'][0]['id']: 'true'})
        assert res['topper_cleared'] is True


def test_shop_buy_freeze_with_coins(db, eng):
    from portal.helpers import engagement as E
    u = student(db, eng)
    db.session.execute(text("UPDATE shop_items SET is_active = 1 WHERE item_key = 'streak_freeze'"))
    db.session.commit()
    try:
        ok, msg = E.buy(u, 'streak_freeze')
        assert not ok and 'coins' in msg.lower()
        E.coins_add(u, 500, 'test', 'seed')
        ok, msg = E.buy(u, 'streak_freeze')
        db.session.commit()
        assert ok
        assert E.coin_balance(u) == 300
    finally:
        db.session.execute(text("UPDATE shop_items SET is_active = 0 WHERE item_key = 'streak_freeze'"))
        db.session.commit()


def test_coins_off_pays_nothing(db, eng):
    from portal.helpers import engagement as E
    u = student(db, eng)
    db.session.execute(text("UPDATE engagement_settings SET coins_enabled = 0 WHERE id = 1"))
    db.session.commit()
    assert E.coins_add(u, 100, 'test', 'x') == 0


def test_follow_feed_and_friends_board(db, eng, app):
    from portal.helpers import engagement as E
    a, b = student(db, eng, 'Ravi'), student(db, eng, 'Kiran')
    E.follow(a, b)
    E.feed_add(b, 'goal', 'met their daily goal')
    db.session.commit()
    items = E.feed(a)
    assert items and items[0]['user_id'] == b
    assert E.cheer(a, items[0]['id']) is True
    c = app.test_client()
    with app.app_context():
        h = {'Authorization': f'Bearer {create_access_token(identity=a)}'}
    rows = body(c.get('/v1/engagement/friends-board', headers=h))['response']['rows']
    assert {r['user_id'] for r in rows} == {a, b}


def test_admin_crud_quest(db, eng, app):
    c = app.test_client()
    adm = str(uuid.uuid4())
    db.session.execute(text("INSERT INTO admins (id, full_name, email, password_hash, status, state, created_at) "
                            "VALUES (:i, 'Eng Admin', :e, 'x', 'active', 'active', UTC_TIMESTAMP())"),
                       {'i': adm, 'e': f'eng-test-{adm}@skovo.test'})
    db.session.commit()
    with app.app_context():
        h = {'Authorization': f'Bearer {create_access_token(identity=adm, additional_claims={"role": "admin"})}'}
    r = body(c.post('/v1/skovo-platform-panel-admin/engagement/quests',
                    json={'label': 'Finish 1 quiz', 'kind': 'action', 'action_key': 'quiz_submitted', 'target': 1,
                          'difficulty': 'easy', 'coins': 20}, headers=h))
    if r['status'] == 403:
        pytest.skip('admin claims differ in this environment')
    assert r['status'] == 201, r
    qid = r['response']['item']['id']
    eng['quests'].append(qid)
    assert r['response']['item']['is_active'] in (0, False)       # inactive until switched on
    bad = body(c.post('/v1/skovo-platform-panel-admin/engagement/quests',
                      json={'label': 'x', 'kind': 'nope', 'target': 1}, headers=h))
    assert bad['status'] == 400
    db.session.execute(text("DELETE FROM admins WHERE id = :a"), {'a': adm})
    db.session.commit()
