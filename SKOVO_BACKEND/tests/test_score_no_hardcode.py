"""Guards against the two mistakes that have broken the score engine twice.

These are not tests of behaviour. They are tests of a rule we keep breaking:

  1. ONE OWNER PER PROCEDURE.
     Two migrations holding a CREATE for the same procedure means whichever ran
     last decides what is live. Re-running an older file then silently reverts
     newer work -- it has already reverted the direct-credit fix, the decay
     interval, and the level-name fix, and it recreated 15 scoring rules an
     admin had deliberately deleted.

  2. NO BUSINESS VALUE INSIDE A PROCEDURE.
     Level names and their thresholds are rows in readiness_levels, editable by
     an admin. A procedure that writes 'Achiever' or compares against 65 puts
     them back the next time it runs, so the admin's change lasts until the
     nightly job.

Both failures are invisible until a specific job runs at 03:00, which is why
they need a test rather than review.

    pytest tests/test_score_no_hardcode.py
"""
import collections
import glob
import os
import re

import pytest

MIGRATIONS = os.path.join(os.path.dirname(__file__), '..', 'database', 'migrations')

# Procedures whose CREATE text appears in a file that no longer executes it.
# Each is kept as the record of what that migration introduced.
#   migrate_score_award_user_guard  verifies the guard instead of recreating
#   migrate_score_autopause / _fix  retired; the feature was removed
DORMANT = {
    'sp_score_award': {'migrate_score_award_user_guard.py'},
    'sp_score_autopause_run': {'migrate_score_autopause.py', 'migrate_autopause_fix.py'},
    'sp_score_autopause_recent': {'migrate_score_autopause.py', 'migrate_autopause_fix.py'},
}

# Known outside the score engine. Recorded so the test reports a real number
# rather than silently passing, and so nobody adds to it by accident.
KNOWN_OTHER = {
    'sp_market_deals_create', 'sp_market_deals_list_public', 'sp_market_deals_update',
}


def _creates_by_file():
    found = collections.defaultdict(set)
    for path in sorted(glob.glob(os.path.join(MIGRATIONS, '*.py'))):
        with open(path, encoding='utf-8') as fh:
            src = fh.read()
        for m in re.finditer(r'CREATE\s+PROCEDURE\s+`?(\w+)`?', src):
            found[m.group(1)].add(os.path.basename(path))
    return found


def test_every_score_procedure_has_exactly_one_owner():
    offenders = {}
    for proc, files in _creates_by_file().items():
        if not proc.startswith(('sp_score', 'sp_readiness')):
            continue
        live = files - DORMANT.get(proc, set())
        if len(live) > 1:
            offenders[proc] = sorted(live)
    assert not offenders, (
        "These procedures are created by more than one migration. Whichever runs "
        "last wins, so a re-run in the wrong order reverts work:\n" +
        "\n".join(f"  {p}: {', '.join(f)}" for p, f in sorted(offenders.items())) +
        "\nKeep the CREATE in the migration that introduced the newest behaviour "
        "and replace the others with a comment naming the owner."
    )


def test_no_new_duplicate_owners_outside_the_score_engine():
    offenders = set()
    for proc, files in _creates_by_file().items():
        live = files - DORMANT.get(proc, set())
        if len(live) > 1 and not proc.startswith(('sp_score', 'sp_readiness')):
            offenders.add(proc)
    assert offenders <= KNOWN_OTHER, (
        f"New duplicate procedure owners: {sorted(offenders - KNOWN_OTHER)}. "
        "Same trap as the score engine -- give each procedure one owner."
    )


def test_v1_rule_seed_cannot_overwrite_a_live_configuration():
    """migrate_score_engine must seed rules only into an empty table.

    It used to re-seed on every run with ON DUPLICATE KEY UPDATE, which undid an
    admin's point values and resurrected every action they had deleted.
    """
    path = os.path.join(MIGRATIONS, 'migrate_score_engine.py')
    with open(path, encoding='utf-8') as fh:
        src = fh.read()
    assert 'seeded = db.session.execute' in src and 'if seeded' in src, (
        "migrate_score_engine.py must count score_event_rules before seeding and "
        "skip the seed when the table is not empty."
    )
    assert 'else V1_RULES' in src, (
        "The V1_RULES loop must be guarded by the seeded check."
    )


# ── live-database guards ─────────────────────────────────────────────────────
# Skipped when no database is reachable, so the file still runs in a bare CI.

def _procs():
    try:
        from portal import InitApp
        from portal.models import db
        from sqlalchemy import text
    except Exception as e:                       # pragma: no cover
        pytest.skip(f"app not importable: {e}")
    app = InitApp().app()
    with app.app_context():
        try:
            rows = db.session.execute(text(
                "SELECT ROUTINE_NAME, ROUTINE_DEFINITION FROM information_schema.ROUTINES "
                "WHERE ROUTINE_SCHEMA = DATABASE() AND ROUTINE_NAME LIKE 'sp_score%'"
            )).all()
            levels = db.session.execute(text(
                "SELECT label FROM readiness_levels")).scalars().all()
        except Exception as e:                   # pragma: no cover
            pytest.skip(f"no database: {e}")
    return {r[0]: (r[1] or '') for r in rows}, [l for l in levels if l]


def test_no_procedure_writes_a_level_name_as_a_literal():
    procs, levels = _procs()
    if not levels:
        pytest.skip("no readiness_levels configured")
    offenders = {}
    for name, body in procs.items():
        hits = [lv for lv in levels if f"'{lv}'" in body]
        if hits:
            offenders[name] = hits
    assert not offenders, (
        "These procedures contain a level name as a literal, so they will write "
        "the old name back over a renamed level:\n" +
        "\n".join(f"  {n}: {', '.join(h)}" for n, h in sorted(offenders.items())) +
        "\nResolve the level from readiness_levels instead:\n"
        "  (SELECT l.label FROM readiness_levels l\n"
        "    WHERE l.is_active = 1 AND l.min_score <= <score>\n"
        "    ORDER BY l.min_score DESC LIMIT 1)"
    )


def test_no_procedure_hardcodes_a_level_threshold():
    procs, _ = _procs()
    offenders = [n for n, body in procs.items()
                 if re.search(r'SET\s+v_(pio|ach)\w*\s*=\s*\d', body, re.I)]
    assert not offenders, (
        f"These procedures hardcode a level threshold: {sorted(offenders)}. "
        "min_score lives in readiness_levels."
    )


def test_the_score_clamp_is_the_only_bare_number_allowed():
    """0 and 100 are the product definition, not configuration.

    Recorded deliberately: if someone later wants a different maximum, this test
    is where they will find out that the decision was made on purpose and that
    two procedures need changing together.
    """
    procs, _ = _procs()
    clamped = [n for n, b in procs.items() if 'LEAST(100' in b]
    assert set(clamped) <= {'sp_score_recalc', 'sp_score_decay_run', 'sp_score_recalc_bulk'}, (
        f"Unexpected procedure clamping the score: {sorted(clamped)}. "
        "The clamp belongs in the three procedures that compute a score."
    )


# ── the first result set must be the procedure's own ─────────────────────────
# MySQL sends every SELECT inside a procedure to the client as its own result
# set, including SELECTs inside procedures it CALLs. portal/helpers/sp.py reads
# the FIRST one. So an inner procedure that ends with a SELECT silently pushes
# its caller's answer out of reach -- the call still succeeds and the caller
# reads someone else's row.
#
# This shipped twice. sp_score_award returned pause_release's row where
# `awarded` was expected, so award() read 0 for every award ever made and never
# triggered its recalc. sp_score_rules_run returned sp_score_rule_apply's row
# where `rules_run` was expected.
#
# A text scan cannot catch it -- the procedures look fine individually. Calling
# them can.

FIRST_ROW_MUST_HAVE = {
    'sp_score_award':     'awarded',
    'sp_score_rules_run': 'rules_run',
    'sp_score_recalc':    'score',
    'sp_score_settings':  'reaction_milestone',
    'sp_score_breakdown': None,      # may be empty; must not raise
}


@pytest.mark.parametrize('proc,key', sorted(FIRST_ROW_MUST_HAVE.items()))
def test_first_result_set_belongs_to_the_procedure_called(proc, key):
    import uuid as _uuid
    try:
        from portal import InitApp
        from portal.models import db
        from sqlalchemy import text
    except Exception as e:                       # pragma: no cover
        pytest.skip(f"app not importable: {e}")

    app = InitApp().app()
    with app.app_context():
        try:
            user = db.session.execute(text(
                "SELECT id FROM users WHERE deleted_at IS NULL LIMIT 1")).scalar()
        except Exception as e:                   # pragma: no cover
            pytest.skip(f"no database: {e}")
        if not user:
            pytest.skip("no user to probe with")

        args = {
            'sp_score_award': (str(_uuid.uuid4()), user, 'college_saved',
                               'guard-' + _uuid.uuid4().hex[:8], None),
            'sp_score_rules_run': (user,),
            'sp_score_recalc': (user,),
            'sp_score_settings': (),
            'sp_score_breakdown': (user,),
        }[proc]

        raw = db.session.connection().connection
        cur = raw.cursor()
        try:
            cur.callproc(proc, args)
            # The raw DBAPI cursor yields tuples, so the column names come from
            # `description` -- captured before nextset() moves past this set.
            cols = [d[0] for d in (cur.description or [])]
            rows = cur.fetchall()
            while cur.nextset():
                pass
        finally:
            cur.close()
            db.session.rollback()

        if key is None:
            return
        assert cols, f"{proc} returned no first result set"
        assert key in cols, (
            f"{proc}'s first result set is {list(cols)}, not its own row "
            f"(expected a '{key}' column).\n"
            "An inner procedure it CALLs is ending with a SELECT. Replace that "
            "SELECT with `SET @some_var = ...` -- callers read the first result "
            "set and will otherwise read the inner procedure's row instead."
        )


# ── every metric in the catalogue must actually run ──────────────────────────
# `cohorts_attended` pointed at a table called `cohort_attendance` that has
# never existed. Nothing caught it, because a metric is only executed when a
# rule uses it -- so the failure waited in the catalogue for whoever first built
# a rule on "Cohorts attended", and would have surfaced at 02:30 as a sweep that
# died partway through.
#
# Listing a metric is a promise that a rule can be built on it. This holds the
# catalogue to that promise.

def test_every_catalogued_metric_can_be_measured():
    try:
        from portal import InitApp
        from portal.models import db
        from sqlalchemy import text
    except Exception as e:                       # pragma: no cover
        pytest.skip(f"app not importable: {e}")

    app = InitApp().app()
    with app.app_context():
        try:
            metrics = db.session.execute(text(
                "SELECT value FROM score_metrics WHERE is_active = 1")).scalars().all()
        except Exception as e:                   # pragma: no cover
            pytest.skip(f"no database: {e}")
        if not metrics:
            pytest.skip("no metrics configured")

        broken = {}
        for m in metrics:
            for proc, args in (
                ('sp_score_metric_snapshot', "(:m, NULL, NULL, NULL)"),
                ('sp_score_streak_snapshot', "(:m, 3, NULL)"),
                ('sp_score_rule_preview',    "(:m, NULL, 'each', NULL, 1.0, NULL, NULL)"),
            ):
                try:
                    db.session.execute(text(f"CALL {proc}{args}"), {'m': m})
                    db.session.commit()
                except Exception as e:
                    db.session.rollback()
                    broken.setdefault(m, []).append(f"{proc}: {str(e)[:90]}")

        assert not broken, (
            "These metrics are listed in the catalogue but cannot be measured:\n" +
            "\n".join(f"  {m}\n    " + "\n    ".join(errs)
                      for m, errs in sorted(broken.items())) +
            "\nA metric that is offered must resolve to a real table and columns. "
            "Fix SOURCES in migrate_score_metric_rules.py AND "
            "migrate_score_rule_shapes.py -- both hold the map."
        )


def test_both_source_maps_agree():
    """SOURCES is duplicated in two migrations; they must not drift.

    They are deliberately separate (importing across migrations couples their
    run order), which makes it easy to fix one and forget the other -- exactly
    what happened with cohorts_attended.
    """
    import re
    def sources(path):
        with open(os.path.join(MIGRATIONS, path), encoding='utf-8') as fh:
            src = fh.read()
        block = re.search(r'^SOURCES = \{(.*?)^\}', src, re.S | re.M)
        assert block, f"no SOURCES map in {path}"
        return dict(re.findall(r"'([a-z_]+)':\s*\('([a-z_]+)',\s*'([a-z_]+)'",
                               block.group(1)) and
                    [(m[0], (m[1], m[2])) for m in
                     re.findall(r"'([a-z_]+)':\s*\('([a-z_]+)',\s*'([a-z_]+)'",
                                block.group(1))])

    a = sources('migrate_score_metric_rules.py')
    b = sources('migrate_score_rule_shapes.py')
    assert a == b, (
        "The two SOURCES maps disagree:\n" +
        "\n".join(f"  {k}: rules={a.get(k)} shapes={b.get(k)}"
                  for k in sorted(set(a) | set(b)) if a.get(k) != b.get(k))
    )
