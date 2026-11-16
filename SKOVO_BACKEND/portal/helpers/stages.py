"""Stages (feature-updates.md §2): the readiness score starts from zero at each
stage, and closed stages stay on the career timeline.

A stage is a group of education categories that share one score:

    class_10      school_10th
    intermediate  school_11th, school_12th, dropper     (Inter 1st + 2nd year = one stage)
    polytechnic   polytechnic
    iti           iti
    ug            ug, professional_course
    pg            pg, phd
    other         working, gap_year, govt_exam, entrance_exam, anything new

Moving between groups is a promotion (score resets); moving inside a group
(11th -> 12th, a branch change, a new college) only updates the details.

The SQL side (student_stages, sp_stage_*) lives in
database/migrations/migrate_v1_stages.py.
"""
import logging
import re
import time
import uuid

from portal.helpers.sp import call_proc, call_proc_one

logger = logging.getLogger("skovo")

STAGE_GROUPS = {
    'school_10th': 'class_10',
    'school_11th': 'intermediate',
    'school_12th': 'intermediate',
    'dropper': 'intermediate',
    'polytechnic': 'polytechnic',
    'iti': 'iti',
    'ug': 'ug',
    'professional_course': 'ug',
    'pg': 'pg',
    'phd': 'pg',
}

_LABELS_CACHE = {'at': 0.0, 'labels': {}}


def group_labels():
    """value -> label for every stage group, from master_stage_group.

    Read through the generic sp_master_list and kept for a minute: timelines
    label one row at a time, and a rename in Admin > Masters should still show
    up without a restart. A failed read keeps the last good labels; with none
    yet, callers fall back to the raw value rather than failing.
    """
    now = time.monotonic()
    if _LABELS_CACHE['labels'] and now - _LABELS_CACHE['at'] < 60:
        return _LABELS_CACHE['labels']
    try:
        rows = call_proc('sp_master_list', 'stage_group', 0) or []
        labels = {r['value']: r['label'] for r in rows if r.get('value')}
        if labels:
            _LABELS_CACHE.update(at=now, labels=labels)
    except Exception:
        logger.exception('stage group labels: master read failed')
    return _LABELS_CACHE['labels']

# Within Inter the year comes from the category itself.
_CATEGORY_YEAR = {'school_11th': '1', 'school_12th': '2', 'school_10th': '1'}

# A promotion undone within this window by switching straight back is treated
# as a mistake and rolled back, instead of opening a third stage.
UNDO_WINDOW_HOURS = 24


def stage_group(education_category):
    """The stage group for a profile's education_category. Unknown -> 'other'."""
    return STAGE_GROUPS.get((education_category or '').strip(), 'other')


def sub_year_from(year_of_study, education_category=None):
    """'1st Year' / '2' / 'Year 3' -> '3'. Inter takes its year from the category."""
    if education_category in _CATEGORY_YEAR:
        return _CATEGORY_YEAR[education_category]
    m = re.search(r'\d+', str(year_of_study or ''))
    return m.group(0) if m else None


def _details(profile):
    return (
        sub_year_from(profile.get('year_of_study'), profile.get('education_category')),
        profile.get('education_category'), profile.get('board'), profile.get('stream'),
        profile.get('degree_category'), profile.get('degree_type'), profile.get('branch'),
        profile.get('college_name') or profile.get('school_name'), profile.get('state'),
    )


def active_stage(user_id):
    return call_proc_one('sp_stage_get_active', user_id)


def history(user_id):
    return call_proc('sp_stage_history', user_id) or []


def sync_from_profile(user_id, actor_id=None):
    """Bring the student's stage in line with their saved profile.

    Returns {'action': 'opened' | 'promoted' | 'updated' | 'rolled_back' | 'none', ...}.
    The caller commits. Never raises: a stage problem must not fail a profile
    save -- it is logged and the next save tries again.
    """
    try:
        profile = call_proc_one('sp_profile_get_by_user', user_id) or {}
        category = profile.get('education_category')
        if not category:
            return {'action': 'none'}
        group = stage_group(category)
        details = _details(profile)
        current = active_stage(user_id)

        from portal.helpers import readiness_v21
        if not current:
            call_proc_one('sp_stage_open', str(uuid.uuid4()), user_id, group, *details, None)
            readiness_v21.attach_card(user_id)
            return {'action': 'opened', 'stage_group': group}

        # Same stage, next year keeps its Journey Card (Inter 1st -> 2nd). Only a
        # move to a different card (degree Y2 -> Y3) opens a new one below.
        if current.get('stage_group') == group and not readiness_v21.needs_new_card(current, group, details[0]):
            call_proc_one('sp_stage_update_details', user_id, *details)
            readiness_v21.attach_card(user_id)
            return {'action': 'updated', 'stage_group': group}

        # Switched straight back to the stage just closed: undo, don't stack.
        if _is_quick_undo(user_id, current, group):
            res = call_proc_one('sp_stage_rollback', user_id, actor_id or user_id,
                                'switched back within %d hours' % UNDO_WINDOW_HOURS) or {}
            if res.get('ok'):
                call_proc_one('sp_stage_update_details', user_id, *details)
                after_rollback(user_id, res.get('stage_id'))
                return {'action': 'rolled_back', 'stage_group': group}

        # Refresh the cached score so the closed stage keeps what the student saw.
        call_proc_one('sp_score_read', user_id)
        res = call_proc_one('sp_stage_promote', str(uuid.uuid4()), user_id, group, *details,
                            actor_id or user_id, 'education stage changed') or {}
        from portal.helpers import streaks
        streaks.on_stage_change(user_id, res.get('closed_stage_id'), res.get('stage_id'))
        if res.get('closed_stage_id'):
            fill_recap(user_id, res['closed_stage_id'])
        readiness_v21.attach_card(user_id)
        return {'action': 'promoted', 'stage_group': group,
                'closed_score': res.get('closed_score'), 'boost': float(res.get('boost') or 0)}
    except Exception as e:                                   # noqa: BLE001
        logger.error(f"stages.sync_from_profile({user_id}) failed: {e}")
        return {'action': 'error'}


def fill_recap(user_id, stage_id):
    """Season recap for a closed stage (feature-updates.md §10): best league
    rank, Hall of Fame places and what was earned during the stage, saved on
    the stage row, then the student is told the shareable card is ready.
    Best effort: a recap problem never blocks the promotion."""
    import json
    from sqlalchemy import text
    from portal.models import db
    try:
        st = db.session.execute(text(
            "SELECT stage_group, started_at, IFNULL(ended_at, UTC_TIMESTAMP()) AS ended_at "
            "FROM student_stages WHERE id = :i AND user_id = :u"), {'i': stage_id, 'u': user_id}).mappings().first()
        if not st:
            return
        w = {'u': user_id, 'g': st['stage_group'], 'a': st['started_at'], 'b': st['ended_at']}
        league = db.session.execute(text(
            "SELECT MIN(final_rank) AS best_rank, MAX(tier) AS best_tier, COUNT(*) AS weeks FROM league_members "
            "WHERE user_id = :u AND stage_group = :g AND week_start BETWEEN DATE(:a) AND DATE(:b)"), w).mappings().first() or {}
        hof = db.session.execute(text(
            "SELECT season_label, scope, scope_value, `rank` FROM hall_of_fame "
            "WHERE user_id = :u AND stage_group = :g AND created_at BETWEEN :a AND DATE_ADD(:b, INTERVAL 30 DAY) "
            "ORDER BY `rank` LIMIT 5"), w).mappings().all()
        tiers = [t.strip() for t in str((db.session.execute(text(
            "SELECT tiers FROM league_settings WHERE id = 1")).scalar() or '')).split(',') if t.strip()]
        best_tier = league.get('best_tier')
        best_rank = {
            'league_best_rank': league.get('best_rank'),
            'league_best_tier': tiers[int(best_tier)] if best_tier is not None and int(best_tier) < len(tiers) else None,
            'league_weeks': int(league.get('weeks') or 0),
            'hall_of_fame': [{'season': h['season_label'], 'scope': h['scope'], 'scope_value': h['scope_value'],
                              'rank': int(h['rank'])} for h in hof],
        }
        earned = [r[0] for r in db.session.execute(text(
            "SELECT b.name FROM user_badges ub JOIN badges b ON b.id = ub.badge_id "
            "WHERE ub.user_id = :u AND IFNULL(ub.earned_at, ub.created_at) BETWEEN :a AND :b"), w).all()]
        earned += [f"{r[0]} ({r[1]})" for r in db.session.execute(text(
            "SELECT IFNULL(a.label, ua.ach_key), ua.tier FROM user_achievements ua "
            "LEFT JOIN achievements a ON a.ach_key = ua.ach_key "
            "WHERE ua.user_id = :u AND ua.earned_at BETWEEN :a AND :b"), w).all()]
        earned += [f"Monthly challenge {r[0]}" for r in db.session.execute(text(
            "SELECT month FROM user_challenge_awards WHERE user_id = :u AND awarded_at BETWEEN :a AND :b"), w).all()]
        db.session.execute(text("UPDATE student_stages SET best_rank_json = :r, badges_json = :b WHERE id = :i"),
                           {'r': json.dumps(best_rank), 'b': json.dumps(earned[:30]), 'i': stage_id})
        from portal.helpers.notifications import notify_user
        label = group_labels().get(st['stage_group'], st['stage_group'])
        notify_user(user_id, f'Your {label} recap is ready 🎓',
                    'See your score, best rank, streak and badges — and share your card.',
                    type='stage', reference_type='stage', reference_id=stage_id)
    except Exception as e:                                   # noqa: BLE001
        logger.error(f"stages.fill_recap({user_id}, {stage_id}) failed: {e}")


def after_rollback(user_id, reopened_stage_id):
    """Side effects of a rolled-back promotion outside the stage table."""
    try:
        call_proc_one('sp_streak_stage_reopened', user_id, reopened_stage_id)
    except Exception as e:                                   # noqa: BLE001
        logger.error(f"stages.after_rollback({user_id}) failed: {e}")


def _is_quick_undo(user_id, current, group):
    import datetime
    started = current.get('started_at')
    if not started or (datetime.datetime.utcnow() - started).total_seconds() > UNDO_WINDOW_HOURS * 3600:
        return False
    closed = [s for s in history(user_id) if s.get('status') == 'closed']
    return bool(closed) and closed[-1].get('stage_group') == group


def _json_or(v, default):
    """JSON columns arrive as text from PyMySQL."""
    if v is None:
        return default
    if isinstance(v, (dict, list)):
        return v
    import json
    try:
        return json.loads(v)
    except (TypeError, ValueError):
        return default


def timeline_entry(s):
    """One career-timeline row for the API."""
    def iso(v):
        return v.isoformat() if hasattr(v, 'isoformat') else v
    return {
        'id': s.get('id'),
        'stage_group': s.get('stage_group'),
        'stage_label': group_labels().get(s.get('stage_group'), s.get('stage_group')),
        'sub_year': s.get('sub_year'),
        'education_category': s.get('education_category'),
        'board': s.get('board'),
        'stream': s.get('stream'),
        'degree_type': s.get('degree_type'),
        'branch': s.get('branch'),
        'institute': s.get('institute'),
        'state': s.get('state'),
        'status': s.get('status'),
        'started_at': iso(s.get('started_at')),
        'ended_at': iso(s.get('ended_at')),
        'final_score': s.get('final_score'),
        'final_level': s.get('final_level'),
        'cohorts_completed': s.get('cohorts_completed'),
        'tasks_completed': s.get('tasks_completed'),
        'stage_best_streak': s.get('stage_best_streak'),
        'best_rank': _json_or(s.get('best_rank_json'), {}),
        'badges': _json_or(s.get('badges_json'), []),
        'boost_points': float(s.get('boost_points') or 0),
    }
