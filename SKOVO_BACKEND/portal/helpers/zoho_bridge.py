"""
App → Zoho event bridge.

Pushes SKOVO lifecycle events to Zoho so the founder's Zoho Workplace
automations (CRM pipelines, Campaigns email sequences, Analytics traction
dashboard) fire on real product activity instead of manual entry.

Design: SKOVO POSTs a small JSON event to a single configurable **Zoho Flow
incoming-webhook URL** (ZOHO_WEBHOOK_URL). The founder builds one Zoho Flow
that receives the event and fans it out to CRM / Campaigns / Analytics — so
the app needs no Zoho OAuth, tokens, or SDK, and this stays a single env var.

No-op until ZOHO_WEBHOOK_URL is set. Best-effort and fire-and-forget: a slow
or failing Zoho endpoint must never block or fail a user's request.

Events the founder's playbook cares about:
  student_registered, app_installed, readiness_completed,
  cohort_enrolled / cohort_payment_captured, cohort_attended,
  session_booked / session_payment_captured, course_payment_captured,
  achiever_applied, achiever_approved, subscription_activated,
  referral_sent, payout_requested, payout_paid.
"""
import os
import json
import logging
import threading

logger = logging.getLogger("skovo")


def _post(url, body):
    try:
        from portal.helpers.http_client import http_session
        http_session().post(url, json=body, timeout=5)
    except Exception as e:
        logger.warning(f"zoho_bridge post failed: {e}")


def send_to_zoho(event_type, entity_type=None, entity_id=None, user_id=None, meta=None):
    """Fire a lifecycle event to the Zoho Flow webhook. No-op if unconfigured."""
    url = os.environ.get('ZOHO_WEBHOOK_URL')
    if not url:
        return
    body = {
        'source': 'skovo-app',
        'event': event_type,
        'entity_type': entity_type,
        'entity_id': str(entity_id) if entity_id else None,
        'user_id': str(user_id) if user_id else None,
        'meta': meta or {},
    }
    # Dispatch off the request thread so Zoho latency never touches the user.
    try:
        threading.Thread(target=_post, args=(url, body), daemon=True).start()
    except Exception as e:
        logger.warning(f"zoho_bridge dispatch failed: {e}")
