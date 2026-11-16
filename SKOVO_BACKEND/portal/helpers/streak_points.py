"""Readiness Score Playbook v2.1 -- the habit book: day streak + Streak Points.

    day streak    days in a row the student opened the app (30 s+). A missed day
                  resets it unless the monthly save or a pause token covers it.
                  It never resets on a stage change.
    lifetime SP   every SP ever earned -- never resets, not even Class 10 -> Inter
    weekly SP     SP earned since Monday -- the weekly / city boards
    multiplier    a long streak multiplies everyday SP (x1.2 / x1.5 / x2.0);
                  a broken streak only loses the multiplier, never the points

Nothing here can write readiness: SP goes to sp_events only (playbook rule 1).
Numbers come from sp_settings / sp_actions, edited in the admin portal.
SQL: database/stored_procedures/readiness_v21.sql. The caller commits.
"""
import datetime
import json
import logging

from portal.helpers.sp import call_proc, call_proc_one
from portal.helpers import readiness_v21 as rv

logger = logging.getLogger("skovo")


def ist_today():
    try:
        from zoneinfo import ZoneInfo
        return datetime.datetime.now(ZoneInfo("Asia/Kolkata")).date()
    except Exception:                                        # noqa: BLE001
        return (datetime.datetime.utcnow() + datetime.timedelta(hours=5, minutes=30)).date()


def settings():
    return call_proc_one('sp_spv_settings_get') or {}


def week_start(day, s=None):
    """Monday (or the admin's reset day) of the week holding `day`."""
    dow = rv._int((s or settings()).get('weekly_reset_dow'), 1)      # 1 = Monday
    return day - datetime.timedelta(days=(day.isoweekday() - dow) % 7)


def multiplier(streak_days, s=None):
    steps = rv._json((s or settings()).get('multiplier_steps'), [])
    x = 1.0
    for st in sorted(steps, key=lambda st: st.get('from', 0)):
        if streak_days >= rv._int(st.get('from')):
            x = float(st.get('x') or 1)
    return x


def next_multiplier(streak_days, s=None):
    for st in sorted(rv._json((s or settings()).get('multiplier_steps'), []), key=lambda st: st.get('from', 0)):
        if rv._int(st.get('from')) > streak_days:
            return {'at_day': rv._int(st['from']), 'x': float(st['x'])}
    return None


def level(lifetime, s=None):
    levels = sorted(rv._json((s or settings()).get('levels'), []), key=lambda lv: lv.get('sp', 0))
    cur, nxt = None, None
    for lv in levels:
        if lifetime >= rv._int(lv.get('sp')):
            cur = lv
        elif nxt is None:
            nxt = lv
    return {'name': cur['name'] if cur else None,
            'next': {'name': nxt['name'], 'sp': rv._int(nxt['sp'])} if nxt else None}


# ── award ────────────────────────────────────────────────────────────────────

def _window(limit_type, day, s):
    if limit_type == 'daily':
        return day, day
    if limit_type == 'weekly':
        ws = week_start(day, s)
        return ws, ws + datetime.timedelta(days=6)
    if limit_type == 'monthly':
        return day.replace(day=1), day
    return None, None                                        # total


def award(user_id, sp_action, ref_id=None, community_id=None, day=None):
    """Add Streak Points for one everyday activity. Idempotent per ref_id (or per
    day when there is none). Returns the points added (0 when capped or off)."""
    try:
        s = settings()
        action = call_proc_one('sp_spv_action_get', sp_action)
        if not action or not action.get('is_active'):
            return 0
        day = day or ist_today()
        lt, lv = action.get('limit_type'), action.get('limit_value')
        if lt != 'each' and lv is not None:
            frm, to = _window(lt, day, s)
            n = rv._int((call_proc_one('sp_spv_action_count', user_id, sp_action, frm, to) or {}).get('n'))
            if n >= rv._int(lv):
                return 0
        base = rv._int(action['points'])
        x = 1.0
        if action.get('multiplier_applies'):
            row = call_proc_one('sp_spv_streak_get', user_id) or {}
            x = multiplier(rv._int(row.get('lifetime_current')), s)
        pts = int(round(base * x))
        card = rv.active_card(user_id) or {}
        idem = f"{user_id}:{sp_action}:{ref_id if ref_id is not None else day.isoformat()}"
        r = call_proc_one('sp_spv_event_add', user_id, sp_action, base, x, pts, card.get('card_type'),
                          community_id, day, week_start(day, s), None if ref_id is None else str(ref_id)[:64],
                          idem[:120])
        return pts if rv._int((r or {}).get('inserted')) else 0
    except Exception as e:                                   # noqa: BLE001
        logger.error(f"streak_points.award({user_id}, {sp_action}) failed: {e}")
        return 0


# ── the day streak ───────────────────────────────────────────────────────────

def _refresh_tokens(row, s, today):
    tokens, year = rv._int(row.get('pause_tokens_left'), 0), row.get('pause_tokens_year')
    if year != today.year:
        tokens, year = rv._int(s.get('pause_tokens_year'), 2), today.year
    return tokens, year


def _save(user_id, row, current, covered, run_started, save_month, tokens, year, paused_until, reason):
    return call_proc_one('sp_spv_streak_save', user_id, current, max(current, rv._int(row.get('lifetime_best'))),
                         covered, run_started, save_month, tokens, year, paused_until, reason)


def open_app(user_id, seconds=None):
    """POST /streak/open, after 30 s in the app. Once a day keeps the streak."""
    s = settings()
    if seconds is not None and rv._int(seconds) < rv._int(s.get('streak_seconds'), 30):
        return {'result': 'too_short'}
    today = ist_today()
    row = call_proc_one('sp_spv_streak_get', user_id) or {}
    covered = row.get('covered_through')
    if covered and covered >= today:
        return {'result': 'already', **state(user_id)}
    current = rv._int(row.get('lifetime_current'))
    run_started = row.get('run_started_on')
    if covered == today - datetime.timedelta(days=1) and current > 0:
        current += 1
    else:                                                    # first day, or the nightly close found a gap
        current, run_started = 1, today
    tokens, year = _refresh_tokens(row, s, today)
    _save(user_id, row, current, today, run_started, row.get('save_month'), tokens, year,
          row.get('paused_until'), row.get('pause_reason'))
    call_proc_one('sp_spv_streak_day_add', user_id, today, 'open')
    award(user_id, 'app_open', day=today)
    milestones = rv._json(s.get('milestones'), {})
    for days, key in milestones.items():
        d = rv._int(days)
        if not d:
            continue
        top = max(rv._int(k) for k in milestones)
        if d == top and current == d:                        # the biggest one: once per streak
            award(user_id, key, ref_id=f"{run_started}:{d}")
        elif d != top and current % d == 0:                  # the others: every Nth day
            award(user_id, key, ref_id=f"{run_started}:{current}")
    return {'result': 'counted', **state(user_id)}


def use_pause_token(user_id):
    s = settings()
    today = ist_today()
    row = call_proc_one('sp_spv_streak_get', user_id) or {}
    tokens, year = _refresh_tokens(row, s, today)
    if tokens <= 0:
        return {'result': 'none_left'}
    until = today + datetime.timedelta(days=rv._int(s.get('pause_days'), 21) - 1)
    _save(user_id, row, rv._int(row.get('lifetime_current')), row.get('covered_through'), row.get('run_started_on'),
          row.get('save_month'), tokens - 1, year, until, 'token')
    return {'result': 'paused', 'paused_until': until.isoformat(), 'tokens_left': tokens - 1}


def close_day(day=None):
    """Nightly (00:05 IST): settle yesterday for every running streak.
    pause token / exam pause -> covered;  monthly save unused -> covered;  else -> 0."""
    s = settings()
    day = day or (ist_today() - datetime.timedelta(days=1))
    exam_cards = rv._json(s.get('exam_pause_cards'), [])
    exam_on = bool(call_proc('sp_spv_exam_window_on', day, rv._int(s.get('exam_days_around'), 3)))
    month = day.strftime('%Y-%m')
    out = {'paused': 0, 'saved': 0, 'broken': 0}
    for row in call_proc('sp_spv_streak_open_runs', day) or []:
        uid = row['user_id']
        covered = row.get('covered_through')
        gap_from = (covered + datetime.timedelta(days=1)) if covered else day
        tokens, year = _refresh_tokens(row, s, day)
        save_month = row.get('save_month')
        current, paused_until, reason = rv._int(row['lifetime_current']), row.get('paused_until'), row.get('pause_reason')
        d = gap_from
        while d <= day and current > 0:
            if paused_until and d <= paused_until:
                kind = 'pause'
            elif exam_on and row.get('card_type') in exam_cards:
                kind = 'exam'
            elif rv._int(s.get('monthly_saves'), 1) > 0 and save_month != d.strftime('%Y-%m'):
                kind, save_month = 'save', d.strftime('%Y-%m')
            else:
                kind = None
            if kind:
                covered = d
                call_proc_one('sp_spv_streak_day_add', uid, d, kind)
                out['paused' if kind in ('pause', 'exam') else 'saved'] += 1
            else:
                current = 0
                out['broken'] += 1
            d += datetime.timedelta(days=1)
        if paused_until and paused_until < day:
            paused_until, reason = None, None
        _save(uid, row, current, covered, row.get('run_started_on') if current else None, save_month,
              tokens, year, paused_until, reason)
    out['month'] = month
    return out


def at_risk(hour):
    """Students with a streak and no app open today (7 pm / 9 pm reminders)."""
    s = settings()
    if hour not in [rv._int(h) for h in rv._json(s.get('reminder_hours'), [])]:
        return []
    return [r['user_id'] for r in call_proc('sp_spv_streak_open_runs', ist_today()) or []
            if not (r.get('paused_until') and r['paused_until'] >= ist_today())]


# ── weekly plan ──────────────────────────────────────────────────────────────

def weekly_plan(user_id):
    """Monday's 3 readiness actions; finishing all 3 pays the Weekly Plan SP once."""
    s = settings()
    today = ist_today()
    ws = week_start(today, s)
    plan = call_proc_one('sp_rv_plan_get', user_id, ws)
    card = rv.active_card(user_id)
    if not plan:
        keys = [a['action_key'] for a in rv.next_actions(user_id, 3, card)] if card else []
        plan = call_proc_one('sp_rv_plan_set', user_id, ws, json.dumps(keys), json.dumps([]), 0)
    keys = rv._json(plan.get('action_keys'), [])
    since = datetime.datetime.combine(ws, datetime.time()) - datetime.timedelta(hours=5, minutes=30)
    done = [k for k in keys if card and rv._int((call_proc_one('sp_rv_card_action_count', card['id'], k, since) or {}).get('n'))]
    bonus = bool(plan.get('bonus_paid'))
    if keys and len(done) == len(keys) and not bonus:
        award(user_id, 'weekly_plan_done', ref_id=ws.isoformat())
        bonus = True
    if done != rv._json(plan.get('completed'), []) or bonus != bool(plan.get('bonus_paid')):
        call_proc_one('sp_rv_plan_set', user_id, ws, json.dumps(keys), json.dumps(done), 1 if bonus else 0)
    acts = {a['action_key']: a for a in call_proc('sp_rv_actions_list', None, 0) or []}
    return {'week_start': ws.isoformat(), 'bonus_paid': bonus,
            'actions': [{'action_key': k, 'label': (acts.get(k) or {}).get('label', k),
                         'pillar': (acts.get(k) or {}).get('pillar'), 'points': rv._int((acts.get(k) or {}).get('points')),
                         'done': k in done} for k in keys]}


# ── reads ────────────────────────────────────────────────────────────────────

def state(user_id, calendar_days=35):
    s = settings()
    today = ist_today()
    row = call_proc_one('sp_spv_streak_get', user_id) or {}
    current = rv._int(row.get('lifetime_current'))
    tot = call_proc_one('sp_spv_totals', user_id, week_start(today, s)) or {}
    lifetime = rv._int(tot.get('lifetime'))
    tokens, _ = _refresh_tokens(row, s, today)
    cal = call_proc('sp_spv_streak_days', user_id, today - datetime.timedelta(days=calendar_days - 1), today) or []
    return {'streak': current, 'longest': rv._int(row.get('lifetime_best')),
            'kept_today': bool(row.get('covered_through') and row['covered_through'] >= today),
            'multiplier': multiplier(current, s), 'next_multiplier': next_multiplier(current, s),
            'save_available': rv._int(s.get('monthly_saves'), 1) > 0 and row.get('save_month') != today.strftime('%Y-%m'),
            'pause_tokens_left': tokens,
            'paused_until': row['paused_until'].isoformat() if row.get('paused_until') else None,
            'sp_lifetime': lifetime, 'sp_weekly': rv._int(tot.get('weekly')), 'level': level(lifetime, s),
            'calendar': [{'day': c['day'].isoformat(), 'kind': c['kind']} for c in cal]}


BOARDS = ('weekly', 'city', 'streak', 'readiness')


def _entry(r, rank):
    return {'rank': rank, 'user_id': r['user_id'], 'name': r.get('full_name'), 'avatar_url': r.get('avatar_url'),
            'city': r.get('city'), 'stage_badge': rv.stage_badge(r.get('card_type'), r.get('sub_year')),
            'value': float(r.get('value') or 0)}


def leaderboard(user_id, board, card_type=None, city=None):
    """Top N plus the caller's own rank. Readiness boards show earned points only."""
    s = settings()
    top_n = rv._int(s.get('board_top_n'), 10)
    ws = week_start(ist_today(), s)
    if board == 'weekly':
        rows = call_proc('sp_spv_board_weekly', ws, card_type, city, top_n) or []
        me = call_proc_one('sp_spv_rank_weekly', user_id, ws, card_type, city) or {}
    elif board == 'city':
        rows = call_proc('sp_spv_board_weekly', ws, None, city, top_n) or []
        me = call_proc_one('sp_spv_rank_weekly', user_id, ws, None, city) or {}
    elif board == 'streak':
        rows = call_proc('sp_spv_board_streak', city, top_n) or []
        me = None
    elif board == 'readiness':
        rows = call_proc('sp_spv_board_readiness', card_type, city, top_n) or []
        me = None
    else:
        return None
    top = [_entry(r, i + 1) for i, r in enumerate(rows)]
    mine = next((t for t in top if t['user_id'] == user_id), None)
    if me is not None and not mine:
        mine = {'rank': rv._int(me.get('rank')), 'value': float(me.get('value') or 0), 'user_id': user_id}
    return {'board': board, 'week_start': ws.isoformat(), 'top': top, 'me': mine}
