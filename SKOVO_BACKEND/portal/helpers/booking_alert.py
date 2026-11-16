"""
Tell the achiever about a new 1-on-1 booking — urgently when it starts soon.

Called after a session is paid (webhook, payment poll, wallet, reconcile) or
booked free. Safe to call more than once: it sends one alert per session.

  * Under 60 minutes to start: "⚡ New booking in 14 min — Resume review, 6:30 PM"
    by app notification and email (SMS / WhatsApp follow the notify settings).
  * Otherwise: "New booking — Resume review, Mon 16 Nov, 6:30 PM".
"""
import datetime
import logging

from sqlalchemy import text

from portal.models import db

logger = logging.getLogger("skovo")
URGENT_MIN = 60


def _ist(dt):
    return dt + datetime.timedelta(minutes=330)


def alert_new_booking(session_id=None, order_id=None):
    try:
        if not session_id and order_id:
            session_id = db.session.execute(text(
                "SELECT s.session_id FROM payment_orders o JOIN achiever_slots s ON s.id = o.slot_id"
                " WHERE o.id = :o AND o.kind = 'session'"), {'o': order_id}).scalar()
        if not session_id:
            return
        if order_id:
            # The student's note waited on the order; the session exists only now.
            db.session.execute(text(
                "UPDATE achiever_sessions x JOIN payment_orders o ON o.id = :o"
                "   SET x.note = o.note"
                " WHERE x.id = :s AND o.note IS NOT NULL AND (x.note IS NULL OR x.note = '')"),
                {'o': order_id, 's': session_id})
            db.session.commit()
        row = db.session.execute(text(
            "SELECT x.mentor_id, u.full_name, s.title, s.start_utc FROM achiever_sessions x"
            "  JOIN achiever_slots s ON s.session_id = x.id"
            "  LEFT JOIN users u ON u.id = x.student_id"
            " WHERE x.id = :s ORDER BY s.start_utc LIMIT 1"), {'s': session_id}).first()
        if not row or not row[3]:
            return
        mentor_id, student, title, start = row
        # One alert per session (the paid paths can each run for the same order).
        sent = db.session.execute(text(
            "SELECT COUNT(*) FROM notification_logs WHERE reference_id = :s AND title LIKE :t"),
            {'s': session_id, 't': '%New booking%'}).scalar()
        if sent:
            return
        mins = int((start - datetime.datetime.utcnow()).total_seconds() // 60)
        when = _ist(start)
        what = title or '1-on-1 session'
        who = student or 'A student'
        if 0 <= mins < URGENT_MIN:
            head = f"⚡ New booking in {max(mins, 1)} min"
            body = f"{what} at {when.strftime('%I:%M %p').lstrip('0')} with {who}. Press Start at the session time."
        else:
            head = "New booking"
            body = f"{what} on {when.strftime('%a %d %b, %I:%M %p')} with {who}."
        from portal.helpers.notifications import notify_user
        notify_user(mentor_id, head, body, type='session', reference_type='session', reference_id=session_id)
        try:
            from portal.helpers.email_template import send_email, simple_email_body
            email = db.session.execute(text("SELECT email FROM achievers WHERE id = :m"), {'m': mentor_id}).scalar()
            if email:
                from portal.helpers.achiever_notify import achiever_url
                send_email(email, f"SKOVO: {head}", simple_email_body(
                    head, body, achiever_url('/bookings'), 'Open my bookings'))
        except Exception as mail_err:
            logger.warning(f"new-booking email failed: {mail_err}")
    except Exception as e:                       # an alert must never break a booking
        logger.warning(f"new-booking alert failed for {session_id or order_id}: {e}")


def alert_cohort_booking(cohort_id=None, student_id=None, order_id=None):
    """Tell the achiever a student took a seat in their cohort (in-app + email).

    1-on-1s already alert on booking; cohort seats told the achiever nothing.
    Called after a seat is confirmed: free/wallet enrolment, a paid webhook,
    or a reconcile. Never raises -- an alert must not break an enrolment.
    """
    try:
        if order_id and not (cohort_id and student_id):
            row = db.session.execute(text(
                "SELECT ref_id, student_id FROM payment_orders WHERE id = :o"), {'o': order_id}).fetchone()
            if not row:
                return
            cohort_id, student_id = cohort_id or row[0], student_id or row[1]
        c = db.session.execute(text(
            "SELECT c.title, c.achiever_id, c.session_date, c.total_seats AS max_seats,"
            " (SELECT COUNT(*) FROM cohort_enrollments e WHERE e.cohort_id = c.id"
            "    AND e.payment_status IN ('paid', 'free')) AS booked"
            " FROM cohorts c WHERE c.id = :c"), {'c': cohort_id}).mappings().first()
        if not c or not c['achiever_id']:
            return
        who = db.session.execute(text("SELECT full_name FROM users WHERE id = :u"),
                                 {'u': student_id}).scalar() or 'A student'
        when = _ist(c['session_date']).strftime('%a %d %b, %I:%M %p') if c['session_date'] else 'soon'
        seats = f" {int(c['booked'] or 0)} of {int(c['max_seats'])} seats taken." if c.get('max_seats') else ''
        from portal.helpers.achiever_notify import tell_achiever, achiever_url
        tell_achiever(c['achiever_id'], 'New booking',
                      f"{who} booked '{c['title']}' on {when}.{seats}",
                      type='cohort', button_url=achiever_url('/cohorts'), button_label='Open my classes',
                      reference_type='cohort', reference_id=cohort_id)
    except Exception as e:
        logger.warning(f"cohort booking alert failed: {e}")
