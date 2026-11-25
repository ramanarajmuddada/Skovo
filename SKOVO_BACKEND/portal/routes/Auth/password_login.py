from portal.helpers.error_capture import capture_error
import json
import time
import uuid
import hashlib
import datetime
from flask import jsonify
from flask_restx import Resource, reqparse
from flask_jwt_extended import create_access_token, create_refresh_token, decode_token
from werkzeug.security import check_password_hash
from portal.models import db
from portal.helpers.sp import call_proc, call_proc_one
from portal.helpers.rate_limit import limiter
from portal.helpers import login_otp
from . import ns, logger

parser = reqparse.RequestParser()
parser.add_argument('email', type=str, location='json', required=True, help='Email is required.')
parser.add_argument('password', type=str, location='json', required=True, help='Password is required.')
parser.add_argument('device_id', type=str, location='json', required=False)
parser.add_argument('device_meta', type=dict, location='json', required=False)

verify_parser = reqparse.RequestParser()
verify_parser.add_argument('challenge_id', type=str, location='json', required=True)
verify_parser.add_argument('otp', type=str, location='json', required=True)
verify_parser.add_argument('device_id', type=str, location='json', required=False)
verify_parser.add_argument('device_meta', type=dict, location='json', required=False)

resend_parser = reqparse.RequestParser()
resend_parser.add_argument('challenge_id', type=str, location='json', required=True)

ROLE = 'student'


def _fail(message, status, **extra):
    return jsonify(response={'message': message, **extra}, status=status, bool=False)


def _find_user(email):
    # ── SP: sp_users_list — no by-email lookup proc exists, so scan the
    # (deleted_at-filtered) bounded batch this already returns. ───────────────
    all_users = call_proc('sp_users_list', 50000, 0)
    return next((u for u in all_users if (u.get('email') or '').lower() == (email or '').lower()), None)


def _complete_login(user, device_id, device_meta):
    """Issue the session. Only ever called after the password AND the emailed code
    have both been checked (or with LOGIN_OTP_REQUIRED=0)."""
    role_code = 'student'
    user_id = user['id']

    additional_claims = {'userid': user_id, 'role': role_code, 'is_new_user': False}
    access_token = create_access_token(identity=str(user_id), additional_claims=additional_claims, fresh=True)
    refresh_token = create_refresh_token(identity=str(user_id), additional_claims=additional_claims)

    try:
        rt_payload = decode_token(refresh_token)
        jti = rt_payload.get('jti')
    except Exception:
        jti = None

    now = datetime.datetime.utcnow()
    rt_hash = hashlib.sha256(refresh_token.encode()).hexdigest()
    # ── SP: sp_sessions_create ─────────────────────────────────────────────────
    call_proc_one(
        'sp_sessions_create',
        str(uuid.uuid4()), user_id, jti, rt_hash, device_id,
        json.dumps(device_meta or {}), now + datetime.timedelta(days=30),
        None, user_id, user_id,
    )
    db.session.commit()

    return jsonify(
        response={
            'user_id': user_id,
            'full_name': user.get('full_name'),
            'phone': user.get('phone'),
            'email': user.get('email'),
            'avatar_url': user.get('avatar_url'),
            'status': user.get('status'),
            'role': role_code,
            'is_new_user': False,
        },
        access_token=access_token,
        refresh_token=refresh_token,
        expires_at=int(time.time()) + 1800,
        status=200,
        bool=True
    )


def _challenge_response(res):
    """The client's next step: enter the code. No tokens are included."""
    return jsonify(
        response={
            'message': res['message'],
            'otp_required': True,
            'challenge_id': res['challenge_id'],
            'email_masked': res['email_masked'],
            'resend_in': res['resend_in'],
            'expires_in': res['expires_in'],
        },
        status=200, bool=True
    )


@ns.route('/login')
class PasswordLogin(Resource):
    # Brute-force guard: 10 attempts/min and 50/hour per IP.
    decorators = [limiter.limit("10 per minute;50 per hour")]

    @ns.doc(
        description=('Step 1 of sign-in. Checks email + password, then emails a 6-digit code and returns '
                     '{otp_required, challenge_id}. No tokens are issued until POST /auth/login/verify succeeds.'),
        responses={200: 'Code sent', 400: 'Missing fields', 401: 'Invalid credentials or blocked', 429: 'Too many attempts', 500: 'Server error'}
    )
    @ns.expect(parser, validate=False)
    def post(self):
        try:
            args = parser.parse_args(strict=False)
            email = (args.get('email') or '').strip().lower()
            password = (args.get('password') or '').strip()

            if not email or not password:
                return _fail('Email and password are required.', 400)

            user = _find_user(email)

            if user is None or not user.get('password_hash'):
                return _fail('Invalid email or password.', 401)

            if not check_password_hash(user['password_hash'], password):
                return _fail('Invalid email or password.', 401)

            if user.get('status') == 'blocked':
                return _fail('Your account has been suspended. Contact support@skovoai.com.', 401)

            if not login_otp.enabled():
                return _complete_login(user, args.get('device_id'), args.get('device_meta'))

            res = login_otp.start(ROLE, user['email'], user.get('full_name') or 'Student')
            if not res['ok']:
                return _fail(res['message'], res['http'], retry_after=res.get('retry_after'))
            return _challenge_response(res)

        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in POST /auth/login: {e}")
            logger.exception(e)
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/login/verify')
class PasswordLoginVerify(Resource):
    decorators = [limiter.limit("10 per minute;60 per hour")]

    @ns.doc(description='Step 2 of sign-in. Verifies the emailed code and, only then, issues JWT access + refresh tokens.')
    @ns.expect(verify_parser, validate=False)
    def post(self):
        try:
            args = verify_parser.parse_args(strict=False)
            res = login_otp.verify(ROLE, args.get('challenge_id'), args.get('otp'))
            if not res['ok']:
                return _fail(res['message'], res['http'], expired=res.get('expired', False),
                             attempts_left=res.get('attempts_left'))

            user = _find_user(res['email'])
            # The account may have changed in the ten minutes since the password step.
            if user is None or user.get('status') == 'blocked':
                return _fail('This account cannot sign in. Contact support@skovoai.com.', 401)
            return _complete_login(user, args.get('device_id'), args.get('device_meta'))

        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in POST /auth/login/verify: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/login/resend')
class PasswordLoginResend(Resource):
    decorators = [limiter.limit("6 per minute;30 per hour")]

    @ns.doc(description='Email a fresh code for an open sign-in. 60 s cooldown; the previous code stops working.')
    @ns.expect(resend_parser, validate=False)
    def post(self):
        try:
            args = resend_parser.parse_args(strict=False)
            target = login_otp.lookup_target(args.get('challenge_id'), ROLE)
            if not target:
                return _fail('This sign-in has expired. Please enter your password again.', 400, expired=True)
            user = _find_user(target)
            if user is None or user.get('status') == 'blocked':
                return _fail('This account cannot sign in. Contact support@skovoai.com.', 401)
            res = login_otp.start(ROLE, target, user.get('full_name') or 'Student')
            if not res['ok']:
                return _fail(res['message'], res['http'], retry_after=res.get('retry_after'))
            return _challenge_response(res)

        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in POST /auth/login/resend: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)
