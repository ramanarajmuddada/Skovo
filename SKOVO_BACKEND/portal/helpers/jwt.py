import os
import datetime
import logging
from flask_jwt_extended import JWTManager

jwt = JWTManager()

_logger = logging.getLogger("skovo")


def _account_deactivated(jwt_payload) -> bool:
    """Return True if the access token's account has been deactivated/blocked/deleted.

    Fails OPEN (returns False) on any lookup error or unknown role so a transient DB
    issue or an unexpected token shape can never lock out the whole platform."""
    role = jwt_payload.get('role')
    sub = jwt_payload.get('sub')
    if not sub or not role:
        return False
    try:
        from portal.helpers.sp import call_proc_one
        if role == 'student':
            # ── SP: sp_users_get ─────────────────────────────────────────────────
            u = call_proc_one('sp_users_get', sub)
            return (u is None) or (u.get('status') in ('blocked', 'deleted'))
        if role in ('mentor', 'achiever'):
            # ── SP: sp_achievers_get ─────────────────────────────────────────────
            a = call_proc_one('sp_achievers_get', sub)
            if a is None:
                return True
            if a.get('is_active') is False or a.get('is_active') == 0:
                return True
            return a.get('status') is not None and a.get('status') != 'active'
        if role == 'admin':
            # ── SP: sp_admins_get ────────────────────────────────────────────────
            adm = call_proc_one('sp_admins_get', sub)
            return (adm is None) or (adm.get('status') != 'active')
        if role == 'super_admin':
            # ── SP: sp_super_admins_get ──────────────────────────────────────────
            sa = call_proc_one('sp_super_admins_get', sub)
            return (sa is None) or (sa.get('status') != 'active')
    except Exception as e:
        _logger.error(f"account-active check failed (failing open): {e}")
        return False
    return False


class Token:
    def __init__(self, app):
        secret = os.environ.get('JWT_SECRET_KEY')
        if not secret:
            raise RuntimeError("JWT_SECRET_KEY environment variable is not set.")

        app.config['JWT_SECRET_KEY'] = secret
        app.config['JWT_ACCESS_TOKEN_EXPIRES'] = datetime.timedelta(minutes=30)
        app.config['JWT_REFRESH_TOKEN_EXPIRES'] = datetime.timedelta(days=30)
        app.config['JWT_BLACKLIST_ENABLED'] = True
        app.config['JWT_BLACKLIST_TOKEN_CHECKS'] = ['access', 'refresh']

        jwt.init_app(app)

        @jwt.token_in_blocklist_loader
        def check_if_token_revoked(jwt_header, jwt_payload):
            """Revoke refresh tokens whose session was revoked, and access tokens
            whose underlying account has since been deactivated/blocked/deleted.

            Without the access-token branch, deactivating an achiever or admin would
            leave their already-issued token valid until it expires (up to 24h)."""
            if jwt_payload.get('type') == 'refresh':
                jti = jwt_payload.get('jti')
                if not jti:
                    return True
                # ── SP: sp_sessions_get_by_jti ───────────────────────────────────────
                from portal.helpers.sp import call_proc_one
                session = call_proc_one('sp_sessions_get_by_jti', jti)
                if not session:
                    return True
                return session.get('revoked_at') is not None

            # Access token: revoke if the account behind it is no longer active.
            return _account_deactivated(jwt_payload)

        @jwt.expired_token_loader
        def expired_token_callback(jwt_header, jwt_payload):
            return {'message': 'Token has expired', 'error': 'token_expired'}, 401

        @jwt.invalid_token_loader
        def invalid_token_callback(error):
            return {'message': 'Invalid token', 'error': 'invalid_token'}, 401

        @jwt.unauthorized_loader
        def missing_token_callback(error):
            return {'message': 'Authorization token is required', 'error': 'authorization_required'}, 401

        @jwt.revoked_token_loader
        def revoked_token_callback(jwt_header, jwt_payload):
            return {'message': 'Token has been revoked', 'error': 'token_revoked'}, 401

        app.logger.info("JWT initialized")
