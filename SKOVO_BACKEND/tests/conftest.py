"""
Shared fixtures for the Score Engine suite.

These tests run against **MySQL**, not SQLite. That is deliberate: every rule the
Playbook cares about — cap windows, the capped-but-logged row, decay, pause
tokens — lives inside stored procedures. Testing the Python wrapper against
SQLite would prove the wrapper works and prove nothing about the engine.

Isolation comes from a throwaway user per test, not a throwaway database. Every
row written is keyed to that user id and deleted afterwards, so a run leaves the
database exactly as it found it.
"""
import os
import uuid

import pytest
from sqlalchemy import text

os.environ.setdefault("APP_SECRET_KEY", "test-secret-key-skovo")
os.environ.setdefault("JWT_SECRET_KEY", "test-jwt-secret-key-skovo")
os.environ.setdefault("ENCRYPTION_KEY", "dGVzdGtleXRlc3RrZXl0ZXN0a2V5dGVzdGtleXQ=")
os.environ.setdefault("Backend", "DEV")

# Rows created by the suite carry this marker so a crashed run can be cleaned up
# by hand: DELETE FROM users WHERE email LIKE 'score-engine-test-%'.
TEST_EMAIL_PREFIX = "score-engine-test-"


# Capture the real database URL from .env at import time — before any other
# test module can overwrite it. test_api.py sets DATABASE_URL to SQLite when it
# loads, and portal/__init__.py honours that variable, so without this snapshot
# whether this suite saw MySQL depended on pytest's collection order.
# (config/dev.ini is not a usable source: its credentials are stale.)
from dotenv import load_dotenv  # noqa: E402

load_dotenv()
_REAL_DATABASE_URL = os.environ.get("DATABASE_URL", "")


@pytest.fixture(scope="session")
def app():
    import logging
    logging.disable(logging.INFO)

    if _REAL_DATABASE_URL:
        os.environ["DATABASE_URL"] = _REAL_DATABASE_URL

    import portal as _portal
    _portal.APP = None                      # ignore an app another module built
    from portal import InitApp
    application = InitApp().app()
    application.config["TESTING"] = True

    # flask-limiter keys on the remote address, and every request the suite
    # makes comes from 127.0.0.1. Login is capped at 10/min per IP and OTP send
    # at 15/hour, so a suite that logs a dozen throwaway students in trips a
    # limit that is doing its job — and the failure lands on whichever test
    # happened to run eleventh. The per-target OTP rules (60s cooldown, 5 per
    # 10 minutes) live in the route rather than the limiter and stay on;
    # test_api.py asserts both of them directly.
    application.config["RATELIMIT_ENABLED"] = False
    try:
        from portal.helpers.rate_limit import limiter
        limiter.enabled = False
    except Exception:
        pass

    return application


@pytest.fixture(scope="session")
def db(app):
    from portal.models import db as _db
    with app.app_context():
        uri = str(app.config.get("SQLALCHEMY_DATABASE_URI", ""))
        if not uri.startswith("mysql"):
            pytest.skip("Score Engine tests require MySQL — the engine is stored procedures.")
        yield _db


@pytest.fixture
def user(db):
    """A fresh student who has never scored, torn down completely afterwards."""
    user_id = str(uuid.uuid4())
    db.session.execute(text("""
        INSERT INTO users (id, full_name, email, status, created_at, updated_at)
        VALUES (:i, 'Score Engine Test', :e, 'active', UTC_TIMESTAMP(), UTC_TIMESTAMP())
    """), {"i": user_id, "e": f"{TEST_EMAIL_PREFIX}{user_id}@skovo.test"})
    db.session.commit()

    yield user_id

    for table in ("score_events", "score_pause_tokens", "readiness_scores"):
        db.session.execute(text(f"DELETE FROM {table} WHERE user_id = :u"), {"u": user_id})
    db.session.execute(text("DELETE FROM users WHERE id = :u"), {"u": user_id})
    db.session.commit()


@pytest.fixture
def award(db):
    """Call sp_score_award directly and hand back (points_awarded, result)."""
    def _award(user_id, event_type, ref_id=None, meta=None):
        row = db.session.execute(
            text("CALL sp_score_award(:id, :user, :type, :ref, :meta)"),
            {"id": str(uuid.uuid4()), "user": user_id, "type": event_type,
             "ref": ref_id, "meta": meta},
        ).mappings().first()
        db.session.commit()
        return (float(row["awarded"]), row["result"]) if row else (0.0, "no_result")
    return _award


@pytest.fixture
def recalc(db):
    """Rebuild the cached score from the ledger; returns the full row."""
    def _recalc(user_id):
        row = db.session.execute(
            text("CALL sp_score_recalc(:u)"), {"u": user_id}).mappings().first()
        db.session.commit()
        return dict(row) if row else {}
    return _recalc


# The v1 signal set these suites are written against. Kept here rather than
# imported from migrate_score_engine, which builds a Flask app at import time.
#   event_type, label, points, cap_type, cap_value
V1_TEST_RULES = [
    ('profile_completed',       'Completed profile',            5,   'once',     1),
    ('college_saved',           'Saved a college',              0,   'lifetime', 10),
    ('college_viewed',          'Viewed a college in detail',   0,   'daily',    1),
    ('cohort_attended',         'Attended a cohort',            2,   'per_item', 1),
    ('cohort_completed',        'Completed a cohort + task',    8,   'per_item', 1),
    ('cohort_repeat_week',      'Repeat attendance same week',  2,   'weekly',   1),
    ('community_post',          'Posted in a community',        0.5, 'daily',    3),
    ('community_reactions',     'Received 5 reactions',         0.5, 'daily',    1),
    ('community_join',          'Joined a new community',       1,   'lifetime', 5),
    ('community_created',       'Created a community',          2,   'lifetime', 5),
    ('market_redeem',           'Redeemed a Market deal',       2,   'monthly',  5),
    ('document_uploaded',       'Uploaded a document',          2,   'lifetime', 5),
    ('application_submitted',   'Applied to an opportunity',    3,   'per_item', 1),
    ('opportunity_shortlisted', 'Shortlisted for an interview', 10,  'per_item', 1),
    ('assessment_completed',    'Completed the assessment',     0,   'none',     None),
]


def _seed_v1_rules(db):
    """Add any missing v1 rule. Returns (added_rules, ledger_high_water)."""
    existing = {r["event_type"] for r in db.session.execute(text(
        "SELECT event_type FROM score_event_rules")).mappings().all()}
    added = []
    for event_type, label, points, cap_type, cap_value in V1_TEST_RULES:
        if event_type in existing:
            continue
        db.session.execute(text(
            "INSERT INTO score_event_rules "
            "(event_type, label, points, cap_type, cap_value, is_active) "
            "VALUES (:t, :l, :p, :ct, :cv, 1)"),
            {'t': event_type, 'l': label, 'p': points,
             'ct': cap_type, 'cv': cap_value})
        added.append(event_type)
    if added:
        db.session.commit()

    # The ledger's high-water mark BEFORE the test runs. Teardown deletes only
    # rows above it.
    #
    # This guard is not theoretical. Without it, teardown deleted every
    # score_events row of the seeded types -- for every student, across the
    # whole database, including years of real history that predated the test.
    # `score_events` is append-only by design and there is no undo.
    high_water = db.session.execute(text(
        "SELECT IFNULL(MAX(seq), 0) FROM score_events")).scalar()
    return added, int(high_water or 0)


def _drop_seeded(db, added, high_water):
    """Remove exactly what this test created. Nothing that predates it."""
    if not added:
        return
    # seq is AUTO_INCREMENT, so "> high_water" is precisely the rows this test
    # is responsible for. Never filter on event_type alone.
    db.session.execute(text(
        "DELETE FROM score_events WHERE seq > :hw AND event_type IN :t"
    ).bindparams(t=tuple(added)), {'hw': high_water})
    db.session.execute(text(
        "DELETE FROM score_event_rules WHERE event_type IN :t").bindparams(t=tuple(added)))
    db.session.commit()


@pytest.fixture(autouse=True)
def _score_rules_available(request, db):
    """Every score test gets the v1 rules, whether it asks for them or not.

    Most of these tests call score_helper.award(COLLEGE_SAVED) and then assert
    on the number. That only works if a rule row exists for that key -- and
    almost none of them declared a dependency on one, because the rows used to
    be seeded into the database permanently.

    Once an admin deleted the v1 actions, 74 tests started failing. Nothing was
    broken; there was simply nothing left to score. Rather than add a fixture
    argument to 74 signatures, this runs for every test in a test_score_* module
    and cleans up after itself.
    """
    name = getattr(request.module, '__name__', '')
    if 'test_score' not in name:
        yield
        return
    added, high_water = _seed_v1_rules(db)
    try:
        yield
    finally:
        _drop_seeded(db, added, high_water)


@pytest.fixture
def rules(db):
    """The rule config these tests need, seeded for the test and then removed.

    This used to read whatever happened to be in score_event_rules. That made
    the whole suite depend on an admin's live configuration: once the v1 actions
    were deleted -- a legitimate thing for an admin to do -- 74 tests failed,
    not because the engine broke but because there was nothing left to score.

    A test must not care what the production config says. So: add only the rows
    that are missing, remember which ones we added, and delete exactly those
    afterwards. A rule the admin actually configured is read, used, and left
    completely alone.
    """
    added, high_water = _seed_v1_rules(db)

    rows = db.session.execute(text(
        "SELECT event_type, points, cap_type, cap_value, is_active "
        "FROM score_event_rules")).mappings().all()

    yield {r["event_type"]: dict(r) for r in rows}

    # Only what this fixture created. Ledger rows those rules produced go too --
    # a test's points must not linger on a real student's score.
    _drop_seeded(db, added, high_water)


@pytest.fixture
def settings(db):
    """readiness_rules — the single config row the engine reads."""
    row = db.session.execute(text("""
        SELECT * FROM readiness_rules ORDER BY created_at ASC LIMIT 1
    """)).mappings().first()
    return dict(row) if row else {}


@pytest.fixture
def age_events(db):
    """Backdate a user's activity.

    MySQL's UTC_TIMESTAMP() cannot be monkeypatched from Python, so the way to
    test a time window is to move the data instead of the clock. Shifting
    last_event_at back N days is exactly what the grace window reads.
    """
    def _age(user_id, days):
        db.session.execute(text("""
            UPDATE readiness_scores
               SET last_event_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL :d DAY),
                   last_decay_on = NULL
             WHERE user_id = :u
        """), {"d": days, "u": user_id})
        db.session.execute(text("""
            UPDATE score_events
               SET occurred_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL :d DAY)
             WHERE user_id = :u
        """), {"d": days, "u": user_id})
        db.session.commit()
    return _age


# ── workbook case reporting ──────────────────────────────────────────────────
#
# Mirrors automation/case-reporter.js so both runners feed one merge step.
# A test claims a case from SKOVO_v1_Test_Cases.xlsx either explicitly:
#
#     @pytest.mark.case("ST06-004", "ST06-005")
#     def test_task_opens_when_the_session_starts(...):
#
# or implicitly, by carrying the id in its name (`test_ST06_004_...`) — Python
# identifiers cannot hold a hyphen, so the underscore form is normalised back.
#
# Several tests may claim one case; the case is Pass only if every one of them
# passed. Worst result wins, same rule as the JS reporter — a case that passes
# in one test and fails in another is a fail, not whichever finished last.
import json  # noqa: E402
import re  # noqa: E402
from pathlib import Path  # noqa: E402

_CASE_RE = re.compile(r"\b([A-Z]{1,2}\d{2})[-_](\d{3})\b")
_RANK = {"passed": 0, "skipped": 1, "failed": 2, "error": 3}
_CASES = {}
_STATS = {"total": 0, "untagged": 0}

_RESULTS = (Path(__file__).resolve().parents[2]
            / "automation" / "results" / "pytest-cases.json")


def pytest_configure(config):
    config.addinivalue_line(
        "markers", "case(*ids): workbook Test IDs this test verifies")


def _ids_for(item):
    ids = []
    for mark in item.iter_markers("case"):
        ids += [str(a).strip().upper() for a in mark.args]
    ids += [f"{a}-{b}" for a, b in _CASE_RE.findall(item.nodeid)]
    return list(dict.fromkeys(ids))


def pytest_runtest_logreport(report):
    # 'call' is the real outcome; a setup failure never reaches it, so record
    # that too or a broken fixture would silently look like an unclaimed case.
    if report.when == "call":
        _STATS["total"] += 1
    elif not (report.when == "setup" and report.outcome == "failed"):
        return

    ids = getattr(report, "_workbook_cases", None) or []
    if not ids:
        if report.when == "call":
            _STATS["untagged"] += 1
        return

    outcome = "error" if report.when == "setup" else report.outcome
    for cid in ids:
        prev = _CASES.get(cid)
        if prev and _RANK.get(prev["status"], 0) >= _RANK.get(outcome, 0):
            prev["claimed_by"] += 1
            continue
        _CASES[cid] = {
            "id": cid,
            "status": outcome,
            "title": report.nodeid.split("::")[-1],
            "file": report.nodeid.split("::")[0],
            "duration_ms": int(getattr(report, "duration", 0) * 1000),
            "error": (str(report.longrepr).strip().splitlines()[-1][:300]
                      if report.failed and report.longrepr else None),
            "claimed_by": (prev["claimed_by"] + 1) if prev else 1,
        }


@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_makereport(item, call):
    # Markers live on the *item*, but logreport only receives the report — so
    # the ids have to be attached to the report as it is built. A plain (non
    # wrapper) hook here would not see the constructed report at all.
    outcome = yield
    report = outcome.get_result()
    report._workbook_cases = _ids_for(item)


def pytest_sessionfinish(session, exitstatus):
    if not _CASES and not _STATS["total"]:
        return
    _RESULTS.parent.mkdir(parents=True, exist_ok=True)
    cases = sorted(_CASES.values(), key=lambda c: c["id"])
    _RESULTS.write_text(json.dumps({
        "runner": "pytest",
        "exit_status": int(exitstatus),
        "total_tests": _STATS["total"],
        "untagged_tests": _STATS["untagged"],
        "cases": cases,
    }, indent=2), encoding="utf-8")
    n_pass = sum(1 for c in cases if c["status"] == "passed")
    print(f"\n[case-reporter] {len(cases)} workbook cases claimed "
          f"({n_pass} pass) · {_STATS['untagged']}/{_STATS['total']} tests untagged"
          f"\n[case-reporter] wrote {_RESULTS}")
