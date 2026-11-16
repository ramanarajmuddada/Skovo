from portal.helpers.error_capture import capture_error
import json
import uuid
import time
import hashlib
import datetime
from flask import jsonify
from portal.helpers.helpers import normalise_indian_mobile
from flask_restx import Resource, reqparse
from flask_jwt_extended import create_access_token, create_refresh_token, decode_token
from werkzeug.security import generate_password_hash
from sqlalchemy.exc import IntegrityError
from portal.models import db
from portal.helpers.sp import call_proc_one
from portal.helpers.identity import email_conflict, conflict_message
from portal.helpers import field_limits as FL
from portal.helpers.email_hygiene import suggest_email, check_email_format
from . import ns, logger

parser = reqparse.RequestParser()
parser.add_argument('full_name', type=str, location='json', required=True, help='Full name is required.')
parser.add_argument('email', type=str, location='json', required=True, help='Email is required.')
parser.add_argument('password', type=str, location='json', required=True, help='Password is required.')
# Optional at signup on purpose: WhatsApp is where these students actually
# read things, but requiring a number at the door costs signups. Asked for as a
# benefit ("session reminders on WhatsApp"), never as a gate.
parser.add_argument('whatsapp', type=str, location='json', required=False)
parser.add_argument('device_id', type=str, location='json', required=False)
parser.add_argument('device_meta', type=dict, location='json', required=False)
parser.add_argument('referral_code', type=str, location='json', required=False)


@ns.route('/register')
class Register(Resource):
    @ns.doc(
        description='Register a new user with email and password. Returns JWT access + refresh tokens.',
        responses={200: 'Created', 400: 'Validation error', 409: 'Email already registered', 500: 'Server error'}
    )
    @ns.expect(parser, validate=False)
    def post(self):
        try:
            args = parser.parse_args(strict=False)
            full_name = (args.get('full_name') or '').strip()
            email = (args.get('email') or '').strip().lower()
            password = (args.get('password') or '').strip()

            if not full_name:
                return jsonify(response={'message': 'Full name is required.'}, status=400, bool=False)
            if not email:
                return jsonify(response={'message': 'Email is required.'}, status=400, bool=False)
            if not password or len(password) < 6:
                return jsonify(response={'message': 'Password must be at least 6 characters.'}, status=400, bool=False)

            # Stated maximums, so "max length + 1" is a 400 naming the field
            # rather than whatever the column does. X04-003/011/017.
            verr = FL.check_all([
                (full_name, 'Full name', FL.FULL_NAME),
                (email, 'Email', FL.EMAIL),
                (password, 'Password', FL.PASSWORD),
            ])
            if verr:
                return jsonify(response={'message': verr}, status=400, bool=False)

            # Syntax before plausibility. Without this the form accepted
            # `no-at-sign.example.com`, `two@@example.com` and `user@localhost`
            # and issued tokens for all three -- accounts that can never receive
            # an OTP or a reset, so the person cannot get back in and cannot
            # prove ownership to have it changed. X04-008/009/010.
            ferr = check_email_format(email)
            if ferr:
                return jsonify(response={'message': ferr, 'field': 'email'},
                               status=400, bool=False)

            # A student and an achiever must be two different people. The users
            # table's UNIQUE key cannot see the achievers table, so check across.
            # A domain one keystroke wrong is valid syntax and reaches nobody.
            # Offered, never applied -- only the person knows what is right.
            _sug = suggest_email(email)
            if _sug:
                return jsonify(response={
                    'message': f'Did you mean {_sug}? Check the address and try again.',
                    'suggestion': _sug,
                }, status=400, bool=False)

            clash = email_conflict(email, 'student')
            if clash:
                return jsonify(response={'message': conflict_message(clash)}, status=409, bool=False)

            user_id = str(uuid.uuid4())
            password_hash = generate_password_hash(password)
            whatsapp = normalise_indian_mobile(args.get('whatsapp'))

            # ── SP: sp_users_create — uq_users_email_active (a generated column,
            # unique only while deleted_at IS NULL) enforces the duplicate check
            # via IntegrityError, same semantics as the old pre-SELECT. ────────
            try:
                user = call_proc_one(
                    'sp_users_create',
                    user_id, whatsapp, email, full_name, password_hash, None, 'active', user_id, user_id, None,
                )
            except IntegrityError as ie:
                db.session.rollback()
                # users has TWO unique keys — email and phone. Blaming the email
                # for a phone collision sends the person off to sign in with an
                # address that does not exist.
                if whatsapp and 'uq_users_phone_active' in str(getattr(ie, 'orig', ie)):
                    # The number is optional; the account is the point. Keep the
                    # signup and drop the number rather than turning someone away
                    # over a field they were told they could leave blank.
                    logger.info(f"whatsapp {whatsapp} already in use — registering {email} without it")
                    try:
                        user = call_proc_one(
                            'sp_users_create',
                            user_id, None, email, full_name, password_hash, None, 'active',
                            user_id, user_id, None,
                        )
                    except IntegrityError:
                        db.session.rollback()
                        return jsonify(response={'message': 'This email is already registered. Please sign in.'},
                                       status=409, bool=False)
                else:
                    return jsonify(response={'message': 'This email is already registered. Please sign in.'},
                                   status=409, bool=False)

            # ── SP: sp_auth_identities_create, sp_user_profiles_create,
            # sp_readiness_scores_create ───────────────────────────────────────
            call_proc_one(
                'sp_auth_identities_create',
                str(uuid.uuid4()), user_id, 'email', email, 1, user_id, user_id,
            )
            call_proc_one(
                'sp_user_profiles_create',
                str(uuid.uuid4()), user_id, None, None, None, json.dumps([]),
                None, None, None, None, None, None, None, None, None, None,
                None, None, None, None, None, None, user_id, user_id,
            )
            call_proc_one(
                'sp_readiness_scores_create',
                str(uuid.uuid4()), user_id, 0, 'Explorer', 0, 0, 0, user_id, user_id,
            )

            role_code = 'student'

            additional_claims = {'userid': user_id, 'role': role_code, 'is_new_user': True}
            access_token = create_access_token(identity=user_id, additional_claims=additional_claims, fresh=True)
            refresh_token = create_refresh_token(identity=user_id, additional_claims=additional_claims)

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
            logger.info(f"Registered new user via password id={user_id}")
            if (args.get('referral_code') or '').strip():
                try:
                    from portal.helpers.referral_rewards import bind_signup
                    bind_signup(user_id, email, args.get('referral_code'))
                except Exception as ref_err:
                    logger.error(f"referral bind failed for {user_id}: {ref_err}")

            return jsonify(
                response={
                    'user_id': user_id,
                    'full_name': user.get('full_name'),
                    'phone': user.get('phone'),
                    'email': user.get('email'),
                    'avatar_url': user.get('avatar_url'),
                    'status': user.get('status'),
                    'role': role_code,
                    'is_new_user': True,
                },
                access_token=access_token,
                refresh_token=refresh_token,
                expires_at=int(time.time()) + 1800,
                status=200,
                bool=True
            )

        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in POST /auth/register: {e}")
            logger.exception(e)
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)
