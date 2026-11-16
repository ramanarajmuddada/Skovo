from portal.helpers.error_capture import capture_error
import json
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
from portal.helpers.identity import email_conflict, conflict_message
from portal.helpers import field_limits as FL
from portal.helpers.email_hygiene import suggest_email, check_email_format
from . import ns, logger

send_otp_parser = reqparse.RequestParser()
send_otp_parser.add_argument('email', type=str, location='json', required=True)

register_parser = reqparse.RequestParser()
register_parser.add_argument('full_name',    type=str,  location='json', required=True)
register_parser.add_argument('email',        type=str,  location='json', required=True)
register_parser.add_argument('password',     type=str,  location='json', required=True)
register_parser.add_argument('otp',          type=str,  location='json', required=True)
register_parser.add_argument('designation',  type=str,  location='json', required=False)
register_parser.add_argument('company',      type=str,  location='json', required=False)
register_parser.add_argument('linkedin_url', type=str,  location='json', required=False)
register_parser.add_argument('bio',          type=str,  location='json', required=False)
register_parser.add_argument('domains',      type=list, location='json', required=False)
register_parser.add_argument('referral_code', type=str, location='json', required=False)


@ns.route('/register/send-otp')
class AchieverRegisterSendOTP(Resource):
    def post(self):
        try:
            args  = send_otp_parser.parse_args(strict=False)
            email = (args.get('email') or '').strip().lower()

            if not email:
                return jsonify(response={'message': 'Email is required.'}, status=400, bool=False)
            # Refused here rather than three steps later: an address longer than
            # the column can hold will fail at /register whatever the OTP says,
            # so sending a code to it only wastes the send and the person's time.
            verr = FL.check(email, 'Email', FL.EMAIL)
            if verr:
                return jsonify(response={'message': verr}, status=400, bool=False)
            # Same reasoning as the length check above, one step cruder: an
            # address that is not an address cannot receive the code, so sending
            # one wastes the send and leaves the person waiting. X04-027/028/029.
            ferr = check_email_format(email)
            if ferr:
                return jsonify(response={'message': ferr, 'field': 'email'},
                               status=400, bool=False)

            # ── SP: sp_identity_email_lookup — one indexed row instead of the
            # 50,000-row scan this used to do, and it also sees the students
            # table: an achiever and a student must be two different people. ───
            row = call_proc_one('sp_identity_email_lookup', email) or {}
            if row.get('in_achievers'):
                return jsonify(response={'message': 'An account with this email already exists.'}, status=409, bool=False)
            # A domain one keystroke wrong is valid syntax and reaches nobody.
            # Offered, never applied -- only the person knows what is right.
            _sug = suggest_email(email)
            if _sug:
                return jsonify(response={
                    'message': f'Did you mean {_sug}? Check the address and try again.',
                    'suggestion': _sug,
                }, status=400, bool=False)

            clash = email_conflict(email, 'achiever')
            if clash:
                return jsonify(response={'message': conflict_message(clash)}, status=409, bool=False)

            ten_min_ago = datetime.datetime.utcnow() - datetime.timedelta(minutes=10)
            # ── SP: sp_otp_requests_list — no channel/target/time filter on the
            # generic CRUD proc, so pull a bounded recent batch and count here. ─
            recent_rows = call_proc('sp_otp_requests_list', 5000, 0)
            recent = sum(
                1 for r in recent_rows
                if r.get('channel') == 'email' and r.get('target') == email
                and r.get('created_at') and r['created_at'] > ten_min_ago
            )
            if recent >= 5:
                return jsonify(response={'message': 'Too many OTP requests. Please wait 10 minutes.'}, status=429, bool=False)

            otp      = generate_otp(6)
            otp_hash = hashlib.sha256(otp.encode()).hexdigest()
            # ── SP: sp_otp_requests_create ───────────────────────────────────────
            call_proc_one(
                'sp_otp_requests_create',
                str(uuid.uuid4()), 'email', email, otp_hash, 'achiever', 0,
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
                return jsonify(response={'message': 'Failed to send OTP. Please try again.'}, status=500, bool=False)

            return jsonify(response={'message': f'OTP sent to {email}.'}, status=200, bool=True)

        except Exception as e:
            db.session.rollback()
            logger.error(f"Achiever register send-otp error: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/register')
class AchieverRegister(Resource):
    def post(self):
        try:
            args        = register_parser.parse_args(strict=False)
            full_name   = (args.get('full_name') or '').strip()
            email       = (args.get('email') or '').strip().lower()
            password    = (args.get('password') or '').strip()
            otp         = (args.get('otp') or '').strip()
            designation = (args.get('designation') or '').strip() or None
            company     = (args.get('company') or '').strip() or None
            linkedin    = (args.get('linkedin_url') or '').strip() or None
            bio         = (args.get('bio') or '').strip() or None
            domains     = args.get('domains') or []

            if not full_name or not email or not password or not otp:
                return jsonify(response={'message': 'All required fields must be filled.'}, status=400, bool=False)
            if len(password) < 6:
                return jsonify(response={'message': 'Password must be at least 6 characters.'}, status=400, bool=False)

            # Stated maximums. `email` is the one that actually 500'd:
            # achievers.email is VARCHAR(255), so a 256-character address was
            # MySQL errno 1406 on the signup form. X04-022/030/036/051/058.
            verr = FL.check_all([
                (full_name, 'Full name', FL.FULL_NAME),
                (email, 'Email', FL.EMAIL),
                (password, 'Password', FL.PASSWORD),
                (designation, 'Designation', FL.DESIGNATION),
                (company, 'Company', FL.COMPANY),
                (linkedin, 'LinkedIn URL', FL.URL),
                (bio, 'Bio', FL.BIO),
            ])
            if verr:
                return jsonify(response={'message': verr}, status=400, bool=False)

            # Checked here too, not only in send-otp: a client can POST straight
            # to /register, so a rule enforced only on the way in is not
            # enforced. X04-027/028/029.
            ferr = check_email_format(email)
            if ferr:
                return jsonify(response={'message': ferr, 'field': 'email'},
                               status=400, bool=False)

            now = datetime.datetime.utcnow()

            # ── SP: sp_otp_requests_list — no channel/target/purpose/expiry filter
            # on the generic CRUD proc, so pull a bounded recent batch and pick the
            # newest matching, still-valid, unverified request in Python. ─────────
            recent_otps = call_proc('sp_otp_requests_list', 5000, 0)
            candidates = [
                r for r in recent_otps
                if r.get('channel') == 'email' and r.get('target') == email
                and r.get('purpose') == 'achiever' and r.get('verified_at') is None
                and r.get('expires_at') and r['expires_at'] > now
            ]
            candidates.sort(key=lambda r: r.get('created_at') or datetime.datetime.min, reverse=True)
            otp_req = candidates[0] if candidates else None

            if not otp_req:
                return jsonify(response={'message': 'OTP expired or not found. Please request a new one.'}, status=400, bool=False)

            new_attempt_count = (otp_req.get('attempt_count') or 0) + 1

            if new_attempt_count > 5:
                call_proc_one(
                    'sp_otp_requests_update',
                    otp_req['id'], otp_req.get('channel'), otp_req.get('target'), otp_req.get('otp_hash'),
                    otp_req.get('purpose'), new_attempt_count, otp_req.get('expires_at'), otp_req.get('verified_at'),
                    otp_req.get('created_by'), otp_req.get('updated_by'),
                )
                db.session.commit()
                return jsonify(response={'message': 'Too many failed attempts. Please request a new OTP.'}, status=429, bool=False)

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

            # Re-check at the point of creation, not only before the OTP was
            # sent: an OTP is valid for ten minutes, and the address could have
            # been claimed as a student account in between.
            # A domain one keystroke wrong is valid syntax and reaches nobody.
            # Offered, never applied -- only the person knows what is right.
            _sug = suggest_email(email)
            if _sug:
                return jsonify(response={
                    'message': f'Did you mean {_sug}? Check the address and try again.',
                    'suggestion': _sug,
                }, status=400, bool=False)

            clash = email_conflict(email, 'achiever')
            if clash:
                return jsonify(response={'message': conflict_message(clash)}, status=409, bool=False)

            achiever_id = str(uuid.uuid4())
            # ── SP: sp_achievers_create — uq_achievers_email enforces the
            # duplicate check via IntegrityError. ───────────────────────────────
            try:
                call_proc_one(
                    'sp_achievers_create',
                    achiever_id, full_name, None, designation, company, bio, None,
                    json.dumps([]), None, linkedin, 0, 0, 1, email,
                    generate_password_hash(password), 'active', None, None,
                    json.dumps(domains), json.dumps([]), None, None, None, None, None,
                    achiever_id, achiever_id,
                )
            except IntegrityError:
                db.session.rollback()
                return jsonify(response={'message': 'An account with this email already exists.'}, status=409, bool=False)

            db.session.commit()

            referral_code = (args.get('referral_code') or '').strip()
            if referral_code:
                try:
                    from portal.helpers.referral_rewards import bind_achiever
                    bind_achiever(achiever_id, email, referral_code)
                except Exception as bind_err:
                    logger.error(f"achiever referral bind failed for {achiever_id}: {bind_err}")

            logger.info(f"Achiever registered: {email}")
            # CRM: achiever 'Applied' pipeline stage → Zoho review/approval flow.
            try:
                from portal.helpers.analytics import track_event
                track_event('achiever_applied', entity_type='achiever', entity_id=achiever_id,
                            meta={'email': email, 'full_name': full_name, 'company': company})
            except Exception:
                pass
            return jsonify(
                response={'message': 'Registration successful! Your profile is pending admin verification.', 'email': email},
                status=201, bool=True
            )

        except Exception as e:
            db.session.rollback()
            logger.error(f"Achiever register error: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)
