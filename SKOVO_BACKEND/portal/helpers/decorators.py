import logging
from functools import wraps
from flask_jwt_extended import verify_jwt_in_request, get_jwt

logger = logging.getLogger("skovo")


def require_role(*allowed_roles):
    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            try:
                verify_jwt_in_request()
            except Exception:
                return {'message': 'Authorization token is required'}, 401

            claims = get_jwt()
            role = claims.get('role', '')

            if claims.get('super_admin') is True and 'super_admin' in allowed_roles:
                return fn(*args, **kwargs)

            if role in allowed_roles:
                return fn(*args, **kwargs)

            return {'message': 'You do not have permission to perform this action.'}, 403

        return wrapper
    return decorator
