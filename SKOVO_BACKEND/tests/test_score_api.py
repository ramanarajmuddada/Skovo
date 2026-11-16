"""
Score Engine — the HTTP layer.

test_score_engine.py covers the stored procedures; this covers the endpoints
every gate check actually calls. The Playbook (§9.4) names the cases that must
exist: pause activation with zero tokens remaining, and activation while a pause
is already running. Both are here.

Same isolation rule as the rest of the suite: a throwaway user per test, every
row keyed to that user and removed afterwards.
"""
import uuid

import pytest
from flask_jwt_extended import create_access_token
from sqlalchemy import text

BASE = '/v1/readiness'


@pytest.fixture
def client(app):
    return app.test_client()


@pytest.fixture
def auth(app):
    """Authorization header for a given user id."""
    def _auth(user_id):
        with app.app_context():
            token = create_access_token(identity=str(user_id))
        return {'Authorization': f'Bearer {token}'}
    return _auth


def body(resp):
    """Every endpoint answers {bool, status, response} — unwrap it."""
    payload = resp.get_json()
    assert payload is not None, f'no JSON body: {resp.data[:200]}'
    return payload


# ── GET /score ──────────────────────────────────────────────────────────────

def test_score_summary_for_new_user_is_zero(client, auth, user):
    r = client.get(f'{BASE}/score', headers=auth(user))
    assert r.status_code == 200
    d = body(r)
    assert d['bool'] is True
    assert d['response']['score'] == 0
    assert d['response']['level']


def test_score_summary_reflects_awarded_points(client, auth, user, award):
    award(user, 'community_join', ref_id=str(uuid.uuid4()))
    d = body(client.get(f'{BASE}/score', headers=auth(user)))
    assert d['response']['base_points'] > 0


def test_score_summary_exposes_breakdown_and_pause(client, auth, user, award):
    award(user, 'community_join', ref_id=str(uuid.uuid4()))
    res = body(client.get(f'{BASE}/score', headers=auth(user)))['response']

    assert isinstance(res['breakdown'], list)
    earned = [b for b in res['breakdown'] if b['event_type'] == 'community_join']
    assert earned and earned[0]['times'] == 1

    # The pause block is what the UI reads to decide whether to offer the token.
    assert {'max_tokens', 'used_this_year', 'pause_days', 'active_until'} <= set(res['pause'])


def test_score_endpoints_require_auth(client, user):
    for path in ('/score', '/score/events', '/score/unlocks', '/score/pause'):
        assert client.get(f'{BASE}{path}').status_code == 401


# ── GET /score/events ───────────────────────────────────────────────────────

def test_events_list_is_the_ledger(client, auth, user, award):
    award(user, 'community_join', ref_id=str(uuid.uuid4()))
    res = body(client.get(f'{BASE}/score/events', headers=auth(user)))['response']
    assert res['page'] == 1
    assert any(e['event_type'] == 'community_join' for e in res['events'])


def test_events_pagination_clamps_hostile_input(client, auth, user):
    """page<1 and an oversized per_page must not reach the database as-is."""
    res = body(client.get(f'{BASE}/score/events?page=0&per_page=9999',
                          headers=auth(user)))['response']
    assert res['page'] == 1                      # floor
    assert len(res['events']) <= 100             # ceiling


def test_events_bad_page_values_do_not_500(client, auth, user):
    r = client.get(f'{BASE}/score/events?page=-5&per_page=-1', headers=auth(user))
    assert r.status_code == 200


# ── GET /score/unlocks ──────────────────────────────────────────────────────

def test_unlocks_are_ordered_and_locked_for_a_new_user(client, auth, user):
    res = body(client.get(f'{BASE}/score/unlocks', headers=auth(user)))['response']

    assert res['score'] == 0
    keys = [u['key'] for u in res['unlocks']]
    assert 'opportunity_hub' in keys

    required = [u['required'] for u in res['unlocks']]
    assert required == sorted(required), 'gates must be listed nearest-first'

    assert all(u['unlocked'] is False for u in res['unlocks'])
    assert res['next'] is not None
    assert res['next']['points_away'] > 0


def test_unlocks_points_away_matches_the_gap(client, auth, user):
    res = body(client.get(f'{BASE}/score/unlocks', headers=auth(user)))['response']
    for u in res['unlocks']:
        assert u['points_away'] == max(0, u['required'] - res['score'])


def test_next_actions_are_routed_and_ranked(client, auth, user):
    res = body(client.get(f'{BASE}/score/unlocks', headers=auth(user)))['response']
    actions = res['next_actions']
    assert actions, 'a student on 0 must be told what to do'
    assert len(actions) <= 4

    for a in actions:
        assert a['route'].startswith('/')
        assert a['points_each'] > 0, 'zero-point signals waste the slot'

    ranked = [a['points_available'] for a in actions]
    assert ranked == sorted(ranked, reverse=True), 'biggest opportunity first'


def test_next_actions_never_suggest_the_locked_door(client, auth, user):
    """Applying to an opportunity is itself gated — suggesting it is circular."""
    res = body(client.get(f'{BASE}/score/unlocks', headers=auth(user)))['response']
    assert res['next'] is not None, 'precondition: this user is still locked'
    suggested = {a['event_type'] for a in res['next_actions']}
    assert 'application_submitted' not in suggested
    assert 'opportunity_shortlisted' not in suggested


def test_next_actions_drops_a_maxed_out_action(client, auth, user, award, rules):
    """Once a lifetime cap is spent the action stops being offered."""
    rule = rules.get('community_join')
    if not rule or (rule['cap_type'] or '').lower() != 'lifetime':
        pytest.skip('community_join is not lifetime-capped in this config')

    for _ in range(int(rule['cap_value'])):
        award(user, 'community_join', ref_id=str(uuid.uuid4()))

    res = body(client.get(f'{BASE}/score/unlocks', headers=auth(user)))['response']
    assert 'community_join' not in {a['event_type'] for a in res['next_actions']}


def test_next_actions_reports_remaining_uses(client, auth, user, award, rules):
    rule = rules.get('community_join')
    if not rule or (rule['cap_type'] or '').lower() != 'lifetime':
        pytest.skip('community_join is not lifetime-capped in this config')

    award(user, 'community_join', ref_id=str(uuid.uuid4()))
    res = body(client.get(f'{BASE}/score/unlocks', headers=auth(user)))['response']
    join = next((a for a in res['next_actions'] if a['event_type'] == 'community_join'), None)
    if join:
        assert join['done_already'] == 1
        assert join['remaining_uses'] == int(rule['cap_value']) - 1


# ── /score/pause ────────────────────────────────────────────────────────────

def test_pause_status_for_a_fresh_user(client, auth, user):
    res = body(client.get(f'{BASE}/score/pause', headers=auth(user)))['response']
    assert res['used_this_year'] == 0
    assert res['remaining'] == res['max_tokens']
    assert res['is_paused'] is False
    assert res['active_until'] is None


def test_activating_a_token_freezes_decay(client, auth, user):
    r = client.post(f'{BASE}/score/pause', headers=auth(user))
    assert body(r)['bool'] is True

    res = body(client.get(f'{BASE}/score/pause', headers=auth(user)))['response']
    assert res['is_paused'] is True
    assert res['active_until'] is not None
    assert res['used_this_year'] == 1
    assert res['remaining'] == res['max_tokens'] - 1


def test_cannot_activate_while_already_paused(client, auth, user):
    """Playbook §9.4 — the named edge case."""
    assert body(client.post(f'{BASE}/score/pause', headers=auth(user)))['bool'] is True

    second = client.post(f'{BASE}/score/pause', headers=auth(user))
    d = body(second)
    assert d['bool'] is False
    # The refusal rides in the envelope, not the HTTP status — `status` sits
    # beside `response`, not inside it.
    assert d['status'] == 400
    assert 'paused' in d['response']['message'].lower()


def test_cannot_activate_with_zero_tokens_remaining(client, auth, user, db, settings):
    """Playbook §9.4 — the other named edge case.

    Spend the yearly allowance, then clear the active window so the refusal can
    only be about the allowance and not about a pause still running.
    """
    max_tokens = int(settings.get('pause_tokens_per_year') or 2)

    for _ in range(max_tokens):
        assert body(client.post(f'{BASE}/score/pause', headers=auth(user)))['bool'] is True
        db.session.execute(text("""
            UPDATE score_pause_tokens
               SET ends_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 DAY)
             WHERE user_id = :u
        """), {'u': user})
        db.session.commit()

    status = body(client.get(f'{BASE}/score/pause', headers=auth(user)))['response']
    assert status['remaining'] == 0
    assert status['is_paused'] is False, 'precondition: nothing is currently running'

    refused = body(client.post(f'{BASE}/score/pause', headers=auth(user)))
    assert refused['bool'] is False
    assert refused['response']['used_this_year'] == max_tokens


def test_pause_protects_the_score_from_decay(client, auth, user, award, recalc, age_events):
    """The point of a token: an idle student keeps their points."""
    award(user, 'community_join', ref_id=str(uuid.uuid4()))
    before = int(recalc(user).get('score') or 0)

    assert body(client.post(f'{BASE}/score/pause', headers=auth(user)))['bool'] is True
    age_events(user, 30)                    # well past the 7-day grace window

    after = body(client.get(f'{BASE}/score', headers=auth(user)))['response']
    assert after['decay_points'] == 0, 'a paused score must not decay'
    assert after['score'] >= before


# ── Failure handling ────────────────────────────────────────────────────────
# A database fault must come back as the standard envelope with an error id, not
# a stack trace and not a 200 with a silently wrong score. These are the paths a
# student hits on the worst day the system has.

@pytest.fixture
def broken_db(monkeypatch):
    """Make every stored-procedure call raise."""
    def _explode(*_a, **_kw):
        raise RuntimeError('database is on fire')

    import portal.routes.Readiness.score as mod
    monkeypatch.setattr(mod, 'call_proc_one', _explode)
    monkeypatch.setattr(mod, 'call_proc', _explode)


@pytest.mark.parametrize('path', ['/score', '/score/events', '/score/unlocks', '/score/pause'])
def test_get_endpoints_fail_cleanly(client, auth, user, broken_db, path):
    r = client.get(f'{BASE}{path}', headers=auth(user))
    d = body(r)
    assert d['bool'] is False
    assert d['status'] == 500
    assert d['response']['error_id'], 'an error id is what makes a report traceable'
    assert 'fire' not in str(d), 'the internal reason must not reach the student'


def test_pause_activation_fails_cleanly(client, auth, user, broken_db):
    d = body(client.post(f'{BASE}/score/pause', headers=auth(user)))
    assert d['bool'] is False
    assert d['status'] == 500
    assert d['response']['error_id']


def test_unlocks_survives_a_broken_breakdown(client, auth, user, monkeypatch):
    """`next_actions` is advisory. If its query fails the gate list still ships.

    Losing the suggestions is a worse screen; losing the whole unlocks response
    would tell a student nothing about why they are locked out.
    """
    import portal.routes.Readiness.score as mod
    real = mod.call_proc

    def _fail_breakdown(name, *a, **kw):
        if name == 'sp_score_breakdown':
            raise RuntimeError('breakdown unavailable')
        return real(name, *a, **kw)

    monkeypatch.setattr(mod, 'call_proc', _fail_breakdown)

    d = body(client.get(f'{BASE}/score/unlocks', headers=auth(user)))
    assert d['bool'] is True
    assert d['response']['unlocks'], 'the gates must still be listed'
    assert d['response']['next_actions'] == []
