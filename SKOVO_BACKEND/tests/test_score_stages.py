"""Stages (feature-updates.md §2): the score starts from zero at each stage.

Runs against MySQL like the rest of the score suite: the reset lives in
sp_score_recalc / sp_stage_*, so only the real procedures prove it.
"""
import datetime
import uuid

import pytest
from sqlalchemy import text


def _open(db, user_id, group, started):
    db.session.execute(text(
        "CALL sp_stage_open(:i, :u, :g, '1', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, :at)"),
        {'i': str(uuid.uuid4()), 'u': user_id, 'g': group, 'at': started})
    db.session.commit()


def _promote(db, user_id, group):
    db.session.execute(text("CALL sp_score_read(:u)"), {'u': user_id}).fetchall()
    row = db.session.execute(text(
        "CALL sp_stage_promote(:i, :u, :g, '1', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, :u, 'test')"),
        {'i': str(uuid.uuid4()), 'u': user_id, 'g': group}).mappings().first()
    db.session.commit()
    return dict(row)


def _event(db, user_id, event_type, points, when):
    db.session.execute(text(
        "INSERT INTO score_events (id, user_id, event_type, points, ref_id, occurred_at) "
        "VALUES (:i, :u, :t, :p, :r, :w)"),
        {'i': str(uuid.uuid4()), 'u': user_id, 't': event_type, 'p': points,
         'r': str(uuid.uuid4()), 'w': when})
    db.session.commit()


def _history(db, user_id):
    return db.session.execute(text("CALL sp_stage_history(:u)"), {'u': user_id}).mappings().all()


@pytest.fixture
def staged(db, user):
    """The test user with an active Class 10 stage begun an hour ago."""
    _open(db, user, 'class_10', datetime.datetime.utcnow() - datetime.timedelta(hours=1))
    yield user
    db.session.execute(text("DELETE FROM student_stages WHERE user_id = :u"), {'u': user})
    db.session.commit()


@pytest.fixture
def boost_settings(db):
    row = db.session.execute(text(
        "SELECT legacy_boost_percent, legacy_boost_max FROM readiness_rules ORDER BY created_at LIMIT 1"
    )).first()
    yield
    db.session.execute(text(
        "UPDATE readiness_rules SET legacy_boost_percent = :p, legacy_boost_max = :m "
        "ORDER BY created_at LIMIT 1"), {'p': row[0], 'm': row[1]})
    db.session.commit()


def test_points_in_the_current_stage_count(db, staged, recalc):
    _event(db, staged, 'admin_task', 7, datetime.datetime.utcnow())
    assert recalc(staged)['score'] == 7


def test_promotion_starts_the_new_stage_at_zero(db, staged, recalc):
    _event(db, staged, 'admin_task', 12, datetime.datetime.utcnow() - datetime.timedelta(minutes=5))
    assert recalc(staged)['score'] == 12

    res = _promote(db, staged, 'intermediate')
    assert res['closed_score'] == 12
    assert recalc(staged)['score'] == 0

    hist = _history(db, staged)
    assert [h['stage_group'] for h in hist] == ['class_10', 'intermediate']
    assert hist[0]['status'] == 'closed' and hist[0]['final_score'] == 12
    assert hist[1]['status'] == 'active'


def test_no_boost_by_default(db, staged, recalc, boost_settings):
    db.session.execute(text(
        "UPDATE readiness_rules SET legacy_boost_percent = 0, legacy_boost_max = 0 ORDER BY created_at LIMIT 1"))
    db.session.commit()
    _event(db, staged, 'admin_task', 80, datetime.datetime.utcnow() - datetime.timedelta(minutes=5))
    recalc(staged)
    assert float(_promote(db, staged, 'intermediate')['boost']) == 0
    assert recalc(staged)['score'] == 0


def test_boost_when_admin_turns_it_on(db, staged, recalc, boost_settings):
    db.session.execute(text(
        "UPDATE readiness_rules SET legacy_boost_percent = 10, legacy_boost_max = 5 ORDER BY created_at LIMIT 1"))
    db.session.commit()
    _event(db, staged, 'admin_task', 82, datetime.datetime.utcnow() - datetime.timedelta(minutes=5))
    recalc(staged)
    assert float(_promote(db, staged, 'intermediate')['boost']) == 5     # min(10% of 82, 5)
    assert recalc(staged)['score'] == 5


def test_rollback_restores_the_old_stage_and_its_score(db, staged, recalc, boost_settings):
    db.session.execute(text(
        "UPDATE readiness_rules SET legacy_boost_percent = 10, legacy_boost_max = 5 ORDER BY created_at LIMIT 1"))
    db.session.commit()
    _event(db, staged, 'admin_task', 40, datetime.datetime.utcnow() - datetime.timedelta(minutes=5))
    recalc(staged)
    _promote(db, staged, 'intermediate')
    assert recalc(staged)['score'] == 4

    res = db.session.execute(text("CALL sp_stage_rollback(:u, :u, 'wrong promotion')"),
                             {'u': staged}).mappings().first()
    db.session.commit()
    assert res['ok'] == 1
    assert recalc(staged)['score'] == 40          # old stage back, boost reversed
    hist = _history(db, staged)
    assert [h['stage_group'] for h in hist] == ['class_10']
    assert hist[0]['status'] == 'active'


def test_rollback_with_no_earlier_stage_refuses(db, staged):
    res = db.session.execute(text("CALL sp_stage_rollback(:u, :u, 'x')"),
                             {'u': staged}).mappings().first()
    db.session.commit()
    assert res['ok'] == 0


def test_student_without_a_stage_keeps_every_point(db, user, recalc):
    _event(db, user, 'admin_task', 9, datetime.datetime.utcnow() - datetime.timedelta(days=400))
    assert recalc(user)['score'] == 9


def test_bulk_rebuild_matches_single(db, staged, recalc):
    _event(db, staged, 'admin_task', 15, datetime.datetime.utcnow() - datetime.timedelta(minutes=5))
    _promote(db, staged, 'intermediate')
    _event(db, staged, 'admin_task', 3, datetime.datetime.utcnow() + datetime.timedelta(seconds=1))
    single = recalc(staged)['score']
    db.session.execute(text("DROP TEMPORARY TABLE IF EXISTS tmp_score_touched"))
    db.session.execute(text("CREATE TEMPORARY TABLE tmp_score_touched (user_id CHAR(36) PRIMARY KEY)"))
    db.session.execute(text("INSERT INTO tmp_score_touched VALUES (:u)"), {'u': staged})
    db.session.execute(text("CALL sp_score_recalc_bulk('touched')"))
    db.session.commit()
    bulk = db.session.execute(text("SELECT score FROM readiness_scores WHERE user_id = :u"),
                              {'u': staged}).scalar()
    assert single == bulk == 3


def test_stage_group_mapping():
    from portal.helpers.stages import stage_group, sub_year_from
    assert stage_group('school_10th') == 'class_10'
    assert stage_group('school_11th') == stage_group('school_12th') == 'intermediate'
    assert stage_group('professional_course') == 'ug'
    assert stage_group('working') == 'other'
    assert stage_group(None) == 'other'
    assert sub_year_from('3rd Year') == '3'
    assert sub_year_from(None, 'school_12th') == '2'
