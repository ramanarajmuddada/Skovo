"""Career streaks (feature-updates.md §3).

Two counters move together on every kept day:
    lifetime  never resets on promotion
    stage     resets to 0 when the student changes stage; ranks the leaderboard

A day is kept by doing an action admin switched on (streak_actions.counts = 1)
at least min_per_day times, or by a freeze or an exam window. Login
alone never counts. Days are IST dates.

Everything is off until admin enables streaks (streak_settings.enabled) and
switches on at least one action. Milestone points are ordinary score rules
(streak_7 ... buddy_streak_7) -- 0 points and inactive until admin prices them.

SQL: database/migrations/migrate_v1_streaks.py.
"""
import datetime
import logging
import secrets
import uuid

from portal.helpers.sp import call_proc, call_proc_one

logger = logging.getLogger("skovo")

MILESTONES = (7, 30, 100, 365)
BUDDY_MILESTONE = 7
# Pair and group milestones -> score rules buddy_streak_<n> / group_streak_<n>.
SOCIAL_MILESTONES = (7, 30)


def ist_today():
    try:
        from zoneinfo import ZoneInfo
        return datetime.datetime.now(ZoneInfo("Asia/Kolkata")).date()
    except Exception:                                        # noqa: BLE001
        return (datetime.datetime.utcnow() + datetime.timedelta(hours=5, minutes=30)).date()


def settings():
    s = call_proc_one('sp_streak_settings_get') or {}
    # v2.1: one day streak in streak_points.py; buddies, groups and freezes retire.
    return {**s, 'enabled': 0, 'group_enabled': 0, 'buddy_max': 0} if s and _v21_on() else s


def _v21_on():
    """Readiness Score Playbook v2.1 retires this feature once the new engine is on."""
    try:
        from portal.helpers import readiness_v21
        return readiness_v21.enabled()
    except Exception:                                        # noqa: BLE001
        return False


def _matches(segment, value):
    """NULL / '' segment = everyone; otherwise a comma list, case-insensitive."""
    if not segment:
        return True
    wanted = {s.strip().lower() for s in str(segment).split(',') if s.strip()}
    return (value or '').strip().lower() in wanted


def _context(user_id):
    stage = call_proc_one('sp_stage_get_active', user_id) or {}
    return stage


def freezes_on(s):
    """Freezes are off when admin sets "Earn a freeze every N days" to 0: none
    are earned, none held are spent, and the screens do not show them."""
    return int(s.get('freeze_every_days') or 0) > 0


def _freeze_cap(user_id, s):
    if not freezes_on(s):
        return 0
    cap = int(s.get('freeze_max') or 0)
    try:
        from portal.routes.Subscription.subscription import is_pro
        if is_pro(user_id):
            cap = int(s.get('freeze_max_pro') or 0)
    except Exception:                                        # noqa: BLE001
        pass
    # Streak club perk (§7): +1 freeze slot once the best streak reaches the
    # admin's club threshold (0 = off).
    try:
        from portal.helpers import engagement
        club = int(engagement.settings().get('club_extra_freeze_days') or 0)
        if club > 0:
            best = int((call_proc_one('sp_streak_get', user_id) or {}).get('lifetime_best') or 0)
            if best >= club:
                cap += 1
    except Exception:                                        # noqa: BLE001
        pass
    return cap


def record(user_id, action_key, day=None):
    """A qualifying action happened. Returns a small dict, never raises.

    The caller commits (or the request's commit picks it up).
    """
    try:
        s = settings()
        if not s.get('enabled'):
            return {'result': 'disabled'}
        action = next((a for a in (call_proc('sp_streak_actions_list') or [])
                       if a.get('action_key') == action_key), None)
        if not action or not action.get('counts'):
            return {'result': 'not_counted'}
        stage = _context(user_id)
        if not (_matches(action.get('segment_stage'), stage.get('stage_group'))
                and _matches(action.get('segment_branch'), stage.get('branch'))
                and _matches(action.get('segment_state'), stage.get('state'))):
            return {'result': 'not_for_this_student'}

        day = day or ist_today()
        count = (call_proc_one('sp_streak_log_action', user_id, day, action_key) or {}).get('count', 1)
        if int(count) < int(action.get('min_per_day') or 1):
            return {'result': 'below_minimum', 'count': count}

        res = call_proc_one('sp_streak_keep_day', user_id, day, 'action', stage.get('id'),
                            int(s.get('freeze_every_days') or 0), _freeze_cap(user_id, s)) or {}
        if res.get('result') == 'kept':
            _after_kept(user_id, day, res)
        return {'result': res.get('result'), 'lifetime': res.get('lifetime_current'),
                'stage': res.get('stage_current'), 'freeze_earned': bool(res.get('freeze_earned'))}
    except Exception as e:                                   # noqa: BLE001
        logger.error(f"streaks.record({user_id}, {action_key}) failed: {e}")
        return {'result': 'error'}


def _after_kept(user_id, day, res):
    from portal.helpers import score
    from portal.helpers.notifications import notify_user
    life = int(res.get('lifetime_current') or 0)
    run = str(res.get('run_started_on') or day)
    if life in MILESTONES:
        # ref = the run's first day: once per run, a new run can earn it again.
        score.award(user_id, f'streak_{life}', ref_id=f'run-{run}')
        notify_user(user_id, f'🔥 {life}-day streak!', 'Keep it going — do one task tomorrow too.',
                    type='system', reference_type='streak')
    if res.get('freeze_earned'):
        notify_user(user_id, 'You earned a streak freeze',
                    'It saves your streak automatically on a day you miss.',
                    type='system', reference_type='streak')
    for b in call_proc('sp_buddy_keep_day', user_id, day) or []:
        n = int(b.get('current') or 0)
        if n in SOCIAL_MILESTONES:
            ref = f"buddy-{b.get('id')}-{b.get('run_started_on')}"
            for uid in (b.get('user_a'), b.get('user_b')):
                score.award(uid, f'buddy_streak_{n}', ref_id=ref)
                notify_user(uid, f'🤝 {n}-day buddy streak!', 'Keep it going together.',
                            type='system', reference_type='streak')
    # Groups move on only when every member acted today.
    for g in call_proc('sp_group_keep_day', user_id, day) or []:
        n = int(g.get('current') or 0)
        if n in SOCIAL_MILESTONES:
            ref = f"group-{g.get('id')}-{g.get('run_started_on')}"
            for m in call_proc('sp_group_members_of', g.get('id')) or []:
                score.award(m['user_id'], f'group_streak_{n}', ref_id=ref)
                notify_user(m['user_id'], f'👥 {n}-day group streak!', 'Your whole group kept it going.',
                            type='system', reference_type='streak')


def on_stage_change(user_id, closed_stage_id, new_stage_id):
    """Promotion: the closed stage keeps its best ⚡; the stage counter restarts."""
    try:
        call_proc_one('sp_streak_stage_closed', user_id, closed_stage_id, new_stage_id)
    except Exception as e:                                   # noqa: BLE001
        logger.error(f"streaks.on_stage_change({user_id}) failed: {e}")


def add_freeze(user_id):
    """Win-back gift: +1 freeze if under the cap. Returns True if added."""
    s = settings()
    return bool((call_proc_one('sp_streak_add_freeze', user_id, _freeze_cap(user_id, s)) or {}).get('added'))


def summary(user_id, days=60):
    """Everything the streak screens need."""
    s = settings()
    row = call_proc_one('sp_streak_get', user_id) or {}
    today = ist_today()
    cal = call_proc('sp_streak_days', user_id, today - datetime.timedelta(days=days - 1), today) or []
    covered = row.get('covered_through')

    # Exam windows for this student: the one on now, else one starting within
    # 3 days. The nightly job protects these days; this lets the student know.
    def _win(w):
        return {'label': w.get('label'), 'start': w['start_date'].isoformat(),
                'end': w['end_date'].isoformat()}
    windows = call_proc('sp_streak_exam_windows_for', user_id, today, 3) or []
    current = next((w for w in windows if w['start_date'] <= today), None)
    upcoming = next((w for w in windows if w['start_date'] > today), None)
    return {
        'enabled': bool(s.get('enabled')),
        'exam_window': _win(current) if current else None,
        'exam_upcoming': _win(upcoming) if upcoming else None,
        'lifetime_current': int(row.get('lifetime_current') or 0),
        'lifetime_best': int(row.get('lifetime_best') or 0),
        'stage_current': int(row.get('stage_current') or 0),
        'stage_best': int(row.get('stage_best') or 0),
        'freezes_on': freezes_on(s),
        'freezes_held': int(row.get('freezes_held') or 0) if freezes_on(s) else 0,
        'freeze_cap': _freeze_cap(user_id, s),
        'kept_today': bool(covered and covered >= today),
        'at_risk': bool(int(row.get('lifetime_current') or 0) > 0 and not (covered and covered >= today)),
        'next_milestone': next((m for m in MILESTONES if m > int(row.get('lifetime_current') or 0)), None),
        'calendar': [{'day': c['day'].isoformat(), 'kind': c['kind'], 'actions': c['actions']} for c in cal],
    }


# ── buddies ──────────────────────────────────────────────────────────────────

def invite(user_id):
    code = secrets.token_hex(4).upper()          # 8 chars, e.g. 3FA9C21B
    return call_proc_one('sp_buddy_invite', str(uuid.uuid4()), user_id, code) or {}


def accept(user_id, code):
    s = settings()
    return call_proc_one('sp_buddy_accept', user_id, (code or '').strip().upper(),
                         int(s.get('buddy_max') or 0), 1 if s.get('buddy_same_class', 1) else 0) or {}


# ── groups ───────────────────────────────────────────────────────────────────

def group_create(user_id, name):
    s = settings()
    code = secrets.token_hex(4).upper()
    return call_proc_one('sp_group_create', str(uuid.uuid4()), user_id, (name or '').strip()[:60], code,
                         int(s.get('group_per_student') or 1)) or {}


def group_join(user_id, code):
    s = settings()
    return call_proc_one('sp_group_join', user_id, (code or '').strip().upper(),
                         1 if s.get('buddy_same_class', 1) else 0,
                         int(s.get('group_min') or 3), int(s.get('group_max') or 5),
                         int(s.get('group_per_student') or 1)) or {}


def group_leave(user_id, group_id):
    return call_proc_one('sp_group_leave', user_id, group_id, int(settings().get('group_min') or 3)) or {}


def groups(user_id):
    """The student's groups with members and who has acted today."""
    out = {}
    for r in call_proc('sp_group_list', user_id, ist_today()) or []:
        g = out.setdefault(r['id'], {
            'id': r['id'], 'name': r['name'], 'status': r['status'],
            'current': int(r.get('current') or 0), 'best': int(r.get('best') or 0),
            'invite_code': r.get('invite_code'), 'is_owner': r.get('created_by') == user_id,
            'members': [],
        })
        g['members'].append({'user_id': r['user_id'], 'name': r.get('full_name'),
                             'done_today': bool(r.get('done_today')), 'is_me': r['user_id'] == user_id,
                             'nudged_today': bool(r.get('nudged_today'))})
    return list(out.values())


def social_leaderboard(user_id, limit=10):
    """Top pairs and groups in the student's own class."""
    stage = (call_proc_one('sp_stage_get_active', user_id) or {}).get('stage_group')
    if not stage:
        return {'stage': None, 'pairs': [], 'groups': []}
    pairs = call_proc('sp_social_leaderboard_pairs', stage, limit) or []
    grps = call_proc('sp_social_leaderboard_groups', stage, limit) or []

    def row(r):
        return {'id': r['id'], 'name': r['name'], 'current': int(r['current'] or 0),
                'best': int(r['best'] or 0), 'mine': user_id in str(r.get('members') or '').split(',')}
    return {'stage': stage, 'pairs': [row(r) for r in pairs], 'groups': [row(r) for r in grps]}


def buddies(user_id):
    return call_proc('sp_buddy_list', user_id, ist_today()) or []


def nudge(from_user, to_user):
    """👋 a buddy or group member who has not acted today. Once a day each."""
    from portal.helpers.notifications import notify_user
    res = call_proc_one('sp_streak_nudge', from_user, to_user, ist_today()) or {}
    if res.get('result') == 'sent':
        notify_user(to_user, f"👋 {res.get('from_name') or 'Your buddy'} is waiting for you",
                    'Do one task today to keep your shared streak going.',
                    type='reminder', reference_type='streak')
    return res.get('result')


def end_buddy(user_id, buddy_row_id):
    return (call_proc_one('sp_buddy_end', user_id, buddy_row_id) or {}).get('ended', 0)


# ── nightly ──────────────────────────────────────────────────────────────────

def nightly(day=None):
    """Settle `day` (default: yesterday IST) for everyone with a live streak.

    Order per student: exam window -> freeze -> break. Returns counts.
    """
    from portal.helpers.notifications import notify_user
    s = settings()
    if not s.get('enabled'):
        return {'skipped': 'disabled'}
    day = day or (ist_today() - datetime.timedelta(days=1))
    out = {'exam': 0, 'freeze': 0, 'broken': 0}
    for c in call_proc('sp_streak_nightly_candidates', day) or []:
        uid = c['user_id']
        try:
            in_exam = (call_proc_one('sp_streak_in_exam_window', day, c.get('stage_group'),
                                     c.get('state')) or {}).get('n', 0)
            if in_exam:
                call_proc_one('sp_streak_cover_exam', uid, day)
                out['exam'] += 1
            elif freezes_on(s) and int(c.get('freezes_held') or 0) > 0:
                call_proc_one('sp_streak_use_freeze', uid, day)
                out['freeze'] += 1
                notify_user(uid, 'A freeze saved your streak',
                            f"Your 🔥 {c.get('lifetime_current')} is safe. Do one task today.",
                            type='system', reference_type='streak')
            else:
                call_proc_one('sp_streak_break', uid, day)
                out['broken'] += 1
        except Exception as e:                               # noqa: BLE001
            logger.error(f"streaks.nightly {uid}: {e}")
    call_proc_one('sp_buddy_nightly_break', day)
    call_proc_one('sp_group_nightly', day)
    call_proc_one('sp_social_housekeeping', int(s.get('invite_expiry_days') or 0))
    return out


def risk_reminders(today=None):
    from portal.helpers.notifications import notify_user
    s = settings()
    if not s.get('enabled'):
        return 0
    today = today or ist_today()
    sent = 0
    for c in call_proc('sp_streak_risk_candidates', today) or []:
        notify_user(c['user_id'], f"🔥 {c['lifetime_current']} ends tonight",
                    'Do one task before midnight to keep your streak.',
                    type='reminder', reference_type='streak')
        call_proc_one('sp_streak_mark_reminded', c['user_id'], today)
        sent += 1
    # Shared streaks: everyone in a live pair or group who has not acted yet.
    for c in call_proc('sp_social_risk_candidates', today) or []:
        if c['kind'] == 'pair':
            title = f"🤝 Your {c['current']}-day streak with {c.get('with_name') or 'your buddy'} breaks at midnight"
        else:
            title = f"👥 {c.get('with_name') or 'Your group'}'s {c['current']}-day streak breaks at midnight"
        notify_user(c['user_id'], title, 'Do one task now — they are counting on you.',
                    type='reminder', reference_type='streak')
        sent += 1
    return sent
