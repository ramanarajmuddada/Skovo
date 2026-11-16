"""Version 1 scheduled jobs (feature-updates.md §2, §3, §4, §7, §15).

Registered from portal/scheduler.py. Every job reads its admin settings on each
run and does nothing while its feature is switched off, so registering a job is
never the same as turning a feature on.

All wall-clock times are IST (the timezone the scheduler hands in).
"""
import datetime
import logging

logger = logging.getLogger("skovo.jobs_v1")

# job name -> callable; filled by the @job decorator below
_JOBS = []


def job(cron, job_id):
    def wrap(fn):
        _JOBS.append((fn, cron, job_id))
        return fn
    return wrap


# Retired by Readiness Score Playbook v2.1: old streak (buddies, groups, freezes),
# the score-based leaderboard, leagues, quests and win-back. They stop the moment
# the new engine is switched on; code and data are deleted once v2.1 is verified live.
RETIRED_BY_V21 = {'v1_streak_nightly', 'v1_streak_risk_reminder', 'v1_leaderboard_sync', 'v1_league_week',
                  'v1_quests_assign', 'v1_perfect_week', 'v1_winback'}


def _unless_v21(fn):
    def wrapped():
        from portal.helpers import readiness_v21
        if readiness_v21.enabled():
            return 'retired (v21 on)'
        return fn()
    wrapped.__name__ = fn.__name__
    return wrapped


def register(sched, run, tz):
    for fn, cron, job_id in _JOBS:
        if job_id in RETIRED_BY_V21:
            fn = _unless_v21(fn)
        sched.add_job(lambda f=fn: run(f), 'cron', timezone=tz, id=job_id,
                      max_instances=1, coalesce=True, **cron)


def _ist_today():
    try:
        from zoneinfo import ZoneInfo
        return datetime.datetime.now(ZoneInfo("Asia/Kolkata")).date()
    except Exception:                                        # noqa: BLE001
        return (datetime.datetime.utcnow() + datetime.timedelta(hours=5, minutes=30)).date()


# ── Stages: auto-promotion (§2) ─────────────────────────────────────────────

# education_category -> (next category, next year label) for the automatic move.
# Only moves that need no choice from the student: Class 10 -> Inter 1st year
# (the group they planned in Class 10 carries over), 11th -> 12th. Inter 2nd
# year and final years are NOT auto-moved -- the next course is the student's
# choice -- they get a reminder instead.
_AUTO_NEXT = {
    'school_10th': ('school_11th', '1st Year'),
    'school_11th': ('school_12th', '2nd Year'),
}
_YEARLY = ('ug', 'polytechnic', 'iti', 'pg', 'professional_course')
_MAX_YEAR = 6


def _ordinal(n):
    return {1: '1st', 2: '2nd', 3: '3rd'}.get(n, f'{n}th') + ' Year'


@job({'hour': 1, 'minute': 15}, 'v1_stage_auto_promote')
def stage_auto_promote(today=None):
    """Once a year on admin's date (default 1 July), move students up a year.

    Off unless admin switched auto-promotion on. Uses the normal profile save
    path (sp_profile_upsert + stages.sync_from_profile), so the snapshot, the
    score reset and the career timeline are exactly what a manual change does.
    """
    from portal.models import db
    from portal.helpers.sp import call_proc, call_proc_one
    from portal.helpers import stages
    from portal.helpers.notifications import notify_user

    settings = call_proc_one('sp_stage_settings_get') or {}
    if not settings.get('auto_promote_enabled'):
        return 0
    today = today or _ist_today()
    if today.strftime('%m-%d') != (settings.get('auto_promote_on') or '07-01'):
        return 0
    year_start = datetime.datetime(today.year, today.month, today.day) - datetime.timedelta(hours=5, minutes=30)

    moved = 0
    for c in call_proc('sp_stage_auto_promote_candidates', 100000) or []:
        if c.get('started_at') and c['started_at'] >= year_start:
            continue                      # started this academic year already
        uid = c['user_id']
        cat = c.get('education_category')
        prof = call_proc_one('sp_profile_get_by_user', uid) or {}
        new_cat, new_year = None, None
        if cat in _AUTO_NEXT:
            new_cat, new_year = _AUTO_NEXT[cat]
        elif cat in _YEARLY:
            y = stages.sub_year_from(prof.get('year_of_study'))
            if y and y.isdigit() and int(y) < _MAX_YEAR:
                new_cat, new_year = cat, _ordinal(int(y) + 1)
        if not new_cat:
            if cat == 'school_12th':
                notify_user(uid, 'Finished Inter?',
                            'Update your course in Profile to start your next stage on SKOVO.',
                            type='system', reference_type='stage')
            continue
        try:
            _profile_set(uid, new_cat, new_year)
            res = stages.sync_from_profile(uid)
            db.session.commit()
            moved += 1
            notify_user(uid, 'You moved up a year',
                        f"We've moved you to {new_year}. Not right? Change it in Profile.",
                        type='system', reference_type='stage')
            logger.info(f"auto-promote {uid}: {cat} -> {new_cat} {new_year} ({res.get('action')})")
        except Exception as e:                               # noqa: BLE001
            db.session.rollback()
            logger.error(f"auto-promote {uid} failed: {e}")
    logger.info(f"stage auto-promotion: {moved} students moved")
    return moved


# ── Streaks (§3) ────────────────────────────────────────────────────────────

@job({'hour': 0, 'minute': 10}, 'v1_streak_nightly')
def streak_nightly():
    """Settle yesterday: exam window -> freeze -> break. Off while streaks are off."""
    from portal.models import db
    from portal.helpers import streaks
    out = streaks.nightly()
    db.session.commit()
    logger.info(f"streak nightly: {out}")
    return out


@job({'minute': 0}, 'v1_streak_risk_reminder')
def streak_risk_reminder():
    """Hourly tick; sends only at admin's reminder hour (default 20:00 IST)."""
    from portal.models import db
    from portal.helpers import streaks
    try:
        from zoneinfo import ZoneInfo
        hour = datetime.datetime.now(ZoneInfo("Asia/Kolkata")).hour
    except Exception:                                        # noqa: BLE001
        hour = (datetime.datetime.utcnow() + datetime.timedelta(hours=5, minutes=30)).hour
    if hour != int(streaks.settings().get('risk_reminder_hour') or 20):
        return 0
    n = streaks.risk_reminders()
    db.session.commit()
    return n


# ── Leaderboard (§4) ────────────────────────────────────────────────────────

@job({'minute': '*/3'}, 'v1_leaderboard_sync')
def leaderboard_sync():
    """Copy new paying score events into the leaderboard ledger (daily cap)."""
    from portal.models import db
    from portal.helpers import leaderboard
    n = leaderboard.sync()
    db.session.commit()
    return n


@job({'day_of_week': 'mon', 'hour': 0, 'minute': 5}, 'v1_league_week')
def league_week():
    """Monday 00:05 IST: settle last week's leagues and build this week's groups."""
    from portal.models import db
    from portal.helpers import leaderboard
    out = leaderboard.close_week_and_regroup()
    db.session.commit()
    logger.info(f"league week: {out}")
    return out


# ── Communities (§6) ────────────────────────────────────────────────────────

@job({'day_of_week': 'mon', 'hour': 0, 'minute': 20}, 'v1_top_helper_week')
def top_helper_week(today=None):
    """Monday: last week's #1 helper in each community gets top_helper_week
    (admin rule, 0 / inactive by default) and a notification."""
    from portal.models import db
    from portal.helpers.sp import call_proc
    from portal.helpers import score
    from portal.helpers.notifications import notify_user
    today = today or _ist_today()
    monday = today - datetime.timedelta(days=today.weekday())
    end = datetime.datetime(monday.year, monday.month, monday.day) - datetime.timedelta(hours=5, minutes=30)
    start = end - datetime.timedelta(days=7)
    n = 0
    for g in call_proc('sp_cm_groups_with_solved', start, end) or []:
        top = (call_proc('sp_cm_top_helpers', g['group_id'], start, 1) or [None])[0]
        if top:
            score.award(top['user_id'], 'top_helper_week', ref_id=f"{g['group_id']}-{monday.isoformat()}")
            notify_user(top['user_id'], "You're this week's Top Helper 🏅",
                        'Your answers solved the most doubts in your community.',
                        type='community', reference_type='community', reference_id=g['group_id'])
            n += 1
    db.session.commit()
    return n


# ── Daily engagement (§7) ───────────────────────────────────────────────────

@job({'hour': 0, 'minute': 1}, 'v1_quests_assign')
def quests_assign():
    """00:01 IST: today's quests for each recently active student (if on)."""
    from portal.models import db
    from portal.helpers import engagement
    n = engagement.assign_quests()
    db.session.commit()
    return n


@job({'day_of_week': 'mon', 'hour': 0, 'minute': 25}, 'v1_perfect_week')
def perfect_week(today=None):
    """Monday: students who met their daily goal all 7 days last week."""
    from portal.models import db
    from portal.helpers import engagement, score
    from sqlalchemy import text
    if not engagement.settings().get('perfect_week_enabled'):
        return 0
    today = today or _ist_today()
    start = today - datetime.timedelta(days=today.weekday() + 7)
    end = start + datetime.timedelta(days=6)
    rows = db.session.execute(text(
        "SELECT user_id FROM daily_activity WHERE action_key = 'daily_goal_met' AND day BETWEEN :a AND :b "
        "GROUP BY user_id HAVING COUNT(DISTINCT day) = 7"), {'a': start, 'b': end}).all()
    for (uid,) in rows:
        score.award(uid, 'perfect_week', ref_id=f'pw-{start.isoformat()}')
        engagement.feed_add(uid, 'perfect_week', 'had a perfect week 🌟')
    db.session.commit()
    return len(rows)


@job({'hour': 10, 'minute': 0}, 'v1_winback')
def winback(today=None):
    """10:00 IST: nudge students idle for exactly 3 / 7 / 30 days (admin days)."""
    from portal.models import db
    from portal.helpers import engagement
    from sqlalchemy import text
    s = engagement.settings()
    if not s.get('winback_enabled'):
        return 0
    today = today or _ist_today()
    sent = 0
    for d in [x for x in str(s.get('winback_days') or '').split(',') if x.strip().isdigit()]:
        day = today - datetime.timedelta(days=int(d))
        rows = db.session.execute(text(
            "SELECT user_id FROM daily_activity GROUP BY user_id HAVING MAX(day) = :d"), {'d': day}).all()
        for (uid,) in rows:
            engagement.notify_tpl(uid, f'winback_{int(d)}', 'We miss you', 'One quick quiz gets you back on track.',
                                  type='reminder', reference_type='winback')
            sent += 1
    db.session.commit()
    return sent


# ── Wallet + refunds (§15) ──────────────────────────────────────────────────

@job({'minute': '*/5'}, 'v1_wallet_restore_failed')
def wallet_restore_failed():
    """Orders that failed / expired after the wallet paid part: give it back."""
    from portal.models import db
    from portal.helpers import wallet
    n = wallet.restore_failed_orders()
    db.session.commit()
    return n


@job({'hour': 1, 'minute': 0}, 'v1_wallet_expire_bonus')
def wallet_expire_bonus():
    from portal.models import db
    from portal.helpers import wallet
    n = wallet.expire_bonus()
    db.session.commit()
    return n


@job({'hour': 11, 'minute': 0}, 'v1_wallet_expiry_reminders')
def wallet_expiry_reminders():
    from portal.models import db
    from portal.helpers import wallet
    n = wallet.expiry_reminders()
    db.session.commit()
    return n


@job({'minute': 15}, 'v1_refund_retry')
def refund_retry():
    """Hourly: retry failed bank refunds on the 1h / 6h / 24h schedule."""
    from portal.helpers.refunds import retry_failed
    return retry_failed()


@job({'hour': 9, 'minute': 0}, 'v1_refund_sla')
def refund_sla():
    from portal.helpers.refunds import sla_alerts
    return sla_alerts()


# ── Platform (§16) ──────────────────────────────────────────────────────────

@job({'hour': 9, 'minute': 30}, 'v1_rank_data_review')
def rank_data_review(today=None):
    """From admin's yearly due date (default 15 July, after results) until rank
    data is marked reviewed this year, keep one open admin alert.

    v1: off. The college predictor and its Rank Data screen are hidden in v1,
    so a reminder to update them has nowhere to go."""
    return
    from portal.models import db
    from sqlalchemy import text
    from portal.helpers import wallet
    today = today or _ist_today()
    r = db.session.execute(text("SELECT rank_data_due, rank_data_reviewed_on FROM platform_settings WHERE id = 1")
                           ).mappings().first()
    if not r:
        return 0
    m, d = (int(x) for x in str(r['rank_data_due']).split('-'))
    due = datetime.date(today.year, m, d)
    reviewed = r.get('rank_data_reviewed_on')
    if today >= due and not (reviewed and reviewed >= due):
        wallet.alert('rank_data_review', str(today.year),
                     'Update this year\'s EAPCET / ECET / ICET / POLYCET rank data (AP and Telangana) for the college '
                     'predictor, then mark it reviewed in Admin > Platform settings.')
        db.session.commit()
        return 1
    return 0


def _profile_set(user_id, category, year_label):
    """Partial profile update through the same procedure the Profile PATCH uses."""
    from portal.helpers.sp import call_proc
    # sp_profile_upsert COALESCEs NULL to "keep", so only these two change.
    call_proc('sp_profile_upsert', user_id,
              None, None, None, None, None, None,
              None, category,
              None, None, None, None, None, None, None, year_label,
              None, None, None, None, None, None, None)


# ── Readiness Score Playbook v2.1 (playbook C5, India time) ──────────────────
# All off until readiness_settings.v21_enabled is switched on in the admin portal.

def _v21(fn_name, *args):
    from portal.models import db
    from portal.helpers import readiness_v21 as rv
    if not rv.enabled():
        return 'v21 off'
    from portal.helpers import streak_points as spx
    from portal.routes.Admin import admin_readiness_v21 as admin_v21
    fn = {'release': rv.release_saved, 'streak_close': spx.close_day, 'active_ready': rv.active_ready_job,
          'skill_card': rv.skill_card_job, 'audit': rv.audit_job, 'config': admin_v21.apply_scheduled}[fn_name]
    out = fn(*args)
    db.session.commit()
    logger.info(f"v21 {fn_name}: {out}")
    return out


@job({'hour': 0, 'minute': 5}, 'v21_streak_close')
def v21_streak_close():
    """Settle yesterday: pause / exam / monthly save, or the streak goes to 0."""
    return _v21('streak_close')


@job({'hour': 0, 'minute': 10}, 'v21_release_saved')
def v21_release_saved():
    """Apply saved points whose card month has arrived, within that month's limit."""
    return _v21('release')


@job({'hour': 0, 'minute': 20}, 'v21_config_scheduled')
def v21_config_scheduled():
    """Apply approved config changes whose effective date has arrived."""
    return _v21('config')


@job({'hour': 1, 'minute': 30}, 'v21_active_ready')
def v21_active_ready():
    return _v21('active_ready')


@job({'hour': 2, 'minute': 0}, 'v21_skill_card_expiry')
def v21_skill_card_expiry():
    """Close Skill Cards past 12 months as Expired; remind at 90 / 30 / 7 days left."""
    return _v21('skill_card')


@job({'hour': 4, 'minute': 0}, 'v21_score_audit')
def v21_score_audit():
    """Rebuild ~1% of cards from their events; log any difference."""
    return _v21('audit')


@job({'hour': '19,21', 'minute': 0}, 'v21_streak_reminders')
def v21_streak_reminders():
    """7 pm / 9 pm 'streak at risk' push (hours set in the admin portal)."""
    from portal.models import db
    from portal.helpers import readiness_v21 as rv
    if not rv.enabled():
        return 'v21 off'
    from portal.helpers import streak_points as spx
    from portal.helpers.notifications import notify_user
    hour = _ist_now_hour()
    users = spx.at_risk(hour)
    for uid in users:
        notify_user(uid, 'Your streak is at risk' if hour >= 21 else 'Keep your streak going',
                    'Open Skovo today to keep your day streak.', type='system', reference_type='streak')
    db.session.commit()
    return len(users)


def _ist_now_hour():
    try:
        from zoneinfo import ZoneInfo
        return datetime.datetime.now(ZoneInfo("Asia/Kolkata")).hour
    except Exception:                                        # noqa: BLE001
        return (datetime.datetime.utcnow() + datetime.timedelta(hours=5, minutes=30)).hour


@job({'hour': 18, 'minute': 0}, 'v1_review_reminder')
def review_reminder():
    """One reminder, a day after a cohort ended, to attendees who have not rated it."""
    from portal.models import db
    from sqlalchemy import text
    from portal.helpers.notifications import notify_user
    rows = db.session.execute(text("""
        SELECT e.user_id, c.id, c.title
          FROM cohorts c
          JOIN cohort_enrollments e ON e.cohort_id = c.id AND e.attended = 1
         WHERE c.status = 'completed'
           AND c.session_date BETWEEN UTC_TIMESTAMP() - INTERVAL 48 HOUR AND UTC_TIMESTAMP() - INTERVAL 24 HOUR
           AND NOT EXISTS (SELECT 1 FROM achiever_reviews r
                            WHERE r.user_id = e.user_id AND r.context_id = c.id)
    """)).fetchall()
    for user_id, cohort_id, title in rows:
        notify_user(user_id, f"Don't forget to rate {title}",
                    'Your rating helps other students and your achiever. It takes 10 seconds.',
                    type='cohort', reference_type='cohort_review', reference_id=cohort_id)
    db.session.commit()
    return len(rows)


@job({'minute': '*'}, 'v1_class_watch')
def class_watch():
    """Class-day rules: reminders, missed classes (100% back + strikes), automatic close."""
    from portal.helpers.class_rules import watch
    return watch()
