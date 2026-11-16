"""Career streaks (feature-updates.md §3), against the real procedures."""
import datetime
import uuid

import pytest
from sqlalchemy import text

D0 = datetime.date(2030, 1, 10)       # fixed days: no dependence on today's IST date


def day(n):
    return D0 + datetime.timedelta(days=n)


@pytest.fixture
def streak_on(db, app):
    """Streaks enabled with two counting actions; everything put back after."""
    s = db.session.execute(text("SELECT * FROM streak_settings WHERE id = 1")).mappings().first()
    acts = db.session.execute(text(
        "SELECT action_key, counts, min_per_day FROM streak_actions")).mappings().all()
    db.session.execute(text(
        "UPDATE streak_settings SET enabled = 1, freeze_every_days = 3, freeze_max = 2, "
        "freeze_max_pro = 2, restore_per_month = 1, buddy_max = 5 WHERE id = 1"))
    db.session.execute(text("UPDATE streak_actions SET counts = 0"))
    db.session.execute(text(
        "UPDATE streak_actions SET counts = 1, min_per_day = 1, segment_stage = NULL, "
        "segment_branch = NULL, segment_state = NULL WHERE action_key IN ('quiz_submitted', 'task_submitted')"))
    db.session.commit()
    with app.app_context():
        yield
    cols = ', '.join(f"{k} = :{k}" for k in s.keys() if k not in ('id', 'updated_at'))
    db.session.execute(text(f"UPDATE streak_settings SET {cols} WHERE id = 1"),
                       {k: v for k, v in s.items() if k not in ('id', 'updated_at')})
    for a in acts:
        db.session.execute(text(
            "UPDATE streak_actions SET counts = :c, min_per_day = :m WHERE action_key = :k"),
            {'c': a['counts'], 'm': a['min_per_day'], 'k': a['action_key']})
    db.session.commit()


@pytest.fixture
def student(db, user):
    yield user
    for t in ('career_streaks', 'streak_days', 'streak_action_log', 'student_stages'):
        db.session.execute(text(f"DELETE FROM {t} WHERE user_id = :u"), {'u': user})
    db.session.execute(text("DELETE FROM buddy_streaks WHERE user_a = :u OR user_b = :u"), {'u': user})
    db.session.commit()


def rec(db, uid, key, n):
    from portal.helpers import streaks
    r = streaks.record(uid, key, day=day(n))
    db.session.commit()
    return r


def summary(db, uid):
    return db.session.execute(text("SELECT * FROM career_streaks WHERE user_id = :u"),
                              {'u': uid}).mappings().first()


def nightly(db, n):
    from portal.helpers import streaks
    out = streaks.nightly(day=day(n))
    db.session.commit()
    return out


def test_disabled_counts_nothing(db, app, student):
    db.session.execute(text("UPDATE streak_settings SET enabled = 0 WHERE id = 1"))
    db.session.commit()
    with app.app_context():
        from portal.helpers import streaks
        assert streaks.record(student, 'quiz_submitted', day=day(0))['result'] == 'disabled'


def test_inactive_action_does_not_count(db, streak_on, student):
    assert rec(db, student, 'lesson_finished', 0)['result'] == 'not_counted'


def test_consecutive_days_grow_both_counters(db, streak_on, student):
    assert rec(db, student, 'quiz_submitted', 0)['lifetime'] == 1
    assert rec(db, student, 'quiz_submitted', 0)['result'] == 'already'   # same day once
    r = rec(db, student, 'task_submitted', 1)
    assert (r['lifetime'], r['stage']) == (2, 2)


def test_min_per_day(db, streak_on, student):
    db.session.execute(text("UPDATE streak_actions SET min_per_day = 2 WHERE action_key = 'quiz_submitted'"))
    db.session.commit()
    assert rec(db, student, 'quiz_submitted', 0)['result'] == 'below_minimum'
    assert rec(db, student, 'quiz_submitted', 0)['lifetime'] == 1


def test_gap_starts_again(db, streak_on, student):
    rec(db, student, 'quiz_submitted', 0)
    rec(db, student, 'quiz_submitted', 1)
    assert rec(db, student, 'quiz_submitted', 3)['lifetime'] == 1


def test_freeze_earned_and_used(db, streak_on, student):
    for n in range(3):
        r = rec(db, student, 'quiz_submitted', n)
    assert r['freeze_earned'] is True                     # every 3 days
    assert summary(db, student)['freezes_held'] == 1
    assert nightly(db, 3)['freeze'] == 1                  # missed day 3
    s = summary(db, student)
    assert s['freezes_held'] == 0 and s['lifetime_current'] == 3
    assert rec(db, student, 'quiz_submitted', 4)['lifetime'] == 4


def test_break_and_restore(db, streak_on, student):
    rec(db, student, 'quiz_submitted', 0)
    rec(db, student, 'quiz_submitted', 1)
    assert nightly(db, 2)['broken'] == 1
    assert summary(db, student)['lifetime_current'] == 0
    res = db.session.execute(text("CALL sp_streak_restore(:u, :t, :m, 1)"),
                             {'u': student, 't': day(3), 'm': day(3).strftime('%Y-%m')}).mappings().first()
    db.session.commit()
    assert res['ok'] == 1
    assert summary(db, student)['lifetime_current'] == 2
    assert rec(db, student, 'quiz_submitted', 3)['lifetime'] == 3


def test_restore_once_a_month(db, streak_on, student):
    for start in (0, 5):
        rec(db, student, 'quiz_submitted', start)
        nightly(db, start + 1)
        res = db.session.execute(text("CALL sp_streak_restore(:u, :t, :m, 1)"),
                                 {'u': student, 't': day(start + 2), 'm': day(start + 2).strftime('%Y-%m')}
                                 ).mappings().first()
        db.session.commit()
    assert res['ok'] == 0 and res['result'] == 'limit_reached'


def test_exam_window_keeps_streak_without_a_freeze(db, streak_on, student):
    wid = str(uuid.uuid4())
    db.session.execute(text(
        "INSERT INTO streak_exam_windows (id, label, start_date, end_date) VALUES (:i, 'test exams', :s, :e)"),
        {'i': wid, 's': day(1), 'e': day(2)})
    db.session.commit()
    try:
        rec(db, student, 'quiz_submitted', 0)
        assert nightly(db, 1)['exam'] == 1
        assert nightly(db, 2)['exam'] == 1
        assert rec(db, student, 'quiz_submitted', 3)['lifetime'] == 2   # exam days kept, not counted up
    finally:
        db.session.execute(text("DELETE FROM streak_exam_windows WHERE id = :i"), {'i': wid})
        db.session.commit()


def test_stage_change_resets_only_the_stage_counter(db, streak_on, student):
    db.session.execute(text(
        "CALL sp_stage_open(:i, :u, 'class_10', '1', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)"),
        {'i': str(uuid.uuid4()), 'u': student})
    db.session.commit()
    rec(db, student, 'quiz_submitted', 0)
    rec(db, student, 'quiz_submitted', 1)
    old = db.session.execute(text("SELECT id FROM student_stages WHERE user_id = :u AND status = 'active'"),
                             {'u': student}).scalar()
    row = db.session.execute(text(
        "CALL sp_stage_promote(:i, :u, 'intermediate', '1', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, :u, 't')"),
        {'i': str(uuid.uuid4()), 'u': student}).mappings().first()
    db.session.commit()
    from portal.helpers import streaks
    streaks.on_stage_change(student, old, row['stage_id'])
    db.session.commit()
    r = rec(db, student, 'quiz_submitted', 2)
    assert (r['lifetime'], r['stage']) == (3, 1)
    best = db.session.execute(text("SELECT stage_best_streak FROM student_stages WHERE id = :i"),
                              {'i': old}).scalar()
    assert best == 2


def test_milestone_pays_only_an_active_rule(db, streak_on, student):
    db.session.execute(text("UPDATE streak_settings SET freeze_every_days = 100 WHERE id = 1"))
    db.session.commit()
    for n in range(7):
        rec(db, student, 'quiz_submitted', n)
    paid = db.session.execute(text(
        "SELECT IFNULL(SUM(points), 0) FROM score_events WHERE user_id = :u AND event_type = 'streak_7'"),
        {'u': student}).scalar()
    assert float(paid) == 0                                # rule inactive by default


def test_buddy_streak_needs_both(db, streak_on, student, app):
    other = str(uuid.uuid4())
    db.session.execute(text(
        "INSERT INTO users (id, full_name, email, status, created_at, updated_at) "
        "VALUES (:i, 'Buddy Test', :e, 'active', UTC_TIMESTAMP(), UTC_TIMESTAMP())"),
        {'i': other, 'e': f'score-engine-test-{other}@skovo.test'})
    db.session.commit()
    try:
        from portal.helpers import streaks
        code = streaks.invite(student)['invite_code']
        assert streaks.accept(other, code)['ok'] == 1
        db.session.commit()
        rec(db, student, 'quiz_submitted', 0)
        b = streaks.buddies(student)[0]
        assert int(b['current']) == 0                       # only one of them acted
        rec(db, other, 'quiz_submitted', 0)
        assert int(streaks.buddies(student)[0]['current']) == 1
    finally:
        for t in ('career_streaks', 'streak_days', 'streak_action_log'):
            db.session.execute(text(f"DELETE FROM {t} WHERE user_id = :u"), {'u': other})
        db.session.execute(text("DELETE FROM buddy_streaks WHERE user_a = :u OR user_b = :u"), {'u': other})
        db.session.execute(text("DELETE FROM users WHERE id = :u"), {'u': other})
        db.session.commit()
