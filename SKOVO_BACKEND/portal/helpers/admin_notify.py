"""Telling the admin that an achiever is waiting on them.

Achievers submit applications, upload replacement documents, ask for payouts and
raise support issues. None of that reached the admin: it sat in a queue until
someone happened to open the right screen.

Two channels:

  in-app -- one notification_logs row per active admin, keyed on the admin's id.
            That is the id the admin token carries, so the existing
            /notifications endpoints serve the admin bell and page unchanged.

  email  -- sent off the request thread to the same admins, because the admin is
            not always signed in. ADMIN_NOTIFY_EMAIL=0 turns it off.

Call it AFTER the request has committed its own work. It never raises: a failed
alert must not turn a successful submission into an error for the achiever.
"""
import os
import logging

from sqlalchemy import text

from portal.models import db

logger = logging.getLogger("skovo")

ADMIN_PATH = '/skovo-platform-panel-admin/notifications'


def _admin_url():
    base = (os.environ.get('ADMIN_PORTAL_URL') or 'https://skovoai.info').rstrip('/')
    return base + ADMIN_PATH


def _admins():
    """Approved, allow-listed admins as (id, email)."""
    from portal.helpers.platform_admins import is_allowed_admin_email
    rows = db.session.execute(text("SELECT id, email FROM admins WHERE state = 'active'")).fetchall()
    return [(r[0], r[1]) for r in rows if is_allowed_admin_email(r[1])]


def achiever_name(achiever_id):
    try:
        name = db.session.execute(text("SELECT full_name FROM achievers WHERE id = :i"),
                                  {'i': str(achiever_id)}).scalar()
        return (name or '').strip() or 'An achiever'
    except Exception:
        return 'An achiever'


def tell_admins(title, body, *, reference_type, reference_id, once_while_unread=False):
    """Notify every admin. Returns how many were notified.

    once_while_unread: for things that arrive in bursts (several documents,
    several chat messages). An admin who has not yet read the last notification
    about the same item is not told again.
    """
    sent = 0
    try:
        from portal.helpers.notifications import notify_user
        for admin_id, email in _admins():
            if once_while_unread and db.session.execute(text(
                    "SELECT 1 FROM notification_logs WHERE user_id = :u AND reference_type = :t"
                    " AND reference_id = :r AND title = :h AND IFNULL(is_read, 0) = 0 LIMIT 1"),
                    {'u': admin_id, 't': reference_type, 'r': str(reference_id), 'h': title}).first():
                continue
            if notify_user(admin_id, title, body, type='system',
                           reference_type=reference_type, reference_id=reference_id) is None:
                continue
            sent += 1
            if email and os.environ.get('ADMIN_NOTIFY_EMAIL', '1') != '0':
                from portal.helpers.email_template import simple_email_body
                from portal.helpers.achiever_notify import _send_email_async
                _send_email_async(email, f'SKOVO Admin — {title}',
                                  simple_email_body(title, body, _admin_url(), 'Open notifications'))
    except Exception as e:
        logger.error(f"admin notification '{title}' failed: {e}")
        try:
            db.session.rollback()
        except Exception:
            pass
    return sent
