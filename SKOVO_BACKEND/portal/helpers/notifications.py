import os
import uuid
import logging

logger = logging.getLogger("skovo")

# Notification types important enough to also push over SMS/WhatsApp when enabled.
_MULTICHANNEL_TYPES = {'reminder', 'payment', 'session', 'cohort'}


def notify_user(user_id, title, body, type='system', reference_type=None, reference_id=None):
    """Create a NotificationLog entry for a user, plus best-effort SMS/WhatsApp.

    SMS/WhatsApp are env-gated (NOTIFY_SMS_ENABLED / NOTIFY_WHATSAPP_ENABLED) and
    no-op by default, so there is zero extra cost or DB work until you turn them on.
    """
    try:
        from portal.models import db
        from portal.helpers.sp import call_proc_one

        # ── SP: sp_notification_logs_create ──────────────────────────────────────
        n = call_proc_one(
            'sp_notification_logs_create',
            str(uuid.uuid4()), str(user_id), title, body, None, 'sent', type,
            reference_type, str(reference_id) if reference_id else None,
            0, None, None, None,
        )
        db.session.commit()

        # Best-effort multichannel push for high-value notifications.
        if type in _MULTICHANNEL_TYPES and (
            os.environ.get('NOTIFY_SMS_ENABLED') == '1' or os.environ.get('NOTIFY_WHATSAPP_ENABLED') == '1'
        ):
            _push_multichannel(user_id, title, body)
        return n
    except Exception as e:
        logger.error(f"notify_user failed: {e}")
        try:
            from portal.models import db
            db.session.rollback()
        except Exception:
            pass
        return None


def _push_multichannel(user_id, title, body):
    try:
        from portal.helpers.sp import call_proc_one
        # ── SP: sp_users_get ─────────────────────────────────────────────────────
        u = call_proc_one('sp_users_get', str(user_id))
        phone = u.get('phone') if u else None
        if not phone:
            return
        from portal.helpers.messaging import send_sms, send_whatsapp
        text = f"{title}: {body}"
        send_sms(phone, text[:300])
        # Templated WhatsApp uses an approved template; the body is passed as params.
        tmpl = os.environ.get('WHATSAPP_NOTIFY_TEMPLATE')
        if tmpl:
            send_whatsapp(phone, tmpl, params=[title, body])
    except Exception as e:
        logger.error(f"multichannel push failed: {e}")
