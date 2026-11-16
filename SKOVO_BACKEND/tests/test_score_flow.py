"""
Career Readiness Score — the whole flow, one student at a time.

`test_score_engine.py` proves the SQL and `test_score_helper.py` proves the
wrapper. This file walks a student through the activities that are supposed to
move the number and asserts the number moved — the thing that was actually
reported broken ("score stuck at 0").

Two properties are asserted over and over, because between them they are the
bug:

  * **the cache never lags the ledger.** `readiness_scores` is what every
    screen reads; `score_events` is the truth. After any award, without anyone
    calling recalc by hand, the two must agree.
  * **a 0 is either earned or it is a bug.** A student with an empty ledger
    scoring 0 is the engine working. A student with points in the ledger
    scoring 0 is not.

Runs against MySQL with a throwaway user per test, same as its neighbours.
"""
import uuid

import pytest
from sqlalchemy import text

from portal.helpers import score as score_helper
from portal.helpers.helpers import (OPPORTUNITY_HUB_MIN_SCORE,
                                    opportunity_hub_min_score)


@pytest.fixture
def ctx(app):
    """`award()` runs inside a request in production; give it an app context."""
    with app.app_context():
        yield


def cached(db, user_id):
    """What the Dashboard would read for this student, right now."""
    row = db.session.execute(text(
        "SELECT score, level, base_points, decay_points "
        "  FROM readiness_scores WHERE user_id = :u"), {"u": user_id}).mappings().first()
    return dict(row) if row else {}


def ledger_total(db, user_id):
    """What the student has actually earned, straight off the append-only log."""
    return float(db.session.execute(text("""
        SELECT IFNULL(SUM(e.points), 0)
          FROM score_events e
          JOIN score_event_rules r ON r.event_type = e.event_type
         WHERE e.user_id = :u AND r.is_active = 1
    """), {"u": user_id}).scalar() or 0)


def assert_cache_matches_ledger(db, user_id):
    """The invariant the reported bug violated."""
    total = ledger_total(db, user_id)
    row = cached(db, user_id)
    assert row, "no readiness_scores row — the dashboard would read a hardcoded 0"
    assert float(row["base_points"]) == total
    expected = max(0, min(100, int(total - int(row["decay_points"] or 0))))
    assert int(row["score"]) == expected


def _event_types(db, user_id):
    return [r[0] for r in db.session.execute(text(
        "SELECT event_type FROM score_events WHERE user_id = :u ORDER BY seq"),
        {"u": user_id}).fetchall()]


# ── A 0 has to be an earned 0 ────────────────────────────────────────────────

def test_a_student_who_has_done_nothing_scores_zero(ctx, user, db):
    """The control. Without this, every other assertion here proves nothing."""
    score_helper.recalc(user)
    db.session.commit()
    assert int(cached(db, user)["score"]) == 0
    assert ledger_total(db, user) == 0


def test_one_scoring_action_moves_the_number_off_zero(ctx, user, db):
    """The report, reduced: a student completes something and the score stays 0."""
    assert score_helper.award(user, score_helper.DOCUMENT_UPLOADED, ref_id="doc-1") == 2
    db.session.commit()
    assert int(cached(db, user)["score"]) == 2
    assert_cache_matches_ledger(db, user)


# ── The cache is rebuilt on every ledger write, not only on paying ones ──────

def test_a_zero_point_signal_still_refreshes_the_cache(ctx, user, db):
    """`college_saved` is worth 0 by spec but is still activity.

    The rebuild used to be gated on "points > 0", so every zero-point and
    capped signal left `readiness_scores` holding whatever it held before —
    including the derived level and cohort/task counters the dashboard prints
    next to the score.
    """
    score_helper.award(user, score_helper.COLLEGE_SAVED, ref_id="col-1")
    db.session.commit()
    assert cached(db, user), "a zero-point signal must still leave a cached row"
    assert_cache_matches_ledger(db, user)


def test_a_capped_signal_still_refreshes_the_cache(ctx, user, db):
    """Past the lifetime cap the row is logged with 0 points — still a write."""
    for i in range(5):
        assert score_helper.award(user, score_helper.DOCUMENT_UPLOADED, ref_id=f"d{i}") == 2
    db.session.commit()

    # The sixth is capped: logged, worth nothing, and it must not corrupt the
    # cached total on its way through.
    assert score_helper.award(user, score_helper.DOCUMENT_UPLOADED, ref_id="d5") == 0
    db.session.commit()
    assert int(cached(db, user)["score"]) == 10
    assert_cache_matches_ledger(db, user)


def test_nobody_has_to_call_recalc_by_hand(ctx, user, db):
    """Every award leaves the cache correct, in any order, with no help."""
    score_helper.award(user, score_helper.COMMUNITY_JOIN, ref_id="g1")
    score_helper.award(user, score_helper.COLLEGE_VIEWED, ref_id="c1")
    score_helper.award(user, score_helper.MARKET_REDEEM, ref_id="deal-1")
    score_helper.award(user, score_helper.APPLICATION_SUBMITTED, ref_id="app-1")
    db.session.commit()
    assert_cache_matches_ledger(db, user)
    assert int(cached(db, user)["score"]) == 6      # 1 + 0 + 2 + 3


# ── Cohorts: the anchor module, and the repeat-week signal that never fired ──

def test_first_check_in_pays_the_attendance_points_only(ctx, user, db):
    """One cohort in a week is attendance, not a repeat."""
    assert score_helper.award_cohort_attendance(user, "cohort-a") == 2
    db.session.commit()
    assert int(cached(db, user)["score"]) == 2
    assert _event_types(db, user) == ["cohort_attended"]


def test_a_second_cohort_the_same_week_pays_the_repeat_bonus(ctx, user, db):
    """+2 attendance and +2 repeat — the signal that had config but no caller."""
    score_helper.award_cohort_attendance(user, "cohort-a")
    assert score_helper.award_cohort_attendance(user, "cohort-b") == 4
    db.session.commit()
    assert int(cached(db, user)["score"]) == 6
    assert sorted(_event_types(db, user)) == [
        "cohort_attended", "cohort_attended", "cohort_repeat_week"]
    assert_cache_matches_ledger(db, user)


def test_the_repeat_bonus_is_paid_once_a_week(ctx, user, db):
    """A third and fourth cohort still earn +2 each, but not a second bonus."""
    score_helper.award_cohort_attendance(user, "cohort-a")
    score_helper.award_cohort_attendance(user, "cohort-b")
    assert score_helper.award_cohort_attendance(user, "cohort-c") == 2
    assert score_helper.award_cohort_attendance(user, "cohort-d") == 2
    db.session.commit()
    assert _event_types(db, user).count("cohort_repeat_week") == 1
    assert int(cached(db, user)["score"]) == 10     # 4 x 2 attendance + 1 x 2 repeat


def test_checking_in_twice_to_one_cohort_pays_once(ctx, user, db):
    """Idempotent on the cohort id — a retry or a re-save must not pay again."""
    assert score_helper.award_cohort_attendance(user, "cohort-a") == 2
    assert score_helper.award_cohort_attendance(user, "cohort-a") == 0
    db.session.commit()
    assert int(cached(db, user)["score"]) == 2
    assert _event_types(db, user) == ["cohort_attended"]


def test_a_repeat_check_in_does_not_conjure_a_bonus(ctx, user, db):
    """The second call is a duplicate, so neither signal may pay."""
    score_helper.award_cohort_attendance(user, "cohort-a")
    score_helper.award_cohort_attendance(user, "cohort-a")
    db.session.commit()
    assert "cohort_repeat_week" not in _event_types(db, user)


def test_last_week_does_not_count_as_this_week(ctx, user, db, age_events):
    """The bonus is for a repeat *this* week, so a backdated one cannot arm it."""
    score_helper.award_cohort_attendance(user, "cohort-old")
    db.session.commit()
    age_events(user, 21)                      # three weeks back

    assert score_helper.award_cohort_attendance(user, "cohort-new") == 2
    db.session.commit()
    assert "cohort_repeat_week" not in _event_types(db, user)


def test_attendance_scoring_never_raises_on_bad_input(ctx, user):
    """Scoring is a side effect of the check-in; it must not break it."""
    assert score_helper.award_cohort_attendance(None, "cohort-a") == 0
    assert score_helper.award_cohort_attendance(user, None) == 0
    assert score_helper.award_cohort_attendance(str(uuid.uuid4()), "cohort-a") == 0


def test_the_repeat_lookup_failing_still_pays_the_attendance(ctx, user, db, monkeypatch):
    """A broken bonus lookup costs the bonus, never the +2 that was earned."""
    real = score_helper.call_proc_one

    def _dispatch(proc_name, *args, **kwargs):
        if proc_name == "sp_score_cohort_week_count":
            raise RuntimeError("lookup unavailable")
        return real(proc_name, *args, **kwargs)

    monkeypatch.setattr(score_helper, "call_proc_one", _dispatch)
    assert score_helper.award_cohort_attendance(user, "cohort-a") == 2
    db.session.commit()
    assert int(cached(db, user)["score"]) == 2


# ── A whole student journey ─────────────────────────────────────────────────

def test_a_full_term_of_activity_adds_up(ctx, user, db):
    """Every module that scores, once, and the total has to be the sum."""
    score_helper.award_cohort_attendance(user, "cohort-a")                       # +2
    score_helper.award_cohort_attendance(user, "cohort-b")                       # +2 +2
    score_helper.award(user, score_helper.COHORT_COMPLETED, ref_id="sub-1")      # +8
    score_helper.award(user, score_helper.DOCUMENT_UPLOADED, ref_id="doc-1")     # +2
    score_helper.award(user, score_helper.COMMUNITY_JOIN, ref_id="g1")           # +1
    score_helper.award(user, score_helper.COMMUNITY_CREATED, ref_id="g2")        # +2
    score_helper.award(user, score_helper.MARKET_REDEEM, ref_id="deal-1")        # +2
    score_helper.award(user, score_helper.APPLICATION_SUBMITTED, ref_id="a1")    # +3
    score_helper.award(user, score_helper.OPPORTUNITY_SHORTLISTED, ref_id="a1")  # +10
    db.session.commit()

    assert ledger_total(db, user) == 34
    assert int(cached(db, user)["score"]) == 34
    assert_cache_matches_ledger(db, user)


def _level_for(db, score):
    """The level an admin's config says this score is, not a name from 2024.

    This test used to assert "30 is Pioneer" and "70 is Achiever" -- the bands
    that were hardcoded in sp_score_decay_run before levels became rows. An
    admin renaming or re-banding a level is the whole point of readiness_levels,
    and it must not fail a test about arithmetic.
    """
    return db.session.execute(text(
        "SELECT label FROM readiness_levels "
        "WHERE is_active = 1 AND min_score <= :s "
        "ORDER BY min_score DESC LIMIT 1"), {"s": score}).scalar()


def test_the_level_follows_the_score(ctx, user, db):
    """The level tracks the score, through whatever ladder is configured."""
    for i in range(3):
        score_helper.award(user, score_helper.OPPORTUNITY_SHORTLISTED, ref_id=f"s{i}")
    db.session.commit()
    assert int(cached(db, user)["score"]) == 30
    assert cached(db, user)["level"] == _level_for(db, 30)

    for i in range(3, 7):
        score_helper.award(user, score_helper.OPPORTUNITY_SHORTLISTED, ref_id=f"s{i}")
    db.session.commit()
    assert int(cached(db, user)["score"]) == 70
    assert cached(db, user)["level"] == _level_for(db, 70)

    # And the two are genuinely different bands, or this test proves nothing.
    assert _level_for(db, 30) != _level_for(db, 70)


def test_the_score_is_clamped_to_a_hundred(ctx, user, db):
    """Eleven shortlists is 110 points; the score a student sees is 100."""
    for i in range(11):
        score_helper.award(user, score_helper.OPPORTUNITY_SHORTLISTED, ref_id=f"s{i}")
    db.session.commit()
    assert ledger_total(db, user) == 110
    assert int(cached(db, user)["score"]) == 100


# ── The Opportunity Hub gate is one number, everywhere ──────────────────────

def test_the_hub_gate_is_read_from_config_not_hardcoded(ctx, db, settings):
    """The dashboard countdown and the Opportunities check read the same row.

    They did not: the dashboard counted down to a hardcoded 60 while the config
    row said 65, so a student who reached 60 was told the Hub was open and then
    refused at the door.
    """
    assert opportunity_hub_min_score() == int(settings["opportunity_unlock_score"])


def test_the_hub_gate_falls_back_to_the_spec_floor(ctx, monkeypatch):
    """An unreadable config row must not take the screen down with it."""
    import portal.helpers.sp as sp_module

    def _boom(*_a, **_k):
        raise RuntimeError("config unavailable")

    monkeypatch.setattr(sp_module, "call_proc", _boom)
    assert opportunity_hub_min_score() == OPPORTUNITY_HUB_MIN_SCORE


def test_the_gate_agrees_with_what_the_unlocks_endpoint_reports(ctx, user, db):
    """One threshold, two readers — they must never drift apart again."""
    row = db.session.execute(text("CALL sp_score_unlocks(:u)"),
                             {"u": user}).mappings().first()
    db.session.commit()
    assert int(row["opportunity_unlock_score"]) == opportunity_hub_min_score()
