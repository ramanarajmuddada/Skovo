"""Telling an achiever what an admin just decided about their account.

WHY THIS EXISTS
    Every admin decision in the achiever lifecycle -- approve, reject, send a
    document back, ask for another one, clear a background check, change a demo
    target, suspend, ban, lift a ban, and the overnight job that lifts an
    expired suspension -- changed the database and told nobody. The achiever's
    own screen meanwhile promises, twice, "We will email you when there is a
    decision": once in the toast on submit and again on the banner they stare at
    while waiting.

    Nothing was sending that email. The whole admin area contained exactly one
    notify_user() call and it was addressed to STUDENTS whose bookings had been
    cancelled. An achiever asked for a clearer ID photo found out by logging in
    and noticing. A banned achiever found out by being unable to work.

WHAT IT SENDS
    Two channels, on purpose:

      in-app  -- written synchronously, keyed on the achiever's id. That is the
                 same id their JWT carries, which is what /notifications reads,
                 so the bell in the achiever header picks it up with no other
                 change. This is the durable record.

      email   -- fired off the request thread. send_email() can cost ~15s when
                 SendGrid times out and SMTP takes over, and an admin clicking
                 Approve must not wait for that. Best effort by definition: the
                 decision is already committed and a bounced email must never
                 look like a failed decision.

    The same split admin_achiever_trust.py already uses for its student cascade.

WHAT IT DELIBERATELY DOES NOT DO
    It never raises. A notification failure cannot be allowed to roll back or
    obscure the decision it is reporting -- the ban is the safety-critical half,
    the email is the courtesy. Callers do not need try/except around it.
"""
import os
import threading
import logging

logger = logging.getLogger("skovo")

# Where an achiever goes to act on any of this. One constant rather than a
# string per caller: these all land on the same screen, and a link that 404s
# because one call site spelled the path differently is worse than no link.
VERIFICATION_PATH = '/skovo-achiever-portal/application'
PORTAL_PATH = '/skovo-achiever-portal'


def achiever_url(path=VERIFICATION_PATH):
    """Absolute link into the achiever portal, or None when FRONTEND_URL is unset.

    None on purpose. A button reading "Upload a replacement" that points at
    '/skovo-achiever-portal/application' with no host is a dead link in an email
    client, and a dead button is worse than a paragraph telling them where to
    go — the text of every message says that anyway.
    """
    # The achiever portal is served by the web build on skovoai.com (the admin
    # build on skovoai.info has no achiever routes — a link there is a 404).
    base = (os.environ.get('ACHIEVER_PORTAL_URL') or 'https://skovoai.com').rstrip('/')
    if not path.startswith(PORTAL_PATH):
        path = PORTAL_PATH + (path if path.startswith('/') else '/' + path)
    return f"{base}{path}" if base else None


def _send_email_async(to, subject, html):
    """Send one email off the request thread, swallowing everything."""
    def _run():
        try:
            from portal.helpers.email_template import send_email
            send_email(to, subject, html)
        except Exception as e:
            logger.warning(f"achiever notification email to {to} failed: {e}")

    threading.Thread(target=_run, name='achiever-notify-mail', daemon=True).start()


def tell_achiever(achiever_id, title, body, *, email=True, type='system',
                  button_url=None, button_label='Open SKOVO',
                  reference_type='achiever', reference_id=None):
    """Write the in-app notification and, unless told otherwise, email it.

    `email=False` is for the changes that matter on screen but do not deserve an
    inbox -- a demo target moving from 3 to 1, say. A suspension gets both.

    Every email carries a button. An achiever told their ID was rejected should
    not have to remember the URL, find the login, and navigate to the right
    screen -- the mail that interrupted them should hand them the page that
    fixes it. Callers pass `button_label` to say what the button does; the
    destination defaults to the verification screen because that is where all
    but one of these are actioned.

    Returns True when the in-app row was written.
    """
    ok = False
    try:
        from portal.helpers.notifications import notify_user
        notify_user(str(achiever_id), title, body, type=type,
                    reference_type=reference_type or 'achiever',
                    reference_id=str(reference_id or achiever_id))
        ok = True
    except Exception as e:
        logger.error(f"achiever in-app notification failed for {achiever_id}: {e}")

    if not email:
        return ok

    try:
        from portal.helpers.sp import call_proc_one
        from portal.helpers.email_template import simple_email_body
        row = call_proc_one('sp_achievers_get', str(achiever_id)) or {}
        to = (row.get('email') or '').strip()
        if not to:
            logger.warning(f"achiever {achiever_id} has no email — notification is in-app only")
            return ok
        url = button_url or achiever_url()
        _send_email_async(to, f'SKOVO — {title}',
                          simple_email_body(title, body, url,
                                            button_label if url else None))
    except Exception as e:
        logger.error(f"achiever notification email lookup failed for {achiever_id}: {e}")

    return ok
