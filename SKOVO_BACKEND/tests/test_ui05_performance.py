"""
UI-05 Performance — the server-side half.

The client-side cases live in Playwright: UI05-004/007/009 are tagged on
`automation/tests/39-colleges-browse-perf.spec.js`, and the paint, bundle and
scroll cases (001, 002, 010, 011, 012, 013) are browser measurements that cannot
be made from here.

What this file owns is the shape of the work the server does. Three of these are
not really "performance" at all — they are correctness ceilings wearing a
performance costume:

  * A `LIMIT 50000` on a full-table read is a **silent correctness bug**. The
    5000th cohort pushes an enrolled student's cohort out of the window and
    their tasks vanish from My Tasks with no error anywhere.

  * An N+1 loop is fine at 6 rows and unusable at 600, and the row count is not
    something the code controls.

  * A cache with no invalidation shows a number that was true once.
"""
import re
import time
import uuid
from pathlib import Path

import pytest
from flask_jwt_extended import create_access_token
from sqlalchemy import text

REPO = Path(__file__).resolve().parents[2]
ROUTES = REPO / 'SKOVO_BACKEND' / 'portal' / 'routes'
TEST_PREFIX = 'ui05-test-'


@pytest.fixture
def client(app):
    return app.test_client()


def body(resp):
    payload = resp.get_json()
    assert payload is not None, f'no JSON body: {resp.data[:200]}'
    return payload


@pytest.fixture
def student(app, db):
    uid = str(uuid.uuid4())
    db.session.execute(text("""
        INSERT INTO users (id, full_name, email, status, created_at, updated_at)
        VALUES (:i, 'UI05 Student', :e, 'active', UTC_TIMESTAMP(), UTC_TIMESTAMP())
    """), {'i': uid, 'e': f'{TEST_PREFIX}{uid}@skovo.test'})
    db.session.execute(text("""
        INSERT INTO user_profiles (id, user_id, created_at, updated_at)
        VALUES (:i, :u, UTC_TIMESTAMP(), UTC_TIMESTAMP())
    """), {'i': str(uuid.uuid4()), 'u': uid})
    db.session.commit()
    yield uid
    for sql in ('DELETE FROM user_profiles WHERE user_id = :u',
                'DELETE FROM readiness_scores WHERE user_id = :u',
                'DELETE FROM users WHERE id = :u'):
        try:
            db.session.execute(text(sql), {'u': uid})
            db.session.commit()
        except Exception:
            db.session.rollback()


@pytest.fixture
def auth(app, student):
    with app.app_context():
        return {'Authorization': f'Bearer {create_access_token(identity=str(student))}'}


@pytest.mark.case('UI05-009')
def test_the_colleges_browse_work_happens_in_sql(db):
    """`sp_colleges_browse` does the search, filter, sort and page. The old path
    pulled 5000 colleges and 50000 courses through two auto-generated `SELECT *`
    procedures and did all of it in Python — 21 MB and 12.4 s per request, to
    render twenty rows."""
    exists = db.session.execute(text("""
        SELECT COUNT(*) FROM information_schema.routines
         WHERE routine_schema = DATABASE() AND routine_name = 'sp_colleges_browse'
    """)).scalar()
    assert exists == 1, 'sp_colleges_browse is not loaded; browse falls back to the slow path'

    sql = REPO / 'SKOVO_BACKEND' / 'database' / 'stored_procedures' / 'business' / 'colleges_browse.sql'
    if sql.exists():
        src = sql.read_text(encoding='utf-8')
        assert 'COUNT(*) OVER ()' in src, \
            'the filtered total no longer rides on the row, so a second query is needed'


# Whole-table reads currently in the routes. This is real, measured debt, not a
# target: `GET /tasks/` alone did four at once (50000, 5000, 50000, 50000) before
# it was replaced with one indexed join.
#
# The number is pinned rather than driven to zero because fixing 101 call sites
# is a refactor nobody has asked for, and each one needs its own procedure. What
# the pin buys is that the next one is caught the day it is written.
WHOLE_TABLE_READ_BASELINE = 101

# Per-row reads that are known, bounded and accepted — named here so they are
# visible rather than hidden by a loose matcher, and so anything NEW still fails.
# Add to this only with a reason; do not widen the matcher instead.
# Keyed on FILE + PROCEDURE, not on a line number.
#
# It used to be admin_users.py:66, and an unrelated one-line import added
# above it moved the call to 67 and failed this test. An allowlist that breaks
# on every edit above it teaches people to re-number it without reading it,
# which is how an entry outlives the reason it was added. The pair below names
# the call itself: it survives the file moving around, and still fails if a
# SECOND per-row read appears in the same module.
ACKNOWLEDGED = {
    # Bounded by per_page on an internal screen with a handful of rows, and the
    # code says so on the line above. Worth batching if the admin user list ever
    # grows a large page size; not worth a refactor at six users.
    ('SKOVO_BACKEND/portal/routes/Admin/admin_users.py', 'sp_profile_get_by_user'),
}


@pytest.mark.case('UI05-015')
def test_no_endpoint_issues_one_query_per_row():
    """N+1 proper: a `call_proc` inside a loop over rows.

    This is the shape that degrades with the data rather than with the code —
    fine at six enrolments, unusable at six hundred, and the row count is not
    something the endpoint controls.
    """
    # Reads only. A *write* inside a loop is usually a bulk import doing exactly
    # what it says — admin cutoff upserts, agreement records — and rewriting
    # those as set operations is a different job with different risks. What this
    # is hunting is a lookup per displayed row, which is the shape that makes a
    # list screen slower the more successful the product gets.
    READ_PROCS = re.compile(r"'sp_\w*(_get|_list|_by_user|_search|_lookup|_resolve)\w*'")
    # The procedure being called, so the allowlist can name a CALL rather than
    # a line number that any edit above it shifts.
    PROC_NAME = re.compile(r"'(sp_\w+)'")
    offenders = []
    for path in ROUTES.rglob('*.py'):
        lines = path.read_text(encoding='utf-8', errors='ignore').splitlines()
        loop_indent = None
        for n, line in enumerate(lines, 1):
            stripped = line.strip()
            indent = len(line) - len(line.lstrip())
            if re.match(r'^for\s+\w+.*\bin\b.*:', stripped):
                loop_indent = indent
                continue
            if loop_indent is not None and stripped and indent <= loop_indent:
                loop_indent = None
            if stripped.startswith('for '):
                continue          # `for x in call_proc(...)` is ONE call, not N
            if loop_indent is None or not re.search(r'\bcall_proc(_one)?\(', stripped):
                continue
            if not READ_PROCS.search(stripped):
                continue          # a write, or the proc name is on the next line
            rel = str(path.relative_to(REPO)).replace('\\', '/')
            proc = re.search(PROC_NAME, stripped)
            if proc and (rel, proc.group(1)) in ACKNOWLEDGED:
                continue
            offenders.append(f'{rel}:{n} {stripped[:70]}')

    assert not offenders, (
        'a stored-procedure READ sits inside a loop over rows — one query per '
        'displayed row:\n  ' + '\n  '.join(offenders))


@pytest.mark.case('UI05-015')
def test_whole_table_reads_do_not_grow():
    """A pinned baseline, not a clean bill of health.

    Every one of these LIMITs is a silent correctness ceiling as much as a cost:
    past it, rows simply stop existing as far as the screen is concerned, with
    no error anywhere. The 5000th cohort once pushed an enrolled student's
    cohort out of the window and their tasks vanished from My Tasks.

    If this fails because the count went UP, the new call site is the bug. If it
    fails because the count went DOWN, that is good — lower the baseline.
    """
    offenders = []
    for path in ROUTES.rglob('*.py'):
        src = path.read_text(encoding='utf-8', errors='ignore')
        for m in re.finditer(r"call_proc\(\s*'(\w+)'\s*,\s*(\d{4,})", src):
            if int(m.group(2)) >= 20000:
                line = src[:m.start()].count('\n') + 1
                offenders.append(f'{path.relative_to(REPO)}:{line} {m.group(1)}({m.group(2)})')

    assert len(offenders) <= WHOLE_TABLE_READ_BASELINE, (
        f'whole-table reads grew from {WHOLE_TABLE_READ_BASELINE} to {len(offenders)}. '
        f'New ones:\n  ' + '\n  '.join(offenders[WHOLE_TABLE_READ_BASELINE:]))
    if len(offenders) < WHOLE_TABLE_READ_BASELINE:
        pytest.skip(f'{len(offenders)} whole-table reads — lower '
                    f'WHOLE_TABLE_READ_BASELINE from {WHOLE_TABLE_READ_BASELINE}')


@pytest.mark.case('UI05-005')
@pytest.mark.case('UI05-006')
def test_the_client_cache_is_opt_in_and_collapses_duplicates():
    """`api.get` is untouched — nothing caches unless the caller asks. That
    matters: a blanket cache on a write-adjacent read is how a screen shows
    stale money. `getCached` also collapses concurrent identical GETs onto one
    request, which is what actually kills StrictMode's double-fire."""
    api = REPO / 'Skovo' / 'src' / 'services' / 'api.js'
    if not api.exists():
        pytest.skip('SPA services not present in this checkout')
    src = api.read_text(encoding='utf-8', errors='ignore')
    for name in ('getCached', 'hasCached', 'invalidateGetCache'):
        assert name in src, f'{name} is gone from the API client'

    masters = list((REPO / 'Skovo' / 'src').rglob('useMasters*'))
    if masters:
        m_src = masters[0].read_text(encoding='utf-8', errors='ignore')
        assert 'getCached' in m_src or 'cache' in m_src.lower(), \
            'useMasters no longer caches, so static dropdowns refetch on every navigation'


@pytest.mark.case('UI05-008')
def test_the_profile_cache_has_a_ttl_and_an_invalidation():
    """Cached 30 s per user, and invalidated on write. Under multiple gunicorn
    workers a worker that did not serve the write keeps its copy until the TTL —
    bounded, and the only symptom is a banner catching up late. That is the
    trade; what would not be acceptable is a cache with no invalidation at all."""
    cache = REPO / 'SKOVO_BACKEND' / 'portal' / 'helpers' / 'profile_cache.py'
    if not cache.exists():
        pytest.skip('profile cache not present in this checkout')
    src = cache.read_text(encoding='utf-8')
    assert re.search(r'\b30\b', src), 'the 30-second TTL is gone'
    assert 'invalidate' in src.lower(), 'the cache has no invalidation path'


@pytest.mark.case('UI05-014')
def test_key_endpoints_respond_quickly_when_warm(client, auth):
    """A generous ceiling on purpose. This is a smoke check against a route
    quietly acquiring a full-table read — not a benchmark, and it runs against a
    remote RDS over the open internet, so a tight bound would fail on latency
    that has nothing to do with the code."""
    endpoints = ['/v1/cohorts/', '/v1/colleges/', '/v1/tasks/',
                 '/v1/readiness/score', '/v1/document-vault/']
    slow = []
    for path in endpoints:
        client.get(path, headers=auth)          # warm
        started = time.perf_counter()
        resp = client.get(path, headers=auth)
        elapsed = (time.perf_counter() - started) * 1000
        if resp.status_code == 200 and elapsed > 5000:
            slow.append(f'{path} {elapsed:.0f}ms')
    assert not slow, f'endpoints took over 5s warm: {slow}'


@pytest.mark.case('UI05-010')
def test_the_whiteboard_bundle_is_loaded_lazily():
    """EXPECTED TO FAIL — an open finding, not a broken test.

    1.7 MB, statically imported by Bookings, AchieverBookings and
    AchieverCohorts, so it ships in the main bundle and is paid for by every
    student on every visit including the ones who never open a whiteboard.

    Not fixed here on purpose: converting the three imports to `React.lazy`
    needs a Suspense boundary at each site, and the only honest way to confirm a
    lazy chunk actually loads is to build and open a whiteboard — a build nobody
    has asked for. The finding is worth more than a blind refactor.
    """
    src_dir = REPO / 'Skovo' / 'src'
    if not src_dir.exists():
        pytest.skip('SPA source not present in this checkout')
    eager = []
    for path in src_dir.rglob('*.jsx'):
        txt = path.read_text(encoding='utf-8', errors='ignore')
        for m in re.finditer(r"^import\s+\w+\s+from\s+['\"].*[Ww]hiteboard.*['\"]", txt, re.M):
            eager.append(f'{path.relative_to(REPO)}: {m.group(0).strip()}')
    assert not eager, ('the whiteboard is statically imported, so it ships in the '
                       f'main bundle:\n  ' + '\n  '.join(eager))


@pytest.mark.case('UI05-011')
def test_no_multi_megabyte_image_ships_on_the_landing_path():
    """A 4 MB hero photo costs more on a phone than every query on this page put
    together, and no amount of backend work compensates for it."""
    assets = REPO / 'Skovo' / 'src' / 'assets'
    public = REPO / 'Skovo' / 'public'
    heavy = []
    for root in (assets, public):
        if not root.exists():
            continue
        for path in root.rglob('*'):
            if path.suffix.lower() in ('.jpg', '.jpeg', '.png', '.webp', '.gif'):
                mb = path.stat().st_size / (1024 * 1024)
                if mb > 1.5:
                    heavy.append(f'{path.relative_to(REPO)} {mb:.1f}MB')
    assert not heavy, f'oversized images ship to the browser: {heavy}'
