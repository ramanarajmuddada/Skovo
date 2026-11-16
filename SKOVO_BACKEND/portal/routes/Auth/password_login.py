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
from . import ns, logger

parser = reqparse.RequestParser()
parser.add_argument('email', type=str, location='json', required=True, help='Email is required.')
parser.add_argument('password', type=str, location='json', required=True, help='Password is required.')
parser.add_argument('device_id', type=str, location='json', required=False)
parser.add_argument('device_meta', type=dict, location='json', required=False)


@ns.route('/login')
class PasswordLogin(Resource):
    # Brute-force guard: 10 attempts/min and 50/hour per IP.
    decorators = [limiter.limit("10 per minute;50 per hour")]

    @ns.doc(
        description='Sign in with email and password. Returns JWT access + refresh tokens.',
        responses={200: 'OK', 400: 'Missing fields', 401: 'Invalid credentials or blocked', 429: 'Too many attempts', 500: 'Server error'}
    )
    @ns.expect(parser, validate=False)
    def post(self):
        try:
            args = parser.parse_args(strict=False)
            email = (args.get('email') or '').strip().lower()
            password = (args.get('password') or '').strip()

            if not email or not password:
                return jsonify(response={'message': 'Email and password are required.'}, status=400, bool=False)

            # ── SP: sp_users_list — no by-email lookup proc exists, so scan the
            # (deleted_at-filtered) bounded batch this already returns. ───────
            all_users = call_proc('sp_users_list', 50000, 0)
            user = next((u for u in all_users if (u.get('email') or '').lower() == email), None)

            if user is None or not user.get('password_hash'):
                return jsonify(response={'message': 'Invalid email or password.'}, status=401, bool=False)

            if not check_password_hash(user['password_hash'], password):
                return jsonify(response={'message': 'Invalid email or password.'}, status=401, bool=False)

            if user.get('status') == 'blocked':
                return jsonify(
                    response={'message': 'Your account has been suspended. Contact support@skovoai.com.'},
                    status=401, bool=False
                )

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
            # ── SP: sp_sessions_create ─────────────────────────────────────────
            call_proc_one(
                'sp_sessions_create',
                str(uuid.uuid4()), user_id, jti, rt_hash, args.get('device_id'),
                json.dumps(args.get('device_meta') or {}), now + datetime.timedelta(days=30),
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

        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in POST /auth/login: {e}")
            logger.exception(e)
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)
