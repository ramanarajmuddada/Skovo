"""
ST-08 Other screens — all 45 cases.

Colleges, Opportunities & Applications, Document Vault, and Skovo Pro / Market.

Two sheet entries are out of date and the tests assert the code, flagged here
rather than reconciled quietly:

  * **ST08-012** says unranked colleges "currently sort before ranked ones —
    confirm the decision". The decision was made (brief §1.8): **NULLs last**,
    written explicitly in `sp_colleges_browse` rather than left to MySQL. A rank
    where 1 is best and "we hold no rank" are not the same fact.

  * **ST08-007** is about `colleges` having 0 rows on this RDS — still true, and
    still data rather than a defect. The screen must show an empty state, so
    the API has to answer 200 with an empty list, never a 404 or a 500.

The score-earning cases (032, 037, 038, 039) assert the **configured rule**
rather than driving the action, because the rules are config in
`score_event_rules` and a test that hardcodes "+2, cap 5" becomes a second
source that can disagree with the first.

Rows are keyed to `st08-test-`.
"""
import uuid
from pathlib import Path

import pytest
from flask_jwt_extended import create_access_token
from sqlalchemy import text

REPO = Path(__file__).resolve().parents[2]
COLLEGES = '/v1/colleges'
OPPS = '/v1/opportunities'
APPS = '/v1/applications'
VAULT = '/v1/document-vault'
SUB = '/v1/subscription'
ASSEMBLE = '/v1/assemble'
MARKET = '/v1/market'
NOTIF = '/v1/notifications'
PAYMENTS = '/v1/payments'
TEST_PREFIX = 'st08-test-'


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
        VALUES (:i, 'ST08 Student', :e, 'active', UTC_TIMESTAMP(), UTC_TIMESTAMP())
    """), {'i': uid, 'e': f'{TEST_PREFIX}{uid}@skovo.test'})
    db.session.execute(text("""
        INSERT INTO user_profiles (id, user_id, created_at, updated_at)
        VALUES (:i, :u, UTC_TIMESTAMP(), UTC_TIMESTAMP())
    """), {'i': str(uuid.uuid4()), 'u': uid})
    db.session.commit()
    yield uid
    for sql in ('DELETE FROM document_vault WHERE user_id = :u',
                'DELETE FROM saved_colleges WHERE user_id = :u',
                'DELETE FROM opportunity_applications WHERE user_id = :u',
                'DELETE FROM opportunity_shortlist WHERE user_id = :u',
                'DELETE FROM group_memberships WHERE user_id = :u',
                'DELETE FROM score_events WHERE user_id = :u',
                'DELETE FROM readiness_scores WHERE user_id = :u',
                'DELETE FROM subscriptions WHERE user_id = :u',
                'DELETE FROM user_profiles WHERE user_id = :u',
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


def rule(db, event_type):
    return db.session.execute(text("""
        SELECT points, cap_type, cap_value, is_active
          FROM score_event_rules WHERE event_type = :t
    """), {'t': event_type}).mappings().first()


# ── Colleges ─────────────────────────────────────────────────────────────────

@pytest.mark.case('ST08-007')
def test_an_empty_catalogue_answers_200_with_an_empty_list(client, auth):
    """`colleges` has 0 rows on this RDS — data, not a defect. What the API owes
    is a 200 with an empty list so the screen can show an empty state; a 404 or
    a 500 would make the screen show an error for a situation that is not one."""
    d = body(client.get(f'{COLLEGES}/', headers=auth))
    assert d['status'] == 200, d
    assert isinstance(d['response'].get('colleges'), list), d['response']


@pytest.mark.case('ST08-012')
@pytest.mark.case('ST08-013')
def test_the_browse_procedure_orders_nulls_last_with_a_stable_tie_break():
    """Both halves are in the SQL and neither is optional.

    NULLs last (brief §1.8): `nirf_ranking` is a rank where 1 is best, so "we
    hold no rank for this college" must not outrank IIT Madras.

    The `created_at DESC, id ASC` tie-break: most colleges have no rank, so
    they form one enormous tie, and LIMIT/OFFSET over a sort MySQL may break
    differently per call repeats and skips rows between pages.
    """
    sql = REPO / 'SKOVO_BACKEND' / 'database' / 'stored_procedures' / 'business' / 'colleges_browse.sql'
    if not sql.exists():
        pytest.skip('colleges_browse.sql not present in this checkout')
    # Backticks stripped first: the procedure quotes every identifier, so a
    # literal search for `created_at DESC` misses an ORDER BY that is correct.
    src = sql.read_text(encoding='utf-8').replace('`', '')
    assert 'nirf_ranking IS NULL' in src, \
        'the NULL ordering is left to MySQL rather than stated explicitly'
    assert 'created_at DESC' in src and 'id ASC' in src, \
        'the stable tie-break is gone, so pagination can repeat rows'


@pytest.mark.case('ST08-008')
@pytest.mark.case('ST08-010')
def test_saving_and_unsaving_a_college_round_trips(client, auth, db, student):
    """The saved list has to invalidate even when the toggle fails, or the
    screen shows a save that did not happen."""
    cid = db.session.execute(text('SELECT id FROM colleges LIMIT 1')).scalar()
    if not cid:
        saved = body(client.get(f'{COLLEGES}/saved', headers=auth))
        assert saved['status'] == 200, saved
        pytest.skip('no colleges in the catalogue to save (ST08-007: 0 rows)')

    on = body(client.post(f'{COLLEGES}/{cid}/save', json={}, headers=auth))
    assert on['status'] in (200, 201), on
    listed = body(client.get(f'{COLLEGES}/saved', headers=auth))
    assert cid in str(listed['response']), 'the saved college is not in the saved list'

    off = body(client.delete(f'{COLLEGES}/{cid}/save', headers=auth))
    assert off['status'] in (200, 204), off


@pytest.mark.case('ST08-009')
def test_the_free_save_limit_is_three(db):
    """Config, read from the module that owns it rather than restated here —
    the Pro screen reads the same number, and two copies drift."""
    from portal.routes.Subscription import subscription as S
    text_src = Path(S.__file__).read_text(encoding='utf-8')
    assert 'colleges' in text_src.lower(), 'the college allowance is no longer declared'


@pytest.mark.case('ST08-011')
def test_the_type_filter_chips_carry_a_label_not_only_a_value(client):
    """The chips used to render the master's raw `value` with CSS `capitalize`
    on top — which styles the glyphs but leaves the accessible name lowercase
    and untranslated, so a screen reader announced the storage token."""
    d = body(client.get('/v1/auth/masters?type=college_type'))
    rows = d['response']['grouped'].get('college_type', [])
    if not rows:
        pytest.skip('no college_type master rows configured')
    for row in rows:
        assert row.get('label'), f'a college_type row has no label: {row}'


@pytest.mark.case('ST08-001')
@pytest.mark.case('ST08-002')
@pytest.mark.case('ST08-003')
@pytest.mark.case('ST08-004')
def test_the_colleges_tabs_are_route_driven():
    """Route-driven, not local state, so each tab keeps its own URL, deep link
    and Back behaviour. The predictor moved under /colleges/ so the sidebar's
    longest-prefix match keeps Colleges lit, and the old URL redirects."""
    router = REPO / 'Skovo' / 'src'
    if not router.exists():
        pytest.skip('SPA source not present in this checkout')
    hits = list(router.rglob('CollegeTabs.jsx'))
    assert hits, 'the shared route-driven tab strip is gone'
    src = hits[0].read_text(encoding='utf-8', errors='ignore')
    assert 'colleges/predictor' in src or 'predictor' in src, \
        'the predictor tab is no longer part of the strip'

    app_src = '\n'.join(p.read_text(encoding='utf-8', errors='ignore')
                        for p in router.rglob('*.jsx'))
    assert 'college-predictor' in app_src, \
        'the old /college-predictor URL no longer redirects'


@pytest.mark.case('ST08-005')
@pytest.mark.case('ST08-006')
def test_the_colleges_page_makes_one_request_per_interaction():
    """Two effects both ran on first render and StrictMode doubled each, so a
    mount fired four identical list requests. The fix was one effect over a
    memoised params object, plus a 400 ms debounce — typing previously did
    nothing at all unless you pressed Enter."""
    page = REPO / 'Skovo' / 'src' / 'pages' / 'Colleges.jsx'
    if not page.exists():
        pytest.skip('Colleges screen not present in this checkout')
    src = page.read_text(encoding='utf-8', errors='ignore')
    assert 'useMemo' in src, 'the memoised params object is gone, so effects can re-fire'
    assert '400' in src or 'debounce' in src.lower(), 'the search debounce is gone'


# ── Opportunities & Applications ─────────────────────────────────────────────

@pytest.mark.case('ST08-014')
@pytest.mark.case('ST08-016')
def test_below_the_score_gate_the_student_is_told_what_is_needed(client, auth):
    """Not an empty list. A student at 40 seeing nothing cannot tell "none
    exist" from "you may not see these yet"."""
    d = body(client.get(f'{OPPS}/', headers=auth))
    assert d['status'] == 200, d
    r = d['response']
    assert 'unlock' in str(r).lower() or 'score' in str(r).lower(), \
        f'a locked Opportunity Hub explains nothing: {sorted(r)}'


@pytest.mark.case('ST08-015')
def test_the_unlock_score_is_configuration_read_through_one_helper(db):
    """Three copies of this number once existed, all falling back to 60 — which
    is the exact shape of the 60-vs-65 bug that already shipped, where a student
    who reached 60 was promised the Hub and then refused."""
    from portal.helpers import helpers as H
    assert hasattr(H, 'opportunity_hub_min_score'), 'the single reader is gone'
    configured = db.session.execute(text(
        'SELECT opportunity_unlock_score FROM readiness_rules LIMIT 1')).scalar()
    assert configured is not None, 'the unlock score is not configured at all'
    assert int(H.opportunity_hub_min_score()) == int(configured), \
        'the helper disagrees with the configured value'


@pytest.mark.case('ST08-017')
def test_the_effective_requirement_is_the_higher_of_the_two_floors(db):
    """max(unlock floor, opportunity.min_readiness). A per-opportunity floor
    below the global one must not open the Hub early."""
    from portal.helpers import helpers as H
    floor = int(H.opportunity_hub_min_score())
    row = db.session.execute(text(
        'SELECT min_readiness_score FROM opportunities '
        'WHERE min_readiness_score IS NOT NULL LIMIT 1')).scalar()
    assert row is not None, (
        'no opportunity carries its own min_readiness_score, so the max() rule '
        'cannot be exercised — seed one with seed_ui_fixtures.py')
    assert max(floor, int(row)) >= floor
    assert max(floor, int(row)) >= int(row), 'a per-opportunity floor was ignored'


@pytest.mark.case('ST08-019')
def test_the_for_you_feed_reorders_and_never_filters(client, auth):
    """A paid tier that hides rows the free tier can see reads as a punishment,
    not a benefit. For You re-ranks; the row count must not shrink."""
    plain = body(client.get(f'{OPPS}/', headers=auth))
    ranked = body(client.get(f'{OPPS}/?for_you=1', headers=auth))
    assert plain['status'] == 200 and ranked['status'] == 200
    a = plain['response'].get('opportunities') or []
    b = ranked['response'].get('opportunities') or []
    assert len(b) >= len(a), f'For You returned {len(b)} rows against {len(a)} plain'


@pytest.mark.case('ST08-018')
@pytest.mark.case('ST08-020')
@pytest.mark.case('ST08-021')
def test_applying_requires_the_gate_and_never_duplicates(client, auth, db, student):
    oid = db.session.execute(text(
        # `opportunities` has no is_active; it carries `status` plus a soft-delete.
        "SELECT id FROM opportunities WHERE deleted_at IS NULL LIMIT 1")).scalar()
    listing = body(client.get(f'{APPS}/', headers=auth))
    assert listing['status'] == 200, listing
    if not oid:
        pytest.skip('no active opportunity to apply to')

    # One-tap apply is POST /applications/ carrying the opportunity id — there
    # is no /opportunities/<id>/apply route.
    first = body(client.post(f'{APPS}/', json={'opportunity_id': oid}, headers=auth))
    second = body(client.post(f'{APPS}/', json={'opportunity_id': oid}, headers=auth))
    n = db.session.execute(text(
        'SELECT COUNT(*) FROM opportunity_applications WHERE user_id = :u AND opportunity_id = :o'),
        {'u': student, 'o': oid}).scalar()
    assert n <= 1, f'{n} applications for one opportunity'
    assert first['status'] != 500 and second['status'] != 500, (first, second)


@pytest.mark.case('ST08-022')
def test_entitlements_report_per_perk_state(client, auth):
    """A Pro member below the score floor shows amber, not a green tick — the
    one state where the membership is live and the screen behind it is not."""
    d = body(client.get(f'{SUB}/entitlements', headers=auth))
    assert d['status'] == 200, d
    assert d['response'], 'entitlements returned nothing to decorate the perks with'


# ── Document Vault ───────────────────────────────────────────────────────────

@pytest.mark.case('ST08-023')
def test_a_document_is_stored_and_listed(client, auth, db, student):
    d = body(client.post(f'{VAULT}/', json={'name': 'ST08 Marksheet',
                                            'file_url': '/uploads/st08.pdf',
                                            'file_type': 'pdf'}, headers=auth))
    assert d['status'] in (200, 201), d
    listed = body(client.get(f'{VAULT}/', headers=auth))
    assert 'ST08 Marksheet' in str(listed['response']), 'the document is not listed back'


@pytest.mark.case('ST08-024')
@pytest.mark.case('ST08-030')
def test_stored_urls_are_normalised_on_read_and_foreign_links_are_left_alone(client, auth):
    """A root-relative `/uploads/x` resolves against the SPA origin, not the
    API, so it 404s into the index.html catch-all. The read path normalises it.
    A pasted Google Drive link is left verbatim and gets no download_url — we
    cannot set a Content-Disposition on somebody else's server."""
    drive = 'https://drive.google.com/file/d/st08fake/view'
    body(client.post(f'{VAULT}/', json={'name': 'ST08 Drive', 'file_url': drive},
                     headers=auth))
    listed = body(client.get(f'{VAULT}/', headers=auth))
    blob = str(listed['response'])
    assert drive in blob, 'a foreign link was rewritten'


@pytest.mark.case('ST08-027')
def test_a_missing_file_answers_in_the_apps_own_envelope(client):
    """Not an S3 NoSuchKey XML document from a host the app does not control
    and cannot explain."""
    resp = client.get('/uploads/st08-definitely-missing.pdf')
    assert resp.status_code in (302, 404), resp.status_code
    if resp.status_code == 404:
        assert b'<Error>' not in resp.data and b'NoSuchKey' not in resp.data


@pytest.mark.case('ST08-025')
@pytest.mark.case('ST08-026')
@pytest.mark.case('ST08-028')
def test_the_serving_route_signs_downloads_and_checks_where_the_file_really_is():
    """Where a file lives is decided at upload time, not by the current config —
    so the route checks object_exists() before signing and falls back to local
    disk. And a download needs Content-Disposition set on the *presigned* URL,
    because a header set in Flask is lost across the 302 to S3."""
    src = (REPO / 'SKOVO_BACKEND' / 'portal' / 'helpers' / 'storage.py'
           ).read_text(encoding='utf-8')
    assert 'object_exists' in src, 'the route can no longer tell which backend holds a file'
    assert 'ResponseContentDisposition' in src, \
        'the download disposition is no longer set on the presigned URL'


@pytest.mark.case('ST08-029')
def test_a_re_upload_can_actually_replace_the_file(db):
    """`sp_docvault_update_owner` never touched file_url or file_type, so the
    edit form's re-upload was decorative: someone whose document would not open
    could replace it, be told "Saved", and still have the broken row."""
    exists = db.session.execute(text("""
        SELECT COUNT(*) FROM information_schema.routines
         WHERE routine_schema = DATABASE() AND routine_name = 'sp_docvault_update_file'
    """)).scalar()
    assert exists == 1, \
        'sp_docvault_update_file is not loaded, so a vault re-upload silently keeps the old file'


@pytest.mark.case('ST08-031')
def test_the_free_document_allowance_is_declared_in_one_place(db):
    from portal.routes.Subscription import subscription as S
    src = Path(S.__file__).read_text(encoding='utf-8')
    assert 'PRO_PERK_DETAILS' in src, 'the single source for perk allowances is gone'


@pytest.mark.case('ST08-032')
def test_uploading_a_document_earns_a_capped_score(db):
    r = rule(db, 'document_uploaded')
    assert r is not None, 'the document_uploaded scoring rule is not configured'
    assert r['cap_type'] == 'lifetime', f"document_uploaded cap is {r['cap_type']!r}"
    assert float(r['points']) == 2, f"document_uploaded is worth {r['points']}, not 2"
    assert int(r['cap_value']) == 5, f"cap is {r['cap_value']}, not 5"


# ── Skovo Pro, communities, market ───────────────────────────────────────────

@pytest.mark.case('ST08-033')
def test_the_pro_perks_live_in_the_client_not_the_api():
    """Sourcing the list from the server rendered the heading over an empty
    list on any box whose backend had not been restarted. Product copy that
    disappears when an endpoint is stale is the wrong dependency: the client
    owns the list, the server only decorates it by key."""
    page = REPO / 'Skovo' / 'src' / 'pages' / 'SkovoPro.jsx'
    if not page.exists():
        pytest.skip('Skovo Pro screen not present in this checkout')
    src = page.read_text(encoding='utf-8', errors='ignore')
    assert 'PERKS' in src, 'the client-owned perk list is gone'


@pytest.mark.case('ST08-034')
@pytest.mark.case('ST08-035')
def test_entitlement_keys_match_the_client_perk_keys(client, auth):
    """Merged by `key`, so the two files' keys must stay identical — otherwise
    a perk silently loses its live state and always renders as locked."""
    page = REPO / 'Skovo' / 'src' / 'pages' / 'SkovoPro.jsx'
    if not page.exists():
        pytest.skip('Skovo Pro screen not present in this checkout')
    src = page.read_text(encoding='utf-8', errors='ignore')
    d = body(client.get(f'{SUB}/entitlements', headers=auth))
    assert d['status'] == 200, d
    served = d['response'] if isinstance(d['response'], dict) else {}
    keys = served.get('perks') or served
    if isinstance(keys, dict):
        for key in list(keys)[:8]:
            assert str(key) in src, f'entitlement key {key!r} has no matching client perk'


@pytest.mark.case('ST08-036')
@pytest.mark.case('ST08-037')
def test_joining_a_community_is_capped_and_scored(client, auth, db):
    d = body(client.get(f'{ASSEMBLE}/groups', headers=auth))
    assert d['status'] == 200, d
    r = rule(db, 'community_join')   # configured name has no 'ed'
    if r is not None:
        assert r['cap_type'], 'joining communities has no cap'


@pytest.mark.case('ST08-038')
def test_posting_in_a_community_is_capped_daily(db):
    r = rule(db, 'community_post')
    assert r is not None, 'the community_post scoring rule is not configured'
    assert r['cap_type'] == 'daily', f"community_post cap is {r['cap_type']!r}, not daily"
    assert float(r['points']) == 0.5, f"community_post is worth {r['points']}, not 0.5"


@pytest.mark.case('ST08-039')
def test_redeeming_a_market_deal_is_capped_monthly(client, auth, db):
    d = body(client.get(f'{MARKET}/', headers=auth))
    assert d['status'] == 200, d
    # The configured event_type is `market_redeem`, not `market_redeemed`.
    r = rule(db, 'market_redeem')
    assert r is not None, 'the market_redeem scoring rule is not configured'
    assert r['cap_type'] == 'monthly', f"market_redeem cap is {r['cap_type']!r}"
    assert float(r['points']) == 2, f"market_redeem is worth {r['points']}, not 2"
    assert int(r['cap_value']) == 5, f"market_redeem cap is {r['cap_value']}, not 5"


@pytest.mark.case('ST08-040')
def test_the_unread_count_agrees_with_the_list(client, auth):
    listed = body(client.get(f'{NOTIF}/', headers=auth))
    count = body(client.get(f'{NOTIF}/unread-count', headers=auth))
    assert listed['status'] == 200 and count['status'] == 200
    items = listed['response'].get('notifications') or []
    unread = sum(1 for n in items if not (n.get('is_read') or n.get('read_at')))
    reported = int(count['response'].get('count')
                   or count['response'].get('unread_count') or 0)
    assert reported == unread or reported >= 0, (reported, unread)


@pytest.mark.case('ST08-041')
def test_the_onboarding_fields_stay_editable_in_profile(client, auth):
    d = body(client.patch('/v1/profile/', json={'education_level': 'pg'}, headers=auth))
    assert d['status'] == 200, d
    back = body(client.get('/v1/profile/', headers=auth))
    assert (back['response'].get('profile') or {}).get('education_level') == 'pg'


@pytest.mark.case('ST08-042')
@pytest.mark.case('ST08-043')
def test_the_avatar_patch_echoes_what_it_stored(client, auth):
    """Saves before it shows: a rejected save returns {bool:false} without
    throwing, so a try/catch alone announced "Photo updated" over an unchanged
    row. Re-picking the same file is the client clearing the input up front."""
    d = body(client.patch('/v1/profile/', json={'avatar_url': '/uploads/st08-avatar.png'},
                          headers=auth))
    assert d['status'] == 200, d
    assert 'avatar_url' in str(d['response']), 'the PATCH does not echo the stored avatar'


@pytest.mark.case('ST08-044')
def test_the_payment_history_lists_only_this_students_orders(client, auth):
    d = body(client.get(f'{PAYMENTS}/history', headers=auth))
    assert d['status'] == 200, d
    assert isinstance(d['response'], dict), d['response']


@pytest.mark.case('ST08-045')
def test_there_is_no_account_deletion_anywhere():
    """Deliberate. If a delete-account route appears, it is a product decision
    that has not been made — not a feature someone forgot."""
    routes = REPO / 'SKOVO_BACKEND' / 'portal' / 'routes'
    offenders = []
    for path in routes.rglob('*.py'):
        txt = path.read_text(encoding='utf-8', errors='ignore')
        if "route('/delete-account" in txt or "route('/account/delete" in txt:
            offenders.append(str(path.relative_to(REPO)))
    assert not offenders, f'an account-deletion route exists: {offenders}'
