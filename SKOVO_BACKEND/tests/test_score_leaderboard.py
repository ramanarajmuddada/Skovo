"""Leaderboard (feature-updates.md §4), against the real procedures."""
import datetime
import uuid

import pytest
from sqlalchemy import text

RULE = 'cohort_attended'          # seeded for test_score_* modules by conftest


def _user(db, name, state='Andhra Pradesh', group='intermediate', year='1', institute='ZPHS Test'):
    uid = str(uuid.uuid4())
    db.session.execute(text(
        "INSERT INTO users (id, full_name, email, status, created_at, updated_at) "
        "VALUES (:i, :n, :e, 'active', UTC_TIMESTAMP(), UTC_TIMESTAMP())"),
        {'i': uid, 'n': name, 'e': f'lb-test-{uid}@skovo.test'})
    db.session.execute(text(
        "CALL sp_stage_open(:i, :u, :g, :y, NULL, NULL, NULL, NULL, NULL, NULL, :ins, :st, NULL)"),
        {'i': str(uuid.uuid4()), 'u': uid, 'g': group, 'y': year, 'ins': institute, 'st': state})
    db.session.commit()
    return uid


def _earn(db, uid, n=1):
    for _ in range(n):
        db.session.execute(text(
            "INSERT INTO score_events (id, user_id, event_type, points, ref_id, occurred_at) "
            "VALUES (:i, :u, :t, 2, :r, UTC_TIMESTAMP())"),
            {'i': str(uuid.uuid4()), 'u': uid, 't': RULE, 'r': str(uuid.uuid4())})
    db.session.commit()


@pytest.fixture
def lb_on(db, app):
    s = db.session.execute(text("SELECT enabled, daily_cap, name_format FROM lb_settings WHERE id = 1")).first()
    pts = db.session.execute(text("SELECT leaderboard_points FROM score_event_rules WHERE event_type = :t"),
                             {'t': RULE}).scalar()
    hw = db.session.execute(text("SELECT last_seq FROM lb_state WHERE id = 1")).scalar()
    db.session.execute(text("UPDATE lb_settings SET enabled = 1, daily_cap = 0, name_format = 'full' WHERE id = 1"))
    db.session.execute(text("UPDATE score_event_rules SET leaderboard_points = 5 WHERE event_type = :t"), {'t': RULE})
    db.session.execute(text("UPDATE lb_state SET last_seq = (SELECT IFNULL(MAX(seq), 0) FROM score_events) WHERE id = 1"))
    db.session.commit()
    made = []
    with app.app_context():
        yield made
    for uid in made:
        for t in ('lb_events', 'lb_profiles', 'score_events', 'student_stages', 'readiness_scores', 'career_streaks'):
            db.session.execute(text(f"DELETE FROM {t} WHERE user_id = :u"), {'u': uid})
        db.session.execute(text("DELETE FROM users WHERE id = :u"), {'u': uid})
    db.session.execute(text("UPDATE lb_settings SET enabled = :e, daily_cap = :c, name_format = :n WHERE id = 1"),
                       {'e': s[0], 'c': s[1], 'n': s[2]})
    db.session.execute(text("UPDATE score_event_rules SET leaderboard_points = :p WHERE event_type = :t"),
                       {'p': pts or 0, 't': RULE})
    db.session.execute(text("UPDATE lb_state SET last_seq = GREATEST(last_seq, :h) WHERE id = 1"), {'h': hw or 0})
    db.session.commit()


def sync(db):
    from portal.helpers import leaderboard
    n = leaderboard.sync()
    db.session.commit()
    return n


def board(uid, scope='school', period='week'):
    from portal.helpers import leaderboard
    return leaderboard.board(uid, scope, period)


def test_disabled_board(db, app):
    db.session.execute(text("UPDATE lb_settings SET enabled = 0 WHERE id = 1"))
    db.session.commit()
    with app.app_context():
        from portal.helpers import leaderboard
        assert leaderboard.board(str(uuid.uuid4()))['enabled'] is False


def test_ranks_by_period_points_within_the_class(db, lb_on):
    a, b = _user(db, 'Ravi Kumar'), _user(db, 'Kiran Rao')
    other_class = _user(db, 'Class Ten', group='class_10')
    lb_on += [a, b, other_class]
    _earn(db, a, 1)
    _earn(db, b, 3)
    _earn(db, other_class, 5)
    assert sync(db) == 9
    res = board(a)
    names = [r['name'] for r in res['rows']]
    assert names == ['Kiran Rao', 'Ravi Kumar']          # Class 10 student not shown
    assert res['me']['rank'] == 2 and res['me']['points'] == 5.0
    assert all('email' not in r and 'phone' not in r for r in res['rows'])


def test_daily_cap(db, lb_on):
    db.session.execute(text("UPDATE lb_settings SET daily_cap = 12 WHERE id = 1"))
    db.session.commit()
    a = _user(db, 'Cap Test')
    lb_on.append(a)
    _earn(db, a, 4)                                    # 4 x 5 = 20, capped at 12
    sync(db)
    assert board(a)['me']['points'] == 12.0


def test_alias_and_photo_off(db, lb_on):
    a = _user(db, 'Real Name')
    lb_on.append(a)
    db.session.execute(text("CALL sp_lb_profile_set(:u, 'MathKing', 1)"), {'u': a})
    db.session.commit()
    _earn(db, a)
    sync(db)
    row = board(a)['rows'][0]
    assert row['name'] == 'MathKing' and row['photo'] is None


def test_admin_removal(db, lb_on):
    a, b = _user(db, 'Cheater'), _user(db, 'Honest')
    lb_on += [a, b]
    _earn(db, a, 5)
    _earn(db, b, 1)
    sync(db)
    db.session.execute(text("CALL sp_lb_remove(:u, 1, 'cheating', NULL)"), {'u': a})
    db.session.commit()
    assert [r['name'] for r in board(b)['rows']] == ['Honest']


def test_scope_state_vs_school(db, lb_on):
    a = _user(db, 'AP One', institute='School A')
    b = _user(db, 'AP Two', institute='School B')
    lb_on += [a, b]
    _earn(db, a)
    _earn(db, b)
    sync(db)
    assert len(board(a, 'school')['rows']) == 1
    assert len(board(a, 'state')['rows']) == 2


def test_payment_rules_never_count(db, lb_on):
    from portal.helpers.leaderboard import is_payment_rule
    assert is_payment_rule('m_pro_subscription_annual_active')
    assert not is_payment_rule('cohort_attended')


def test_league_week_promotes_and_demotes(db, lb_on):
    from portal.helpers import leaderboard
    ls = db.session.execute(text(
        "SELECT enabled, group_size, promote_count, demote_count, tiers FROM league_settings WHERE id = 1")).first()
    db.session.execute(text(
        "UPDATE league_settings SET enabled = 1, group_size = 5, promote_count = 1, demote_count = 1, "
        "tiers = 'Bronze,Silver,Gold' WHERE id = 1"))
    db.session.commit()
    today = datetime.date(2031, 3, 10)                         # a Monday
    prev = today - datetime.timedelta(days=7)
    users = [_user(db, f'League {i}', group='ug', year='9') for i in range(3)]
    lb_on += users
    try:
        for i, uid in enumerate(users):
            db.session.execute(text("CALL sp_league_add_member(:w, :u, 'ug', '9', 1, 0)"), {'w': prev, 'u': uid})
            db.session.execute(text(
                "INSERT INTO lb_events (user_id, stage_id, event_seq, event_type, points, day) "
                "VALUES (:u, NULL, :s, 'test', :p, :d)"),
                {'u': uid, 's': 9_000_000_000 + i + int(uuid.uuid4().int % 1_000_000) * 10, 'p': (i + 1) * 10,
                 'd': prev + datetime.timedelta(days=2)})
        db.session.commit()
        out = leaderboard.close_week_and_regroup(today)
        db.session.commit()
        assert out['settled'] == 3
        res = dict(db.session.execute(text(
            "SELECT user_id, result FROM league_members WHERE week_start = :w AND user_id IN :u"
        ).bindparams(u=tuple(users)), {'w': prev}).all())
        assert res[users[2]] == 'promoted' and res[users[0]] == 'demoted' and res[users[1]] == 'stayed'
        tiers = dict(db.session.execute(text(
            "SELECT user_id, tier FROM league_members WHERE week_start = :w AND user_id IN :u"
        ).bindparams(u=tuple(users)), {'w': today}).all())
        assert tiers[users[2]] == 2 and tiers[users[0]] == 0 and tiers[users[1]] == 1
    finally:
        db.session.execute(text("DELETE FROM league_members WHERE user_id IN :u").bindparams(u=tuple(users)))
        db.session.execute(text(
            "UPDATE league_settings SET enabled = :e, group_size = :g, promote_count = :p, demote_count = :d, "
            "tiers = :t WHERE id = 1"), {'e': ls[0], 'g': ls[1], 'p': ls[2], 'd': ls[3], 't': ls[4]})
        db.session.commit()
