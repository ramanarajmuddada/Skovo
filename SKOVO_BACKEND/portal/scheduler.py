"""
In-process scheduler (APScheduler) — the time-driven session engine.

Runs INSIDE the gunicorn web process (single worker) so no Redis / no separate
worker dyno is needed. Replaces the orphaned, never-deployed celery_app.py.

Jobs:
  • session_lifecycle (every 60s):
      - flip cohort status  upcoming -> live  at session_date
                            live     -> completed at session_date + duration
      - send a one-time T-15min reminder (in-app + email, with join link) to every
        confirmed enrollee of a cohort about to start
      - send the existing 1-on-1 session reminders (24h window)
  • sweep_holds (every 5 min):
      - release slots held by unpaid pending 1-on-1 sessions older than 15 min

All times are compared in UTC (the DB stores naive-UTC timestamps via utcnow()).
"""
import datetime
import logging

logger = logging.getLogger("skovo.scheduler")

_scheduler = None


def _stu_url(path):
    import os
    return (os.environ.get('FRONTEND_URL') or 'https://skovoai.com').rstrip('/') + path


def _ach_url(path):
    from portal.helpers.achiever_notify import achiever_url
    return achiever_url(path)


def start_scheduler(app):
    """Start the background scheduler once. Safe to call multiple times."""
    global _scheduler
    if _scheduler is not None:
        return
    try:
        from apscheduler.schedulers.background import BackgroundScheduler
    except Exception as e:
        app.logger.warning(f"APScheduler not installed — time-based jobs disabled: {e}")
        return
        

    # Asia/Kolkata needs the IANA database, which is built in on Linux but
    # comes from the `tzdata` package on Windows. Falling back to UTC keeps the
    # job running (an hour that is merely wrong beats a scheduler that refused
    # to start) and says so in the log.
    try:
        from zoneinfo import ZoneInfo
        DECAY_TZ = ZoneInfo("Asia/Kolkata")
    except Exception as e:
        DECAY_TZ = "UTC"
        app.logger.warning(
            f"Asia/Kolkata unavailable ({e}) — score decay falls back to 03:00 UTC. "
            "Install `tzdata` to run it at 03:00 IST as the spec requires.")

    sched = BackgroundScheduler(timezone="UTC", daemon=True)
    sched.add_job(lambda: _run(app, _session_lifecycle), 'interval', seconds=60,
                  id='session_lifecycle', max_instances=1, coalesce=True)
    sched.add_job(lambda: _run(app, _sweep_abandoned_holds), 'interval', seconds=300,
                  id='sweep_holds', max_instances=1, coalesce=True)
    # Readiness score decay — one tick per idle student per day, at 03:00 IST
    # per the Playbook. The scheduler itself runs on UTC, so this job carries
    # its own timezone rather than an hour number: `hour=2` in UTC was 07:30
    # IST, which dropped a student's score in the middle of their morning
    # instead of overnight. Students read the score as a standing number; it
    # should settle while nobody is looking at it.
    #
    # sp_score_decay_run guards itself with `last_decay_on < CURDATE()` on the
    # database's own clock, so it stays once-a-day whichever zone the server
    # keeps — the guard only needs the job to fire once per 24h at a fixed
    # wall-clock time, which this does.
    sched.add_job(lambda: _run(app, _score_decay), 'cron', hour=3, minute=0,
                  timezone=DECAY_TZ,
                  id='score_decay', max_instances=1, coalesce=True)
    # Achiever quality — what ranks the directory above the trust floor.
    # Nightly rather than per-event: a score that moves after every single
    # session is noise, and the browse screen reads a stored column anyway.
    # Metric scoring rules -- 02:30 IST, BEFORE decay at 03:00 so a student who
    # earned points yesterday is credited before the idle sweep looks at them.
    #
    # Awards are idempotent (score_events is UNIQUE on user+type+ref and every
    # ref is derived from the count, never from the clock), so a double run, a
    # retry, or a catch-up after downtime pays nobody twice.
    # DECAY_TZ (Asia/Kolkata). This read `timezone=tz`, a name defined nowhere:
    # start_scheduler raised NameError here, before sched.start(), so no job in
    # this file ran at all.
    sched.add_job(lambda: _run(app, _score_rules), 'cron', hour=2, minute=30,
                  timezone=DECAY_TZ,
                  id='score_rules', max_instances=1, coalesce=True)

    sched.add_job(lambda: _run(app, _achiever_quality), 'cron', hour=3, minute=30,
                  id='achiever_quality', max_instances=1, coalesce=True)
    sched.add_job(lambda: _run(app, _expire_payment_holds), 'interval', seconds=60,
                  id='expire_holds', max_instances=1, coalesce=True)
    sched.add_job(lambda: _run(app, _reconcile_orders), 'interval', seconds=120,
                  id='reconcile_orders', max_instances=1, coalesce=True)
    sched.add_job(lambda: _run(app, _auto_complete_sessions), 'interval', seconds=60,
                  id='session_auto_complete', max_instances=1, coalesce=True)
    # Expired suspensions. sp_achiever_lift_suspensions existed and was wired
    # into the Celery nightly task only -- and Celery needs a broker, so on any
    # deployment running the web process alone nothing ever lifted one. The
    # suspend dialog meanwhile promises "reinstated automatically on <date>",
    # which made it a promise the platform could not keep: an admin suspending
    # someone for a month was in fact suspending them forever.
    #
    # Every minute, not nightly. An admin who suspends until 6pm expects it
    # back at 6pm; the procedure only touches rows whose suspended_until has
    # actually passed, so a frequent tick costs an indexed lookup and nothing
    # more. Indefinite suspensions have suspended_until NULL and it skips them.
    sched.add_job(lambda: _run(app, _lift_expired_suspensions), 'interval', seconds=60,
                  id='achiever_lift_suspensions', max_instances=1, coalesce=True)
    # Community chat and documents. The day counts live in community_retention
    # (Admin → Communities) and are read on every run, so a change applies on
    # the next sweep without a restart.
    sched.add_job(lambda: _run(app, _community_expiry), 'interval', hours=1,
                  id='community_expiry', max_instances=1, coalesce=True)
    # Version 1 jobs (feature-updates.md): stages, streaks, quests, leagues,
    # wallet expiry ... each one reads its own admin settings and does nothing
    # while its feature is switched off.
    from portal import jobs_v1
    jobs_v1.register(sched, lambda fn: _run(app, fn), DECAY_TZ)
    sched.start()
    _scheduler = sched
    app.logger.info("APScheduler started — session lifecycle, holds, reconcile, "
                    "auto-complete, suspension lifts, community expiry")


def _run(app, fn):
    """Execute a job inside an app context, never letting it raise into APScheduler."""
    try:
        with app.app_context():
            fn()
    except Exception as e:
        logger.error(f"scheduler job {getattr(fn, '__name__', '?')} failed: {e}")


def _score_rules():
    """Evaluate every metric scoring rule across all students.

    Rules are expressed over facts the platform records (cohorts attended, Pro
    plan active, sessions completed...), so nothing fires them at the moment
    they happen -- this sweep is what notices. Saving a rule also runs it
    immediately, so this is the catch-up, not the only path.
    """
    # Playbook v2.1: no decay, and readiness never comes from activity metrics.
    from portal.helpers import readiness_v21
    if readiness_v21.enabled():
        return
    # ── SP: sp_score_rules_run ─ set-based, one pass per rule ────────────
    result = call_proc_one('sp_score_rules_run', None) or {}
    ran = result.get('rules_run') or 0
    touched = result.get('students_touched') or 0
    if ran:
        logger.info(f"score rules: {ran} rule(s) evaluated, {touched} student(s) matched")

    # ── SP: sp_score_task_autopay_all ────────────────────────────────────
    # Tasks settle themselves too. A student never taps "I've done this" and an
    # admin never approves -- at 10,000 students neither of those scales, and
    # the student who did the work but never tapped was going unpaid.
    #
    # Walks only students holding an unpaid, provable task, so the set shrinks
    # as tasks get paid rather than being every student every night.
    paid = (call_proc_one('sp_score_task_autopay_all') or {}).get('tasks_paid') or 0
    if paid:
        logger.info(f"score tasks: {paid} task(s) paid automatically")


# ── Job 3: readiness score decay ──────────────────────────────────────────────

def _score_decay():
    # Playbook v2.1: no decay, and readiness never comes from activity metrics.
    from portal.helpers import readiness_v21
    if readiness_v21.enabled():
        return
    from portal.models import db
    from portal.helpers.sp import call_proc, call_proc_one
    from portal.helpers.notifications import notify_user

    # ── SP: sp_score_decay_run — set-based, skips users inside a pause window.
    # Automatic protection was removed: a pause is something a student
    # chooses, twice a year, and decay applies otherwise. ─────────────────
    result = call_proc_one('sp_score_decay_run') or {}
    decayed = result.get('decayed') or 0
    db.session.commit()
    if decayed:
        logger.info(f"score decay: {decayed} student(s) decayed for inactivity")


# ── Job 5: achiever quality score ─────────────────────────────────────────────

def _achiever_quality():
    """Recompute every active achiever's quality score.

    Trust is the floor — verified, and cleared for minors or not. Quality is the
    ordering above it, from measured events: rating, completion vs cancellation,
    no-shows, and repeat bookings. Without this the directory can only rank by
    `is_featured`, which is a founder's guess.

    Set-based inside the procedure, so this stays one round trip as supply grows.
    """
    from portal.models import db
    from portal.helpers.sp import call_proc_one

    # ── SP: sp_achiever_quality_recompute_all ─────────────────────────────────
    res = call_proc_one('sp_achiever_quality_recompute_all') or {}
    db.session.commit()
    logger.info(f"achiever quality: {res.get('scored') or 0} achiever(s) scored")


# Job 4 (background-check expiry) removed.
#
# It demoted an achiever from the tier that allowed 14-17 students down to
# the one that did not, then cancelled and refunded their future sessions
# with minors. Both halves belonged to the tier system: there is no minors
# permission to lapse any more, and capability follows lifecycle state,
# which no nightly job needs to adjust.

# ── Job 1: session lifecycle ──────────────────────────────────────────────────

def _session_lifecycle():
    _transition_cohorts()
    _send_cohort_reminders()
    _send_cohort_timeup()
    _scan_oneonone_reminders()


def _expire_payment_holds():
    from portal.models import db
    from portal.helpers.sp import call_proc_one
    call_proc_one('sp_payment_expire_holds')
    db.session.commit()


def _lift_expired_suspensions():
    from portal.models import db
    from portal.helpers.sp import call_proc_one
    from portal.helpers.achiever_notify import tell_achiever
    from flask import current_app
    from sqlalchemy import text

    # Who is about to be lifted, read BEFORE the procedure runs -- afterwards
    # they are indistinguishable from anyone else in that state.
    due = db.session.execute(text(
        "SELECT id FROM achievers "
        " WHERE state = 'suspended' AND suspended_until IS NOT NULL "
        "   AND suspended_until <= UTC_TIMESTAMP()"
    )).scalars().all()

    res = call_proc_one('sp_achiever_lift_suspensions') or {}
    db.session.commit()
    n = res.get('reinstated') or 0
    if n:
        current_app.logger.info(f"scheduler: lifted {n} expired suspension(s)")
    for achiever_id in due:
        tell_achiever(
            achiever_id, 'Your suspension has ended',
            'The suspension on your account has run its course and been lifted '
            'automatically. You are back where you were before it.',
            type='system')


def _reconcile_orders():
    from portal.helpers.reconcile import reconcile_stuck_orders
    reconcile_stuck_orders()


def _auto_complete_sessions():
    from portal.models import db
    from portal.helpers.sp import call_proc_one
    # With class rules live, the class watcher closes 1-on-1s (End session or
    # auto-close), sets ended_at (which starts the 24 h complaint window and the
    # payout clock) and marks never-started ones missed. This older job completed
    # them at slot end with no ended_at -- even pending ones nobody started.
    try:
        from portal.helpers import class_rules as CR
        if CR.rules().get('live_from'):
            return
    except Exception:
        pass
    res = call_proc_one('sp_scheduler_auto_complete_sessions') or {}
    n = res.get('completed') or 0
    if n:
        db.session.commit()
        logger.info(f"1-on-1 auto-complete: {n} session(s)")


def _transition_cohorts():
    from portal.models import db
    from portal.helpers.sp import call_proc_one
    # ── SP: sp_scheduler_transition_cohorts — single set-based UPDATE ───────────
    result = call_proc_one('sp_scheduler_transition_cohorts') or {}
    changed = result.get('changed') or 0
    if changed:
        db.session.commit()
        logger.info(f"cohort lifecycle: transitioned {changed} cohort(s)")


def _send_cohort_reminders():
    from portal.models import db
    from portal.helpers.sp import call_proc, call_proc_one
    from portal.helpers.notifications import notify_user
    from portal.helpers.email_template import send_email, simple_email_body

    # ── SP: sp_scheduler_due_cohort_reminders, sp_scheduler_cohort_reminder_recipients,
    # sp_scheduler_mark_cohort_reminder_sent ─────────────────────────────────────
    cohorts = call_proc('sp_scheduler_due_cohort_reminders')

    sent = 0
    for c in cohorts:
        title = c.get('title') or 'your class'
        link = (c.get('meeting_link') or '').strip() or None
        recipients = call_proc('sp_scheduler_cohort_reminder_recipients', c['id']) or []

        # The link opens only after the achiever presses Start (class rules), so
        # it is never sent ahead: Join appears on My Bookings at Start.
        student_body = f"Your cohort '{title}' starts in ~15 minutes. Join opens on My Bookings when the achiever starts."
        for r in recipients:
            try:
                notify_user(user_id=r.get('user_id'), title='Session starting soon', body=student_body,
                            type='reminder', reference_type='cohort', reference_id=c['id'])
            except Exception:
                pass
            try:
                if r.get('email'):
                    send_email(
                        r['email'], f"SKOVO — '{title}' starts soon",
                        simple_email_body(
                            'Your session starts soon',
                            f"'{title}' is about to begin. Join opens on My Bookings when the achiever starts.",
                            _stu_url('/bookings'), 'Open My Bookings',
                        ),
                    )
            except Exception:
                pass
            sent += 1

        achiever = call_proc_one('sp_achievers_get', c.get('achiever_id')) if c.get('achiever_id') else None
        if achiever:
            if link:
                a_body = (f"Your cohort '{title}' starts in ~15 minutes. Join with your Meet/Teams "
                          f"link. Open Whiteboard from My Cohorts when you are in.")
                a_mail_body = f"'{title}' is about to begin. Join and open the whiteboard from My Cohorts."
            else:
                a_body = (f"Your class '{title}' starts in 15 minutes. Add a Meet or Teams link "
                          "or students cannot join.")
                a_mail_body = a_body
            try:
                notify_user(user_id=achiever.get('id'), title='Session starting soon', body=a_body,
                            type='reminder', reference_type='cohort', reference_id=c['id'])
            except Exception:
                pass
            try:
                if achiever.get('email'):
                    send_email(
                        achiever['email'], f"SKOVO — '{title}' starts soon",
                        simple_email_body(
                            'Your class starts soon',
                            a_mail_body,
                            link or _ach_url('/cohorts'), 'Join Session' if link else 'Add the meeting link',
                        ),
                    )
            except Exception:
                pass
            sent += 1

        call_proc_one('sp_scheduler_mark_cohort_reminder_sent', c['id'])
    if cohorts:
        db.session.commit()
        logger.info(f"cohort reminders: {sent} notice(s) across {len(cohorts)} cohort(s)")


def _send_cohort_timeup():
    """Tell both sides the booked minutes are done. Do not auto-complete."""
    from portal.models import db
    from portal.helpers.sp import call_proc, call_proc_one
    from portal.helpers.notifications import notify_user
    from portal.helpers.email_template import send_email, simple_email_body

    try:
        cohorts = call_proc('sp_scheduler_due_cohort_timeup')
    except Exception as e:
        logger.error(f"cohort time-up query failed: {e}")
        return

    sent = 0
    for c in cohorts:
        title = c.get('title') or 'the class'
        mins = c.get('duration_minutes') or 60
        body = (f"{mins} minutes are done. {title} stays live until the achiever taps End session.")
        achiever_body = (f"{mins} minutes are done. Tap End session on My Cohorts when the class "
                         f"is actually over.")
        recipients = call_proc('sp_scheduler_cohort_reminder_recipients', c['id']) or []
        for r in recipients:
            try:
                notify_user(user_id=r.get('user_id'), title='Class time is up', body=body,
                            type='reminder', reference_type='cohort', reference_id=c['id'])
            except Exception:
                pass
            try:
                if r.get('email'):
                    send_email(r['email'], f"SKOVO — '{title}' time is up",
                               simple_email_body('Class time is up', body, None, None))
            except Exception:
                pass
            sent += 1
        achiever = call_proc_one('sp_achievers_get', c.get('achiever_id')) if c.get('achiever_id') else None
        if achiever:
            try:
                notify_user(user_id=achiever.get('id'), title='Class time is up', body=achiever_body,
                            type='reminder', reference_type='cohort', reference_id=c['id'])
            except Exception:
                pass
            try:
                if achiever.get('email'):
                    send_email(achiever['email'], f"SKOVO — '{title}' time is up",
                               simple_email_body('Class time is up', achiever_body, None, None))
            except Exception:
                pass
            sent += 1
        try:
            call_proc_one('sp_scheduler_mark_cohort_timeup_sent', c['id'])
        except Exception as e:
            logger.error(f"mark time-up sent failed for {c.get('id')}: {e}")
    if cohorts:
        db.session.commit()
        logger.info(f"cohort time-up: {sent} notice(s) across {len(cohorts)} cohort(s)")


def _scan_oneonone_reminders():
    """Confirmed 1-on-1 sessions starting within 24h get a one-time reminder."""
    from portal.models import db
    from portal.helpers.sp import call_proc, call_proc_one
    from portal.helpers.notifications import notify_user
    from portal.helpers.email_template import send_email, simple_email_body

    # ── SP: sp_scheduler_due_session_reminders, sp_scheduler_mark_session_reminder_sent ─
    sessions = call_proc('sp_scheduler_due_session_reminders')
    sent = 0
    for s in sessions:
        a_name = s.get('achiever_name') or 'your mentor'
        s_name = s.get('student_name') or 'your student'
        # start_dt is UTC (the SP subtracts 330 min); people read IST.
        when = ((s['start_dt'] + datetime.timedelta(minutes=330)).strftime('%d %b, %I:%M %p').replace(' 0', ' ')
                if s.get('start_dt') else 'soon')
        link = s.get('meeting_link') or ''
        # Student
        try:
            notify_user(user_id=s.get('student_id'), title='Session starting soon',
                        body=f"Your session with {a_name} is at {when}. Join opens on My Bookings when the achiever starts.",
                        type='reminder', reference_type='session', reference_id=s['session_id'])
        except Exception:
            pass
        if s.get('student_email'):
            try:
                send_email(s['student_email'], 'SKOVO — Session starting soon',
                           simple_email_body('Your session is about to begin',
                                             f"Your 1-on-1 with {a_name} is at {when}. Join opens on My Bookings when the achiever starts.",
                                             _stu_url('/bookings'), 'Open My Bookings'))
            except Exception:
                pass
        # Achiever
        if s.get('mentor_id'):
            if link:
                a_body = f"Your 1-on-1 with {s_name} starts in ~15 minutes. Join with your meeting link."
            else:
                a_body = (f"Your 1-on-1 with {s_name} starts in 15 minutes. "
                          "Add a Meet or Teams link or they cannot join.")
            try:
                notify_user(user_id=s.get('mentor_id'), title='Session starting soon',
                            body=a_body, type='reminder', reference_type='session',
                            reference_id=s['session_id'])
            except Exception:
                pass
            if s.get('achiever_email'):
                try:
                    send_email(s['achiever_email'], 'SKOVO — Session starting soon',
                               simple_email_body('Your session starts soon', a_body,
                                                 link or _ach_url('/bookings'),
                                                 'Join Session' if link else 'Add the meeting link'))
                except Exception:
                    pass
        call_proc_one('sp_scheduler_mark_session_reminder_sent', s['session_id'])
        sent += 1
    if sent:
        db.session.commit()
        logger.info(f"1-on-1 reminders: sent {sent}")


# ── Job 2: release abandoned paid 1-on-1 holds ────────────────────────────────

def _sweep_abandoned_holds():
    from portal.models import db
    from portal.helpers.sp import call_proc_one
    # ── SP: sp_scheduler_sweep_abandoned_holds ──────────────────────────────────
    result = call_proc_one('sp_scheduler_sweep_abandoned_holds', 15) or {}
    freed = result.get('freed') or 0
    if freed:
        db.session.commit()
        logger.info(f"sweep: released {freed} stale hold(s)")


def _community_expiry():
    """Delete chat past the admin chat window, and document files past the file window.

    The day counts are read from community_retention on every run. The file is
    removed from storage first, then the database row, so a link cannot be
    opened after the window.
    """
    from portal.models import db
    from portal.helpers.sp import call_proc, call_proc_one
    from portal.helpers.storage import delete_file

    row = call_proc_one('sp_community_retention_get') or {}
    try:
        chat_days = int(row.get('chat_days'))
        file_days = int(row.get('file_days'))
    except (TypeError, ValueError):
        logger.warning("community expiry skipped — retention settings are missing")
        return
    if chat_days < 1 or file_days < 1:
        logger.warning("community expiry skipped — retention settings are missing")
        return

    due = call_proc('sp_community_files_due', chat_days, file_days) or []
    removed_files = 0
    for item in due:
        url = item.get('media_url')
        if url and delete_file(url):
            removed_files += 1
    result = call_proc_one('sp_community_purge', chat_days, file_days) or {}
    db.session.commit()
    posts = int(result.get('posts_removed') or 0)
    messages = int(result.get('messages_removed') or 0)
    if posts or messages or removed_files:
        logger.info(
            "community expiry: %s post(s), %s message(s), %s file(s) removed "
            "(chat %s days, documents %s days)",
            posts, messages, removed_files, chat_days, file_days,
        )
