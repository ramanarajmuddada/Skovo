"""Class-day rules for cohorts and 1-on-1 sessions.

One place for: the Start window, the End session window, missed classes,
automatic close, the time-change lock, reminders and achiever strikes. Every
number comes from `class_rules` (Admin > Wallet & refunds > Class rules).

Only classes created on or after class_rules.live_from follow these rules.
Older classes keep the old behaviour, so none is ever marked missed.

Example, a 5:15-6:15 PM class with the defaults:
    Start opens 5:10, closes 5:20 (not started -> missed, 100% back, strikes)
    meeting link only after Start; End session from 6:10; closes itself 7:15
    the achiever's money is released 24 hours after the class ends.
"""
import datetime as _dt
import logging

from portal.models import db
from portal.helpers.sp import call_proc, call_proc_one

log = logging.getLogger(__name__)

DEFAULTS = {
    'start_before_min': 5, 'start_after_min': 5, 'end_before_min': 5, 'auto_close_min': 60,
    'release_hours': 24, 'change_lock_hours': 24,
    'strike_missed': 2, 'strike_late_cancel': 1, 'strike_left_early': 1,
    'strike_pause_at': 3, 'strike_suspend_at': 5, 'strike_days': 30, 'reminders_on': 1,
    'live_from': None,
}
FIELDS = [k for k in DEFAULTS if k != 'live_from']
REASONS = {'missed': 'Missed class', 'late_cancel': 'Cancelled within 24 hours',
           'left_early': 'Left the class early'}


def rules():
    try:
        r = call_proc_one('sp_class_rules_get') or {}
    except Exception as e:  # table not there yet: old behaviour everywhere
        log.error("class_rules read failed: %s", e)
        r = {}
    out = dict(DEFAULTS)
    out.update({k: v for k, v in r.items() if k in DEFAULTS and v is not None})
    return out


def follows(row, r=None):
    """Does this class follow the new rules (created after they went live)?"""
    r = r or rules()
    lf, created = r.get('live_from'), (row or {}).get('created_at')
    return bool(lf and created and created >= lf)


def _iso(d):
    return d.isoformat() + 'Z' if d else None


def state(row, start, duration, status, r=None, now=None):
    """What the achiever and student may do right now.

    row: the cohort or session row (needs created_at, started_at, ended_at,
    missed_at). start: UTC start. status: effective status
    (upcoming / live / completed / cancelled)."""
    r = r or rules()
    now = now or _dt.datetime.utcnow()
    if not follows(row, r) or not start:
        # Old class: as before -- no Start step, End while live.
        return {'rules': False, 'started': True, 'missed': False, 'can_start': False,
                'can_end': status == 'live', 'start_opens_at': None, 'start_closes_at': None,
                'end_opens_at': None}
    m = lambda n: _dt.timedelta(minutes=int(n or 0))  # noqa: E731
    end = start + m(duration or 60)
    started = bool(row.get('started_at'))
    closed = status in ('completed', 'cancelled') or bool(row.get('ended_at'))
    s_open, s_close, e_open = start - m(r['start_before_min']), start + m(r['start_after_min']), end - m(r['end_before_min'])
    return {
        'rules': True,
        'started': started,
        'missed': bool(row.get('missed_at')),
        'can_start': not started and not closed and s_open <= now <= s_close,
        'start_late': not started and not closed and now > s_close,
        'can_end': started and not closed and now >= e_open,
        'start_opens_at': _iso(s_open), 'start_closes_at': _iso(s_close), 'end_opens_at': _iso(e_open),
        'started_at': _iso(row.get('started_at')), 'ended_at': _iso(row.get('ended_at')),
    }


def timeline(row, start, duration, r=None):
    """What actually happened, for admin's class details: Start (and how late),
    End (by the achiever or closed automatically), missed, moved, paid."""
    if not row:
        return None
    r = r or rules()
    m = lambda n: _dt.timedelta(minutes=int(n or 0))  # noqa: E731
    end = start + m(duration or 60) if start else None
    started, ended = row.get('started_at'), row.get('ended_at')
    auto = bool(ended and end and ended >= end + m(r['auto_close_min']) - m(1))
    return {
        'rules': follows(row, r),
        'started_at': _iso(started),
        'late_min': max(0, int((started - start).total_seconds() // 60)) if started and start else 0,
        'ended_at': _iso(ended),
        'ended_by': ('auto' if auto else 'achiever') if ended else None,
        'missed_at': _iso(row.get('missed_at')),
        'start_closes_at': _iso(start + m(r['start_after_min'])) if start else None,
        'rescheduled_at': _iso(row.get('rescheduled_at')),
        'paid_at': _iso(ended + _dt.timedelta(hours=int(r['release_hours']))) if ended else None,
    }


def change_locked(start, r=None):
    """Achiever may not change the time (or ask to) inside the lock window."""
    r = r or rules()
    return bool(start) and start - _dt.datetime.utcnow() < _dt.timedelta(hours=int(r['change_lock_hours']))


def lock_message(r=None):
    r = r or rules()
    return (f"The time can't be changed within {r['change_lock_hours']} hours of the class. "
            "If you can't make it, cancel the class: every student gets 100% back.")


def complaint_open(row, r=None):
    """Students can report a problem until the money is released."""
    r = r or rules()
    ended = row.get('ended_at')
    return bool(ended) and _dt.datetime.utcnow() < ended + _dt.timedelta(hours=int(r['release_hours']))


def paused(achiever_id):
    try:
        row = call_proc_one('sp_achiever_strike_points', achiever_id) or {}
        return bool(row.get('paused_at')) or row.get('state') in ('suspended', 'banned')
    except Exception:
        return False


PAUSED_MSG = "This achiever isn't taking new bookings right now."


# ── Refunds when it is not the student's fault ──────────────────────────────
def refund_cohort_seats(cohort_id, case_key, reason, actor_id=None, suffix='ac'):
    """100% back to every paid student's wallet and cancel every seat.
    Raises if a refund fails, so the caller can stop and leave the class as is."""
    from portal.helpers.refunds import issue_refund
    rows = [e for e in (call_proc('sp_cohort_enrollments_list', 50000, 0) or [])
            if e.get('cohort_id') == cohort_id and e.get('payment_status') in ('paid', 'free')]
    refunded = 0
    for e in rows:
        oid, amt = e.get('payment_order_id'), float(e.get('amount_paid') or 0)
        if e.get('payment_status') == 'paid' and oid and amt > 0:
            ok, info = issue_refund(oid, amt, reason, actor_id=actor_id,
                                    refund_key='rf-%s-%s' % (str(oid)[:22], suffix), case_key=case_key)
            # Already refunded (an earlier run got this far and then stopped):
            # the money is back, so carry on and cancel the seat.
            if not ok and not _order_refunded(oid):
                db.session.rollback()
                raise RuntimeError(f'refund failed for {oid}: {info}')
            refunded += 1
        call_proc_one('sp_student_cohort_booking_cancel', e['id'], None, 1)
    db.session.commit()
    return rows, refunded


def _order_refunded(order_id):
    """True when the order's money is already fully back (status refunded)."""
    from portal.helpers.refunds import lookup_order
    row = lookup_order(order_id)
    if not row:
        return False
    _, _, gross, status, already = row
    return status == 'refunded' or float(already or 0) >= float(gross or 0) > 0


def _session_set_payment(s, payment_status):
    call_proc_one(
        'sp_achiever_sessions_update',
        s['id'], s.get('mentor_id'), s.get('student_id'), s.get('note'), s.get('mentor_notes'),
        s.get('meeting_link'), s.get('status'), s.get('amount'), s.get('platform_fee'),
        s.get('achiever_earning'), payment_status, s.get('payment_order_id'), s.get('payment_id'),
        s.get('reminder_sent'), s.get('no_show'), s.get('coupon_code'), s.get('discount_amount'),
        s.get('created_by'), s.get('updated_by'),
    )


def refund_session(session_id, case_key, reason, actor_id=None, suffix='as'):
    """100% back to the student's wallet for a 1-on-1. Returns the amount."""
    from portal.helpers.refunds import issue_refund
    s = call_proc_one('sp_achiever_sessions_get', session_id)
    if not s or s.get('payment_status') != 'paid' or not s.get('payment_order_id'):
        return 0.0
    amt = float(s.get('amount') or 0)
    if amt > 0:
        ok, info = issue_refund(s['payment_order_id'], amt, reason, actor_id=actor_id,
                                refund_key='rf-%s-%s' % (str(s['payment_order_id'])[:22], suffix),
                                case_key=case_key)
        if not ok and not _order_refunded(s['payment_order_id']):
            db.session.rollback()
            raise RuntimeError(f"refund failed for session {session_id}: {info}")
    s = call_proc_one('sp_achiever_sessions_get', session_id)
    _session_set_payment(s, 'refunded')
    db.session.commit()
    return amt


def inr(v):
    from portal.helpers.refunds import inr as _inr
    return _inr(v)


# ── Strikes ─────────────────────────────────────────────────────────────────
def _tell(achiever_id, title, body, kind=None, ref_id=None):
    """Tell the achiever in-app and by email. `kind` ('cohort' / 'session')
    makes the tap and the email button open that class's screen; without it
    (strikes, pause, suspension) both open the dashboard."""
    try:
        from portal.helpers.achiever_notify import tell_achiever, achiever_url
        if kind == 'session':
            url, label, ref = achiever_url('/bookings'), 'Open my bookings', 'session'
        elif kind == 'cohort':
            url, label, ref = achiever_url('/cohorts'), 'Open my classes', 'cohort'
        else:
            url, label, ref = achiever_url(''), 'Open my dashboard', 'strike'
        tell_achiever(achiever_id, title, body, type='system', button_url=url, button_label=label,
                      reference_type=ref, reference_id=ref_id or achiever_id)
    except Exception as e:
        log.error("tell achiever %s failed: %s", achiever_id, e)


def add_strike(achiever_id, reason, source_type=None, source_id=None, note=None, by=None):
    """Give a strike and apply the level it reaches. Never raises."""
    try:
        r = rules()
        pts = int(r.get(f'strike_{reason}') or 1)
        row = call_proc_one('sp_achiever_strike_add', achiever_id, reason, pts,
                            source_type, source_id, (note or '')[:500] or None, by) or {}
        db.session.commit()
        _enforce(achiever_id, reason, row, r)
    except Exception as e:
        db.session.rollback()
        log.error("strike %s for %s failed: %s", reason, achiever_id, e)


def _enforce(achiever_id, reason, row, r):
    points, st = int(row.get('points') or 0), row.get('state')
    if st in ('suspended', 'banned'):
        return
    why = REASONS.get(reason, reason)
    days = r['strike_days']
    if points >= int(r['strike_suspend_at']):
        suspend(achiever_id, f"{points} strikes in {days} days (last: {why}).")
        return
    if points >= int(r['strike_pause_at']) or (st == 'probation' and reason == 'missed'):
        call_proc_one('sp_achiever_set_paused', achiever_id, 1)
        db.session.commit()
        _tell(achiever_id, 'New classes paused',
              f"{why}. You now have {points} strikes in {days} days, so new classes and bookings are paused "
              "until an admin reviews your account. Classes already booked still run.")
        return
    left = int(r['strike_pause_at']) - points
    _tell(achiever_id, 'You got a strike',
          f"{why}. You have {points} strike{'s' if points != 1 else ''} in the last {days} days. "
          f"{left} more pause{'s' if left == 1 else ''} new classes.")


def suspend(achiever_id, reason):
    """Suspend and give every upcoming student 100% back."""
    try:
        call_proc_one('sp_achiever_set_state', achiever_id, 'suspended', reason, None, None, 'system')
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        log.error("suspend %s failed: %s", achiever_id, e)
        return
    import types
    from portal.helpers.helpers import effective_cohort_status
    for c in call_proc('sp_cohorts_list', 5000, 0) or []:
        if c.get('achiever_id') != achiever_id or c.get('deleted_at'):
            continue
        if effective_cohort_status(types.SimpleNamespace(status=c.get('status'), session_date=c.get('session_date'),
                                                         duration_minutes=c.get('duration_minutes'))) != 'upcoming':
            continue
        try:
            refund_cohort_seats(c['id'], 'achiever_cancel', 'Achiever suspended', suffix='su')
            _cancel_cohort_row(c['id'])
        except Exception as e:
            log.error("suspend: cohort %s refund failed: %s", c['id'], e)
    for s in call_proc('sp_achiever_sessions_list', 50000, 0) or []:
        if s.get('mentor_id') != achiever_id or s.get('status') not in ('pending', 'confirmed'):
            continue
        try:
            call_proc_one('sp_achiever_session_set_status', s['id'], achiever_id, 'cancelled', None, None, None)
            db.session.commit()
            refund_session(s['id'], 'achiever_cancel', 'Achiever suspended', suffix='su')
        except Exception as e:
            log.error("suspend: session %s refund failed: %s", s['id'], e)
    _tell(achiever_id, 'Account suspended',
          f"{reason} Your upcoming classes were cancelled and students got 100% back. Contact SKOVO support.")


def _cancel_cohort_row(cohort_id):
    from sqlalchemy import text
    db.session.execute(text("UPDATE cohorts SET status = 'cancelled', updated_at = UTC_TIMESTAMP() WHERE id = :i"),
                       {'i': cohort_id})
    db.session.commit()


# ── The watcher (every minute) ──────────────────────────────────────────────
def _ist(d):
    return (d + _dt.timedelta(minutes=330)).strftime('%I:%M %p').lstrip('0')


def _notify(user_id, title, body, ref_type, ref_id):
    try:
        from portal.helpers.notifications import notify_user
        notify_user(user_id, title, body, type='session' if ref_type == 'session' else 'cohort',
                    reference_type=ref_type, reference_id=ref_id)
    except Exception as e:
        log.error("notify %s failed: %s", user_id, e)


def _reminders(kind, row, start, now, r, achiever_id, student_ids, title):
    """Send what is due once: d1 (day before), h1 (1 hour), start (Start now), last (3 min left)."""
    if not int(r['reminders_on']):
        return
    m = lambda n: _dt.timedelta(minutes=int(n))  # noqa: E731
    sent = set(filter(None, (row.get('reminders_sent') or '').split(',')))
    close = start + m(r['start_after_min'])
    due = None
    if start - m(r['start_before_min']) <= now < close - m(3):
        due = 'start'
    elif close - m(3) <= now <= close:
        due = 'last'
    elif start - m(60) <= now < start - m(r['start_before_min']):
        due = 'h1'
    elif start - _dt.timedelta(hours=24) <= now < start - m(60):
        due = 'd1'
    if not due or due in sent:
        return
    # Claim it first. The watcher runs in more than one process (web + scheduler),
    # and both can see the same row in the same minute: only the one whose
    # conditional UPDATE lands sends, so a reminder never goes out twice.
    from sqlalchemy import text as _t
    table = 'cohorts' if kind == 'cohort' else 'achiever_sessions'
    old = row.get('reminders_sent') or ''
    new = ','.join(sorted(sent | {due}))
    claimed = db.session.execute(_t(
        f"UPDATE `{table}` SET reminders_sent = :new WHERE id = :i AND IFNULL(reminders_sent, '') = :old"),
        {'new': new, 'i': row['id'], 'old': old}).rowcount
    db.session.commit()
    if not claimed:
        return
    when = _ist(start)
    if due == 'd1':
        _tell(achiever_id, 'Class tomorrow', f"'{title}' is tomorrow at {when}. {len(student_ids)} booked.",
              kind, row['id'])
    elif due == 'h1':
        # Booked at short notice: say the real time left, not "1 hour".
        left = int((start - now).total_seconds() // 60)
        head = 'Class in 1 hour' if left >= 55 else f'Class in {max(left, 1)} min'
        _tell(achiever_id, head, f"'{title}' starts at {when}. Press Start from "
              f"{_ist(start - m(r['start_before_min']))}.", kind, row['id'])
        for u in student_ids:
            _notify(u, head, f"'{title}' starts at {when}. Join opens when the achiever starts.", kind, row['id'])
    elif due == 'start':
        _tell(achiever_id, 'Start your class now', f"'{title}' starts at {when}. Students are waiting. "
              f"Press Start before {_ist(close)}.", kind, row['id'])
    else:
        _tell(achiever_id, '3 minutes left to start',
              f"Press Start for '{title}' before {_ist(close)}, or the class is marked missed and students get 100% back.", kind, row['id'])


def _miss_cohort(c):
    try:
        rows, _ = refund_cohort_seats(c['id'], 'achiever_no_show', 'Achiever did not start the class', suffix='ns')
    except Exception as e:
        log.error("missed cohort %s: refund failed, retrying next minute: %s", c['id'], e)
        return
    if not _claim_missed('cohorts', c['id']):
        return
    call_proc_one('sp_class_mark', 'cohort', c['id'], 'missed', None)
    db.session.commit()
    title = c.get('title') or 'Your class'
    if not rows:
        _tell(c['achiever_id'], 'Class closed', f"'{title}' was not started and nobody had booked, so it was closed.", 'cohort', c['id'])
        return
    total = sum(float(e.get('amount_paid') or 0) for e in rows if e.get('payment_status') == 'paid')
    for e in rows:
        amt = float(e.get('amount_paid') or 0) if e.get('payment_status') == 'paid' else 0
        _notify(e['user_id'], "The achiever didn't join",
                f"'{title}' did not start. " + (f"{inr(amt)} is back in your SKOVO Wallet." if amt else 'Your seat is cancelled.'),
                'cohort', c['id'])
    call_proc_one('sp_class_issue_add', 'missed', 'cohort', c['id'], None, c['achiever_id'], None,
                  f"Not started by the cut-off. {len(rows)} booked, {inr(total)} back to wallets.", 'closed')
    db.session.commit()
    add_strike(c['achiever_id'], 'missed', 'cohort', c['id'], note=title)


def _close_cohort(c):
    from sqlalchemy import text
    db.session.execute(text("UPDATE cohorts SET status = 'completed', updated_at = UTC_TIMESTAMP() WHERE id = :i"),
                       {'i': c['id']})
    call_proc_one('sp_cohort_mark_ended', c['id'])
    db.session.commit()
    title = c.get('title') or 'Your class'
    if int(c.get('booked') or 0) and not int(c.get('attended') or 0):
        call_proc_one('sp_class_issue_add', 'no_checkins', 'cohort', c['id'], None, c['achiever_id'], None,
                      'Started, but nobody checked in. Closed automatically; money held until admin checks.', 'open')
        db.session.commit()
    try:
        call_proc_one('sp_achiever_demo_complete', c['achiever_id'])
        db.session.commit()
    except Exception:
        db.session.rollback()
    # Its tasks open now: tell the students who checked in.
    try:
        from portal.routes.Achiever.achiever import _open_tasks_now
        _open_tasks_now(call_proc_one('sp_cohorts_get', c['id']) or c)
    except Exception as e:
        log.error("open tasks after auto close %s: %s", c.get('id'), e)
    _tell(c['achiever_id'], 'Class closed automatically',
          f"'{title}' was closed because End session was not pressed. Please press End session next time.", 'cohort', c['id'])


def _session_title(session_id):
    """The 1-on-1's own title (from its booked slot), not a generic label."""
    try:
        from sqlalchemy import text as _t
        t = db.session.execute(_t(
            "SELECT sl.title FROM achiever_slots sl WHERE sl.session_id = :s AND sl.title IS NOT NULL LIMIT 1"),
            {'s': session_id}).scalar()
        return t or '1-on-1 session'
    except Exception:
        return '1-on-1 session'


def _claim_missed(table, row_id):
    """Mark missed only if nobody has yet. Two watcher runs can read the same
    stale row; only the one whose UPDATE lands gives the strike and the notices."""
    from sqlalchemy import text as _t
    n = db.session.execute(_t(
        f"UPDATE `{table}` SET missed_at = UTC_TIMESTAMP() WHERE id = :i AND missed_at IS NULL"),
        {'i': row_id}).rowcount
    db.session.commit()
    return bool(n)


def _miss_session(s):
    try:
        amt = refund_session(s['id'], 'achiever_no_show', 'Achiever did not start the session', suffix='ns')
    except Exception as e:
        log.error("missed session %s: refund failed, retrying next minute: %s", s['id'], e)
        return
    if not _claim_missed('achiever_sessions', s['id']):
        return
    call_proc_one('sp_class_mark', 'session', s['id'], 'missed', None)
    call_proc_one('sp_class_issue_add', 'missed', 'session', s['id'], s['id'], s['achiever_id'], s['student_id'],
                  f"1-on-1 not started by the cut-off. {inr(amt)} back to the wallet.", 'closed')
    db.session.commit()
    _notify(s['student_id'], "The achiever didn't join",
            f"'{_session_title(s['id'])}' did not start. " + (f"{inr(amt)} is back in your SKOVO Wallet." if amt else 'It is cancelled.'),
            'session', s['id'])
    add_strike(s['achiever_id'], 'missed', 'session', s['id'], note=_session_title(s['id']))


def _close_session(s):
    call_proc_one('sp_achiever_session_set_status', s['id'], s['achiever_id'], 'completed', None, None, None)
    call_proc_one('sp_session_mark_ended', s['id'])
    db.session.commit()
    if s.get('is_demo'):
        try:
            call_proc_one('sp_achiever_demo_complete', s['achiever_id'])
            db.session.commit()
        except Exception:
            db.session.rollback()


def watch():
    """Every minute: reminders, missed classes, automatic close."""
    r = rules()
    if not r.get('live_from'):
        return 'off'
    # One runner at a time, across every process on the shared database: two
    # copies running at once refunded, then clashed and rolled the rest back.
    # A named lock belongs to one connection, so it is held on its own
    # connection for the whole run (the session's connection goes back to the
    # pool on every commit, and a lock left there would block every later run).
    from sqlalchemy import text
    conn = db.engine.connect()
    try:
        if not conn.execute(text("SELECT GET_LOCK('skovo_class_watch', 0)")).scalar():
            return 'busy'
        try:
            return _watch(r)
        finally:
            conn.execute(text("SELECT RELEASE_LOCK('skovo_class_watch')"))
    finally:
        conn.close()


def _watch(r):
    now = _dt.datetime.utcnow()
    m = lambda n: _dt.timedelta(minutes=int(n or 0))  # noqa: E731
    done = 0
    for c in call_proc('sp_class_watch_cohorts') or []:
        try:
            start = c['session_date']
            end = start + m(c.get('duration_minutes') or 60)
            if not c.get('started_at'):
                if now > start + m(r['start_after_min']):
                    _miss_cohort(c)
                    done += 1
                elif int(c.get('booked') or 0):
                    students = [x['user_id'] for x in (call_proc('sp_cohort_enrolled_students', c['id']) or [])]
                    _reminders('cohort', c, start, now, r, c['achiever_id'], students, c.get('title'))
            elif not c.get('ended_at') and now > end + m(r['auto_close_min']):
                _close_cohort(c)
                done += 1
        except Exception as e:
            db.session.rollback()
            log.error("class watch cohort %s: %s", c.get('id'), e)
    for s in call_proc('sp_class_watch_sessions') or []:
        try:
            start = s['start_utc']
            if not start:
                continue
            end = start + m(s.get('duration_minutes') or 60)
            if not s.get('started_at'):
                if now > start + m(r['start_after_min']):
                    _miss_session(s)
                    done += 1
                else:
                    _reminders('session', s, start, now, r, s['achiever_id'], [s['student_id']], _session_title(s['id']))
            elif not s.get('ended_at') and now > end + m(r['auto_close_min']):
                _close_session(s)
                done += 1
        except Exception as e:
            db.session.rollback()
            log.error("class watch session %s: %s", s.get('id'), e)
    db.session.commit()
    return done


def _span(minutes):
    m = int(minutes or 0)
    if m and m % 60 == 0:
        h = m // 60
        return f"{h} hour{'s' if h != 1 else ''}"
    return f"{m} min"


def guide_tabs():
    """The rules tabs in 'How a cohort works', written from admin's live numbers
    (Class rules and Cancellation rules), so a change in admin shows here at once.
    Example times are for a 5:15-6:15 PM class."""
    import datetime as _d
    from portal.helpers.refunds import student_rules, inr
    r = rules()
    base = _d.datetime(2026, 1, 1, 17, 15)
    t = lambda mins: (base + _d.timedelta(minutes=mins)).strftime('%I:%M').lstrip('0')  # noqa: E731
    sb, sa, eb = int(r['start_before_min']), int(r['start_after_min']), int(r['end_before_min'])
    lock, rel = int(r['change_lock_hours']), int(r['release_hours'])
    day = [
        f"Start opens {sb} min before the class and closes {sa} min after the class time. "
        f"Example: a 5:15 class can be started from {t(-sb)} to {t(sa)}.",
        "Your students get the meeting link only after you press Start. Then share the check-in code.",
        f"Not started by {sa} min after the start time? The class is missed: every student gets 100% back "
        f"and you get {r['strike_missed']} strikes.",
        f"End session opens {eb} min before the class ends ({t(60 - eb)} for a 5:15–6:15 class). Press it when you finish.",
        f"Forgot End session? The class closes itself {_span(r['auto_close_min'])} after it ends.",
        f"You can't change the time within {lock} hours of the class. Before that, students may cancel for 100% back.",
    ]
    if int(r['reminders_on']):
        day.append(f"We remind you the day before and 1 hour before. At {t(-sb)} we tell you to press Start, "
                   f"and at {t(sa - 3)} we warn you that 3 minutes are left.")
    att = [
        "Attendance is marked only when a student enters your check-in code. There are no manual ticks.",
        "Students who never enter the code show as Absent after the class ends.",
        f"Missed class: {r['strike_missed']} strikes.",
        f"Cancelling within {lock} hours of the class: {r['strike_late_cancel']} strike.",
        f"Leaving early (confirmed by admin): {r['strike_left_early']} strike.",
        f"{r['strike_pause_at']} strikes in {r['strike_days']} days pauses new classes until an admin reviews. "
        f"{r['strike_suspend_at']} suspends the account and upcoming students get 100% back.",
        "On probation, one missed class pauses new classes.",
        f"Each strike drops off after {r['strike_days']} days. A fair reason (power cut with proof) can be raised with support.",
    ]
    cancel = student_rules('cohort')
    lines = []
    for i, x in enumerate(cancel):
        h, pct = x['min_hours'], x['pct']
        h_txt = f"{h:g}"
        if len(cancel) == 1:
            when = 'any time'
        elif i == 0:
            when = f"{h_txt} hours or more before"
        elif h == 0:
            when = f"less than {cancel[i - 1]['min_hours']:g} hours before"
        else:
            when = f"{h_txt}–{cancel[i - 1]['min_hours']:g} hours before"
        lines.append(f"Student cancels {when}: "
                     + ('no refund.' if pct <= 0 else f"{pct:g}% back ({inr(500 * pct / 100)} on a {inr(500)} class)."))
    money = [
        "Students pay when they book. SKOVO holds the money until the class is over.",
        f"You're paid {rel} hours after the class ends. If a student reports a problem, only that student's share waits for admin.",
        *lines,
        "Student refunds go to their SKOVO Wallet instantly.",
        f"If you cancel, every student gets 100% back. Within {lock} hours it is also a strike.",
        "After the first booking, the price and offer can't be changed. Seats can only go up.",
    ]
    return [
        {'key': 'day', 'title': 'Class day', 'items': day},
        {'key': 'attendance', 'title': 'Attendance & strikes', 'items': att},
        {'key': 'money', 'title': 'Money & refunds', 'items': money},
    ]
