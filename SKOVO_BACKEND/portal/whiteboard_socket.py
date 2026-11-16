"""
Realtime whiteboard — Socket.IO relay.

Live strokes are broadcast peer-to-peer between the two-to-many clients in a
session/cohort's room and never touch the DB. A full canvas snapshot is
persisted (debounced client-side) via `sp_whiteboard_save` so a late joiner
or a page refresh restores the last-drawn state — see
database/stored_procedures/endpoints/whiteboard.sql.

Auth: the JWT access token is passed in the Socket.IO connection's `auth`
payload (not a header — engineio's handshake doesn't carry custom headers
reliably through all transports), decoded once at `connect`, and the
resulting identity/role cached on the per-connection Flask session for the
lifetime of that socket. `join_board` re-validates the caller actually has
access to the requested session/cohort before allowing the room join.
"""
import logging
import os
import sys
from flask import session
from flask_socketio import SocketIO, join_room, leave_room, emit

logger = logging.getLogger("skovo")

# Flask-SocketIO's auto-detect (async_mode=None) prefers eventlet whenever the
# package is importable — regardless of whether it's actually monkey-patched
# — which isn't safe on Windows (eventlet's non-blocking I/O is unsupported
# on Windows pipes/console handles). Force plain-threading there explicitly;
# eventlet (via gunicorn's eventlet worker) is used everywhere else in prod.
_ASYNC_MODE = 'threading' if sys.platform == 'win32' else None

# Strokes are broadcast to a room, and a room lives inside one process. Under
# gunicorn with more than one worker, the student and the achiever land on
# different workers roughly half the time, and neither sees the other draw.
# A Redis message queue is what makes emit() cross the process boundary.
#
# Falls back to REDIS_URL, then to None — so a single-process dev run with no
# Redis behaves exactly as before. Set SOCKETIO_MESSAGE_QUEUE explicitly to
# point the relay at a different Redis database than the cache uses.
_MESSAGE_QUEUE = (
    os.environ.get('SOCKETIO_MESSAGE_QUEUE')
    or os.environ.get('REDIS_URL')
    or None
)

socketio = SocketIO(
    cors_allowed_origins="*",
    async_mode=_ASYNC_MODE,
    message_queue=_MESSAGE_QUEUE,
)

if _MESSAGE_QUEUE:
    logger.info('Whiteboard relay using a shared message queue - safe across workers.')
else:
    logger.warning(
        'Whiteboard relay has no message queue. Fine for a single process; with '
        'more than one gunicorn worker, strokes will not cross workers. '
        'Set REDIS_URL or SOCKETIO_MESSAGE_QUEUE.')


def _room_name(context_type, context_id):
    return f"{context_type}:{context_id}"


def _check_access(context_type, context_id, user_id, role):
    """Return (allowed: bool, message: str)."""
    from portal.helpers.sp import call_proc_one

    if context_type == 'session':
        actors = call_proc_one('sp_chat_session_actors', context_id)
        if not actors:
            return False, 'Session not found.'
        if role == 'student':
            return actors.get('student_id') == user_id, 'Access denied.'
        if role in ('mentor', 'achiever'):
            return actors.get('mentor_id') == user_id, 'Access denied.'
        return False, 'Access denied.'

    if context_type == 'cohort':
        access = call_proc_one('sp_whiteboard_cohort_access', context_id, user_id)
        if not access:
            return False, 'Cohort not found.'
        allowed = bool(access.get('is_achiever')) or bool(access.get('is_enrolled'))
        return allowed, 'Access denied.'

    return False, 'Invalid board context.'


@socketio.on('connect')
def handle_connect(auth):
    from flask_jwt_extended import decode_token

    token = (auth or {}).get('token')
    if not token:
        logger.warning("whiteboard socket connect rejected: no token")
        return False
    try:
        payload = decode_token(token)
    except Exception as e:
        logger.warning(f"whiteboard socket connect rejected: bad token ({e})")
        return False

    session['wb_user_id'] = payload.get('sub')
    session['wb_role'] = payload.get('role')
    return True


@socketio.on('join_board')
def handle_join_board(data):
    # An exception here used to vanish: no ack went back, and the client sat on
    # "Opening whiteboard..." for ever. Log it and answer, so the board says so.
    try:
        return _join_board(data)
    except Exception:
        logger.exception("whiteboard join_board failed")
        return {'ok': False, 'message': 'Could not open the whiteboard. Try again.'}


def _join_board(data):
    from portal.helpers.sp import call_proc_one

    user_id = session.get('wb_user_id')
    if not user_id:
        return {'ok': False, 'message': 'Unauthorized.'}

    context_type = (data or {}).get('context_type')
    context_id = (data or {}).get('context_id')
    if not context_type or not context_id:
        return {'ok': False, 'message': 'context_type and context_id are required.'}

    allowed, message = _check_access(context_type, context_id, user_id, session.get('wb_role'))
    if not allowed:
        return {'ok': False, 'message': message}

    room = _room_name(context_type, context_id)
    join_room(room)
    session[f'wb_room:{room}'] = True

    board = call_proc_one('sp_whiteboard_get', context_type, context_id)
    return {'ok': True, 'canvas_data': (board or {}).get('canvas_data')}


@socketio.on('board_patch')
def handle_board_patch(data):
    """Live, high-frequency, ephemeral — broadcast only, never persisted."""
    context_type = (data or {}).get('context_type')
    context_id = (data or {}).get('context_id')
    room = _room_name(context_type, context_id)
    if not session.get(f'wb_room:{room}'):
        return
    emit('board_patch', (data or {}).get('patch'), room=room, include_self=False)


@socketio.on('board_save')
def handle_board_save(data):
    """Infrequent, client-debounced full-snapshot persistence."""
    from portal.models import db
    from portal.helpers.sp import call_proc_one

    context_type = (data or {}).get('context_type')
    context_id = (data or {}).get('context_id')
    room = _room_name(context_type, context_id)
    user_id = session.get('wb_user_id')
    if not session.get(f'wb_room:{room}') or not user_id:
        return
    try:
        call_proc_one('sp_whiteboard_save', context_type, context_id, (data or {}).get('canvas_data'), user_id)
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        logger.error(f"whiteboard board_save failed: {e}")


@socketio.on('leave_board')
def handle_leave_board(data):
    context_type = (data or {}).get('context_type')
    context_id = (data or {}).get('context_id')
    room = _room_name(context_type, context_id)
    leave_room(room)
    session.pop(f'wb_room:{room}', None)
