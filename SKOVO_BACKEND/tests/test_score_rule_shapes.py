"""Every rule shape, end to end, against the live engine.

Unlike the older score tests, nothing here depends on the seeded v1 rule set --
an admin can delete every action and these still run. Each test builds the rule
it needs, evaluates it, asserts on the ledger, and removes both the rule and the
rows it produced.

The rules are named `zz_test_*` so a crashed run is obvious and easy to sweep up.

    pytest tests/test_score_rule_shapes.py -v
"""
import uuid

import pytest
from sqlalchemy import text


PREFIX = 'zz_test_'


@pytest.fixture
def engine(db):
    """Build rules, evaluate them, read the ledger -- and always clean up.

    Cleanup runs even when an assertion fails, because these write to the real
    database: a leaked rule would change every student's score on the next
    nightly sweep, which is precisely the accident this suite exists to prevent.
    """
    made = []

    class Engine:
        def __init__(self, user):
            self.user = user

        def rule(self, test='each', points=1, metric=None, **cols):
            key = PREFIX + uuid.uuid4().hex[:12]
            made.append(key)
            cols.setdefault('shape', 'simple')
            cols.setdefault('cap_type', 'none')
            vals = {'event_type': key, 'label': 'test ' + key, 'points': points,
                    'is_active': 1, 'rule_test': test, 'metric_key': metric}
            # Overrides replace a default rather than being appended, so passing
            # label= does not name the column twice.
            vals.update(cols)
            names = list(vals)
            db.session.execute(text(
                f"INSERT INTO score_event_rules ({', '.join('`%s`' % n for n in names)}) "
                f"VALUES ({', '.join(':' + n for n in names)})"), vals)
            db.session.commit()
            return key

        def condition(self, key, metric, threshold=1, order=0, filt=None):
            db.session.execute(text(
                "INSERT INTO score_rule_conditions "
                "(id, rule_key, metric_key, metric_filter, threshold, sort_order) "
                "VALUES (:i, :k, :m, :f, :t, :o)"),
                {'i': str(uuid.uuid4()), 'k': key, 'm': metric, 'f': filt,
                 't': threshold, 'o': order})
            db.session.commit()

        def run(self):
            db.session.execute(text("CALL sp_score_rules_run(:u)"), {'u': self.user})
            db.session.commit()

        def awards(self, key):
            return db.session.execute(text(
                "SELECT ref_id, points FROM score_events "
                "WHERE user_id = :u AND event_type = :k ORDER BY ref_id"),
                {'u': self.user, 'k': key}).mappings().all()

        def points(self, key):
            return float(db.session.execute(text(
                "SELECT IFNULL(SUM(points), 0) FROM score_events "
                "WHERE user_id = :u AND event_type = :k"),
                {'u': self.user, 'k': key}).scalar())

    user = db.session.execute(text(
        "SELECT id FROM users WHERE deleted_at IS NULL LIMIT 1")).scalar()
    if not user:
        pytest.skip("no real user to score")

    try:
        yield Engine(user)
    finally:
        for key in made:
            db.session.execute(text(
                "DELETE FROM score_events WHERE event_type = :k"), {'k': key})
            db.session.execute(text(
                "DELETE FROM score_rule_conditions WHERE rule_key = :k"), {'k': key})
            db.session.execute(text(
                "DELETE FROM score_event_rules WHERE event_type = :k"), {'k': key})
        db.session.commit()
        db.session.execute(text("CALL sp_score_recalc(:u)"), {'u': user})
        db.session.commit()


# ── the shapes that already existed, now re-proved without the v1 seed ───────

def test_each_pays_once_per_item(engine):
    key = engine.rule(test='each', points=1, metric='account_created')
    engine.run()
    assert len(engine.awards(key)) == 1, "one account, one award"
    engine.run()
    assert len(engine.awards(key)) == 1, "a second sweep must not pay again"


def test_becomes_active_pays_once_ever(engine):
    key = engine.rule(test='becomes_active', points=5, metric='account_created')
    engine.run()
    engine.run()
    rows = engine.awards(key)
    assert [r['ref_id'] for r in rows] == ['m:active']
    assert engine.points(key) == 5.0


def test_reaches_does_not_pay_below_the_threshold(engine):
    low = engine.rule(test='reaches', points=3, metric='account_created', threshold=1)
    high = engine.rule(test='reaches', points=3, metric='account_created', threshold=99)
    engine.run()
    assert engine.points(low) == 3.0
    assert engine.points(high) == 0.0, "99 accounts is not 1 account"


# ── tiered ───────────────────────────────────────────────────────────────────

def test_tiered_pays_the_first_tier_for_the_first_item(engine):
    key = engine.rule(test='tiered', points=0, metric='account_created',
                      tier_points='5,3,1')
    engine.run()
    rows = engine.awards(key)
    assert len(rows) == 1
    assert float(rows[0]['points']) == 5.0, "the first item is worth the first tier"


def test_tiered_is_repeat_safe(engine):
    key = engine.rule(test='tiered', points=0, metric='account_created',
                      tier_points='5,3,1')
    engine.run()
    engine.run()
    engine.run()
    assert engine.points(key) == 5.0, "three sweeps, one payment"


# ── streak ───────────────────────────────────────────────────────────────────

def test_a_streak_longer_than_the_data_pays_nothing(engine):
    key = engine.rule(test='streak', points=2, metric='daily_login', streak_days=30)
    engine.run()
    assert engine.points(key) == 0.0


def test_a_streak_shape_runs_without_error(engine):
    # Whether this user happens to have a 2-day run is data, not behaviour; the
    # assertion that matters is that the gaps-and-islands query executes and
    # every ref it produces is a dated streak ref.
    key = engine.rule(test='streak', points=2, metric='daily_login', streak_days=2)
    engine.run()
    for row in engine.awards(key):
        assert row['ref_id'].startswith('m:streak:')


# ── all of / any N of ────────────────────────────────────────────────────────

def test_all_of_pays_when_every_condition_passes(engine):
    key = engine.rule(points=5, shape='all_of')
    engine.condition(key, 'account_created', 1, 0)
    engine.condition(key, 'daily_login', 1, 1)
    engine.run()
    rows = engine.awards(key)
    assert [r['ref_id'] for r in rows] == ['m:combo']
    assert engine.points(key) == 5.0


def test_all_of_pays_nothing_when_one_condition_fails(engine):
    key = engine.rule(points=5, shape='all_of')
    engine.condition(key, 'account_created', 1, 0)
    engine.condition(key, 'cohorts_enrolled', 1, 1)     # this user has none
    engine.run()
    assert engine.points(key) == 0.0, "partial pays nothing, not a fraction"


def test_any_of_pays_when_enough_conditions_pass(engine):
    key = engine.rule(points=3, shape='any_of', require_count=1)
    engine.condition(key, 'account_created', 1, 0)
    engine.condition(key, 'cohorts_enrolled', 1, 1)
    engine.run()
    assert engine.points(key) == 3.0, "one of two is enough when require_count is 1"


def test_any_of_respects_a_higher_requirement(engine):
    key = engine.rule(points=3, shape='any_of', require_count=2)
    engine.condition(key, 'account_created', 1, 0)
    engine.condition(key, 'cohorts_enrolled', 1, 1)     # fails
    engine.run()
    assert engine.points(key) == 0.0


def test_a_combo_pays_once_however_often_it_is_evaluated(engine):
    key = engine.rule(points=5, shape='all_of')
    engine.condition(key, 'account_created', 1, 0)
    for _ in range(3):
        engine.run()
    assert engine.points(key) == 5.0


def test_combo_progress_reports_the_incomplete_steps(engine):
    key = engine.rule(points=5, shape='all_of', label='Getting started')
    engine.condition(key, 'account_created', 1, 0)
    engine.condition(key, 'cohorts_enrolled', 1, 1)

    from portal.models import db as _db
    rows = _db.session.execute(text("CALL sp_score_rule_progress(:u)"),
                               {'u': engine.user}).mappings().all()
    _db.session.commit()
    mine = [r for r in rows if r['rule_key'] == key]
    assert mine, "the rule should appear in progress while it is unearned"
    row = mine[0]
    assert int(row['total']) == 2
    assert int(row['done']) == 1, "one of the two conditions is met"
    assert int(row['earned']) == 0


# ── segment ──────────────────────────────────────────────────────────────────

def test_a_segment_that_does_not_match_pays_nobody(engine):
    key = engine.rule(test='each', points=1, metric='account_created',
                      segment_state='NoSuchState')
    engine.run()
    assert engine.points(key) == 0.0


# ── campaign window ──────────────────────────────────────────────────────────

def test_a_rule_past_its_end_date_stops_awarding(engine):
    key = engine.rule(test='each', points=1, metric='account_created',
                      until_at='2020-01-01 00:00:00')
    engine.run()
    assert engine.points(key) == 0.0


def test_a_rule_inside_its_window_still_awards(engine):
    key = engine.rule(test='each', points=1, metric='account_created',
                      until_at='2099-01-01 00:00:00')
    engine.run()
    assert engine.points(key) == 1.0


# ── points that lapse ────────────────────────────────────────────────────────

def test_expired_points_stop_counting_without_a_negative_row(engine, db):
    key = engine.rule(test='each', points=4, metric='account_created')
    engine.run()
    assert engine.points(key) == 4.0

    # Age the award, then make the rule lapse after a day.
    db.session.execute(text(
        "UPDATE score_events SET occurred_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 400 DAY) "
        "WHERE event_type = :k"), {'k': key})
    db.session.execute(text(
        "UPDATE score_event_rules SET expires_days = 1 WHERE event_type = :k"), {'k': key})
    db.session.commit()

    before = db.session.execute(text(
        "SELECT base_points FROM readiness_scores WHERE user_id = :u"),
        {'u': engine.user}).scalar()
    db.session.execute(text("CALL sp_score_recalc(:u)"), {'u': engine.user})
    db.session.commit()
    after = db.session.execute(text(
        "SELECT base_points FROM readiness_scores WHERE user_id = :u"),
        {'u': engine.user}).scalar()

    assert float(before) - float(after) == 4.0, "the lapsed points stop counting"
    assert engine.points(key) == 4.0, "the ledger row is untouched -- no negative row"

    # And it is reversible, because nothing was destroyed.
    db.session.execute(text(
        "UPDATE score_event_rules SET expires_days = NULL WHERE event_type = :k"), {'k': key})
    db.session.commit()
    db.session.execute(text("CALL sp_score_recalc(:u)"), {'u': engine.user})
    db.session.commit()
    restored = db.session.execute(text(
        "SELECT base_points FROM readiness_scores WHERE user_id = :u"),
        {'u': engine.user}).scalar()
    assert float(restored) == float(before), "clearing expires_days brings them back"


def test_no_rule_shape_can_write_a_negative_row(engine, db):
    """Rules only ever add. Taking points away is Adjust's job, or decay's."""
    negatives = db.session.execute(text(
        "SELECT COUNT(*) FROM score_events e "
        "JOIN score_event_rules r ON r.event_type = e.event_type "
        "WHERE e.points < 0")).scalar()
    assert negatives == 0
