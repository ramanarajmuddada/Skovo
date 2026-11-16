"""
Multi-channel messaging — WhatsApp + SMS — for India-first delivery.

Everything is env-gated and fails SOFT (returns False, never raises) so the app
runs unchanged until you add a provider key. Primary provider: MSG91 (SMS +
WhatsApp). Set the keys below to activate.

Env:
  MSG91_AUTH_KEY        - MSG91 auth key (enables SMS + WhatsApp)
  MSG91_SMS_SENDER      - 6-char DLT sender id (SMS). MSG91_SENDER_ID also works.
  MSG91_WA_NUMBER       - your WhatsApp business number (WhatsApp)
  MSG91_WA_NAMESPACE    - WhatsApp template namespace
  NOTIFY_SMS_ENABLED    - '1' to actually send SMS (default off)
  NOTIFY_WHATSAPP_ENABLED - '1' to actually send WhatsApp (default off)
"""
import os
import logging

logger = logging.getLogger("skovo")


def _on(flag):
    return os.environ.get(flag, '0') == '1'


def send_sms(phone: str, message: str) -> bool:
    """Send a plain SMS via MSG91. No-op (False) unless configured + enabled."""
    if not phone or not _on('NOTIFY_SMS_ENABLED'):
        return False
    auth = os.environ.get('MSG91_AUTH_KEY')
    # The deployed .env sets MSG91_SENDER_ID, which this helper originally did
    # not read — so SMS would have gone out with no sender id and failed soft,
    # silently, forever. Accept either name.
    sender = os.environ.get('MSG91_SMS_SENDER') or os.environ.get('MSG91_SENDER_ID')
    if not auth or not sender:
        return False
    try:
        import requests
        r = requests.post(
            'https://control.msg91.com/api/v5/flow/',
            headers={'authkey': auth, 'Content-Type': 'application/json'},
            json={
                'sender': sender,
                'short_url': '0',
                'mobiles': _fmt(phone),
                'message': message,
            },
            timeout=12,
        )
        ok = r.status_code == 200
        if not ok:
            logger.error(f"SMS send failed ({r.status_code}): {r.text[:160]}")
        return ok
    except Exception as e:
        logger.error(f"SMS error: {e}")
        return False


def send_whatsapp(phone: str, template_name: str, params: list = None, fallback_text: str = None) -> bool:
    """Send a templated WhatsApp message via MSG91. No-op unless configured + enabled.

    template_name must be a pre-approved WhatsApp template; params fill its
    {{1}},{{2}}… placeholders in order.
    """
    if not phone or not _on('NOTIFY_WHATSAPP_ENABLED'):
        return False
    auth = os.environ.get('MSG91_AUTH_KEY')
    wa_number = os.environ.get('MSG91_WA_NUMBER')
    if not auth or not wa_number:
        return False
    try:
        import requests
        components = {}
        if params:
            components = {
                'body_1': {'type': 'text', 'value': str(p)} for p in []  # placeholder shape
            }
        payload = {
            'integrated_number': wa_number,
            'content_type': 'template',
            'payload': {
                'messaging_product': 'whatsapp',
                'type': 'template',
                'template': {
                    'name': template_name,
                    'language': {'code': 'en', 'policy': 'deterministic'},
                    'namespace': os.environ.get('MSG91_WA_NAMESPACE', ''),
                    'to_and_components': [{
                        'to': [_fmt(phone)],
                        'components': _wa_components(params),
                    }],
                },
            },
        }
        r = requests.post(
            'https://control.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/',
            headers={'authkey': auth, 'Content-Type': 'application/json'},
            json=payload, timeout=12,
        )
        ok = r.status_code in (200, 201, 202)
        if not ok:
            logger.error(f"WhatsApp send failed ({r.status_code}): {r.text[:160]}")
        return ok
    except Exception as e:
        logger.error(f"WhatsApp error: {e}")
        return False


def _wa_components(params):
    if not params:
        return {}
    return {f'body_{i+1}': {'type': 'text', 'value': str(p)} for i, p in enumerate(params)}


def _fmt(phone: str) -> str:
    """Normalise to country-coded digits (default +91 for bare 10-digit numbers)."""
    p = ''.join(ch for ch in str(phone) if ch.isdigit())
    if len(p) == 10:
        p = '91' + p
    return p
