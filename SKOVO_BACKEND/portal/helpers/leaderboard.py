"""Leaderboard (feature-updates.md §4).

* A student sees only their own stage group + year (optionally branch).
* Scope: school / district (city) / state / india. Period: week / month / season.
* Ranked by leaderboard points in the period -- a per-rule number admin sets
  (score_event_rules.leaderboard_points, default 0). Payments never count.
* Display: name + photo, or alias / photo off. Admin can remove a student.
* Weekly leagues (league_settings.enabled, default off).

Leaderboard points are copied from the score ledger by sync() (a job every few
minutes), so every award path -- requests, nightly metric rules, admin credits --
feeds the board the same way, with the admin daily cap applied once.

SQL: database/migrations/migrate_v1_leaderboard.py.
"""
import datetime
import logging
import uuid

from portal.helpers.sp import call_proc, call_proc_one

logger = logging.getLogger("skovo")

SCOPES = ('school', 'district', 'state', 'india')
PERIODS = ('week', 'month', 'season')

# Rules that are payments. Their leaderboard points are forced to 0.
PAYMENT_PREFIXES = ('m_pro_subscription', 'pro_', 'market_redeem', 'coupon')


def is_payment_rule(event_type):
    return any((event_type or '').startswith(p) for p in PAYMENT_PREFIXES)


def _ist_now():
    return datetime.datetime.utcnow() + datetime.timedelta(hours=5, minutes=30)


def ist_date(dt):
    return (dt + datetime.timedelta(hours=5, minutes=30)).date()


def week_start(day=None):
    day = day or _ist_now().date()
    return day - datetime.timedelta(days=day.weekday())          # Monday


def period_from(period, stage_started=None):
    today = _ist_now().date()
    if period == 'week':
        return week_start(today)
    if period == 'month':
        return today.replace(day=1)
    return datetime.date(1970, 1, 1)          # season = whole active stage (stage_id filter)


def settings():
    s = call_proc_one('sp_lb_settings_get') or {}
    # v2.1: boards rank Streak Points (readiness_v21 / streak_points), not score events.
    return {**s, 'enabled': 0} if s and _v21_on() else s


def league_settings():
    s = call_proc_one('sp_league_settings_get') or {}
    return {**s, 'enabled': 0} if s and _v21_on() else s


def _v21_on():
    """Readiness Score Playbook v2.1 retires this feature once the new engine is on."""
    try:
        from portal.helpers import readiness_v21
        return readiness_v21.enabled()
    except Exception:                                        # noqa: BLE001
        return False


def league_tiers(ls=None):
    """Tier names, lowest first, from master_league_tier (Admin > Masters).

    A member's tier is a position in this list, so inactive rows are kept in
    place rather than skipped -- dropping one would shift everyone above it.
    Falls back to the old comma setting when the master is empty or unreadable.
    """
    try:
        rows = call_proc('sp_master_list', 'league_tier', 0) or []
        names = [r['label'] for r in sorted(rows, key=lambda r: (r.get('sort_order') or 0))]
        if names:
            return names
    except Exception:
        pass
    ls = ls if ls is not None else league_settings()
    return [t.strip() for t in (ls.get('tiers') or '').split(',') if t.strip()]


# ── copy job ─────────────────────────────────────────────────────────────────

def sync(batch=2000):
    """Copy new paying score events into lb_events, applying the daily cap."""
    s = settings()
    hw = call_proc_one('sp_lb_high_water') or {}
    if not s.get('enabled'):
        # Off: move the high water along so switching it on later does not
        # backfill months of points into one week.
        if hw.get('max_seq'):
            call_proc_one('sp_lb_state_set', hw['max_seq'])
        return 0
    cap = float(s.get('daily_cap') or 0)
    added, last = 0, None
    day_totals = {}
    for e in call_proc('sp_lb_pending', batch) or []:
        last = e['seq']
        if is_payment_rule(e.get('event_type')):
            continue
        uid = e['user_id']
        day = ist_date(e['occurred_at'])
        key = (uid, day)
        if key not in day_totals:
            day_totals[key] = float((call_proc_one('sp_lb_day_total', uid, day) or {}).get('total') or 0)
        pts = float(e.get('leaderboard_points') or 0)
        # Double-points boosts (shop / win-back, §7) multiply leaderboard
        # points only; readiness points stay exactly what the admin rule says.
        from portal.helpers import engagement
        pts *= engagement.boost_at(uid, e['occurred_at'])
        if cap > 0:
            pts = min(pts, max(0.0, cap - day_totals[key]))
        if pts <= 0:
            continue
        if (call_proc_one('sp_lb_credit', uid, e.get('stage_id'), e['seq'], e['event_type'], pts, day)
                or {}).get('added'):
            day_totals[key] += pts
            added += 1
    if last is not None:
        call_proc_one('sp_lb_state_set', last)
    elif hw.get('max_seq'):
        # Nothing pending that pays: everything up to max_seq is settled.
        call_proc_one('sp_lb_state_set', hw['max_seq'])
    return added


# ── display ──────────────────────────────────────────────────────────────────

def display_name(row, name_format='full'):
    alias = (row.get('alias') or '').strip()
    if alias:
        return alias
    name = (row.get('full_name') or 'Student').strip()
    if name_format == 'initial':
        parts = name.split()
        return parts[0] + (f' {parts[-1][0]}.' if len(parts) > 1 else '')
    return name


def _photo(row, photos_on):
    from portal.helpers.storage import browser_url
    if not photos_on or row.get('hide_photo'):
        return None
    return browser_url(row.get('avatar_url')) if row.get('avatar_url') else None


def entry(row, s, me=None, tiers=None):
    """One board row. Never carries phone or email."""
    tier = row.get('league_tier')
    return {
        'rank': int(row.get('rank') or 0),
        'user_id': row.get('user_id'),
        'is_me': row.get('user_id') == me,
        'name': display_name(row, s.get('name_format') or 'full'),
        'photo': _photo(row, bool(s.get('photos', 1))),
        'institute': row.get('institute'),
        'points': float(row.get('points') or 0),
        'stage_streak': int(row.get('stage_streak') or 0),
        'league': (tiers[int(tier)] if tiers and tier is not None and int(tier) < len(tiers) else None),
    }


# ── boards ───────────────────────────────────────────────────────────────────

def _scope_value(stage, profile, scope):
    if scope == 'school':
        return stage.get('institute')
    if scope == 'district':
        return (profile or {}).get('city')
    if scope == 'state':
        return stage.get('state') or (profile or {}).get('state')
    return None


def board(user_id, scope='school', period='week', by_branch=False, limit=50, offset=0):
    s = settings()
    if not s.get('enabled'):
        return {'enabled': False}
    scope = scope if scope in SCOPES else 'school'
    period = period if period in PERIODS else 'week'
    stage = call_proc_one('sp_stage_get_active', user_id) or {}
    if not stage:
        return {'enabled': True, 'no_stage': True, 'rows': [], 'me': None}
    profile = call_proc_one('sp_profile_get_by_user', user_id) or {}
    value = _scope_value(stage, profile, scope)
    branch = stage.get('branch') if by_branch else None
    frm = period_from(period)
    wk = week_start()
    args = (stage.get('stage_group'), stage.get('sub_year'), branch, scope, value, frm, wk)
    tiers = league_tiers()
    rows = call_proc('sp_lb_board', *args, limit, offset) or []
    total = (call_proc_one('sp_lb_board_count', *args) or {}).get('total', 0)
    mine = call_proc_one('sp_lb_my_rank', *args, user_id)
    me = entry(mine, s, user_id, tiers) if mine else None
    if me and me['points'] <= 0:
        me['rank'] = None                       # not on the board until they earn
    return {
        'enabled': True,
        'scope': scope, 'period': period, 'scope_value': value,
        'stage_group': stage.get('stage_group'), 'sub_year': stage.get('sub_year'),
        'branch': branch, 'from': frm.isoformat(), 'total': total,
        'rows': [entry(r, s, user_id, tiers) for r in rows],
        'me': me,
    }


# ── leagues ──────────────────────────────────────────────────────────────────

def league(user_id):
    ls = league_settings()
    if not ls.get('enabled'):
        return {'enabled': False}
    s = settings()
    tiers = league_tiers(ls)
    wk = week_start()
    rows = call_proc('sp_league_my_group', wk, user_id) or []
    last = call_proc_one('sp_league_last_result', user_id)
    out_rows = []
    for i, r in enumerate(rows, 1):
        out_rows.append({'rank': i, 'user_id': r['user_id'], 'is_me': r['user_id'] == user_id,
                         'name': display_name(r, s.get('name_format') or 'full'),
                         'photo': _photo(r, bool(s.get('photos', 1))),
                         'points': float(r.get('points') or 0)})
    tier = int(rows[0]['tier']) if rows else None
    return {
        'enabled': True, 'week_start': wk.isoformat(),
        'tier': tiers[tier] if tier is not None and tier < len(tiers) else None,
        'tier_index': tier, 'tiers': tiers,
        'promote_count': int(ls.get('promote_count') or 0),
        'demote_count': int(ls.get('demote_count') or 0),
        'members': out_rows,
        'last_result': ({'week_start': last['week_start'].isoformat(), 'rank': last.get('final_rank'),
                         'result': last.get('result'),
                         'tier': tiers[int(last['tier'])] if tiers and int(last['tier']) < len(tiers) else None}
                        if last else None),
    }


def close_week_and_regroup(today=None):
    """Monday job: settle last week (promote / stay / demote), build this week's groups."""
    import random
    from portal.helpers.notifications import notify_user
    ls = league_settings()
    if not ls.get('enabled'):
        return {'skipped': 'disabled'}
    tiers = league_tiers(ls) or ['League']
    top = len(tiers) - 1
    size = max(5, int(ls.get('group_size') or 30))
    up, down = int(ls.get('promote_count') or 0), int(ls.get('demote_count') or 0)
    this_week = week_start(today)
    prev = this_week - datetime.timedelta(days=7)

    # 1. settle last week
    groups = {}
    for r in call_proc('sp_league_week_points', prev) or []:
        groups.setdefault((r['stage_group'], r['sub_year'], r['tier'], r['group_no']), []).append(r)
    settled = 0
    for (g, y, tier, no), members in groups.items():
        n = len(members)
        for rank, m in enumerate(members, 1):
            if rank <= up and tier < top and float(m['points'] or 0) > 0:
                result = 'promoted'
            elif rank > n - down and tier > 0 and n > up + down:
                result = 'demoted'
            else:
                result = 'stayed'
            call_proc_one('sp_league_set_result', prev, m['user_id'], rank, result)
            settled += 1
            label = {'promoted': f'moved up to {tiers[min(tier + 1, top)]}',
                     'demoted': f'moved down to {tiers[max(tier - 1, 0)]}',
                     'stayed': f'stay in {tiers[tier]}'}[result]
            notify_user(m['user_id'], f'League result: #{rank}', f'You finished #{rank} and {label}.',
                        type='system', reference_type='league')

    # 2. groups for this week
    since = this_week - datetime.timedelta(days=28)
    buckets = {}
    for e in call_proc('sp_league_eligible', since, prev) or []:
        t = e.get('prev_tier')
        t = 0 if t is None else int(t)
        if e.get('prev_result') == 'promoted':
            t = min(t + 1, top)
        elif e.get('prev_result') == 'demoted':
            t = max(t - 1, 0)
        buckets.setdefault((e['stage_group'], e['sub_year'], t), []).append(e['user_id'])
    placed = 0
    for (g, y, t), users in buckets.items():
        random.shuffle(users)
        for i, uid in enumerate(users):
            call_proc_one('sp_league_add_member', this_week, uid, g, y, t, i // size)
            placed += 1
    return {'settled': settled, 'placed': placed, 'week': this_week.isoformat()}


# ── Hall of Fame ─────────────────────────────────────────────────────────────

def close_season(season_label, admin_id, top_n=10):
    """Record the season's top students per stage group+year for every state
    and city, and all India. Admin runs it once per season."""
    if (call_proc_one('sp_hof_season_exists', season_label) or {}).get('n'):
        return {'error': 'exists'}
    from portal.models import db
    from sqlalchemy import text
    combos = db.session.execute(text(
        "SELECT DISTINCT st.stage_group, IFNULL(st.sub_year, '') AS sub_year, "
        "COALESCE(NULLIF(st.state, ''), p.state) AS state, p.city "
        "FROM student_stages st LEFT JOIN user_profiles p ON p.user_id = st.user_id "
        "WHERE st.status = 'active'")).mappings().all()
    frm = datetime.date(1970, 1, 1)
    wk = week_start()
    seen, added = set(), 0
    for c in combos:
        for scope, value in (('india', None), ('state', c['state']), ('district', c['city'])):
            if scope != 'india' and not value:
                continue
            key = (c['stage_group'], c['sub_year'], scope, value)
            if key in seen:
                continue
            seen.add(key)
            rows = call_proc('sp_lb_board', c['stage_group'], c['sub_year'], None, scope, value,
                             frm, wk, top_n, 0) or []
            for r in rows:
                call_proc_one('sp_hof_add', str(uuid.uuid4()), season_label, c['stage_group'],
                              c['sub_year'], scope, value, r['user_id'], int(r['rank']),
                              float(r['points'] or 0), admin_id)
                added += 1
    return {'added': added}


# ── Diamond tournament (§7) ──────────────────────────────────────────────────

def tournament_board(tournament_id, user_id=None, limit=100):
    """Members of the tournament tier, ranked by leaderboard points between its
    dates, per class (the viewer's stage group + year)."""
    from portal.models import db
    from sqlalchemy import text
    t = db.session.execute(text("SELECT * FROM tournaments WHERE id = :i"), {'i': tournament_id}).mappings().first()
    if not t:
        return None
    stage = call_proc_one('sp_stage_get_active', user_id) if user_id else None
    rows = db.session.execute(text(
        "SELECT st.user_id, st.stage_group, IFNULL(st.sub_year, '') AS sub_year, u.full_name, u.avatar_url, "
        "lp.alias, IFNULL(lp.hide_photo, 0) AS hide_photo, "
        "IFNULL((SELECT SUM(le.points) FROM lb_events le WHERE le.user_id = st.user_id "
        "AND le.day BETWEEN :a AND :b), 0) AS points "
        "FROM league_members lm JOIN student_stages st ON st.user_id = lm.user_id AND st.status = 'active' "
        "JOIN users u ON u.id = st.user_id LEFT JOIN lb_profiles lp ON lp.user_id = st.user_id "
        "WHERE lm.week_start = :wk AND lm.tier = :tier AND IFNULL(lp.removed, 0) = 0 "
        "AND (:g = '' OR (st.stage_group = :g AND IFNULL(st.sub_year, '') = :y)) "
        "ORDER BY points DESC LIMIT :n"),
        {'a': t['starts_on'], 'b': t['ends_on'], 'wk': week_start(min(t['ends_on'], _ist_now().date())),
         'tier': t['tier'], 'g': (stage or {}).get('stage_group') or '', 'y': (stage or {}).get('sub_year') or '',
         'n': limit}).mappings().all()
    s = settings()
    return {'id': t['id'], 'label': t['label'], 'starts_on': t['starts_on'].isoformat(),
            'ends_on': t['ends_on'].isoformat(), 'status': t['status'],
            'rows': [{'rank': i, 'user_id': r['user_id'], 'name': display_name(r, s.get('name_format') or 'full'),
                      'photo': _photo(r, bool(s.get('photos', 1))), 'points': float(r['points']),
                      'is_me': r['user_id'] == user_id, 'stage_group': r['stage_group'], 'sub_year': r['sub_year']}
                     for i, r in enumerate(rows, 1)]}


def close_tournament(tournament_id, admin_id, top_n=10):
    """Winners per class go to the Hall of Fame (scope 'tournament')."""
    from portal.models import db
    from sqlalchemy import text
    t = db.session.execute(text("SELECT * FROM tournaments WHERE id = :i"), {'i': tournament_id}).mappings().first()
    if not t or t['status'] == 'closed':
        return {'error': 'not_open'}
    board = tournament_board(tournament_id, None, 100000) or {'rows': []}
    per_class, added = {}, 0
    for r in board['rows']:
        if r['points'] <= 0:
            continue
        key = (r['stage_group'], r['sub_year'])
        per_class.setdefault(key, [])
        if len(per_class[key]) < top_n:
            per_class[key].append(r)
    for (g, y), winners in per_class.items():
        for rank, r in enumerate(winners, 1):
            call_proc_one('sp_hof_add', str(uuid.uuid4()), t['label'], g, y, 'tournament', None,
                          r['user_id'], rank, r['points'], admin_id)
            added += 1
    db.session.execute(text("UPDATE tournaments SET status = 'closed' WHERE id = :i"), {'i': tournament_id})
    return {'added': added}
