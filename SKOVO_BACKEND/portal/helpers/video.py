"""
Video meeting provider — Daily.co.

Env-gated: with no DAILY_API_KEY set there is no auto-generated room at all and
`generate_meet_url` returns '' — callers must treat that as "no link", so the
Join button simply doesn't appear until a real link is supplied. Set
DAILY_API_KEY to switch on rooms with authentication, a pre-join lobby, and
cloud recording.

Env:
  DAILY_API_KEY           - Daily.co API key (enables Daily rooms)
  DAILY_SUBDOMAIN         - your Daily subdomain, e.g. 'skovo' (-> skovo.daily.co)
  DAILY_ENABLE_RECORDING  - '1' to enable cloud recording (needs a paid Daily plan)
  DAILY_PRIVATE           - '1' to make rooms private (requires per-user tokens)
"""
import os
import re
import time
import secrets
import logging

logger = logging.getLogger("skovo")


def _slug(title, ref):
    slug = re.sub(r'[^a-z0-9]', '', (title or '').lower())[:18]
    room_id = (ref or '')[:8] or secrets.token_urlsafe(6)
    token = secrets.token_urlsafe(4)
    return f"skovo-{slug}-{room_id}-{token}" if slug else f"skovo-{room_id}-{token}"


def generate_meet_url(title: str = '', cohort_id: str = '', exp_ts: int = None) -> str:
    """Return a join URL for a session — a Daily room when Daily is configured.

    Returns '' when Daily isn't configured or the room can't be created. There is
    deliberately no auto-generated fallback room: an unauthenticated public room
    anyone could guess from the title is not a meeting link we want to hand a
    student. Callers must treat '' as "no meeting link yet".
    """
    if not os.environ.get('DAILY_API_KEY'):
        return ''
    return _create_daily_room(_slug(title, cohort_id), exp_ts) or ''


def _create_daily_room(name, exp_ts=None):
    try:
        import requests
        api_key = os.environ['DAILY_API_KEY']
        props = {
            'enable_prejoin_ui': True,            # lobby / waiting room
            'enable_knocking': os.environ.get('DAILY_PRIVATE') == '1',
            'exp': exp_ts or (int(time.time()) + 60 * 60 * 6),   # default 6h TTL
        }
        if os.environ.get('DAILY_ENABLE_RECORDING') == '1':
            props['enable_recording'] = 'cloud'
        r = requests.post(
            'https://api.daily.co/v1/rooms',
            headers={'Authorization': f'Bearer {api_key}', 'Content-Type': 'application/json'},
            json={
                'name': name,
                'privacy': 'private' if os.environ.get('DAILY_PRIVATE') == '1' else 'public',
                'properties': props,
            },
            timeout=12,
        )
        if r.status_code in (200, 201):
            return r.json().get('url')
        if r.status_code == 409:   # room already exists -> reuse deterministic URL
            sub = os.environ.get('DAILY_SUBDOMAIN', '')
            return f"https://{sub}.daily.co/{name}" if sub else None
        logger.error(f"Daily room create failed ({r.status_code}): {r.text[:160]}")
        return None
    except Exception as e:
        logger.error(f"Daily room error: {e}")
        return None


def sanitize_meeting_link(link: str) -> str:
    """Drop legacy auto-generated Jitsi rooms from links already in the DB.

    Cohorts and sessions created before the Jitsi fallback was removed still
    carry a `https://meet.jit.si/...` value in `meeting_link`. Serving it would
    keep redirecting students to Jitsi, so it's filtered out on the way to the
    client and those rows simply read as "no link yet". Any other link (Zoom,
    Meet, Teams, Daily) passes through untouched.
    """
    if not link:
        return ''
    host = link.split('//', 1)[-1].split('/', 1)[0].split('@')[-1].lower()
    return '' if host == 'meet.jit.si' or host.endswith('.jit.si') or host == 'jit.si' else link


def tokenized_join_url(meeting_link: str, user_name: str = '', is_owner: bool = False) -> str:
    """Append a per-user Daily meeting token to a private-room URL.

    Returns the link unchanged when Daily isn't configured, the room isn't private,
    or it isn't a Daily URL — so it's safe to call on every join link.
    """
    meeting_link = sanitize_meeting_link(meeting_link)
    if (not meeting_link
            or os.environ.get('DAILY_PRIVATE') != '1'
            or not os.environ.get('DAILY_API_KEY')
            or 'daily.co/' not in meeting_link):
        return meeting_link
    room = meeting_link.split('?')[0].rstrip('/').rsplit('/', 1)[-1]
    tok = create_meeting_token(room, user_name, is_owner)
    return f"{meeting_link}?t={tok}" if tok else meeting_link


def create_meeting_token(room_name: str, user_name: str = '', is_owner: bool = False) -> str:
    """Mint a Daily meeting token for a private room (host vs guest). Empty string
    if Daily isn't configured — callers should treat empty as 'open room'."""
    if not os.environ.get('DAILY_API_KEY'):
        return ''
    try:
        import requests
        r = requests.post(
            'https://api.daily.co/v1/meeting-tokens',
            headers={'Authorization': f'Bearer {os.environ["DAILY_API_KEY"]}', 'Content-Type': 'application/json'},
            json={'properties': {
                'room_name': room_name,
                'user_name': user_name or 'Guest',
                'is_owner': is_owner,
                'exp': int(time.time()) + 60 * 60 * 4,
            }},
            timeout=12,
        )
        return r.json().get('token', '') if r.status_code in (200, 201) else ''
    except Exception as e:
        logger.error(f"Daily token error: {e}")
        return ''
