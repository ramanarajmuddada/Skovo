import uuid
import json
import logging

logger = logging.getLogger("skovo")


def track_event(event_type, entity_type=None, entity_id=None, user_id=None, meta=None, req=None):
    """Write a platform_analytics event row. Fire-and-forget — never raises."""
    try:
        from portal.models import db
        from portal.helpers.sp import call_proc_one

        ip_address, user_agent = None, None
        if req:
            ip_address = req.environ.get('HTTP_X_REAL_IP', req.remote_addr)
            user_agent = req.headers.get('User-Agent', '')[:512]

        # ── SP: sp_platform_analytics_create ─────────────────────────────────────
        call_proc_one(
            'sp_platform_analytics_create',
            str(uuid.uuid4()), event_type, entity_type,
            str(entity_id) if entity_id else None, str(user_id) if user_id else None,
            json.dumps(meta or {}), None, ip_address, user_agent,
        )
        db.session.commit()
    except Exception as e:
        logger.error(f"track_event failed: {e}")
        try:
            from portal.models import db
            db.session.rollback()
        except Exception:
            pass

    # Mirror the event to Zoho (CRM/Campaigns/Analytics) — no-op unless
    # ZOHO_WEBHOOK_URL is set; runs on its own thread so it never blocks.
    try:
        from portal.helpers.zoho_bridge import send_to_zoho
        send_to_zoho(event_type, entity_type, entity_id, user_id, meta)
    except Exception:
        pass
