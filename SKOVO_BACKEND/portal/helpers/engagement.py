"""Daily engagement (feature-updates.md §7). No AI.

track(user, action) is the one call every qualifying action makes. It logs the
day's activity and moves, in order: daily goal, daily quests,
the career streak (helpers/streaks.py) and achievements. Each piece checks its
own switch in engagement_settings; everything is off and pays nothing until an
admin turns it on. Readiness points = admin score rules. Skovo v1 gives no
coins and has no shop.

SQL: database/migrations/migrate_v1_engagement.py.
"""
import datetime
import json
import logging
import random
import uuid

from sqlalchemy import text

from portal.models import db
from portal.helpers.sp import call_proc, call_proc_one

logger = logging.getLogger("skovo")


# ── basics ───────────────────────────────────────────────────────────────────

# Not in the v2.1 playbook: goals, quests, challenges, paths, friends, coins and
# shop, achievements, win-back, perfect week, tournaments. Practice tools stay.
_RETIRED_BY_V21 = ('daily_goal_enabled', 'quests_enabled', 'challenge_enabled', 'paths_enabled', 'friends_enabled',
                   'friend_quests_enabled', 'coins_enabled', 'achievements_enabled', 'winback_enabled',
                   'perfect_week_enabled')


def settings():
    s = call_proc_one('sp_eng_settings_get') or {}
    if s and _v21_on():
        s = {**s, **{k: 0 for k in s if k in _RETIRED_BY_V21 or 'tournament' in k}}
    return s


def _v21_on():
    """Readiness Score Playbook v2.1 retires this feature once the new engine is on."""
    try:
        from portal.helpers import readiness_v21
        return readiness_v21.enabled()
    except Exception:                                        # noqa: BLE001
        return False


def ist_now():
    return datetime.datetime.utcnow() + datetime.timedelta(hours=5, minutes=30)


def ist_today():
    return ist_now().date()


def _rows(sql, **params):
    return [dict(r) for r in db.session.execute(text(sql), params).mappings().all()]


def _one(sql, **params):
    r = db.session.execute(text(sql), params).mappings().first()
    return dict(r) if r else None


def _loads(v, default):
    if v is None:
        return default
    if isinstance(v, (dict, list)):
        return v
    try:
        return json.loads(v)
    except ValueError:
        return default


# ── templates (mascot messages, Telugu + English) ───────────────────────────

def render(key, lang='en', **values):
    """(title, body) from message_templates; falls back to English, then None."""
    row = _one("SELECT title, body FROM message_templates WHERE tpl_key = :k AND lang = :l", k=key, l=lang) \
        or _one("SELECT title, body FROM message_templates WHERE tpl_key = :k AND lang = 'en'", k=key)
    if not row:
        return None

    class _Safe(dict):
        def __missing__(self, k):
            return ''
    vals = _Safe(**{k: v for k, v in values.items()})
    return row['title'].format_map(vals), row['body'].format_map(vals)


def notify_tpl(user_id, key, fallback_title, fallback_body, type='system', reference_type=None, **values):
    from portal.helpers.notifications import notify_user
    lang = (_one("SELECT lang FROM user_profiles WHERE user_id = :u", u=user_id) or {}).get('lang') \
        if _has_profile_lang() else 'en'
    if 'name' not in values:   # {name} in a template = the student's first name
        full = (_one("SELECT full_name FROM users WHERE id = :u", u=user_id) or {}).get('full_name') or ''
        values['name'] = full.split()[0] if full.strip() else 'there'
    out = render(key, lang or 'en', **values)
    title, body = out if out else (fallback_title, fallback_body)
    notify_user(user_id, title, body, type=type, reference_type=reference_type)


_PROFILE_LANG = {'checked': False, 'has': False}


def _has_profile_lang():
    if not _PROFILE_LANG['checked']:
        _PROFILE_LANG['has'] = bool(db.session.execute(text(
            "SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() "
            "AND TABLE_NAME = 'user_profiles' AND COLUMN_NAME = 'lang'")).scalar())
        _PROFILE_LANG['checked'] = True
    return _PROFILE_LANG['has']


# ── feed ─────────────────────────────────────────────────────────────────────

def feed_add(user_id, kind, text_):
    if not settings().get('friends_enabled'):
        return
    db.session.execute(text(
        "INSERT INTO activity_feed (id, user_id, kind, text) VALUES (:i, :u, :k, :t)"),
        {'i': str(uuid.uuid4()), 'u': user_id, 'k': kind, 't': text_[:300]})


# ── the one entry point ──────────────────────────────────────────────────────

def track(user_id, action_key, percent=None, day=None):
    """A student did something. Never raises; the caller commits."""
    out = {}
    try:
        day = day or ist_today()
        s = settings()
        if s.get('winback_enabled'):
            _welcome_back(user_id, day, s)
        tot = call_proc_one('sp_activity_track', user_id, day, action_key) or {}
        day_total = int(tot.get('day_total') or 0)
        if s.get('daily_goal_enabled'):
            out['goal'] = _goal_progress(user_id, day, day_total)
        if s.get('quests_enabled'):
            out['quests'] = _quest_progress(user_id, day, action_key, percent)
    except Exception as e:                                   # noqa: BLE001
        logger.error(f"engagement.track({user_id}, {action_key}) failed: {e}")
    from portal.helpers import streaks
    out['streak'] = streaks.record(user_id, action_key, day=day)
    try:
        if settings().get('achievements_enabled'):
            out['achievements'] = evaluate_achievements(user_id)
    except Exception as e:                                   # noqa: BLE001
        logger.error(f"engagement achievements({user_id}) failed: {e}")
    return out


def _welcome_back(user_id, day, s):
    """First action after 7+ idle days: admin-set boost hours and / or a free
    freeze (both 0 / off by default)."""
    last = (_one("SELECT MAX(day) AS d FROM daily_activity WHERE user_id = :u", u=user_id) or {}).get('d')
    if not last or (day - last).days < 7:
        return
    hours = int(s.get('winback_boost_hours') or 0)
    if hours > 0:
        grant_boost(user_id, hours * 60, 'winback')
    if s.get('winback_free_freeze'):
        from portal.helpers import streaks
        streaks.add_freeze(user_id)
    from portal.helpers.notifications import notify_user
    if hours > 0 or s.get('winback_free_freeze'):
        notify_user(user_id, 'Welcome back! 👋',
                    'Your comeback bonus is ready.' + (f' Double leaderboard points for {hours}h.' if hours else ''),
                    type='system', reference_type='winback')


# ── daily goal ───────────────────────────────────────────────────────────────

def goal_levels():
    return _rows("SELECT * FROM goal_levels WHERE is_active = 1 ORDER BY sort_order")


def my_goal(user_id):
    g = _one("SELECT ug.level_key, gl.label, gl.tasks_per_day FROM user_goals ug "
             "JOIN goal_levels gl ON gl.level_key = ug.level_key WHERE ug.user_id = :u", u=user_id)
    if g:
        return g
    lv = goal_levels()
    mid = lv[len(lv) // 2] if lv else None
    return {'level_key': mid['level_key'], 'label': mid['label'], 'tasks_per_day': mid['tasks_per_day']} if mid else None


def set_goal(user_id, level_key):
    if not _one("SELECT 1 AS ok FROM goal_levels WHERE level_key = :k AND is_active = 1", k=level_key):
        return False
    db.session.execute(text(
        "INSERT INTO user_goals (user_id, level_key) VALUES (:u, :k) ON DUPLICATE KEY UPDATE level_key = :k"),
        {'u': user_id, 'k': level_key})
    return True


def _goal_progress(user_id, day, day_total):
    g = my_goal(user_id)
    if not g:
        return None
    need = int(g['tasks_per_day'])
    if day_total == need:                       # crossed now, exactly once
        from portal.helpers import score, streaks
        score.award(user_id, 'daily_goal_met', ref_id=f'goal-{day.isoformat()}')
        streaks.record(user_id, 'daily_goal_met', day=day)
        db.session.execute(text(
            "INSERT INTO daily_activity (user_id, day, action_key, count) VALUES (:u, :d, 'daily_goal_met', 1) "
            "ON DUPLICATE KEY UPDATE count = 1"), {'u': user_id, 'd': day})
        notify_tpl(user_id, 'goal_met', 'Daily goal done 🎉', 'Great work today.', reference_type='goal')
        feed_add(user_id, 'goal', 'met their daily goal')
    return {'done': min(day_total, need), 'need': need, 'met': day_total >= need}


def goal_status(user_id, day=None):
    day = day or ist_today()
    g = my_goal(user_id)
    total = int((_one("SELECT IFNULL(SUM(count), 0) AS t FROM daily_activity WHERE user_id = :u AND day = :d "
                      "AND action_key <> 'daily_goal_met'", u=user_id, d=day) or {}).get('t') or 0)
    week_start = day - datetime.timedelta(days=day.weekday())
    met_days = int((_one("SELECT COUNT(*) AS n FROM daily_activity WHERE user_id = :u AND action_key = 'daily_goal_met' "
                         "AND day BETWEEN :a AND :b", u=user_id, a=week_start, b=day) or {}).get('n') or 0)
    return {'enabled': bool(settings().get('daily_goal_enabled')), 'goal': g, 'done_today': total,
            'met_today': bool(g and total >= int(g['tasks_per_day'])), 'met_days_this_week': met_days,
            'levels': [{'level_key': l['level_key'], 'label': l['label'], 'tasks_per_day': l['tasks_per_day']}
                       for l in goal_levels()]}


# ── daily quests ─────────────────────────────────────────────────────────────

def _matches(segment, value):
    if not segment:
        return True
    return (value or '').lower() in {x.strip().lower() for x in segment.split(',') if x.strip()}


def assign_quests(day=None):
    """Nightly: give each recently active student N quests (easy, medium, hard
    mixed) from the active pool for their stage. Idempotent per day."""
    s = settings()
    if not s.get('quests_enabled'):
        return 0
    day = day or ist_today()
    pool = _rows("SELECT * FROM quests WHERE is_active = 1")
    if not pool:
        return 0
    n = max(1, min(5, int(s.get('quests_per_day') or 3)))
    order = ['easy', 'medium', 'hard']
    assigned = 0
    for c in call_proc('sp_quest_assign_candidates', day - datetime.timedelta(days=14)) or []:
        uid = c['user_id']
        if _one("SELECT 1 AS ok FROM user_quests WHERE user_id = :u AND day = :d LIMIT 1", u=uid, d=day):
            continue
        mine = [q for q in pool if _matches(q.get('segment_stage'), c.get('stage_group'))]
        if not mine:
            continue
        picked = []
        for i in range(n):
            want = order[i % 3]
            opts = [q for q in mine if q['difficulty'] == want and q not in picked] or \
                   [q for q in mine if q not in picked]
            if not opts:
                break
            picked.append(random.choice(opts))
        for q in picked:
            db.session.execute(text(
                "INSERT IGNORE INTO user_quests (user_id, day, quest_id, target) VALUES (:u, :d, :q, :t)"),
                {'u': uid, 'd': day, 'q': q['id'], 't': int(q['target'] or 1)})
        assigned += 1
    return assigned


def _quest_progress(user_id, day, action_key, percent):
    from portal.helpers import score
    rows = _rows("SELECT uq.*, q.kind, q.action_key, q.min_percent, q.label FROM user_quests uq "
                 "JOIN quests q ON q.id = uq.quest_id WHERE uq.user_id = :u AND uq.day = :d AND uq.done_at IS NULL",
                 u=user_id, d=day)
    finished = []
    for r in rows:
        hit = (r['kind'] == 'any' or r['action_key'] == action_key)
        if r.get('min_percent') is not None:
            hit = hit and percent is not None and float(percent) >= float(r['min_percent'])
        if not hit:
            continue
        prog = int(r['progress']) + 1
        done = prog >= int(r['target'])
        db.session.execute(text(
            "UPDATE user_quests SET progress = :p, done_at = IF(:done, UTC_TIMESTAMP(), NULL) "
            "WHERE user_id = :u AND day = :d AND quest_id = :q"),
            {'p': prog, 'done': 1 if done else 0, 'u': user_id, 'd': day, 'q': r['quest_id']})
        if done:
            score.award(user_id, 'quest_completed', ref_id=f"{day.isoformat()}-{r['quest_id']}")
            finished.append(r['label'])
    if finished:
        left = _one("SELECT COUNT(*) AS n FROM user_quests WHERE user_id = :u AND day = :d AND done_at IS NULL",
                    u=user_id, d=day)
        if int(left['n']) == 0:
            score.award(user_id, 'quests_all_done', ref_id=f'all-{day.isoformat()}')
            notify_tpl(user_id, 'quests_all', 'All quests done!', 'You finished every quest today.', reference_type='quest')
            feed_add(user_id, 'quests', 'finished all of today\'s quests')
        _check_challenge(user_id, day)
    return finished


def quests_today(user_id, day=None):
    day = day or ist_today()
    return [{'quest_id': r['quest_id'], 'label': r['label'],
             'progress': int(r['progress']), 'target': int(r['target']), 'done': bool(r['done_at']),
             'difficulty': r['difficulty']}
            for r in _rows("SELECT uq.*, q.label, q.difficulty FROM user_quests uq "
                           "JOIN quests q ON q.id = uq.quest_id WHERE uq.user_id = :u AND uq.day = :d "
                           "ORDER BY FIELD(q.difficulty, 'easy', 'medium', 'hard')", u=user_id, d=day)]


# ── monthly challenge ────────────────────────────────────────────────────────

def _check_challenge(user_id, day):
    s = settings()
    if not s.get('challenge_enabled'):
        return
    month = day.strftime('%Y-%m')
    ch = _one("SELECT * FROM monthly_challenges WHERE month = :m AND is_active = 1", m=month)
    if not ch:
        return
    done = int(_one("SELECT COUNT(*) AS n FROM user_quests WHERE user_id = :u AND done_at IS NOT NULL "
                    "AND DATE_FORMAT(day, '%Y-%m') = :m", u=user_id, m=month)['n'])
    if done >= int(ch['target_quests']) and not _one(
            "SELECT 1 AS ok FROM user_challenge_awards WHERE user_id = :u AND month = :m", u=user_id, m=month):
        from portal.helpers import score
        from portal.helpers.notifications import notify_user
        db.session.execute(text("INSERT IGNORE INTO user_challenge_awards (user_id, month) VALUES (:u, :m)"),
                           {'u': user_id, 'm': month})
        score.award(user_id, 'monthly_challenge', ref_id=month)
        notify_user(user_id, f"🏅 {ch.get('badge_label') or 'Monthly challenge'} earned",
                    ch['label'], type='system', reference_type='challenge')
        feed_add(user_id, 'challenge', f"earned the {ch.get('badge_label') or 'monthly'} badge")


def challenge_status(user_id, day=None):
    day = day or ist_today()
    month = day.strftime('%Y-%m')
    ch = _one("SELECT * FROM monthly_challenges WHERE month = :m AND is_active = 1", m=month)
    if not ch or not settings().get('challenge_enabled'):
        return None
    done = int(_one("SELECT COUNT(*) AS n FROM user_quests WHERE user_id = :u AND done_at IS NOT NULL "
                    "AND DATE_FORMAT(day, '%Y-%m') = :m", u=user_id, m=month)['n'])
    return {'month': month, 'label': ch['label'], 'badge': ch.get('badge_label'), 'target': int(ch['target_quests']),
            'done': done, 'earned': bool(_one("SELECT 1 AS ok FROM user_challenge_awards WHERE user_id = :u AND month = :m",
                                              u=user_id, m=month))}


# ── My Mistakes (spaced review) ─────────────────────────────────────────────

def _mistake_days():
    raw = settings().get('mistake_days') or '1,3,7'
    out = []
    for x in str(raw).split(','):
        try:
            v = int(x)
            if 0 < v <= 90:
                out.append(v)
        except ValueError:
            pass
    return out or [1, 3, 7]


def add_mistakes(user_id, question_ids, day=None):
    if not settings().get('mistakes_enabled') or not question_ids:
        return 0
    day = day or ist_today()
    first = day + datetime.timedelta(days=_mistake_days()[0])
    for qid in question_ids:
        db.session.execute(text(
            "INSERT INTO mistake_reviews (user_id, question_id, step, due_on) VALUES (:u, :q, 0, :d) "
            "ON DUPLICATE KEY UPDATE step = 0, due_on = :d, cleared_at = NULL"),
            {'u': user_id, 'q': qid, 'd': first})
    return len(question_ids)


def mistakes_due(user_id, day=None, limit=20):
    from portal.helpers import quiz as Q
    day = day or ist_today()
    rows = call_proc('sp_mistakes_due', user_id, day, limit) or []
    return [Q.student_view(r) for r in rows]


def answer_mistake(user_id, question_id, given, day=None):
    """Right -> next step (cleared after the last); wrong -> back to step 0."""
    from portal.helpers import quiz as Q
    day = day or ist_today()
    row = _one("SELECT mr.step, q.* FROM mistake_reviews mr JOIN task_questions q ON q.id = mr.question_id "
               "WHERE mr.user_id = :u AND mr.question_id = :q AND mr.cleared_at IS NULL", u=user_id, q=question_id)
    if not row:
        return None
    ok = bool(Q.is_correct(row, given))
    days = _mistake_days()
    step = int(row['step'])
    if ok and step + 1 >= len(days):
        db.session.execute(text("UPDATE mistake_reviews SET cleared_at = UTC_TIMESTAMP() "
                                "WHERE user_id = :u AND question_id = :q"), {'u': user_id, 'q': question_id})
        status = 'cleared'
    else:
        nxt = step + 1 if ok else 0
        due = day + datetime.timedelta(days=days[min(nxt, len(days) - 1)])
        db.session.execute(text("UPDATE mistake_reviews SET step = :s, due_on = :d "
                                "WHERE user_id = :u AND question_id = :q"),
                           {'s': nxt, 'd': due, 'u': user_id, 'q': question_id})
        status = 'next' if ok else 'again'
    # Nothing left due today = a cleared set.
    if not call_proc('sp_mistakes_due', user_id, day, 1):
        from portal.helpers import score
        score.award(user_id, 'mistakes_cleared', ref_id=f'mistakes-{day.isoformat()}')
        track(user_id, 'mistakes_cleared', day=day)
    return {'correct': ok, 'status': status, 'correct_answer': row.get('correct_answer'),
            'explanation': row.get('explanation')}


# ── boosts (double leaderboard points) ───────────────────────────────────────

def grant_boost(user_id, minutes, source, multiplier=2.0):
    start = datetime.datetime.utcnow()
    db.session.execute(text(
        "INSERT INTO lb_boosts (id, user_id, multiplier, starts_at, ends_at, source) VALUES (:i, :u, :m, :s, :e, :src)"),
        {'i': str(uuid.uuid4()), 'u': user_id, 'm': multiplier, 's': start,
         'e': start + datetime.timedelta(minutes=int(minutes)), 'src': source})


def boost_at(user_id, when):
    r = _one("SELECT MAX(multiplier) AS m FROM lb_boosts WHERE user_id = :u AND starts_at <= :w AND ends_at > :w",
             u=user_id, w=when)
    return float(r['m']) if r and r.get('m') else 1.0


def active_boost(user_id):
    r = _one("SELECT multiplier, ends_at FROM lb_boosts WHERE user_id = :u AND ends_at > UTC_TIMESTAMP() "
             "ORDER BY ends_at DESC LIMIT 1", u=user_id)
    return {'multiplier': float(r['multiplier']), 'ends_at': r['ends_at'].isoformat() + 'Z'} if r else None


# ── achievements ─────────────────────────────────────────────────────────────

def _metric(user_id, metric):
    q = {
        'quizzes_submitted': "SELECT COUNT(*) AS n FROM quiz_attempts WHERE user_id = :u AND status IN ('submitted','expired')",
        'answers_solved': "SELECT COUNT(*) AS n FROM score_events WHERE user_id = :u AND event_type = 'answer_solved'",
        'streak_best': "SELECT IFNULL(MAX(lifetime_best), 0) AS n FROM career_streaks WHERE user_id = :u",
        'quests_done': "SELECT COUNT(*) AS n FROM user_quests WHERE user_id = :u AND done_at IS NOT NULL",
        # Duo / Squad badges: the longest buddy or group streak this student has been part of.
        'buddy_best': "SELECT IFNULL(MAX(best), 0) AS n FROM buddy_streaks WHERE user_a = :u OR user_b = :u",
        'group_best': ("SELECT IFNULL(MAX(g.best), 0) AS n FROM streak_groups g "
                       "JOIN streak_group_members m ON m.group_id = g.id WHERE m.user_id = :u"),
    }.get(metric)
    return int((_one(q, u=user_id) or {}).get('n') or 0) if q else 0


def evaluate_achievements(user_id):
    from portal.helpers import score
    from portal.helpers.notifications import notify_user
    earned = []
    have = {(r['ach_key'], r['tier']) for r in _rows("SELECT ach_key, tier FROM user_achievements WHERE user_id = :u",
                                                     u=user_id)}
    for a in _rows("SELECT * FROM achievements WHERE is_active = 1"):
        value = None
        for t in _loads(a['tiers_json'], []):
            if (a['ach_key'], t['tier']) in have:
                continue
            if value is None:
                value = _metric(user_id, a['metric'])
            if value >= int(t['target']):
                db.session.execute(text("INSERT IGNORE INTO user_achievements (user_id, ach_key, tier) VALUES (:u, :k, :t)"),
                                   {'u': user_id, 'k': a['ach_key'], 't': t['tier']})
                score.award(user_id, 'achievement_tier', ref_id=f"{a['ach_key']}-{t['tier']}")
                notify_user(user_id, f"🏆 {a['label']} — {t['tier'].title()}", 'New achievement unlocked.',
                            type='system', reference_type='achievement')
                feed_add(user_id, 'achievement', f"earned {a['label']} ({t['tier'].title()})")
                earned.append({'key': a['ach_key'], 'tier': t['tier']})
    return earned


def achievements_status(user_id):
    have = {}
    for r in _rows("SELECT ach_key, tier, earned_at FROM user_achievements WHERE user_id = :u", u=user_id):
        have.setdefault(r['ach_key'], []).append(r['tier'])
    out = []
    for a in _rows("SELECT * FROM achievements WHERE is_active = 1 ORDER BY sort_order"):
        tiers = _loads(a['tiers_json'], [])
        value = _metric(user_id, a['metric'])
        nxt = next((t for t in tiers if t['tier'] not in have.get(a['ach_key'], [])), None)
        out.append({'key': a['ach_key'], 'label': a['label'], 'value': value,
                    'earned': have.get(a['ach_key'], []),
                    'next': {'tier': nxt['tier'], 'target': int(nxt['target'])} if nxt else None})
    return out


# ── follows + feed ───────────────────────────────────────────────────────────

def follow(user_id, other_id, on=True):
    if on:
        db.session.execute(text("INSERT IGNORE INTO follows (follower_id, followee_id) VALUES (:a, :b)"),
                           {'a': user_id, 'b': other_id})
    else:
        db.session.execute(text("DELETE FROM follows WHERE follower_id = :a AND followee_id = :b"),
                           {'a': user_id, 'b': other_id})


def following_ids(user_id):
    return [r['followee_id'] for r in _rows("SELECT followee_id FROM follows WHERE follower_id = :u", u=user_id)]


def feed(user_id, limit=50):
    rows = _rows("SELECT f.*, u.full_name, u.avatar_url, "
                 "(SELECT COUNT(*) FROM feed_cheers c WHERE c.feed_id = f.id) AS cheers, "
                 "(SELECT COUNT(*) FROM feed_cheers c WHERE c.feed_id = f.id AND c.user_id = :u) AS cheered "
                 "FROM activity_feed f JOIN follows fo ON fo.followee_id = f.user_id AND fo.follower_id = :u "
                 "JOIN users u ON u.id = f.user_id ORDER BY f.created_at DESC LIMIT :n", u=user_id, n=limit)
    return rows


def cheer(user_id, feed_id):
    row = _one("SELECT f.user_id FROM activity_feed f JOIN follows fo ON fo.followee_id = f.user_id "
               "AND fo.follower_id = :u WHERE f.id = :f", u=user_id, f=feed_id)
    if not row:
        return False
    db.session.execute(text("INSERT IGNORE INTO feed_cheers (feed_id, user_id) VALUES (:f, :u)"),
                       {'f': feed_id, 'u': user_id})
    return True
