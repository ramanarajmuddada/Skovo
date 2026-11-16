from flask import Blueprint
from flask_restx import Api
from werkzeug.exceptions import HTTPException
from jwt.exceptions import PyJWTError
from flask_jwt_extended.exceptions import JWTExtendedException

api_bp = Blueprint('api', __name__, url_prefix='/v1')

api = Api(
    api_bp,
    version='1.0',
    title='SKOVO API',
    description='Backend API for SKOVO — Career Platform for Students',
    doc='/doc/',
    catch_all_404s=True
)


# ── Admin approval, enforced for the whole admin surface ─────────────────────
# The path prefix every admin endpoint lives under.
_ADMIN_PREFIX = '/v1/skovo-platform-panel-admin/'

# The only admin endpoints a not-yet-approved admin may reach. Everything else
# is refused. `console` is what tells them their own state, so blocking it would
# leave the holding screen unable to explain itself; the rest are their own
# credentials, which approval has no bearing on.
_ADMIN_SELF_SERVICE = frozenset({
    'login', 'register', 'send-otp', 'reset-password', 'verify-otp',
    'me', 'console', 'profile', 'change-password', 'logout',
})


def _install_admin_approval_gate(app):
    """Refuse the admin API to any admin whose state is not `active`.

    AdminLayout hides the console from a pending admin, but that is a screen,
    not a permission: of 51 admin GET endpoints, 48 answered a pending admin's
    token in full — students, cohorts, payments, error logs — and none of the
    109 write endpoints checked at all. Registration is open by design, so
    anyone who signed up could read and write the platform through the API
    while the UI showed them "awaiting approval".

    One hook covers the whole surface. Doing it per-file would mean 43 files and
    a permanent invitation to forget the 44th.

    It only ever *adds* a refusal: anything it cannot positively identify as a
    non-active admin is passed straight through to the route's own decorators,
    so a super-admin, a student or an anonymous caller is unaffected.
    """
    from flask import request, jsonify
    from flask_jwt_extended import verify_jwt_in_request, get_jwt_identity
    from sqlalchemy import text
    from portal.models import db

    @app.before_request
    def _require_approved_admin():
        path = request.path
        if not path.startswith(_ADMIN_PREFIX):
            return None
        if request.method == 'OPTIONS':          # CORS preflight carries no token
            return None
        if path[len(_ADMIN_PREFIX):].split('/', 1)[0] in _ADMIN_SELF_SERVICE:
            return None

        try:
            verify_jwt_in_request(optional=True)
            identity = get_jwt_identity()
        except Exception:
            # Malformed or expired — the route's own @jwt_required answers it,
            # and it answers 401 with the wording the client already handles.
            return None
        if not identity:
            return None

        row = db.session.execute(
            text("SELECT state FROM admins WHERE id = :i"), {'i': identity}
        ).fetchone()
        if row is None:
            return None                          # not an admin token at all
        if row[0] != 'active':
            return jsonify(
                response={'message': 'Your admin account is not approved yet.',
                          'state': row[0]},
                status=403, bool=False,
            ), 403
        return None


def init_app(app):
    app.register_blueprint(api_bp)
    _install_admin_approval_gate(app)

    @api.errorhandler(HTTPException)
    def handle_http_exception_with_cors(error):
        """Answer HTTP errors in the same envelope every route uses.

        Every hand-written route returns {bool, status, response:{message}}, and
        both clients read exactly that: the web app does
        `data.response?.message` and the mobile app the same. Anything raised
        rather than returned used to arrive as a bare {'message': ...}, so
        `data.bool` was undefined and `data.response` did not exist.

        The case that actually reached users was reqparse: `required=True` on a
        parser aborts with 400 before the route body runs, which is how a signup
        missing an email got answered. The route's own "Email is required."
        check below it never executed, and the client — finding no
        `response.message` — fell through to its generic "Something went wrong".
        The specific message existed the whole time; the shape hid it.

        The HTTP status is unchanged, so the web client's 401-refresh
        interceptor keys off the same thing it always did.
        """
        code = getattr(error, 'code', 500)

        # reqparse hangs the per-field messages off error.data['errors'].
        data = getattr(error, 'data', None) or {}
        field_errors = data.get('errors') or {}

        # Prefer a field-level message — "Email is required." is worth showing;
        # "Input payload validation failed" is not.
        message = (next(iter(field_errors.values()), None)
                   or data.get('message')
                   or getattr(error, 'description', None)
                   or str(error))

        response = {'message': message}
        if field_errors:
            response['errors'] = field_errors

        payload = {
            'bool': False,
            'status': code,
            'response': response,
        }

        # flask_restx.Api.handle_error ends with
        #     data = getattr(e, "data", default_data)
        # so for any exception carrying `.data` — which is every reqparse abort —
        # a handler's return value is computed and then thrown away. Writing the
        # envelope back onto the exception is what actually reaches the client;
        # the return below covers the exceptions that have no `.data`.
        error.data = payload

        # A *copy* on the way out, deliberately. handle_error also does
        #     default_data["message"] = default_data.get("message", str(e))
        # on whatever the handler returned, and returning `payload` itself would
        # let that graft werkzeug's generic "400 Bad Request: The browser (or
        # proxy) sent a request that this server could not understand." onto the
        # envelope, alongside the specific message. It lands on the copy instead.
        return dict(payload), code, {
            'Access-Control-Allow-Origin': '*'
        }


    @api.errorhandler(PyJWTError)
    @api.errorhandler(JWTExtendedException)
    def handle_jwt_error(error):
        """Answer an auth failure with 401, not 500.

        flask_jwt_extended registers expired/invalid/missing-token callbacks on
        the Flask app, and they return 401 correctly. They were never reached:
        flask_restx replaces app.handle_user_exception with its own error_router,
        which for a restx route calls Api.handle_error - and that only consults
        handlers registered on `api`. Only HTTPException was. A JWT error is a
        plain exception, so it fell through to a blanket 500.

        The effect on a user was total. An access token lives 24h; the moment it
        expired, every authenticated call answered 500 - /v1/auth/me,
        /v1/dashboard/, notifications, colleges, bookings, the lot - and the app
        rendered as a shell of empty pages. The web client has a 401 interceptor
        that refreshes the token and retries; it never fired, because nothing
        ever returned 401. A logged-in user simply watched the product break
        and had no way to know that logging out and back in would fix it.

        Missing-token requests took the same path: the 500s on /v1/colleges/
        and /v1/achievers/ from an unauthenticated browser were
        NoAuthorizationError, not a broken endpoint.
        """
        # The `error` code, not just a message.
        #
        # This handler was added to stop restx turning JWT failures into 500s.
        # It did that, but dropped the one field the clients classify on:
        # flask_jwt_extended's loaders in portal/helpers/jwt.py return
        # {'error': 'token_expired'}, and the web client's isTokenDead() reads
        # exactly that key to tell "your token is dead, sign in again" from
        # "this endpoint said no". restx routes never reach those loaders, so
        # no restx 401 ever carried the code and isTokenDead() always said
        # false -- no expired session was ever recognised.
        #
        # What that looked like: an admin whose token expired got /console 401
        # -> useAdminConsole kept data=null -> its 'pending' default won ->
        # "Your account is awaiting approval", telling a fully approved admin
        # to ask a super-admin to approve them. Only the token had aged out.
        #
        # Codes match helpers/jwt.py. Anything unrecognised is 'invalid_token',
        # the safe end: the client re-authenticates rather than mis-reporting
        # an account state.
        name = type(error).__name__
        if 'Expired' in name:
            code = 'token_expired'
        elif 'NoAuthorization' in name or 'Unauthorized' in name:
            code = 'authorization_required'
        elif 'Revoked' in name:
            code = 'token_revoked'
        else:
            code = 'invalid_token'
        
        payload = {
            'bool': False,
            'status': 401,
            'error': code,
            'response': {'message': str(error) or 'Authentication required'},
        }
        # Same reason as the HTTPException handler above: handle_error prefers
        # e.data over the handler's return value when the exception carries one.
        error.data = payload
        return dict(payload), 401, {'Access-Control-Allow-Origin': '*'}

    app.logger.info('Initialized SKOVO API')
