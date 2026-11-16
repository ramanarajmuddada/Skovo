"""
Score Engine test suite — Engineering Playbook §9.4.

    "The Score Engine must have >90% test coverage. Every score action needs a
     unit test. Every cap has an integration test. Decay job has a time-mocked
     test. Pause token activation has an edge case test... This is not
     negotiable — a bug in the Score Engine corrupts the anchor mechanic."

Structure follows that sentence:

  1. Rule config matches the spec table            (§5.7)
  2. Every active score action awards its points   ("every score action")
  3. Every cap type holds                          ("every cap")
  4. Ledger behaviour — capped rows, idempotency   (§9.1)
  5. Score computation, clamping, levels           (§5.7)
  6. Decay                                         ("time-mocked")
  7. Pause tokens, including the edge cases        ("0 remaining", "while paused")
  8. Gate thresholds                               (§5.5 — unlock at 60)
"""
import uuid

import pytest
from sqlalchemy import text

# The canonical table from Playbook §5.7 / Scope §6.2. If this list and the
# database disagree, one of them is wrong and the test says which.
SPEC_RULES = {
    "profile_completed":       (5.0,  "once",     1),
    "college_saved":           (0.0,  "lifetime", 10),
    "college_viewed":          (0.0,  "daily",    1),
    "cohort_attended":         (2.0,  "per_item", 1),
    "cohort_completed":        (8.0,  "per_item", 1),
    "cohort_repeat_week":      (2.0,  "weekly",   1),
    "community_post":          (0.5,  "daily",    3),
    "community_reactions":     (0.5,  "daily",    1),
    "community_join":          (1.0,  "lifetime", 5),
    "community_created":       (2.0,  "lifetime", 5),
    "market_redeem":           (2.0,  "monthly",  5),
    "document_uploaded":       (2.0,  "lifetime", 5),
    "application_submitted":   (3.0,  "per_item", 1),
    "opportunity_shortlisted": (10.0, "per_item", 1),
}


# ── 1. Rule config ───────────────────────────────────────────────────────────

@pytest.mark.parametrize("event_type", sorted(SPEC_RULES))
def test_rule_matches_spec(rules, event_type):
    """Every action in the spec table exists with the spec's points and cap."""
    assert event_type in rules, f"{event_type} missing from score_event_rules"
    rule = rules[event_type]
    points, cap_type, cap_value = SPEC_RULES[event_type]

    assert rule["is_active"] == 1, f"{event_type} is inactive"
    assert float(rule["points"]) == points, f"{event_type} points drifted from spec"
    assert rule["cap_type"] == cap_type, f"{event_type} cap type drifted from spec"
    if cap_value is not None and cap_type not in ("per_item",):
        assert int(rule["cap_value"]) == cap_value, f"{event_type} cap value drifted"


def test_points_are_config_not_code(rules):
    """§5.7 warning: 'A code deploy to change a point value is a failure of the
    design.' Points must be readable — and therefore editable — as data."""
    assert len(rules) >= len(SPEC_RULES)
    for rule in rules.values():
        assert rule["points"] is not None


# ── 2. Every score action ────────────────────────────────────────────────────

@pytest.mark.parametrize("event_type", sorted(SPEC_RULES))
def test_action_awards_its_points(user, award, event_type):
    """One clean award of every action in the spec, on a fresh user."""
    expected = SPEC_RULES[event_type][0]
    awarded, result = award(user, event_type, ref_id=str(uuid.uuid4()))
    assert result == "awarded", f"{event_type} returned {result}"
    assert awarded == expected


def test_unknown_event_awards_nothing(user, award):
    awarded, result = award(user, "no_such_event_type")
    assert awarded == 0.0
    assert result == "unknown_or_inactive"


def test_inactive_rule_awards_nothing(user, award, db):
    """A rule switched off by admin stops paying immediately."""
    db.session.execute(text(
        "UPDATE score_event_rules SET is_active = 0 WHERE event_type = 'market_redeem'"))
    db.session.commit()
    try:
        awarded, result = award(user, "market_redeem", ref_id=str(uuid.uuid4()))
        assert awarded == 0.0
        assert result == "unknown_or_inactive"
    finally:
        db.session.execute(text(
            "UPDATE score_event_rules SET is_active = 1 WHERE event_type = 'market_redeem'"))
        db.session.commit()


# ── 3. Caps ──────────────────────────────────────────────────────────────────

def test_daily_cap_holds(user, award):
    """community_post: +0.5, 3 per day. The fourth pays nothing."""
    for i in range(3):
        awarded, result = award(user, "community_post", ref_id=f"post-{i}")
        assert (awarded, result) == (0.5, "awarded")

    awarded, result = award(user, "community_post", ref_id="post-3")
    assert awarded == 0.0
    assert result == "capped"


def test_lifetime_cap_holds(user, award):
    """document_uploaded: +2, 5 lifetime."""
    for i in range(5):
        awarded, _ = award(user, "document_uploaded", ref_id=f"doc-{i}")
        assert awarded == 2.0

    awarded, result = award(user, "document_uploaded", ref_id="doc-5")
    assert (awarded, result) == (0.0, "capped")


def test_monthly_cap_holds(user, award):
    """market_redeem: +2, 5 per month."""
    for i in range(5):
        awarded, _ = award(user, "market_redeem", ref_id=f"deal-{i}")
        assert awarded == 2.0

    awarded, result = award(user, "market_redeem", ref_id="deal-5")
    assert (awarded, result) == (0.0, "capped")


def test_weekly_cap_holds(user, award):
    """cohort_repeat_week: +2, once per week."""
    awarded, _ = award(user, "cohort_repeat_week", ref_id="week-1")
    assert awarded == 2.0

    awarded, result = award(user, "cohort_repeat_week", ref_id="week-2")
    assert (awarded, result) == (0.0, "capped")


def test_once_cap_holds(user, award):
    """profile_completed: +5, one time only, ever."""
    awarded, _ = award(user, "profile_completed", ref_id="first")
    assert awarded == 5.0

    awarded, result = award(user, "profile_completed", ref_id="second")
    assert (awarded, result) == (0.0, "capped")


def test_per_item_cap_pays_once_per_item(user, award):
    """cohort_attended is per_item: different cohorts pay, the same one does not."""
    a1, r1 = award(user, "cohort_attended", ref_id="cohort-A")
    a2, r2 = award(user, "cohort_attended", ref_id="cohort-B")
    assert (a1, r1) == (2.0, "awarded")
    assert (a2, r2) == (2.0, "awarded")

    a3, r3 = award(user, "cohort_attended", ref_id="cohort-A")
    assert (a3, r3) == (0.0, "duplicate")


@pytest.mark.case("ST03-013")
def test_zero_point_action_still_respects_its_cap(user, award):
    """college_saved pays +0 but is capped at 10 — the cap must still engage,
    because it is what stops the ledger filling with noise."""
    for i in range(10):
        awarded, result = award(user, "college_saved", ref_id=f"college-{i}")
        assert (awarded, result) == (0.0, "awarded")

    awarded, result = award(user, "college_saved", ref_id="college-10")
    assert result == "capped"


# ── 4. Ledger behaviour (§9.1) ───────────────────────────────────────────────

def test_capped_action_is_still_logged(user, award, db):
    """§9.1(5): a capped action appends with delta 0 and meta 'capped', so we
    keep visibility into what the student did even when it does not pay."""
    for i in range(4):
        award(user, "community_post", ref_id=f"p-{i}")

    rows = db.session.execute(text("""
        SELECT points, meta FROM score_events
         WHERE user_id = :u AND event_type = 'community_post'
         ORDER BY seq
    """), {"u": user}).mappings().all()

    assert len(rows) == 4, "the capped action must still be recorded"
    assert [float(r["points"]) for r in rows] == [0.5, 0.5, 0.5, 0.0]
    assert rows[3]["meta"] == "capped"


def test_capped_rows_do_not_consume_the_allowance(user, award, db):
    """A capped row must not count towards the cap itself, or the allowance
    would shrink every time someone hit the limit."""
    for i in range(5):
        award(user, "community_post", ref_id=f"p-{i}")   # 3 paid, 2 capped

    used = db.session.execute(text("""
        SELECT COUNT(*) FROM score_events
         WHERE user_id = :u AND event_type = 'community_post'
           AND (meta IS NULL OR meta <> 'capped')
    """), {"u": user}).scalar()
    assert used == 3


@pytest.mark.case("ST03-018")
def test_duplicate_ref_is_idempotent(user, award, db):
    """Playbook §8.2: retries must never pay twice."""
    ref = str(uuid.uuid4())
    first, _ = award(user, "application_submitted", ref_id=ref)
    second, result = award(user, "application_submitted", ref_id=ref)

    assert first == 3.0
    assert (second, result) == (0.0, "duplicate")

    rows = db.session.execute(text("""
        SELECT COUNT(*) FROM score_events WHERE user_id = :u AND ref_id = :r
    """), {"u": user, "r": ref}).scalar()
    assert rows == 1, "a duplicate must not append a second row"


def test_ledger_is_append_only(user, award, db):
    """Events accumulate; nothing is overwritten."""
    award(user, "cohort_attended", ref_id="c1")
    award(user, "cohort_completed", ref_id="c1")
    award(user, "document_uploaded", ref_id="d1")

    count = db.session.execute(text(
        "SELECT COUNT(*) FROM score_events WHERE user_id = :u"), {"u": user}).scalar()
    assert count == 3


# ── 5. Score computation ─────────────────────────────────────────────────────

@pytest.mark.case("ST03-008")
def test_new_user_starts_at_zero(user, recalc):
    assert recalc(user)["score"] == 0


def test_score_sums_the_ledger(user, award, recalc):
    award(user, "cohort_attended", ref_id="c1")      # +2
    award(user, "cohort_completed", ref_id="c1")     # +8
    award(user, "document_uploaded", ref_id="d1")    # +2
    assert recalc(user)["score"] == 12


@pytest.mark.case("ST03-015")
def test_score_is_clamped_to_100(user, award, recalc):
    """Range is 0–100 no matter how much the ledger holds."""
    for i in range(12):
        award(user, "opportunity_shortlisted", ref_id=f"shortlist-{i}")   # +10 each
    result = recalc(user)
    assert float(result["base_points"]) >= 100
    assert result["score"] == 100


def test_score_never_goes_below_zero(user, award, recalc, db):
    award(user, "cohort_attended", ref_id="c1")       # +2
    db.session.execute(text(
        "UPDATE readiness_scores SET decay_points = 50 WHERE user_id = :u"), {"u": user})
    db.session.commit()
    assert recalc(user)["score"] == 0


@pytest.mark.parametrize("shortlists", [0, 4, 7])   # 0, 40 and 70 points
def test_level_thresholds(user, award, recalc, db, shortlists):
    """The band comes from readiness_levels, whatever an admin has called it.

    This used to assert the names "Explorer / Pioneer / Achiever" -- the ladder
    that was hardcoded in the procedures before levels became editable rows.
    Renaming or re-banding a level is the feature; it must not fail a test about
    which band a score falls in.
    """
    for i in range(shortlists):
        award(user, "opportunity_shortlisted", ref_id=f"s-{i}")
    result = recalc(user)

    expected = db.session.execute(text(
        "SELECT label FROM readiness_levels "
        "WHERE is_active = 1 AND min_score <= :s "
        "ORDER BY min_score DESC LIMIT 1"), {"s": result["score"]}).scalar()

    assert result["level"] == expected, f"score {result['score']} → {result['level']}"


def test_switching_a_rule_off_stops_its_events_counting(user, award, recalc, db):
    """sp_score_recalc joins active rules only, so retiring a rule retroactively
    removes its contribution — the documented behaviour, worth pinning down."""
    award(user, "market_redeem", ref_id="deal-1")     # +2
    award(user, "cohort_attended", ref_id="c1")       # +2
    assert recalc(user)["score"] == 4

    db.session.execute(text(
        "UPDATE score_event_rules SET is_active = 0 WHERE event_type = 'market_redeem'"))
    db.session.commit()
    try:
        assert recalc(user)["score"] == 2
    finally:
        db.session.execute(text(
            "UPDATE score_event_rules SET is_active = 1 WHERE event_type = 'market_redeem'"))
        db.session.commit()


# ── 6. Decay (time-mocked by moving the data, not the clock) ─────────────────

def _run_decay(db):
    row = db.session.execute(text("CALL sp_score_decay_run()")).mappings().first()
    db.session.commit()
    return int(row["decayed"]) if row else 0


def test_no_decay_inside_the_grace_window(user, award, recalc, db, settings, age_events):
    """Spec: decay starts only after 7 consecutive inactive days."""
    award(user, "opportunity_shortlisted", ref_id="s1")   # +10
    recalc(user)
    age_events(user, int(settings["decay_grace_days"]) - 1)   # 6 days idle

    _run_decay(db)

    score = db.session.execute(text(
        "SELECT decay_points FROM readiness_scores WHERE user_id = :u"), {"u": user}).scalar()
    assert int(score) == 0, "decay must not start inside the grace window"


@pytest.mark.case("ST03-016")
def test_decay_applies_after_the_grace_window(user, award, recalc, db, settings, age_events):
    award(user, "opportunity_shortlisted", ref_id="s1")   # +10
    recalc(user)
    age_events(user, int(settings["decay_grace_days"]) + 1)   # 8 days idle

    _run_decay(db)

    row = db.session.execute(text("""
        SELECT score, decay_points FROM readiness_scores WHERE user_id = :u
    """), {"u": user}).mappings().first()
    assert int(row["decay_points"]) == int(settings["decay_per_day"])
    assert int(row["score"]) == 10 - int(settings["decay_per_day"])


def test_decay_is_idempotent_within_a_day(user, award, recalc, db, settings, age_events):
    """§9.3: 'running twice on the same day is safe.'"""
    award(user, "opportunity_shortlisted", ref_id="s1")
    recalc(user)
    age_events(user, int(settings["decay_grace_days"]) + 1)

    _run_decay(db)
    first = db.session.execute(text(
        "SELECT decay_points FROM readiness_scores WHERE user_id = :u"), {"u": user}).scalar()
    _run_decay(db)
    second = db.session.execute(text(
        "SELECT decay_points FROM readiness_scores WHERE user_id = :u"), {"u": user}).scalar()

    assert int(first) == int(second), "a second run on the same day must be a no-op"


def test_decay_never_exceeds_base_points(user, award, recalc, db, settings, age_events):
    """A student cannot be decayed into negative territory."""
    award(user, "cohort_attended", ref_id="c1")   # +2 only
    recalc(user)
    db.session.execute(text("""
        UPDATE readiness_scores SET decay_points = 2 WHERE user_id = :u
    """), {"u": user})
    db.session.commit()
    age_events(user, int(settings["decay_grace_days"]) + 5)

    _run_decay(db)

    row = db.session.execute(text("""
        SELECT score, decay_points, base_points FROM readiness_scores WHERE user_id = :u
    """), {"u": user}).mappings().first()
    assert int(row["decay_points"]) <= float(row["base_points"])
    assert int(row["score"]) >= 0


def test_a_paused_score_does_not_decay(user, award, recalc, db, settings, age_events):
    """The whole point of a pause token."""
    award(user, "opportunity_shortlisted", ref_id="s1")
    recalc(user)
    age_events(user, int(settings["decay_grace_days"]) + 3)

    db.session.execute(text("CALL sp_score_pause_start(:id, :u)"),
                       {"id": str(uuid.uuid4()), "u": user})
    db.session.commit()

    _run_decay(db)

    decay = db.session.execute(text(
        "SELECT decay_points FROM readiness_scores WHERE user_id = :u"), {"u": user}).scalar()
    assert int(decay) == 0, "an active pause token must block decay entirely"


# ── 7. Pause tokens, including the edge cases §9.4 names ─────────────────────

def _pause(db, user_id):
    row = db.session.execute(text("CALL sp_score_pause_start(:id, :u)"),
                             {"id": str(uuid.uuid4()), "u": user_id}).mappings().first()
    db.session.commit()
    return dict(row) if row else {}


@pytest.mark.case("ST03-017")
def test_pause_token_activates(user, db, settings):
    result = _pause(db, user)
    assert int(result["ok"]) == 1
    assert int(result["used"]) == 1
    assert int(result["max_tokens"]) == int(settings["pause_tokens_per_year"])


def test_pause_token_lasts_the_configured_days(user, db, settings):
    _pause(db, user)
    days = db.session.execute(text("""
        SELECT DATEDIFF(ends_at, starts_at) FROM score_pause_tokens WHERE user_id = :u
    """), {"u": user}).scalar()
    assert int(days) == int(settings["pause_days"])


def test_cannot_activate_while_already_paused(user, db):
    """Edge case named in §9.4."""
    assert int(_pause(db, user)["ok"]) == 1

    second = _pause(db, user)
    assert int(second["ok"]) == 0
    assert "already paused" in second["message"].lower()

    count = db.session.execute(text(
        "SELECT COUNT(*) FROM score_pause_tokens WHERE user_id = :u"), {"u": user}).scalar()
    assert count == 1, "a rejected activation must not burn a token"


def test_cannot_activate_with_zero_tokens_remaining(user, db, settings):
    """Edge case named in §9.4: all tokens spent for the calendar year."""
    max_tokens = int(settings["pause_tokens_per_year"])

    for _ in range(max_tokens):
        assert int(_pause(db, user)["ok"]) == 1
        # Expire it so the next request is refused on allowance, not on overlap.
        #
        # starts_at is pinned to the student's signup instant, not pushed into
        # the past. This used to go back 40 days, which was harmless while the
        # allowance ran on the calendar year -- but it now runs from the signup
        # anniversary, and a pause starting before that window opened does not
        # count against it, so backdating made every pause free.
        #
        # ends_at has to be strictly before now: setting it equal to starts_at
        # leaves the row "active" for the rest of that second, and the next
        # request is then refused for overlapping rather than for allowance.
        db.session.execute(text("""
            UPDATE score_pause_tokens
               SET starts_at = (SELECT created_at FROM users WHERE id = :u),
                   ends_at   = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 SECOND)
             WHERE user_id = :u AND ends_at > UTC_TIMESTAMP()
        """), {"u": user})
        db.session.commit()

    refused = _pause(db, user)
    assert int(refused["ok"]) == 0
    assert str(max_tokens) in refused["message"]
    assert int(refused["used"]) == max_tokens


def test_tokens_are_counted_per_calendar_year(user, db, settings):
    """Tokens reset on 1 January — last year's usage must not block this year."""
    _pause(db, user)
    db.session.execute(text("""
        UPDATE score_pause_tokens
           SET starts_at = DATE_SUB(starts_at, INTERVAL 1 YEAR),
               ends_at   = DATE_SUB(ends_at,   INTERVAL 1 YEAR)
         WHERE user_id = :u
    """), {"u": user})
    db.session.commit()

    again = _pause(db, user)
    assert int(again["ok"]) == 1
    assert int(again["used"]) == 1, "only this year's tokens count towards the allowance"


# ── 8. Gate thresholds ───────────────────────────────────────────────────────

def test_opportunity_gate_is_sixty(settings):
    """§5.5: 'Score at or above 60 unlocks Opportunities Hub visibility.'"""
    assert int(settings["opportunity_unlock_score"]) == 60


def test_unlocks_are_computed_server_side(user, award, recalc, db):
    """§9.2: the client must never need to know the thresholds."""
    award(user, "opportunity_shortlisted", ref_id="s1")
    recalc(user)

    row = db.session.execute(text("CALL sp_score_unlocks(:u)"),
                             {"u": user}).mappings().first()
    db.session.commit()
    assert "score" in row and "opportunity_unlock_score" in row
    assert int(row["opportunity_unlock_score"]) == 60


def test_reaching_sixty_crosses_the_gate(user, award, recalc, db):
    """Six shortlists = 60 = exactly the threshold. 'At or above' means in."""
    for i in range(6):
        award(user, "opportunity_shortlisted", ref_id=f"s-{i}")
    result = recalc(user)

    row = db.session.execute(text("CALL sp_score_unlocks(:u)"),
                             {"u": user}).mappings().first()
    db.session.commit()
    assert result["score"] == 60
    assert int(row["score"]) >= int(row["opportunity_unlock_score"])
