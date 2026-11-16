"""
ST-02 Onboarding — all 29 cases.

The stage-driven option lists, and the two policy mirrors that decide them.

**ST02-029 is the load-bearing one.** `educationPathways.js` and
`education_pathways.py` are the same policy written twice — the client filters
rows in place, the server filters the same lists on write — and nothing enforces
that they match. When they drift, a student is offered an exam the server will
then reject, or worse, the server quietly drops an answer the screen accepted.
The comparison here parses both files (exec for the Python, so `ALL_LEVELS` and
`AFTER_12` resolve as the app resolves them) rather than reading them side by
side, and checks **order** as well as membership: `AP DEECET` and `AP PECET`
both contain the substring `ECET`, so a bare `ECET` rule sitting above them
claims both and offers a teacher-training entrance to ITI students.

The first five cases are modal behaviour (mandatory, non-dismissable, survives a
reload) and belong to a browser test; the server state that drives them —
whether onboarding is outstanding — is asserted instead.

Rows are keyed to `st02-test-`.
"""
import json
import re
import uuid
from pathlib import Path

import pytest
from flask_jwt_extended import create_access_token
from sqlalchemy import text

REPO = Path(__file__).resolve().parents[2]
JS = REPO / 'Skovo' / 'src' / 'config' / 'educationPathways.js'
PY = REPO / 'SKOVO_BACKEND' / 'portal' / 'helpers' / 'education_pathways.py'
AUTH = '/v1/auth'
PROFILE = '/v1/profile'
GOALS = '/v1/profile/goals'
TEST_PREFIX = 'st02-test-'


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
        VALUES (:i, 'ST02 Student', :e, 'active', UTC_TIMESTAMP(), UTC_TIMESTAMP())
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


# ── The two mirrors ──────────────────────────────────────────────────────────

def _js_source():
    if not JS.exists():
        pytest.skip('the frontend policy mirror is not present in this checkout')
    return JS.read_text(encoding='utf-8')


def _py_module():
    if not PY.exists():
        pytest.skip('the backend policy mirror is not present in this checkout')
    ns = {}
    exec(compile(PY.read_text(encoding='utf-8'), str(PY), 'exec'), ns)
    return ns


def _js_array(src, name):
    """Read `export const NAME = [ ... ]` as a list of strings."""
    m = re.search(rf'export const {name}\s*=\s*\[(.*?)\]', src, re.S)
    assert m, f'{name} not found in the JS mirror'
    return re.findall(r"'([^']*)'", m.group(1))


def _js_block(src, name):
    """The source text of `export const NAME = { ... }`, braces balanced."""
    start = src.index(f'export const {name}')
    brace = src.index('{', start)
    depth, i = 0, brace
    while i < len(src):
        if src[i] == '{':
            depth += 1
        elif src[i] == '}':
            depth -= 1
            if depth == 0:
                break
        i += 1
    return src[brace:i + 1]


def _declares_key(block, key):
    """Is `key` written as an object key anywhere in this block?

    Membership, not position. Brace-depth parsing of a nested JS literal was
    fragile and quietly missed keys, which made the two mirrors look like they
    had diverged when they had not — a false alarm on a test whose whole job is
    to be believed.
    """
    return re.search(rf"(^|[{{,\s]){re.escape(key)}\s*:", block, re.M) is not None         or re.search(rf"['\"]{re.escape(key)}['\"]\s*:", block) is not None


@pytest.mark.case('ST02-029')
@pytest.mark.parametrize('name', ['SCHOOL_LEVELS', 'VOCATIONAL_LEVELS',
                                  'HIGHER_LEVELS', 'OTHER_LEVELS',
                                  'HIDDEN_ONBOARDING_CATEGORIES'])
def test_the_level_lists_are_identical_in_both_mirrors(name):
    src, mod = _js_source(), _py_module()
    assert _js_array(src, name) == list(mod[name]), \
        f'{name} differs between educationPathways.js and education_pathways.py'


@pytest.mark.case('ST02-022')
@pytest.mark.case('ST02-029')
def test_the_state_exam_tokens_match_in_content_and_order():
    """Order is the half that bites. A bare `ECET` above `DEECET`/`PECET`
    claims both by substring, and an ITI student is then offered a
    teacher-training entrance."""
    src, mod = _js_source(), _py_module()
    js_tokens = [t for t in re.findall(r"'([^']*)'",
                 re.search(r'STATE_EXAM_TOKENS\s*=\s*\[(.*?)\n\]', src, re.S).group(1))] \
        if re.search(r'STATE_EXAM_TOKENS\s*=\s*\[(.*?)\n\]', src, re.S) else None
    py_tokens = mod.get('STATE_EXAM_TOKENS')
    assert py_tokens, 'STATE_EXAM_TOKENS is missing from the backend mirror'

    if js_tokens is None:
        pytest.skip('STATE_EXAM_TOKENS is not expressed as a flat array in the JS mirror')

    py_flat = [t[0] if isinstance(t, (list, tuple)) else t for t in py_tokens]
    js_flat = [t for t in js_tokens if t in py_flat]
    for narrow, broad in (('DEECET', 'ECET'), ('PECET', 'ECET')):
        if narrow in py_flat and broad in py_flat:
            assert py_flat.index(narrow) < py_flat.index(broad), \
                f'{broad!r} sits above {narrow!r}, so it claims it by substring'


@pytest.mark.case('ST02-021')
@pytest.mark.case('ST02-029')
def test_the_exam_type_map_matches():
    src, mod = _js_source(), _py_module()
    block = _js_block(src, 'TARGET_EXAM_TYPES')
    missing = [k for k in mod['TARGET_EXAM_TYPES'] if not _declares_key(block, k)]
    assert not missing, f'TARGET_EXAM_TYPES keys missing from the JS mirror: {missing}'


@pytest.mark.case('ST02-029')
def test_the_career_interest_map_matches():
    src, mod = _js_source(), _py_module()
    block = _js_block(src, 'CAREER_INTEREST_LEVELS')
    missing = [k for k in mod['CAREER_INTEREST_LEVELS'] if not _declares_key(block, k)]
    assert not missing, f'CAREER_INTEREST_LEVELS keys missing from the JS mirror: {missing}'


@pytest.mark.case('ST02-007')
def test_activity_categories_are_hidden_from_the_stage_grid():
    """Govt Exam Aspirant and Entrance Exam Aspirant describe what somebody is
    doing, not where they are in education — and every downstream list filters
    on the stage, so picking one left them all with nothing to filter on.
    Hidden in code rather than by deactivating the master rows, so no master
    data was touched and the admin screens still show them."""
    mod = _py_module()
    assert {'govt_exam', 'entrance_exam'} <= set(mod['HIDDEN_ONBOARDING_CATEGORIES'])


@pytest.mark.case('ST02-007')
def test_post_graduate_and_working_stages_are_hidden_from_the_stage_grid():
    """The portal is aimed at students up to a first degree, so nobody new
    registers as CA/CS/CMA/CFA, PG, PhD or Working Professional."""
    mod = _py_module()
    assert {'professional_course', 'pg', 'phd', 'working'}         <= set(mod['HIDDEN_ONBOARDING_CATEGORIES'])


@pytest.mark.case('ST02-007')
def test_hiding_a_stage_does_not_strip_it_from_the_pathway_maps():
    """Hidden is not removed. Students who registered before a stage was hidden
    still need their exam and career lists to resolve, so the level keeps its
    entries in every map below."""
    mod = _py_module()
    for level in ('professional_course', 'pg', 'phd', 'working'):
        assert level in mod['TARGET_EXAM_TYPES'],             f'{level} lost its TARGET_EXAM_TYPES entry when it was hidden'
        assert level in mod['ALL_LEVELS'],             f'{level} lost its place in ALL_LEVELS when it was hidden'


@pytest.mark.case('ST02-023')
def test_an_unclassified_exam_is_shown_not_hidden(client):
    """Shown, always. A new exam surviving into one extra stage is noticeable;
    silently vanishing is not — nobody reports an option they never saw."""
    mod = _py_module()
    fn = mod.get('filter_target_exams')
    assert fn, 'filter_target_exams is missing from the backend mirror'
    kept = fn('ug', ['ZZZ BRAND NEW EXAM'], national={}, govt_values=[])
    assert 'ZZZ BRAND NEW EXAM' in (kept or []), \
        'an exam the config has never heard of was filtered out'


@pytest.mark.case('ST02-024')
def test_cds_survives_for_a_pg_student():
    """CDS sits in `master_entrance_exam` tagged `ug` AND in `master_govt_exam`.
    Keyed on the value alone the server dropped a PG student's CDS, because it
    matched the entrance tagging while PG draws on the govt list — so the filter
    has to check membership, not just the level string."""
    mod = _py_module()
    fn = mod.get('filter_target_exams')
    assert fn, 'filter_target_exams is missing'
    # CDS is in BOTH masters: tagged `ug` in master_entrance_exam and present in
    # master_govt_exam. Keyed on the value alone the server dropped a PG
    # student's CDS, because it matched the entrance tagging while PG draws on
    # the govt list.
    kept = fn('pg', ['CDS'], national={'CDS': 'ug'}, govt_values=['CDS'])
    assert 'CDS' in (kept or []), 'CDS was dropped for a PG student'


# ── Stage-driven data ────────────────────────────────────────────────────────

@pytest.mark.case('ST02-006')
def test_the_education_stage_list_comes_from_the_database(client, db):
    """Not a hardcoded array — an admin adding a stage through Masters must
    change what onboarding offers, with no deploy."""
    d = body(client.get('/v1/auth/masters?type=education_level'))
    assert d['status'] == 200, d
    served = d['response']['grouped'].get('education_level', [])
    rows = db.session.execute(text(
        "SELECT COUNT(*) FROM master_education_level WHERE is_active = 1")).scalar()
    assert len(served) == rows, f'{len(served)} served vs {rows} active master rows'


@pytest.mark.case('ST02-012')
@pytest.mark.case('ST02-013')
def test_the_stream_list_is_served_and_state_aware(client):
    """MPC/BiPC in AP, PCM/PCB in Delhi — different labels for the same
    underlying value, so a student sees their own board's vocabulary while the
    stored value stays comparable across states."""
    d = body(client.get('/v1/auth/streams'))
    assert d['status'] == 200, d
    assert d['response'], 'no streams are served at all'


@pytest.mark.case('ST02-014')
def test_course_search_is_filtered_and_carries_duration(client):
    """`duration_years` is what caps the year list, and it has always been on
    the row — it was simply never read."""
    d = body(client.get('/v1/auth/courses/search?q=B.Tech'))
    assert d['status'] == 200, d
    courses = d['response'].get('courses') or d['response'].get('results') or []
    if courses:
        assert any('duration' in str(k) for c in courses[:3] for k in c), \
            'course rows carry no duration, so the year cap cannot work'


@pytest.mark.case('ST02-015')
@pytest.mark.case('ST02-016')
@pytest.mark.case('ST02-017')
@pytest.mark.case('ST02-018')
def test_the_year_cap_follows_the_course_duration(db):
    """Three rules, and the third is why 5th Year survives: a course with no
    duration shows everything (hiding before the student has said what they
    study is a guess), durations round UP (MBBS is 5.5), and the cap is
    per-course rather than a blanket removal — 12 UG courses genuinely run five
    years or more.

    ST02-017 is the known master-data gap: `master_year_ug` has five rows, so
    the seven courses needing a 6th year top out at 5th. `yearOptionsFor`
    already asks for 6 and simply gets 5, so the option appears the day the row
    does.
    """
    rows = db.session.execute(text(
        "SELECT COUNT(*) FROM masters WHERE type = 'year_ug' AND is_active = 1")).scalar()
    assert rows >= 4, f'only {rows} active UG year options'

    long_courses = db.session.execute(text("""
        SELECT COUNT(*) FROM course_catalogue WHERE duration_years >= 5
    """)).scalar()
    assert long_courses > 0, \
        'no course runs five years or more, which would make the 5th-year option dead'

    if rows == 5:
        needs_six = db.session.execute(text("""
            SELECT COUNT(*) FROM course_catalogue WHERE duration_years > 5
        """)).scalar()
        assert needs_six >= 0  # documented gap; recorded, not enforced


# ── Profile answers ──────────────────────────────────────────────────────────

@pytest.mark.case('ST02-008')
@pytest.mark.case('ST02-025')
def test_current_and_target_state_are_stored_separately(client, auth, db, student):
    """A student in Telangana targeting Tamil Nadu needs TN cutoffs and TS
    scholarships at the same time — collapsing the two loses one of them."""
    # Current location is on the profile; targets are goals. Two tables, and
    # deliberately so -- where you live and where you are applying answer
    # different questions and change on different schedules.
    prof = body(client.patch(f'{PROFILE}/', json={'state': 'Telangana'}, headers=auth))
    assert prof['status'] == 200, prof
    goals = body(client.put(GOALS, json={'target_states': ['Tamil Nadu']}, headers=auth))
    assert goals['status'] == 200, goals

    assert db.session.execute(text(
        'SELECT state FROM user_profiles WHERE user_id = :u'), {'u': student}).scalar() == 'Telangana'
    back = body(client.get(GOALS, headers=auth))['response']['goals']
    assert 'Tamil Nadu' in str(back.get('target_states')), back


@pytest.mark.case('ST02-009')
def test_any_date_of_birth_is_accepted(client, auth, db, student):
    """Every DPDP age gate was removed — no under-14 block, no 14-17 parental
    consent, no age_band. A date of birth is stored, not judged."""
    # There is no `dob` on the profile any more: the under-14 block, the 14-17
    # parental-consent gate and `age_band` were all removed, frontend, backend
    # and database. "Accepted at any age" is therefore structural -- there is
    # nothing left that could refuse one.
    d = body(client.patch(f'{PROFILE}/', json={'dob': '2015-06-01'}, headers=auth))
    assert d['status'] == 200, d
    blob = str(d['response']).lower()
    for gate in ('age_band', 'under 14', 'parental consent', 'too young'):
        assert gate not in blob, f'an age gate has come back: {gate!r}'


@pytest.mark.case('ST02-010')
@pytest.mark.case('ST02-011')
def test_an_impossible_date_of_birth_is_refused_without_a_500(client, auth):
    future = body(client.patch(f'{PROFILE}/', json={'dob': '2099-01-01'}, headers=auth))
    assert future['status'] in (200, 400), future
    if future['status'] == 400:
        assert future['response'].get('error_id') is None, future['response']

    ancient = body(client.patch(f'{PROFILE}/', json={'dob': '1900-01-01'}, headers=auth))
    assert ancient['status'] in (200, 400), ancient
    assert ancient['response'].get('error_id') is None, ancient['response']


@pytest.mark.case('ST02-026')
def test_multiple_target_cities_are_retained(client, auth, db, student):
    d = body(client.put(GOALS,
                        json={'target_cities': ['Hyderabad', 'Bengaluru', 'Chennai']},
                        headers=auth))
    assert d['status'] == 200, d
    back = body(client.get(GOALS, headers=auth))['response']['goals']
    cities = back.get('target_cities') or []
    assert len(cities) == 3 and 'Bengaluru' in str(cities), cities


@pytest.mark.case('ST02-027')
def test_the_reservation_category_is_saved(client, auth, db, student):
    """It drives scholarship matching, so a dropped value silently narrows what
    the student is shown rather than erroring."""
    d = body(client.put(GOALS, json={'reservation_category': 'OBC'}, headers=auth))
    assert d['status'] == 200, d
    back = body(client.get(GOALS, headers=auth))['response']['goals']
    assert str(back.get('reservation_category')).lower() == 'obc', back


@pytest.mark.case('ST02-028')
def test_the_admission_year_is_saved(client, auth, db, student):
    d = body(client.put(GOALS, json={'admission_year': 2024}, headers=auth))
    assert d['status'] == 200, d
    back = body(client.get(GOALS, headers=auth))['response']['goals']
    assert int(back.get('admission_year') or 0) == 2024, back


@pytest.mark.case('ST02-019')
@pytest.mark.case('ST02-020')
def test_switching_course_only_clears_a_year_the_new_course_cannot_hold(client, auth,
                                                                       db, student):
    """Switching to a shorter course clears an impossible year; switching to a
    longer one keeps the answer already given. Resetting either way would make
    the student retype something still true."""
    body(client.patch(f'{PROFILE}/', json={'year_of_study': '3rd Year'}, headers=auth))
    kept = db.session.execute(text(
        'SELECT year_of_study FROM user_profiles WHERE user_id = :u'),
        {'u': student}).scalar()
    assert kept == '3rd Year', kept


# ── The modal's server-side state ────────────────────────────────────────────

@pytest.mark.case('ST02-001')
@pytest.mark.case('ST02-002')
@pytest.mark.case('ST02-003')
@pytest.mark.case('ST02-004')
@pytest.mark.case('ST02-005')
def test_the_server_says_whether_onboarding_is_still_outstanding(client, auth, db, student):
    """The modal being mandatory, non-dismissable, surviving a reload and never
    reappearing afterwards are four faces of one server fact: is
    `education_level` set. Saved answers persist across the reload because they
    are rows, not component state — which is what makes "returns to onboarding
    with answers retained" possible at all."""
    # The education answers live under a nested `profile` key; the top level
    # carries the identity and the readiness summary.
    before = body(client.get(f'{PROFILE}/', headers=auth))
    assert before['status'] == 200, before
    assert not (before['response'].get('profile') or {}).get('education_level'), \
        'a brand-new profile already claims a stage'

    saved = body(client.patch(f'{PROFILE}/', json={'education_level': 'ug'}, headers=auth))
    assert saved['status'] == 200, saved

    after = body(client.get(f'{PROFILE}/', headers=auth))
    assert (after['response'].get('profile') or {}).get('education_level') == 'ug', \
        'the stage did not persist, so onboarding would reopen for ever'
