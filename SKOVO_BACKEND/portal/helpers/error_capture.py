import uuid
import traceback as tb
from flask import request
from werkzeug.exceptions import HTTPException


def capture_error(e, user_id=None, role=None):
    """
    Save the real exception to ErrorLogs and return the short error_id.
    Frontend always receives only 'Internal Server Error'; admin sees the full traceback via error_id.

    HTTP exceptions are re-raised rather than logged. Every route wraps its body
    in `except Exception` and returns a 500, which swallowed the 400/404/405
    that reqparse and routing raise deliberately: sending an out-of-range value
    (e.g. status='suspended' where only active|blocked is allowed) answered
    "500 Internal Server Error" with an opaque error_id instead of the 400 and
    the message explaining what was wrong. Re-raising lets the registered
    HTTPException handler produce the real status and reason.
    """
    if isinstance(e, HTTPException):
        raise e

    error_id = str(uuid.uuid4()).replace('-', '').upper()[:8]

    # Try to get JWT identity if not provided
    if user_id is None:
        try:
            from flask_jwt_extended import get_jwt_identity, get_jwt, verify_jwt_in_request
            verify_jwt_in_request(optional=True)
            user_id = get_jwt_identity()
            role = get_jwt().get('role')
        except Exception:
            pass

    try:
        from portal.models import db
        from portal.helpers.sp import call_proc_one

        # ── SP: sp_error_logs_create ─────────────────────────────────────────────
        call_proc_one(
            'sp_error_logs_create',
            str(uuid.uuid4()), error_id, request.path, request.method, 500,
            type(e).__name__, str(e), tb.format_exc(),
            str(user_id) if user_id else None, role, request.remote_addr,
        )
        db.session.commit()
    except Exception as save_err:
        import logging
        logging.getLogger('skovo').error(f"capture_error: failed to save [{error_id}]: {save_err}")

    return error_id
