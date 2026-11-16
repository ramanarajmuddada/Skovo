from portal.helpers.error_capture import capture_error
import uuid
import time
import json
import hashlib
import datetime
from werkzeug.security import generate_password_hash
from flask import jsonify, request
from portal.helpers.helpers import normalise_indian_mobile
from flask_restx import Resource, reqparse
from flask_jwt_extended import create_access_token, create_refresh_token, decode_token
from sqlalchemy.exc import IntegrityError
from portal.models import db
from portal.helpers.sp import call_proc, call_proc_one
from portal.helpers.rate_limit import limiter
from . import ns, logger

parser = reqparse.RequestParser()
parser.add_argument('phone',                  type=str,  location='json', required=False)
parser.add_argument('email',                  type=str,  location='json', required=False)
parser.add_argument('otp',                    type=str,  location='json', required=True)
parser.add_argument('full_name',              type=str,  location='json', required=False)
parser.add_argument('role',                   type=str,  location='json', required=False, default='student')
parser.add_argument('password',               type=str,  location='json', required=False)
# Optional WhatsApp number captured at signup — see register.py for why this
# is asked as a benefit and never gated.
parser.add_argument('whatsapp',               type=str,  location='json', required=False)
parser.add_argument('device_id',              type=str,  location='json', required=False)
parser.add_argument('device_meta',            type=dict, location='json', required=False)
parser.add_argument('referral_code',          type=str,  location='json', required=False)



@ns.route('/otp/verify')
class VerifyOTP(Resource):
    # OTP brute-force guard: 10 verify attempts/min per IP.
    decorators = [limiter.limit("10 per minute;60 per hour")]

    @ns.doc(
        description='Verify OTP and log in. Auto-registers new users on first login. Returns JWT access + refresh tokens.',
        responses={200: 'OK', 400: 'Invalid OTP', 401: 'Blocked', 409: 'Subdomain taken', 429: 'Too many attempts', 500: 'Server error'}
    )
    @ns.expect(parser, validate=False)
    def post(self):
        try:
            args = parser.parse_args(strict=False)
            phone                = (args.get('phone') or '').strip()
            email                = (args.get('email') or '').strip().lower()
            otp                  = (args.get('otp') or '').strip()
            full_name            = (args.get('full_name') or '').strip()
            role                  = (args.get('role') or 'student').strip().lower()
            password              = (args.get('password') or '').strip()

            if not phone and not email:
                return jsonify(response={'message': 'Either phone or email is required.'}, status=400, bool=False)

            channel = 'sms' if phone else 'email'
            target  = phone if phone else email

            now = datetime.datetime.utcnow()

            # ── SP: sp_otp_requests_list — no channel/target/purpose/expiry filter
            # on the generic CRUD proc, so pull a bounded recent batch and pick the
            # newest matching, still-valid, unverified request in Python. ─────────
            recent_otps = call_proc('sp_otp_requests_list', 5000, 0)
            candidates = [
                r for r in recent_otps
                if r.get('channel') == channel and r.get('target') == target
                and r.get('purpose') == 'auth' and r.get('verified_at') is None
                and r.get('expires_at') and r['expires_at'] > now
            ]
            candidates.sort(key=lambda r: r.get('created_at') or datetime.datetime.min, reverse=True)
            otp_req = candidates[0] if candidates else None

            if otp_req is None:
                return jsonify(
                    response={'message': 'No active OTP found. Please request a new OTP.'},
                    status=400, bool=False
                )

            new_attempt_count = (otp_req.get('attempt_count') or 0) + 1

            if new_attempt_count > 5:
                call_proc_one(
                    'sp_otp_requests_update',
                    otp_req['id'], otp_req.get('channel'), otp_req.get('target'), otp_req.get('otp_hash'),
                    otp_req.get('purpose'), new_attempt_count, otp_req.get('expires_at'), otp_req.get('verified_at'),
                    otp_req.get('created_by'), otp_req.get('updated_by'),
                )
                db.session.commit()
                return jsonify(
                    response={'message': 'Too many failed attempts. Please request a new OTP.'},
                    status=429, bool=False
                )

            otp_hash = hashlib.sha256(otp.encode()).hexdigest()
            if otp_hash != otp_req.get('otp_hash'):
                call_proc_one(
                    'sp_otp_requests_update',
                    otp_req['id'], otp_req.get('channel'), otp_req.get('target'), otp_req.get('otp_hash'),
                    otp_req.get('purpose'), new_attempt_count, otp_req.get('expires_at'), otp_req.get('verified_at'),
                    otp_req.get('created_by'), otp_req.get('updated_by'),
                )
                db.session.commit()
                remaining = max(0, 5 - new_attempt_count)
                return jsonify(
                    response={'message': f'Incorrect OTP. {remaining} attempt{"s" if remaining != 1 else ""} remaining.'},
                    status=400, bool=False
                )

            call_proc_one(
                'sp_otp_requests_update',
                otp_req['id'], otp_req.get('channel'), otp_req.get('target'), otp_req.get('otp_hash'),
                otp_req.get('purpose'), new_attempt_count, otp_req.get('expires_at'), now,
                otp_req.get('created_by'), otp_req.get('updated_by'),
            )

            # ── Find or create user ──────────────────────────────────────────
            # ── SP: sp_users_list — no by-phone/by-email lookup proc exists, so
            # scan the (deleted_at-filtered) bounded batch this already returns. ─
            is_new_user = False
            all_users = call_proc('sp_users_list', 50000, 0)
            if phone:
                user = next((u for u in all_users if u.get('phone') == phone), None)
            else:
                user = next((u for u in all_users if (u.get('email') or '').lower() == email), None)

            if user is None:
                # Block duplicate email globally (any institution or role)
                if email:
                    global_exists = next((u for u in all_users if (u.get('email') or '').lower() == email), None)
                    if global_exists:
                        db.session.commit()
                        return jsonify(
                            response={'message': 'An account with this email already exists. Please log in instead.'},
                            status=409, bool=False
                        )

                is_new_user = True
                if not full_name:
                    full_name = 'Skovo User'

                user_id = str(uuid.uuid4())
                # ── SP: sp_users_create ────────────────────────────────────────
                try:
                    user = call_proc_one(
                        'sp_users_create',
                        user_id,
                        normalise_indian_mobile(args.get('whatsapp')) or phone or None,
                        email or None, full_name,
                        generate_password_hash(password) if password else None,
                        None, 'active', user_id, user_id, None,
                    )
                except IntegrityError:
                    db.session.rollback()
                    return jsonify(
                        response={'message': 'An account with this email already exists. Please log in instead.'},
                        status=409, bool=False
                    )

                # ── SP: sp_auth_identities_create, sp_user_profiles_create,
                # sp_readiness_scores_create ───────────────────────────────────
                call_proc_one(
                    'sp_auth_identities_create',
                    str(uuid.uuid4()), user_id, 'phone' if phone else 'email', target, 1, user_id, user_id,
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
                logger.info(f"Auto-registered new user id={user_id} role={role}")

            else:
                user_id = user['id']
                if user.get('status') == 'blocked':
                    db.session.commit()
                    return jsonify(
                        response={'message': 'Your account has been suspended. Contact support@skovoai.com.'},
                        status=401, bool=False
                    )

            role_code = 'student'

            # ── Issue JWT tokens ─────────────────────────────────────────────
            additional_claims = {
                'userid': user_id,
                'role': role_code,
                'is_new_user': is_new_user,
            }

            access_token = create_access_token(
                identity=str(user_id),
                additional_claims=additional_claims,
                fresh=True
            )
            refresh_token = create_refresh_token(
                identity=str(user_id),
                additional_claims=additional_claims
            )

            try:
                rt_payload = decode_token(refresh_token)
                jti = rt_payload.get('jti')
            except Exception:
                jti = None

            rt_hash = hashlib.sha256(refresh_token.encode()).hexdigest()
            # ── SP: sp_sessions_create ─────────────────────────────────────────
            call_proc_one(
                'sp_sessions_create',
                str(uuid.uuid4()), user_id, jti, rt_hash, args.get('device_id'),
                json.dumps(args.get('device_meta') or {}), now + datetime.timedelta(days=30),
                None, user_id, user_id,
            )
            db.session.commit()

            if is_new_user and (args.get('referral_code') or '').strip():
                try:
                    from portal.helpers.referral_rewards import bind_signup
                    bind_signup(user_id, email or user.get('email'), args.get('referral_code'))
                except Exception as ref_err:
                    logger.error(f"referral bind failed for {user_id}: {ref_err}")

            # CRM: new student → 'Waitlisted/App-installed' pipeline + Campaigns
            # onboarding sequence; returning login → app_installed touchpoint.
            try:
                from portal.helpers.analytics import track_event
                track_event(
                    'student_registered' if is_new_user else 'app_installed',
                    entity_type='user', entity_id=user_id, user_id=user_id,
                    meta={'email': user.get('email'), 'phone': user.get('phone'), 'full_name': user.get('full_name')},
                    req=request,
                )
            except Exception:
                pass

            return jsonify(
                response={
                    'user_id': user_id,
                    'full_name': user.get('full_name'),
                    'phone': user.get('phone'),
                    'email': user.get('email'),
                    'avatar_url': user.get('avatar_url'),
                    'status': user.get('status'),
                    'role': role_code,
                    'is_new_user': is_new_user,
                },
                access_token=access_token,
                refresh_token=refresh_token,
                expires_at=int(time.time()) + 1800,
                status=200,
                bool=True
            )

        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in POST /auth/otp/verify: {e}")
            logger.exception(e)
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)
