"""Readiness Score Playbook v2.1 -- the Score Engine.

This module is the ONLY writer of readiness points (playbook rule 9). Routes,
jobs, n8n and BhaAI call into it; none of them touches score_events directly.

    card score = earned (three pillar buckets, max 70) + completion (max 30)

Write path for one checked piece of work (playbook C3):
    active card -> action on this card? -> action limit -> pillar bucket
    -> monthly cap in card months 1-3 (the rest is saved, never lost)
    -> card earned score -> Readiness Index / Active Ready

Streak Points (the habit book) live in streak_points.py and never call in here.
Every number comes from readiness_settings / score_actions / card_pillar_config /
completion_bands, which the admin edits. SQL: database/stored_procedures/readiness_v21.sql.
The caller commits.
"""
import calendar
import datetime
import json
import logging
import uuid

from portal.helpers.sp import call_proc, call_proc_one

logger = logging.getLogger("skovo")

CARD_ORDER = ('class10', 'inter', 'degree_foundation', 'degree_readiness', 'skill')
CARD_LABELS = {'class10': 'Class 10', 'inter': 'Intermediate', 'degree_foundation': 'Degree Foundation',
               'degree_readiness': 'Degree Readiness', 'skill': 'Skill Card'}
PILLARS = ('clarity', 'skill', 'proof')
# A new card opens a stage row with this stage group / year (admin transition, Skill Card).
CARD_STAGE = {'class10': ('class_10', None), 'inter': ('intermediate', '1'),
              'degree_foundation': ('ug', '1'), 'degree_readiness': ('ug', '3'), 'skill': ('ug', 'graduate')}
DEGREE_GROUPS = ('ug', 'polytechnic', 'iti')


# ── small helpers ────────────────────────────────────────────────────────────

def utcnow():
    return datetime.datetime.utcnow().replace(microsecond=0)


def _int(v, default=0):
    try:
        return int(v)
    except (TypeError, ValueError):
        return default


def _json(v, default):
    if v is None:
        return default
    if isinstance(v, (list, dict)):
        return v
    try:
        return json.loads(v)
    except (TypeError, ValueError):
        return default


def add_months(d, n):
    m = d.month - 1 + n
    y, m = d.year + m // 12, m % 12 + 1
    return d.replace(year=y, month=m, day=min(d.day, calendar.monthrange(y, m)[1]))


def card_month(started_at, at=None):
    """(n, window_start, window_end): card month n (1-based) counted from the
    day the card started, so mid-stage joiners get the same 3-month rule."""
    at = at or utcnow()
    n = 1
    start = started_at
    end = add_months(started_at, 1)
    while end <= at:
        n, start, end = n + 1, end, add_months(started_at, n + 1)
    return n, start, end


def card_type_for(stage_group, sub_year):
    """Stage row -> Journey Card. Inter 1st + 2nd year share one card; degree
    years 1-2 are Degree Foundation, 3+ Degree Readiness."""
    if stage_group == 'class_10':
        return 'class10'
    if stage_group == 'intermediate':
        return 'inter'
    if stage_group in DEGREE_GROUPS:
        if str(sub_year or '').lower() == 'graduate':
            return 'skill'
        return 'degree_readiness' if _int(sub_year, 1) >= 3 else 'degree_foundation'
    return None


def stage_badge(card_type, sub_year):
    """'Inter 1st yr', 'B.Tech Y3'... -- shown on leaderboards instead of an age."""
    y = _int(sub_year, 0)
    if card_type == 'class10':
        return 'Class 10'
    if card_type == 'inter':
        return f"Inter {'1st' if y <= 1 else '2nd'} yr"
    if card_type in ('degree_foundation', 'degree_readiness'):
        return f"Degree Y{y or (1 if card_type == 'degree_foundation' else 3)}"
    if card_type == 'skill':
        return 'Graduate'
    return None


def settings():
    return call_proc_one('sp_rv_settings_get') or {}


def enabled():
    return bool(settings().get('v21_enabled'))


def buckets(card_type):
    rows = call_proc('sp_rv_buckets_list') or []
    return {r['pillar']: _int(r['bucket_size']) for r in rows if r['card_type'] == card_type}


def level_for(score, s=None):
    s = s or settings()
    score = float(score or 0)
    if score >= _int(s.get('premium_score'), 65):
        return 'skovo_ready'
    if score >= _int(s.get('unlock_score'), 60):
        return 'unlocked'
    if score >= 40:
        return 'building'
    return 'getting_started'


# ── cards ────────────────────────────────────────────────────────────────────

def active_card(user_id):
    return call_proc_one('sp_rv_card_active', user_id)


def attach_card(user_id):
    """Make sure the student's active stage row carries its Journey Card.
    Never raises: a card problem must not fail a profile save."""
    try:
        st = call_proc_one('sp_stage_get_active', user_id)
        if not st:
            return None
        ct = card_type_for(st.get('stage_group'), st.get('sub_year'))
        if ct and st.get('card_type') != ct:
            expires = None
            if ct == 'skill':
                expires = add_months(utcnow(), _int(settings().get('skill_card_months'), 12))
            st = call_proc_one('sp_rv_card_set_type', st['id'], ct, 'worked', expires)
        return st
    except Exception as e:                                   # noqa: BLE001
        logger.error(f"readiness_v21.attach_card({user_id}) failed: {e}")
        return None


def needs_new_card(current_stage, group, sub_year):
    """Same stage group but a different card (degree Y2 -> Y3): open a new card."""
    if not current_stage:
        return False
    old = current_stage.get('card_type') or card_type_for(current_stage.get('stage_group'),
                                                          current_stage.get('sub_year'))
    new = card_type_for(group, sub_year)
    return bool(old and new and old != new)


def pillar_state(card):
    """{pillar: {'bucket', 'applied', 'saved', 'room'}} for one card."""
    sizes = buckets(card['card_type'])
    used = {r['pillar']: r for r in (call_proc('sp_rv_card_pillars', card['id']) or [])}
    out = {}
    for p in PILLARS:
        a = _int((used.get(p) or {}).get('applied'))
        sv = _int((used.get(p) or {}).get('saved'))
        b = sizes.get(p, 0)
        out[p] = {'bucket': b, 'applied': min(a, b), 'saved': sv, 'room': max(0, b - a - sv)}
    return out


def recompute_card(card_id):
    card = call_proc_one('sp_rv_card_get', card_id)
    if not card or not card.get('card_type'):
        return card
    earned = sum(v['applied'] for v in pillar_state(card).values())
    return call_proc_one('sp_rv_card_save', card_id, earned, None, None, None, None, None)


def refresh_index(user_id, s=None):
    """Readiness Index = average card score of finished cards the student worked
    on; until one is finished, the current card's score. Past-result cards never count."""
    s = s or settings()
    cards = call_proc('sp_rv_cards_for_user', user_id) or []
    active = next((c for c in cards if c['status'] == 'active'), None)
    finished = [float(c['card_score'] or 0) for c in cards
                if c['status'] in ('closed', 'expired') and c.get('card_kind') == 'worked']
    if finished:
        index = round(sum(finished) / len(finished), 2)
    else:
        index = float(active['card_score'] or 0) if active else 0
    last = (call_proc_one('sp_rv_last_checked_work', user_id) or {}).get('at')
    days = _int(s.get('active_ready_days'), 30)
    ready = bool(active and float(active.get('earned_score') or 0) >= _int(s.get('unlock_score'), 60)
                 and last and last >= utcnow() - datetime.timedelta(days=days))
    return call_proc_one('sp_rv_index_set', user_id, active['id'] if active else None, index,
                         1 if ready else 0, last)


# ── the write path ───────────────────────────────────────────────────────────

def _limit_reached(card, action, now):
    lt, lv = action.get('limit_type'), action.get('limit_value')
    if lt == 'each' or lv is None:
        return False
    since = card['started_at']
    if lt == 'per_month':
        since = card_month(card['started_at'], now)[1]
    n = _int((call_proc_one('sp_rv_card_action_count', card['id'], action['action_key'], since) or {}).get('n'))
    return n >= _int(lv)


def _cap(points, action, s):
    top = _int(s.get('max_employer_points'), 8) if action.get('is_employer') else _int(s.get('max_action_points'), 5)
    return max(0, min(points, top))


def award(user_id, action_key, ref_id, *, mark=None, source='app', actor_id=None, verification_id=None,
          card_id=None, weight=1.0, meta=None):
    """Add readiness points for one piece of checked work.

    Idempotent on (user, action, ref_id). Returns
    {'result': 'applied' | 'saved' | 'split' | 'capped' | 'limit' | 'duplicate'
               | 'no_card' | 'not_on_card' | 'off', 'applied': n, 'saved': n, 'release_at': ...}
    """
    s = settings()
    now = utcnow()
    card = call_proc_one('sp_rv_card_get', card_id) if card_id else active_card(user_id)
    if not card or card.get('status') != 'active' or not card.get('card_type'):
        return {'result': 'no_card'}
    action = call_proc_one('sp_rv_action_get', action_key)
    if not action or not action.get('is_active') or card['card_type'] not in _json(action.get('card_types'), []):
        return {'result': 'not_on_card'}
    if _limit_reached(card, action, now):
        return {'result': 'limit'}

    points = _int(action['points'])
    if action.get('bonus_points') is not None and mark is not None and _int(mark) >= _int(action.get('bonus_min_mark'), 11):
        points = _int(action['bonus_points'])
    points = _cap(int(round(points * float(weight or 1))), action, s)

    pillar = action['pillar']
    room = pillar_state(card)[pillar]['room']
    fit = min(points, room)
    version = _int(s.get('config_version'), 1)
    ref = str(ref_id)
    meta_txt = json.dumps({**(meta or {}), 'asked': points, 'mark': mark})

    def add(points_, status, release, suffix=''):
        r = call_proc_one('sp_rv_event_add', str(uuid.uuid4()), user_id, card['id'], action_key, pillar, points_,
                          status, release, ref + suffix, verification_id, source, actor_id, version, meta_txt)
        return _int((r or {}).get('inserted'))

    if fit <= 0:
        ok = add(0, 'capped', None)
        if ok:
            refresh_index(user_id, s)
        return {'result': 'capped' if ok else 'duplicate', 'applied': 0, 'saved': 0}

    applied, saved, release = fit, 0, None
    n, _, end = card_month(card['started_at'], now)
    if card['card_type'] != 'skill' and n <= _int(s.get('cap_months'), 3):
        used = _int((call_proc_one('sp_rv_card_window_points', card['id'], card_month(card['started_at'], now)[1], end) or {}).get('points'))
        allow = max(0, _int(s.get('monthly_cap'), 20) - used)
        applied, saved, release = min(fit, allow), fit - min(fit, allow), end

    if applied > 0:
        if not add(applied, 'applied', None):
            return {'result': 'duplicate'}
        if saved > 0:
            add(saved, 'saved', release, ':saved')
    else:
        if not add(saved, 'saved', release):
            return {'result': 'duplicate'}
    recompute_card(card['id'])
    refresh_index(user_id, s)
    result = 'split' if applied and saved else ('saved' if saved else 'applied')
    return {'result': result, 'applied': applied, 'saved': saved,
            'release_at': release.isoformat() if saved and release else None, 'pillar': pillar}


def release_saved(now=None):
    """Nightly: apply saved points whose card month has arrived, within that
    month's limit. Anything that still does not fit moves to the next month."""
    now = now or utcnow()
    s = settings()
    cap, cap_months = _int(s.get('monthly_cap'), 20), _int(s.get('cap_months'), 3)
    touched, released = set(), 0
    for ev in call_proc('sp_rv_events_due', now) or []:
        card = call_proc_one('sp_rv_card_get', ev['card_id'])
        if not card:
            continue
        n, start, end = card_month(card['started_at'], now)
        pts = _int(ev['points'])
        allow = pts
        if card['card_type'] != 'skill' and n <= cap_months:
            used = _int((call_proc_one('sp_rv_card_window_points', card['id'], start, end) or {}).get('points'))
            allow = max(0, min(pts, cap - used))
        if allow <= 0:
            call_proc_one('sp_rv_event_settle', ev['id'], pts, 'saved', end)
            continue
        call_proc_one('sp_rv_event_settle', ev['id'], allow, 'applied', now)
        if pts - allow > 0:
            call_proc_one('sp_rv_event_add', str(uuid.uuid4()), ev['user_id'], card['id'], ev['event_type'],
                          ev['pillar'], pts - allow, 'saved', end, f"{ev.get('ref_id')}:r{n}",
                          ev.get('verification_id'), 'system', None, ev.get('config_version'), ev.get('meta'))
        released += allow
        touched.add((card['id'], ev['user_id']))
    for card_id, user_id in touched:
        recompute_card(card_id)
        refresh_index(user_id, s)
    return {'released_points': released, 'cards': len(touched)}


def correction(user_id, card_id, pillar, points, reason, admin_id):
    """Recorded admin correction (playbook B4). Bypasses the monthly cap, never the buckets."""
    if pillar not in PILLARS or not reason:
        return {'result': 'invalid'}
    card = call_proc_one('sp_rv_card_get', card_id)
    if not card or card.get('user_id') != user_id:
        return {'result': 'no_card'}
    call_proc_one('sp_rv_event_add', str(uuid.uuid4()), user_id, card_id, 'correction', pillar, _int(points),
                  'applied', None, f"corr:{uuid.uuid4()}", None, 'admin', admin_id,
                  _int(settings().get('config_version'), 1), json.dumps({'reason': reason}))
    recompute_card(card_id)
    refresh_index(user_id)
    return {'result': 'applied'}


# ── completion (the last 30) ─────────────────────────────────────────────────

def _bands():
    return call_proc('sp_rv_bands_list') or []


def band_from_grade(raw, board=None):
    """'O' / 'B+' / '68%' -> band key, or None when it cannot be read."""
    raw = str(raw or '').strip()
    if not raw:
        return None
    if board:
        for g in call_proc('sp_rv_grades_list') or []:
            if g['board_or_university'] == board and g['raw_grade'].lower() == raw.lower():
                return g['band']
    bands = _bands()
    for b in bands:
        if raw.upper() in [x.upper() for x in _json(b.get('university_grades'), [])]:
            return b['band']
    try:
        pct = float(raw.rstrip('%'))
    except ValueError:
        return None
    for b in sorted([b for b in bands if not b.get('is_pending') and b.get('min_percent') is not None],
                    key=lambda b: -float(b['min_percent'])):
        if pct >= float(b['min_percent']):
            return b['band']
    return None


def apply_result(card_id, band, actor_id, doc_id=None):
    """Desk confirmed a result band (or a Skill Card offer, band='offer').
    Pending for fails; boost one band up at 65+ earned; a newer result only ever raises it."""
    s = settings()
    card = call_proc_one('sp_rv_card_get', card_id)
    if not card:
        return {'result': 'no_card'}
    if card['card_type'] == 'skill':
        if band != 'offer':
            return {'result': 'invalid'}
        pts, status, boost = _int(s.get('completion_max'), 30), 'awarded', 0
    else:
        ordered = sorted(_bands(), key=lambda b: _int(b['sort_order']))
        row = next((b for b in ordered if b['band'] == band), None)
        if not row:
            return {'result': 'invalid'}
        if row.get('is_pending'):
            if card.get('completion_status') == 'awarded':
                return {'result': 'kept', 'points': _int(card['completion_points'])}
            call_proc_one('sp_rv_card_save', card_id, None, 'pending', band, 0, 0, doc_id)
            refresh_index(card['user_id'], s)
            return {'result': 'pending', 'points': 0}
        passing = [b for b in ordered if not b.get('is_pending')]
        i = passing.index(row)
        boost = 0
        if card.get('card_kind') == 'worked' and float(card.get('earned_score') or 0) >= _int(s.get('boost_threshold'), 65):
            j = max(0, i - _int(s.get('boost_bands'), 1))
            boost = 1 if j != i else 0
            row = passing[j]
        pts, status = min(_int(row['points']), _int(s.get('completion_max'), 30)), 'awarded'
    if card.get('completion_status') == 'awarded' and pts <= _int(card.get('completion_points')):
        return {'result': 'kept', 'points': _int(card['completion_points'])}
    call_proc_one('sp_rv_card_save', card_id, None, status, band, boost, pts, doc_id)
    call_proc_one('sp_rv_event_add', str(uuid.uuid4()), card['user_id'], card_id, 'completion', None, pts,
                  'applied', None, f"completion:{band}:{doc_id or ''}", None, 'admin', actor_id,
                  _int(s.get('config_version'), 1), json.dumps({'band': band, 'boost': boost}))
    if card['card_type'] == 'skill':
        call_proc_one('sp_rv_card_close', card_id, 'closed', actor_id, 'placed')
        try:
            from portal.helpers.notifications import notify_user
            notify_user(card['user_id'], 'Congratulations on your job!',
                        'Your Skill Card is complete. You are invited to become an Achiever on Skovo.',
                        type='system', reference_type='readiness')
        except Exception as e:                                # noqa: BLE001
            logger.warning(f"achiever invite notify failed: {e}")
    refresh_index(card['user_id'], s)
    return {'result': 'awarded', 'points': pts, 'boost': bool(boost)}


# ── card transitions ─────────────────────────────────────────────────────────

def transition(user_id, card_type, actor_id, reason='stage changed'):
    """Close the active card for earning and open the next one at 0."""
    if card_type not in CARD_ORDER:
        return {'result': 'invalid'}
    cur = call_proc_one('sp_stage_get_active', user_id) or {}
    group, sub_year = CARD_STAGE[card_type]
    details = (sub_year, cur.get('education_category'), cur.get('board'), cur.get('stream'),
               cur.get('degree_category'), cur.get('degree_type'), cur.get('branch'),
               cur.get('institute'), cur.get('state'))
    if cur:
        res = call_proc_one('sp_stage_promote', str(uuid.uuid4()), user_id, group, *details, actor_id, reason) or {}
    else:
        call_proc_one('sp_stage_open', str(uuid.uuid4()), user_id, group, *details, None)
        res = {}
    card = attach_card(user_id)
    refresh_index(user_id)
    return {'result': 'opened', 'card_id': (card or {}).get('id'), 'closed_card_id': res.get('closed_stage_id')}


def add_past_result_card(user_id, card_type):
    """An earlier stage for a student who joined later: completed only by its result."""
    if card_type not in CARD_ORDER or card_type == 'skill':
        return None
    return call_proc_one('sp_rv_card_add_past', str(uuid.uuid4()), user_id, card_type, CARD_STAGE[card_type][0])


# ── evidence and the verification queue ──────────────────────────────────────

ROUTE = {'achiever': 'achiever', 'employer': 'employer'}


def submit_evidence(user_id, action_key, *, doc_id=None, url=None, note=None, idempotency_key=None, card_id=None):
    """Student proof -> a check request. Points come only on approval (rule 3)."""
    card = call_proc_one('sp_rv_card_get', card_id) if card_id else active_card(user_id)
    if not card or not card.get('card_type'):
        return {'result': 'no_card'}
    action = call_proc_one('sp_rv_action_get', action_key)
    if not action or not action.get('is_active') or card['card_type'] not in _json(action.get('card_types'), []):
        return {'result': 'not_on_card'}
    if action.get('checked_by') == 'app':
        return {'result': 'app_checked'}
    idem = idempotency_key or f"{user_id}:{action_key}:{doc_id or url or uuid.uuid4()}"
    row = call_proc_one('sp_rv_verif_create', str(uuid.uuid4()), user_id, card['id'], action_key, 'evidence',
                        doc_id, url, note, ROUTE.get(action.get('checked_by'), 'desk'), idem[:80], None)
    return {'result': 'queued', 'request': row}


def submit_result(user_id, card_id, *, doc_id=None, url=None, raw_grade=None, board=None, kind='result'):
    """Result card / marks memo (or a Skill Card offer letter) for the desk."""
    card = call_proc_one('sp_rv_card_get', card_id)
    if not card or card.get('user_id') != user_id:
        return {'result': 'no_card'}
    auto = {'raw_grade': raw_grade, 'board': board, 'suggested_band': band_from_grade(raw_grade, board)}
    key = 'job_offer' if card['card_type'] == 'skill' else 'stage_result'
    row = call_proc_one('sp_rv_verif_create', str(uuid.uuid4()), user_id, card_id, key,
                        'offer' if card['card_type'] == 'skill' else kind, doc_id, url, None, 'desk',
                        f"{user_id}:{key}:{doc_id or url or uuid.uuid4()}"[:80], json.dumps(auto))
    return {'result': 'queued', 'request': row}


def decide(request_id, approve, reviewer_id, *, mark=None, feedback=None, reason=None, band=None, source='admin'):
    """Approve or reject a check request. Approval is what adds the points."""
    s = settings()
    vr = call_proc_one('sp_rv_verif_get', request_id)
    if not vr:
        return {'result': 'not_found'}
    if vr['status'] not in ('pending', 'held'):
        return {'result': 'already_decided', 'status': vr['status']}
    if approve and vr['kind'] == 'result' and not band:
        return {'result': 'band_required'}
    if approve and vr['kind'] == 'evidence' and vr['route_to'] == 'achiever':
        if mark is None:
            return {'result': 'mark_required'}
        if _int(mark) < _int(s.get('pass_mark'), 5):
            approve, reason = False, reason or 'Below the pass mark'
    status = 'approved' if approve else 'rejected'
    call_proc_one('sp_rv_verif_decide', request_id, status, reviewer_id, mark, feedback, reason)
    out = {'result': status}
    if approve:
        if vr['kind'] in ('result', 'offer'):
            out['score'] = apply_result(vr['card_id'], 'offer' if vr['kind'] == 'offer' else band, reviewer_id,
                                        vr.get('evidence_doc_id'))
        else:
            out['score'] = award(vr['user_id'], vr['action_key'], vr['id'], mark=mark, source=source,
                                 actor_id=reviewer_id, verification_id=vr['id'], card_id=vr['card_id'])
    try:
        from portal.helpers.notifications import notify_user
        title = 'Your work was approved' if approve else 'Your submission needs another look'
        body = feedback or reason or ('Readiness points added.' if approve else 'See the feedback in the app.')
        notify_user(vr['user_id'], title, body, type='system', reference_type='readiness')
    except Exception as e:                                    # noqa: BLE001
        logger.warning(f"verification notify failed: {e}")
    return out


# ── reads ────────────────────────────────────────────────────────────────────

def next_actions(user_id, n=3, card=None):
    """Until BhaAI: the pillar with the most room, then its highest-point actions
    that are not at their limit (playbook C4)."""
    card = card or active_card(user_id)
    if not card:
        return []
    state = pillar_state(card)
    now = utcnow()
    acts = call_proc('sp_rv_actions_list', card['card_type'], 1) or []
    out = []
    for pillar in sorted(PILLARS, key=lambda p: -state[p]['room']):
        if state[pillar]['room'] <= 0:
            continue
        for a in sorted([a for a in acts if a['pillar'] == pillar and not a.get('is_employer')],
                        key=lambda a: -_int(a['points'])):
            if not _limit_reached(card, a, now):
                out.append({'action_key': a['action_key'], 'label': a['label'], 'evidence': a.get('evidence'),
                            'pillar': pillar, 'points': _int(a['points']), 'checked_by': a['checked_by']})
            if len(out) >= n:
                return out
    return out


def card_view(card, s=None, include_band=True):
    s = s or settings()
    earned = float(card.get('earned_score') or 0)
    out = {'id': card['id'], 'card_type': card['card_type'], 'label': CARD_LABELS.get(card['card_type']),
           'kind': card.get('card_kind'), 'status': card.get('status'),
           'stage_badge': stage_badge(card['card_type'], card.get('sub_year')),
           'earned': earned, 'completion_status': card.get('completion_status'),
           'completion_points': _int(card.get('completion_points')), 'boost_applied': bool(card.get('boost_applied')),
           'card_score': float(card.get('card_score') or 0), 'level': level_for(earned, s),
           'started_at': card['started_at'].isoformat() if card.get('started_at') else None,
           'ended_at': card['ended_at'].isoformat() if card.get('ended_at') else None,
           'expires_at': card['expires_at'].isoformat() if card.get('expires_at') else None}
    if include_band:
        out['result_band'] = card.get('result_band')
    return out


def current(user_id):
    """GET /score/current: everything the score screen and BhaAI need."""
    s = settings()
    attach_card(user_id)
    card = active_card(user_id)
    idx = refresh_index(user_id, s) or {}
    cards = call_proc('sp_rv_cards_for_user', user_id) or []
    out = {'enabled': bool(s.get('v21_enabled')), 'card': None,
           'thresholds': {'unlock': _int(s.get('unlock_score'), 60), 'premium': _int(s.get('premium_score'), 65),
                          'earned_max': _int(s.get('earned_max'), 70), 'completion_max': _int(s.get('completion_max'), 30),
                          'boost': _int(s.get('boost_threshold'), 65)},
           'readiness_index': float(idx.get('readiness_index') or 0), 'active_ready': bool(idx.get('active_ready')),
           'cards': [card_view(c, s) for c in cards if c['status'] != 'active'], 'next_actions': []}
    if not card:
        return out
    now = utcnow()
    n, start, end = card_month(card['started_at'], now)
    capped = card['card_type'] != 'skill' and n <= _int(s.get('cap_months'), 3)
    used = _int((call_proc_one('sp_rv_card_window_points', card['id'], start, end) or {}).get('points'))
    saved = call_proc_one('sp_rv_card_saved_points', card['id']) or {}
    view = card_view(card, s)
    view.update({'pillars': pillar_state(card), 'card_month': n,
                 'monthly': {'capped': capped, 'cap': _int(s.get('monthly_cap'), 20), 'used': used,
                             'left': max(0, _int(s.get('monthly_cap'), 20) - used) if capped else None,
                             'resets_at': end.isoformat()},
                 'saved': {'points': _int(saved.get('points')),
                           'next_release': saved['next_release'].isoformat() if saved.get('next_release') else None},
                 'to_unlock': max(0, _int(s.get('unlock_score'), 60) - int(float(card.get('earned_score') or 0)))})
    out['card'] = view
    out['next_actions'] = next_actions(user_id, 3, card)
    return out


def history(card_id, limit=100):
    rows = call_proc('sp_rv_card_history', card_id, limit) or []
    return [{'id': r['id'], 'action_key': r['event_type'], 'label': r['label'], 'pillar': r['pillar'],
             'points': _int(r['points']), 'status': r['status'], 'source': r.get('source'),
             'release_at': r['release_at'].isoformat() if r.get('release_at') else None,
             'at': r['occurred_at'].isoformat() if r.get('occurred_at') else None} for r in rows]


# ── jobs ─────────────────────────────────────────────────────────────────────

def active_ready_job():
    s = settings()
    return call_proc_one('sp_rv_active_ready_recalc', _int(s.get('active_ready_days'), 30),
                         _int(s.get('unlock_score'), 60))


def skill_card_job(now=None):
    """Close Skill Cards past their 12 months as Expired; remind at 90 / 30 / 7 days."""
    now = now or utcnow()
    closed = reminded = 0
    for c in call_proc('sp_rv_skill_cards_due', now) or []:
        if c['expires_at'] <= now:
            call_proc_one('sp_rv_card_close', c['id'], 'expired', None, 'skill card expired')
            refresh_index(c['user_id'])
            closed += 1
        else:
            try:
                from portal.helpers.notifications import notify_user
                notify_user(c['user_id'], f"{c['days_left']} days left on your Skill Card",
                            'Keep adding projects and mock interviews, and upload your offer letter when you get one.',
                            type='system', reference_type='readiness')
                reminded += 1
            except Exception as e:                            # noqa: BLE001
                logger.warning(f"skill card reminder failed: {e}")
    return {'expired': closed, 'reminded': reminded}


def audit_job(sample_every=100):
    """Rebuild ~1% of cards from their events and report any difference."""
    diffs, checked, offset = [], 0, 0
    while True:
        rows = call_proc('sp_rv_active_cards', 1000, offset) or []
        if not rows:
            break
        for i, c in enumerate(rows):
            if (offset + i) % sample_every:
                continue
            card = call_proc_one('sp_rv_card_get', c['id'])
            rebuilt = sum(v['applied'] for v in pillar_state(card).values())
            checked += 1
            if abs(rebuilt - float(card.get('earned_score') or 0)) > 0.001:
                diffs.append({'card_id': c['id'], 'stored': float(card['earned_score']), 'rebuilt': rebuilt})
        offset += len(rows)
    if diffs:
        logger.error(f"readiness audit: {len(diffs)} card(s) differ: {diffs[:10]}")
    return {'checked': checked, 'differences': len(diffs)}
