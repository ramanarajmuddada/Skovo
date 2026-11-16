"""
Celery background job setup for SKOVO.

Start worker:
    celery -A portal.celery_app.celery worker --loglevel=info

Requires:
    pip install celery[redis]
    REDIS_URL=redis://localhost:6379/0  (in .env)
"""
import os
from celery import Celery

celery = Celery(
    'skovo',
    broker=os.environ.get('REDIS_URL', 'redis://localhost:6379/0'),
    backend=os.environ.get('REDIS_URL', 'redis://localhost:6379/0'),
)

celery.conf.update(
    task_serializer='json',
    accept_content=['json'],
    result_serializer='json',
    timezone='Asia/Kolkata',
    enable_utc=True,
    task_track_started=True,
    beat_schedule={
        'cleanup-expired-otps': {
            'task': 'portal.celery_app.cleanup_expired_otps',
            'schedule': 3600.0,  # every hour
        },
        'scan-session-reminders': {
            'task': 'portal.celery_app.scan_session_reminders',
            'schedule': 1800.0,  # every 30 minutes
        },
        # Replaces sweep-abandoned-session-holds, which ran every 10 minutes
        # against a hardcoded 15-minute cutoff. A slot held for a 10-minute
        # payment window could therefore sit dead for up to 25 minutes. This
        # runs every minute and takes its deadline from each hold's own
        # expires_at, so the window is what payment_settings says it is.
        'expire-payment-holds': {
            'task': 'portal.celery_app.expire_payment_holds',
            'schedule': 60.0,  # every minute
        },
        # The safety net for payments the webhook never confirmed. Without it a
        # student whose browser closed mid-payment is charged and gets nothing:
        # expire-payment-holds frees the slot on a timer without ever asking the
        # gateway whether the money actually arrived.
        'reconcile-stuck-orders': {
            'task': 'portal.celery_app.reconcile_stuck_orders',
            'schedule': 300.0,  # every 5 minutes
        },
        # Achiever lifecycle upkeep. Nightly rather than hourly: a suspension
        # ending is not time-critical, and standing computed too often reacts
        # to single sessions instead of a trend.
        'achiever-nightly': {
            'task': 'portal.celery_app.achiever_nightly',
            'schedule': 86400.0,  # daily
        },
    },
)


@celery.task(name='portal.celery_app.send_enrollment_confirmation')
def send_enrollment_confirmation(user_id: str, cohort_id: str, email: str, cohort_title: str):
    """Send enrollment confirmation email (placeholder — wire to your email provider)."""
    import logging
    logger = logging.getLogger('skovo.celery')
    logger.info(f"[CELERY] Sending enrollment confirmation to {email} for cohort '{cohort_title}'")
    # TODO: integrate with SendGrid / AWS SES / Mailgun


@celery.task(name='portal.celery_app.expire_payment_holds')
def expire_payment_holds():
    """Release reservations whose payment never completed. Runs every minute.

    Supersedes sweep_abandoned_session_holds. Three differences that matter:

      * the deadline is each hold's own expires_at, set from
        payment_settings.hold_minutes, instead of a 15-minute constant that
        disagreed with it;
      * abandoned orders are marked 'expired' rather than DELETEd, so a student
        asking why their booking vanished can still be answered;
      * cohort seats are released too, which the old sweep never touched.

    Safe to run concurrently with itself: every release re-checks that no
    payment actually succeeded before giving the seat back.
    """
    import logging
    logger = logging.getLogger('skovo.celery')
    try:
        from portal import InitApp
        app = InitApp().app()
    except Exception as e:
        logger.error(f"[CELERY] expire_payment_holds: app init failed: {e}")
        return

    with app.app_context():
        try:
            from portal.models import db
            from portal.helpers.sp import call_proc_one
            # ── SP: sp_payment_expire_holds ─────────────────────────────────
            r = call_proc_one('sp_payment_expire_holds') or {}
            db.session.commit()
            slots   = r.get('slots_released') or 0
            orphans = r.get('orphan_holds_released') or 0
            seats   = r.get('cohort_seats_released') or 0
            if slots or orphans or seats:
                logger.info(
                    f"[CELERY] expire_payment_holds: {slots} slot(s), "
                    f"{orphans} orphan hold(s), {seats} cohort seat(s) released"
                )
        except Exception as e:
            logger.error(f"[CELERY] expire_payment_holds failed: {e}")


@celery.task(name='portal.celery_app.reconcile_stuck_orders')
def reconcile_stuck_orders():
    """Recover payments the webhook never confirmed. See helpers/reconcile.py.

    Thin wrapper on purpose: the logic is testable without a Celery worker, and
    an operator can run it by hand during an incident.
    """
    import logging
    logger = logging.getLogger('skovo.celery')
    try:
        from portal import InitApp
        app = InitApp().app()
    except Exception as e:
        logger.error(f"[CELERY] reconcile_stuck_orders: app init failed: {e}")
        return

    with app.app_context():
        try:
            from portal.helpers.reconcile import reconcile_stuck_orders as run
            run()
        except Exception as e:
            from portal.models import db
            db.session.rollback()
            logger.error(f"[CELERY] reconcile_stuck_orders failed: {e}")


@celery.task(name='portal.celery_app.achiever_nightly')
def achiever_nightly():
    """Lift finished suspensions, then recompute standing.

    Order matters: an achiever reinstated this morning should be included in
    tonight's standing pass rather than waiting another full day to reappear
    in the rankings.
    """
    import logging
    logger = logging.getLogger('skovo.celery')
    try:
        from portal import InitApp
        app = InitApp().app()
    except Exception as e:
        logger.error(f"[CELERY] achiever_nightly: app init failed: {e}")
        return

    with app.app_context():
        from portal.models import db
        from portal.helpers.sp import call_proc_one
        try:
            lifted = (call_proc_one('sp_achiever_lift_suspensions') or {}).get('reinstated') or 0
            db.session.commit()
            if lifted:
                logger.info(f"[CELERY] achiever_nightly: {lifted} suspension(s) lifted")
        except Exception as e:
            db.session.rollback()
            logger.error(f"[CELERY] lift_suspensions failed: {e}")

        try:
            r = call_proc_one('sp_achiever_recompute_standing') or {}
            db.session.commit()
            logger.info(
                "[CELERY] standing: %s spotlight, %s established, %s new, %s at risk",
                r.get('spotlight') or 0, r.get('established') or 0,
                r.get('new_achievers') or 0, r.get('at_risk') or 0)
        except Exception as e:
            db.session.rollback()
            logger.error(f"[CELERY] recompute_standing failed: {e}")


@celery.task(name='portal.celery_app.cleanup_expired_otps')
def cleanup_expired_otps():
    """Delete OTP records older than 1 hour."""
    import logging
    logger = logging.getLogger('skovo.celery')
    try:
        from portal.models import db
        from portal.helpers.sp import call_proc_one
        # ── SP: sp_scheduler_cleanup_expired_otps ────────────────────────────────
        result = call_proc_one('sp_scheduler_cleanup_expired_otps', 1) or {}
        db.session.commit()
        logger.info(f"[CELERY] Cleaned {result.get('deleted') or 0} expired OTP records")
    except Exception as e:
        logger.error(f"[CELERY] cleanup_expired_otps failed: {e}")


@celery.task(name='portal.celery_app.generate_session_reminder')
def generate_session_reminder(session_id: str, user_id: str, achiever_name: str, slot_date: str):
    """Send a reminder notification 1 day before a booked session."""
    import logging
    logger = logging.getLogger('skovo.celery')
    try:
        from portal.helpers.notifications import notify_user
        notify_user(
            user_id=user_id,
            title='Session Tomorrow!',
            body=f"Reminder: your session with {achiever_name} is tomorrow ({slot_date}).",
            type='reminder',
            reference_type='session',
            reference_id=session_id,
        )
        logger.info(f"[CELERY] Session reminder sent to user {user_id}")
    except Exception as e:
        logger.error(f"[CELERY] generate_session_reminder failed: {e}")


@celery.task(name='portal.celery_app.scan_session_reminders')
def scan_session_reminders():
    """Find confirmed 1-on-1 sessions starting within the next ~24h and send a
    one-time reminder (in-app + email). Runs every 30 min; the `reminder_sent`
    flag prevents duplicates."""
    import logging
    logger = logging.getLogger('skovo.celery')
    try:
        from portal import InitApp
        app = InitApp().app()
    except Exception as e:
        logger.error(f"[CELERY] scan_session_reminders: app init failed: {e}")
        return

    with app.app_context():
        try:
            from portal.models import db
            from portal.helpers.sp import call_proc, call_proc_one
            from portal.helpers.notifications import notify_user
            from portal.helpers.email_template import send_email, simple_email_body

            # ── SP: sp_scheduler_due_session_reminders, sp_scheduler_mark_session_reminder_sent ─
            sessions = call_proc('sp_scheduler_due_session_reminders')
            sent = 0
            for s in sessions:
                a_name = s.get('achiever_name') or 'your mentor'
                when = s['start_dt'].strftime('%d %b, %I:%M %p') if s.get('start_dt') else ''
                link = s.get('meeting_link')

                try:
                    notify_user(user_id=s.get('student_id'), title='Session Reminder',
                                body=f"Your session with {a_name} is at {when}." + (f" Join: {link}" if link else ""),
                                type='reminder', reference_type='session', reference_id=s['session_id'])
                except Exception:
                    pass
                if s.get('student_email'):
                    try:
                        send_email(s['student_email'], 'SKOVO — Session Reminder',
                                   simple_email_body('Your session is coming up',
                                                     f"Your 1-on-1 with {a_name} is at {when}.",
                                                     link, 'Join Session'))
                    except Exception:
                        pass

                call_proc_one('sp_scheduler_mark_session_reminder_sent', s['session_id'])
                sent += 1

            db.session.commit()
            logger.info(f"[CELERY] scan_session_reminders sent {sent} reminder(s)")
        except Exception as e:
            logger.error(f"[CELERY] scan_session_reminders failed: {e}")


@celery.task(name='portal.celery_app.sweep_abandoned_session_holds')
def sweep_abandoned_session_holds():
    """Backstop for the 2-step paid booking: release slots held by unpaid pending
    sessions older than 15 minutes (student abandoned the checkout popup and the
    on-dismiss release never fired). Runs every 10 minutes."""
    import logging
    logger = logging.getLogger('skovo.celery')
    try:
        from portal import InitApp
        app = InitApp().app()
    except Exception as e:
        logger.error(f"[CELERY] sweep_abandoned_session_holds: app init failed: {e}")
        return

    with app.app_context():
        try:
            from portal.models import db
            from portal.helpers.sp import call_proc_one
            # ── SP: sp_scheduler_sweep_abandoned_holds ──────────────────────────────
            result = call_proc_one('sp_scheduler_sweep_abandoned_holds', 15) or {}
            db.session.commit()
            logger.info(f"[CELERY] sweep_abandoned_session_holds released {result.get('freed') or 0} stale hold(s)")
        except Exception as e:
            logger.error(f"[CELERY] sweep_abandoned_session_holds failed: {e}")
