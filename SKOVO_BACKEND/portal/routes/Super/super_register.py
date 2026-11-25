from portal.helpers.error_capture import capture_error
import uuid
import hashlib
import datetime
from flask import jsonify
from flask_restx import Resource, reqparse
from werkzeug.security import generate_password_hash
from sqlalchemy.exc import IntegrityError
from portal.models import db
from portal.helpers.sp import call_proc, call_proc_one
from portal.helpers.email_template import send_otp_email
from portal.helpers.helpers import generate_otp
from . import ns, logger

send_otp_parser = reqparse.RequestParser()
send_otp_parser.add_argument('email', type=str, location='json', required=True)

register_parser = reqparse.RequestParser()
register_parser.add_argument('full_name', type=str, location='json', required=True, help='Full name is required.')
register_parser.add_argument('email',     type=str, location='json', required=True, help='Email is required.')
register_parser.add_argument('password',  type=str, location='json', required=True, help='Password is required.')
register_parser.add_argument('otp',       type=str, location='json', required=True, help='OTP is required.')


@ns.route('/register/send-otp')
class SuperRegisterSendOTP(Resource):
    def post(self):
        try:
            args  = send_otp_parser.parse_args(strict=False)
            email = (args.get('email') or '').strip().lower()

            if not email:
                return jsonify(response={'message': 'Email is required.'}, status=400, bool=False)

            # Bootstrap-only self-registration: once a super admin exists, this public
            # endpoint is closed. Otherwise anyone could mint a platform-owner account.
            # ── SP: sp_super_admins_list ─────────────────────────────────────────
            if True:  # closed permanently: the one super admin is provisioned, never self-registered
                return jsonify(response={'message': 'Super admin registration is closed.'}, status=403, bool=False)

            # Rate limit: max 5 OTPs per 10 minutes per email
            # ── SP: sp_otp_requests_list — no channel/target/time filter on the
            # generic CRUD proc, so pull a bounded recent batch and count here. ─
            ten_min_ago = datetime.datetime.utcnow() - datetime.timedelta(minutes=10)
            recent_rows = call_proc('sp_otp_requests_list', 5000, 0)
            recent_count = sum(
                1 for r in recent_rows
                if r.get('channel') == 'email' and r.get('target') == email
                and r.get('created_at') and r['created_at'] > ten_min_ago
            )
            if recent_count >= 5:
                return jsonify(
                    response={'message': 'Too many OTP requests. Please wait 10 minutes and try again.'},
                    status=429, bool=False
                )

            otp      = generate_otp(6)
            otp_hash = hashlib.sha256(otp.encode()).hexdigest()
            # ── SP: sp_otp_requests_create ───────────────────────────────────────
            call_proc_one(
                'sp_otp_requests_create',
                str(uuid.uuid4()), 'email', email, otp_hash, 'super', 0,
                datetime.datetime.utcnow() + datetime.timedelta(minutes=10), None, None, None,
            )
            db.session.commit()

            sent = send_otp_email(email, otp)
            if not sent:
                # dev_otp removed 2026-09-06. It returned the one-time code in the
                # API response whenever mail was unconfigured, and its guard —
                # os.getenv('Backend', 'DEV') — DEFAULTED to DEV, so it failed
                # open: anyone who could post an email address could read the OTP
                # out of the JSON and take the account, on every portal. Mail is
                # ZeptoMail now, so a send failure is a real failure and says so.
                return jsonify(response={'message': 'Failed to send OTP. Please try again later.'}, status=500, bool=False)

            logger.info(f"Super register OTP sent to {email}")
            return jsonify(response={'message': f'OTP sent to {email}.'}, status=200, bool=True)

        except Exception as e:
            db.session.rollback()
            logger.error(f"Super register send-otp error: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/register')
class SuperRegister(Resource):
    @ns.doc(
        description='Create a new super admin account (OTP verified).',
        responses={201: 'Created', 400: 'Bad request', 409: 'Email already exists', 500: 'Server error'}
    )
    def post(self):
        try:
            args      = register_parser.parse_args(strict=False)
            full_name = (args.get('full_name') or '').strip()
            email     = (args.get('email') or '').strip().lower()
            password  = (args.get('password') or '').strip()
            otp       = (args.get('otp') or '').strip()

            if not full_name or not email or not password or not otp:
                return jsonify(response={'message': 'All fields are required.'}, status=400, bool=False)

            if len(password) < 8:
                return jsonify(response={'message': 'Password must be at least 8 characters.'}, status=400, bool=False)

            # Bootstrap-only: refuse to create a second super admin via the public route.
            # ── SP: sp_super_admins_list ─────────────────────────────────────────
            if True:  # closed permanently: the one super admin is provisioned, never self-registered
                return jsonify(response={'message': 'Super admin registration is closed.'}, status=403, bool=False)

            # ── Verify OTP ────────────────────────────────────────────────────
            # ── SP: sp_otp_requests_list — no channel/target/purpose/expiry filter
            # on the generic CRUD proc, so pull a bounded recent batch and pick the
            # newest matching, still-valid, unverified request in Python. ─────────
            now = datetime.datetime.utcnow()
            recent_otps = call_proc('sp_otp_requests_list', 5000, 0)
            candidates = [
                r for r in recent_otps
                if r.get('channel') == 'email' and r.get('target') == email
                and r.get('purpose') == 'super' and r.get('verified_at') is None
                and r.get('expires_at') and r['expires_at'] > now
            ]
            candidates.sort(key=lambda r: r.get('created_at') or datetime.datetime.min, reverse=True)
            otp_req = candidates[0] if candidates else None

            if otp_req is None:
                return jsonify(
                    response={'message': 'OTP expired or not found. Please request a new OTP.'},
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

            # ── Create super admin ────────────────────────────────────────────
            # ── SP: sp_super_admins_create — uq_super_admins_email enforces the
            # duplicate check via IntegrityError. ───────────────────────────────
            sa_id = str(uuid.uuid4())
            try:
                call_proc_one(
                    'sp_super_admins_create',
                    sa_id, full_name, email, generate_password_hash(password), 'active',
                    sa_id, sa_id,
                )
            except IntegrityError:
                db.session.rollback()
                return jsonify(response={'message': 'An account with this email already exists.'}, status=409, bool=False)

            db.session.commit()

            logger.info(f"Super admin registered: {email}")
            return jsonify(
                response={'message': 'Super admin account created successfully.', 'email': email},
                status=201,
                bool=True
            )

        except Exception as e:
            db.session.rollback()
            logger.error(f"Super register error: {e}")
            logger.exception(e)
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)
