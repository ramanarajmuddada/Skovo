from portal.helpers.error_capture import capture_error
import hashlib
import datetime
from flask import jsonify
from flask_restx import Resource, reqparse
from werkzeug.security import generate_password_hash
from portal.models import db
from portal.helpers.sp import call_proc, call_proc_one
from . import ns, logger

parser = reqparse.RequestParser()
parser.add_argument('email', type=str, location='json', required=True, help='Email is required.')
parser.add_argument('otp', type=str, location='json', required=True, help='OTP is required.')
parser.add_argument('new_password', type=str, location='json', required=True, help='New password is required.')


@ns.route('/reset-password')
class ResetPassword(Resource):
    @ns.doc(
        description='Reset password using email + OTP verification.',
        responses={200: 'Password updated', 400: 'Invalid OTP or validation error', 404: 'User not found', 500: 'Server error'}
    )
    @ns.expect(parser, validate=False)
    def post(self):
        try:
            args = parser.parse_args(strict=False)
            email = (args.get('email') or '').strip().lower()
            otp = (args.get('otp') or '').strip()
            new_password = (args.get('new_password') or '').strip()

            if not email:
                return jsonify(response={'message': 'Email is required.'}, status=400, bool=False)
            if not otp:
                return jsonify(response={'message': 'OTP is required.'}, status=400, bool=False)
            if not new_password or len(new_password) < 6:
                return jsonify(response={'message': 'Password must be at least 6 characters.'}, status=400, bool=False)

            now = datetime.datetime.utcnow()

            # ── SP: sp_otp_requests_list — no channel/target/purpose/expiry filter
            # on the generic CRUD proc, so pull a bounded recent batch and pick the
            # newest matching, still-valid, unverified request in Python. ─────────
            recent_otps = call_proc('sp_otp_requests_list', 5000, 0)
            candidates = [
                r for r in recent_otps
                if r.get('channel') == 'email' and r.get('target') == email
                and r.get('purpose') == 'auth' and r.get('verified_at') is None
                and r.get('expires_at') and r['expires_at'] > now
            ]
            candidates.sort(key=lambda r: r.get('created_at') or datetime.datetime.min, reverse=True)
            otp_req = candidates[0] if candidates else None

            if otp_req is None:
                return jsonify(response={'message': 'No active OTP found. Please request a new OTP.'}, status=400, bool=False)

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
                return jsonify(response={'message': f'Incorrect OTP. {remaining} attempt{"s" if remaining != 1 else ""} remaining.'}, status=400, bool=False)

            call_proc_one(
                'sp_otp_requests_update',
                otp_req['id'], otp_req.get('channel'), otp_req.get('target'), otp_req.get('otp_hash'),
                otp_req.get('purpose'), new_attempt_count, otp_req.get('expires_at'), now,
                otp_req.get('created_by'), otp_req.get('updated_by'),
            )

            # ── SP: sp_users_list — no by-email lookup proc exists, so scan the
            # (deleted_at-filtered) bounded batch this already returns. ───────
            all_users = call_proc('sp_users_list', 50000, 0)
            user = next((u for u in all_users if (u.get('email') or '').lower() == email), None)
            if user is None:
                db.session.commit()
                return jsonify(response={'message': 'No account found with this email.'}, status=404, bool=False)

            # ── SP: sp_users_update (full replace) ─────────────────────────────
            call_proc_one(
                'sp_users_update',
                user['id'], user.get('phone'), user.get('email'), user.get('full_name'),
                generate_password_hash(new_password), user.get('avatar_url'), user.get('status'),
                user.get('created_by'), user['id'], user.get('deleted_at'),
            )
            db.session.commit()
            logger.info(f"Password reset for user id={user['id']}")

            return jsonify(response={'message': 'Password updated successfully. Please sign in.'}, status=200, bool=True)

        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in POST /auth/reset-password: {e}")
            logger.exception(e)
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)
