"""
Score Engine — the Python surface (`portal.helpers.score`).

Every module in the platform writes to the engine through `award()`, so its
contract matters as much as the stored procedures underneath it:

  * it returns the points actually awarded,
  * it never raises — Playbook §5.7 makes scoring a side effect of a student's
    action, and a scoring failure must not roll back the action that earned it,
  * it rebuilds the cached score when, and only when, points were awarded.

`test_score_engine.py` covers the SQL. This file covers everything between the
caller and the CALL.
"""
import uuid

import pytest
from sqlalchemy import text

from portal.helpers import score as score_helper


@pytest.fixture
def ctx(app):
    """`award()` runs inside a request in production; give it an app context."""
    with app.app_context():
        yield


# ── Contract ─────────────────────────────────────────────────────────────────

def test_award_returns_points(ctx, user, db):
    assert score_helper.award(user, "cohort_completed", ref_id="c1") == 8


def test_award_updates_the_cached_score(ctx, user, db):
    score_helper.award(user, "cohort_completed", ref_id="c1")
    score = db.session.execute(text(
        "SELECT score FROM readiness_scores WHERE user_id = :u"), {"u": user}).scalar()
    assert int(score) == 8


def test_award_skips_recalc_when_asked(ctx, user, db):
    """Bulk callers pass recalc=False and rebuild once at the end."""
    score_helper.award(user, "cohort_completed", ref_id="c1", recalc=False)
    score = db.session.execute(text(
        "SELECT IFNULL(score, 0) FROM readiness_scores WHERE user_id = :u"), {"u": user}).scalar()
    assert int(score or 0) == 0

    score_helper.recalc(user)
    score = db.session.execute(text(
        "SELECT score FROM readiness_scores WHERE user_id = :u"), {"u": user}).scalar()
    assert int(score) == 8


def test_award_is_idempotent_on_ref_id(ctx, user):
    assert score_helper.award(user, "application_submitted", ref_id="app-1") == 3
    assert score_helper.award(user, "application_submitted", ref_id="app-1") == 0


def test_award_respects_caps(ctx, user):
    for i in range(5):
        assert score_helper.award(user, "document_uploaded", ref_id=f"d{i}") == 2
    assert score_helper.award(user, "document_uploaded", ref_id="d5") == 0


# ── Guard rails ──────────────────────────────────────────────────────────────

@pytest.mark.parametrize("user_id,event_type", [
    (None, "cohort_attended"),
    ("", "cohort_attended"),
    ("some-user", None),
    ("some-user", ""),
])
def test_award_rejects_empty_arguments(ctx, user_id, event_type):
    assert score_helper.award(user_id, event_type) == 0


def test_award_never_raises_on_a_bad_user(ctx):
    """A user id that does not exist must return 0, not explode — the caller's
    own work has already happened by the time scoring runs."""
    assert score_helper.award(str(uuid.uuid4()), "cohort_attended", ref_id="x") == 0


def test_award_never_raises_when_the_database_fails(ctx, user, monkeypatch):
    """Scoring must never take down the action that triggered it."""
    def _boom(*_args, **_kwargs):
        raise RuntimeError("database is down")

    monkeypatch.setattr(score_helper, "call_proc_one", _boom)
    assert score_helper.award(user, "cohort_attended", ref_id="c1") == 0


def test_recalc_never_raises(ctx, monkeypatch):
    def _boom(*_args, **_kwargs):
        raise RuntimeError("database is down")

    monkeypatch.setattr(score_helper, "call_proc_one", _boom)
    assert score_helper.recalc("whoever") is None


def test_award_accepts_a_non_string_ref(ctx, user):
    """Callers pass ints and UUID objects; the helper stringifies them."""
    assert score_helper.award(user, "cohort_attended", ref_id=12345) == 2
    assert score_helper.award(user, "cohort_attended", ref_id=12345) == 0


# ── Vault completion (§5.6: +5 once all four folders are filled) ─────────────

def _fake_vault(monkeypatch, categories):
    """Stub only the vault lookup.

    `call_proc_one` delegates to `call_proc`, so replacing `call_proc` outright
    also hijacks the sp_score_award call underneath `award()` and the award
    silently returns 0. Dispatch on the procedure name and let everything else
    reach the real database.
    """
    import portal.helpers.sp as sp_module
    real_call_proc = sp_module.call_proc

    def _dispatch(proc_name, *args, **kwargs):
        if proc_name == "sp_docvault_by_user":
            if isinstance(categories, Exception):
                raise categories
            return [{"category": c} for c in categories]
        return real_call_proc(proc_name, *args, **kwargs)

    monkeypatch.setattr(sp_module, "call_proc", _dispatch)


def test_vault_complete_awards_once_all_four_folders_exist(ctx, user, monkeypatch):
    _fake_vault(monkeypatch, score_helper.VAULT_FOLDERS)
    assert score_helper.award_vault_complete(user) == 5
    # One-time only — the 'once' cap holds on the second check.
    assert score_helper.award_vault_complete(user) == 0


def test_vault_complete_awards_nothing_while_a_folder_is_missing(ctx, user, monkeypatch):
    _fake_vault(monkeypatch, list(score_helper.VAULT_FOLDERS)[:-1])
    assert score_helper.award_vault_complete(user) == 0


def test_vault_complete_is_case_insensitive(ctx, user, monkeypatch):
    _fake_vault(monkeypatch, [f.upper() for f in score_helper.VAULT_FOLDERS])
    assert score_helper.award_vault_complete(user) == 5


def test_vault_complete_ignores_extra_folders(ctx, user, monkeypatch):
    _fake_vault(monkeypatch, list(score_helper.VAULT_FOLDERS) + ["scholarship", "misc"])
    assert score_helper.award_vault_complete(user) == 5


def test_vault_complete_handles_an_empty_vault(ctx, user, monkeypatch):
    _fake_vault(monkeypatch, [])
    assert score_helper.award_vault_complete(user) == 0


def test_vault_complete_survives_a_lookup_failure(ctx, user, monkeypatch):
    _fake_vault(monkeypatch, RuntimeError("vault unavailable"))
    assert score_helper.award_vault_complete(user) == 0


def test_vault_folders_match_the_spec():
    """§5.6: 'Default folders: ID Proofs, Academic, Certificates, Resume'."""
    assert len(score_helper.VAULT_FOLDERS) == 4
