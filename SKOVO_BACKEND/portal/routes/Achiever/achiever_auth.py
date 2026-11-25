from portal.helpers.error_capture import capture_error
import json
import time
import datetime
import hashlib
from flask import jsonify
from flask_restx import Resource, reqparse
from flask_jwt_extended import create_access_token, jwt_required, get_jwt_identity
from werkzeug.security import check_password_hash, generate_password_hash
from sqlalchemy import text
from portal.models import db
from portal.helpers.sp import call_proc, call_proc_one
from portal.helpers.rate_limit import limiter
from portal.helpers import login_otp
from . import ns, logger

login_parser = reqparse.RequestParser()
login_parser.add_argument('email',    type=str, location='json', required=True)
login_parser.add_argument('password', type=str, location='json', required=True)

login_verify_parser = reqparse.RequestParser()
login_verify_parser.add_argument('challenge_id', type=str, location='json', required=True)
login_verify_parser.add_argument('otp',          type=str, location='json', required=True)

login_resend_parser = reqparse.RequestParser()
login_resend_parser.add_argument('challenge_id', type=str, location='json', required=True)

LOGIN_ROLE = 'achiever'


def _login_fail(message, status, **extra):
    return jsonify(response={'message': message, **extra}, status=status, bool=False)


def _find_login_achiever(email):
    # ── SP: sp_achievers_list — no by-email lookup proc exists, so scan the
    # bounded batch this returns. ──────────────────────────────────────────────
    all_achievers = call_proc('sp_achievers_list', 50000, 0, 0)
    return next((
        a for a in all_achievers
        if (a.get('email') or '').lower() == (email or '').lower()
        and a.get('status') == 'active' and a.get('is_active')
    ), None)


def _complete_achiever_login(achiever):
    """Issue the session. Only called after the password AND the emailed code have
    both been checked (or with LOGIN_OTP_REQUIRED=0)."""
    token = create_access_token(
        identity=achiever['id'],
        additional_claims={
            'role':      'mentor',
            'mentor':    True,
            'full_name': achiever.get('full_name'),
        },
        expires_delta=datetime.timedelta(hours=24)
    )

    # Stamp the sign-in. After the token is issued and wrapped in its own try: a
    # failed UPDATE must not turn a successful login into an error the achiever
    # cannot act on. Losing one timestamp is the cheaper loss.
    try:
        db.session.execute(text(
            "UPDATE achievers SET last_login_at = UTC_TIMESTAMP() WHERE id = :i"),
            {'i': achiever['id']})
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        logger.warning(f"could not stamp last_login_at for {achiever['id']}: {e}")

    logger.info(f"Achiever logged in: {achiever.get('email')}")
    return jsonify(
        response={
            'id':          achiever['id'],
            'full_name':   achiever.get('full_name'),
            'email':       achiever.get('email'),
            'is_verified': achiever.get('is_verified'),
            'designation': achiever.get('designation'),
            'company':     achiever.get('company'),
        },
        access_token=token,
        expires_at=int(time.time()) + 86400,
        status=200, bool=True
    )


def _login_challenge_response(res):
    """The client's next step: enter the code. No token is included."""
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


def _as_list(v):
    if isinstance(v, str):
        try:
            return json.loads(v)
        except Exception:
            return []
    return v or []


# order matches sp_achievers_update after (id)
def _achiever_update_args(a, **overrides):
    def g(key):
        return overrides[key] if key in overrides else a.get(key)
    return [
        g('full_name'), g('achievement_title'), g('designation'), g('company'),
        g('bio'), g('avatar_url'), json.dumps(_as_list(g('skills'))),
        g('domain_id'), g('linkedin_url'),
        g('is_verified'), g('is_featured'), g('is_active'), g('email'),
        g('password_hash'), g('status'), g('phone'), g('profile_image_url'),
        json.dumps(_as_list(g('domains'))), json.dumps(_as_list(g('suitable_for'))),
        g('session_rate'), g('payout_account_name'), g('payout_account_number'),
        g('payout_ifsc'), g('payout_upi'), g('created_by'),
    ]


@ns.route('/login')
class AchieverLogin(Resource):
    decorators = [limiter.limit("10 per minute;50 per hour")]

    def post(self):
        try:
            args     = login_parser.parse_args(strict=False)
            email    = (args.get('email') or '').strip().lower()
            password = (args.get('password') or '').strip()

            if not email or not password:
                return jsonify(response={'message': 'Email and password are required.'}, status=400, bool=False)

            achiever = _find_login_achiever(email)
            if not achiever or not achiever.get('password_hash') or not check_password_hash(achiever['password_hash'], password):
                return jsonify(response={'message': 'Invalid email or password.'}, status=401, bool=False)

            # Step 1 of 2: the password is right, so email the code. No token yet.
            if not login_otp.enabled():
                return _complete_achiever_login(achiever)
            res = login_otp.start(LOGIN_ROLE, achiever['email'], achiever.get('full_name') or 'Achiever')
            if not res['ok']:
                return _login_fail(res['message'], res['http'], retry_after=res.get('retry_after'))
            return _login_challenge_response(res)

        except Exception as e:
            db.session.rollback()
            logger.error(f"Achiever login error: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/login/verify')
class AchieverLoginVerify(Resource):
    decorators = [limiter.limit("10 per minute;60 per hour")]

    def post(self):
        try:
            args = login_verify_parser.parse_args(strict=False)
            res = login_otp.verify(LOGIN_ROLE, args.get('challenge_id'), args.get('otp'))
            if not res['ok']:
                return _login_fail(res['message'], res['http'], expired=res.get('expired', False),
                                   attempts_left=res.get('attempts_left'))
            achiever = _find_login_achiever(res['email'])
            # The account may have been suspended in the ten minutes since step 1.
            if not achiever:
                return _login_fail('This account cannot sign in. Contact support@skovoai.com.', 401)
            return _complete_achiever_login(achiever)

        except Exception as e:
            db.session.rollback()
            logger.error(f"Achiever login verify error: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/login/resend')
class AchieverLoginResend(Resource):
    decorators = [limiter.limit("6 per minute;30 per hour")]

    def post(self):
        try:
            args = login_resend_parser.parse_args(strict=False)
            target = login_otp.lookup_target(args.get('challenge_id'), LOGIN_ROLE)
            if not target:
                return _login_fail('This sign-in has expired. Please enter your password again.', 400, expired=True)
            achiever = _find_login_achiever(target)
            if not achiever:
                return _login_fail('This account cannot sign in. Contact support@skovoai.com.', 401)
            res = login_otp.start(LOGIN_ROLE, target, achiever.get('full_name') or 'Achiever')
            if not res['ok']:
                return _login_fail(res['message'], res['http'], retry_after=res.get('retry_after'))
            return _login_challenge_response(res)

        except Exception as e:
            db.session.rollback()
            logger.error(f"Achiever login resend error: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


reset_pw_parser = reqparse.RequestParser()
reset_pw_parser.add_argument('email',        type=str, location='json', required=True)
reset_pw_parser.add_argument('otp',          type=str, location='json', required=True)
reset_pw_parser.add_argument('new_password', type=str, location='json', required=True)


@ns.route('/reset-password')
class AchieverResetPassword(Resource):
    def post(self):
        try:
            args         = reset_pw_parser.parse_args(strict=False)
            email        = (args.get('email') or '').strip().lower()
            otp          = (args.get('otp') or '').strip()
            new_password = (args.get('new_password') or '').strip()

            if not email or not otp or not new_password:
                return jsonify(response={'message': 'email, otp and new_password are required.'}, status=400, bool=False)
            if len(new_password) < 6:
                return jsonify(response={'message': 'Password must be at least 6 characters.'}, status=400, bool=False)

            now = datetime.datetime.utcnow()

            # ── SP: sp_otp_requests_list — no channel/target/purpose/expiry filter
            # on the generic CRUD proc, so pull a bounded recent batch and pick the
            # newest matching, still-valid, unverified request in Python. ─────────
            # Achiever forgot-password uses the student /auth/otp/send endpoint,
            # so accept both that ('auth') and any achiever-scoped code.
            recent_otps = call_proc('sp_otp_requests_list', 5000, 0)
            candidates = [
                r for r in recent_otps
                if r.get('channel') == 'email' and r.get('target') == email
                and r.get('purpose') in ('auth', 'achiever') and r.get('verified_at') is None
                and r.get('expires_at') and r['expires_at'] > now
            ]
            candidates.sort(key=lambda r: r.get('created_at') or datetime.datetime.min, reverse=True)
            otp_req = candidates[0] if candidates else None

            if otp_req is None:
                return jsonify(response={'message': 'No active OTP found. Please request a new one.'}, status=400, bool=False)

            new_attempt_count = (otp_req.get('attempt_count') or 0) + 1

            if new_attempt_count > 5:
                call_proc_one(
                    'sp_otp_requests_update',
                    otp_req['id'], otp_req.get('channel'), otp_req.get('target'), otp_req.get('otp_hash'),
                    otp_req.get('purpose'), new_attempt_count, otp_req.get('expires_at'), otp_req.get('verified_at'),
                    otp_req.get('created_by'), otp_req.get('updated_by'),
                )
                db.session.commit()
                return jsonify(response={'message': 'Too many attempts. Request a new OTP.'}, status=429, bool=False)

            if hashlib.sha256(otp.encode()).hexdigest() != otp_req.get('otp_hash'):
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

            # ── SP: sp_achievers_list — no by-email lookup proc exists, so scan
            # the bounded batch this returns. ──────────────────────────────────
            all_achievers = call_proc('sp_achievers_list', 50000, 0, 0)
            achiever = next((a for a in all_achievers if (a.get('email') or '').lower() == email and a.get('is_active')), None)
            if not achiever:
                db.session.commit()
                return jsonify(response={'message': 'No achiever account found with this email.'}, status=404, bool=False)

            # ── SP: sp_achievers_update (full replace) ──────────────────────────
            call_proc_one(
                'sp_achievers_update',
                achiever['id'], *_achiever_update_args(achiever, password_hash=generate_password_hash(new_password)),
                achiever['id'],
            )
            db.session.commit()
            logger.info(f"Password reset for achiever id={achiever['id']}")
            return jsonify(response={'message': 'Password updated successfully. Please sign in.'}, status=200, bool=True)

        except Exception as e:
            db.session.rollback()
            logger.error(f"Achiever reset-password error: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


change_pw_parser = reqparse.RequestParser()
change_pw_parser.add_argument('current_password', type=str, location='json', required=True)
change_pw_parser.add_argument('new_password',     type=str, location='json', required=True)


@ns.route('/change-password')
class AchieverChangePassword(Resource):
    @jwt_required()
    def post(self):
        try:
            args             = change_pw_parser.parse_args(strict=False)
            current_password = (args.get('current_password') or '').strip()
            new_password     = (args.get('new_password') or '').strip()

            if not current_password or not new_password:
                return jsonify(response={'message': 'Both fields are required.'}, status=400, bool=False)
            if len(new_password) < 6:
                return jsonify(response={'message': 'New password must be at least 6 characters.'}, status=400, bool=False)

            achiever_id = get_jwt_identity()
            # ── SP: sp_achievers_get + _update (full replace) ───────────────────
            achiever = call_proc_one('sp_achievers_get', achiever_id)
            if not achiever:
                return jsonify(response={'message': 'Achiever not found.'}, status=404, bool=False)

            if not achiever.get('password_hash') or not check_password_hash(achiever['password_hash'], current_password):
                return jsonify(response={'message': 'Current password is incorrect.'}, status=400, bool=False)

            call_proc_one(
                'sp_achievers_update',
                achiever_id, *_achiever_update_args(achiever, password_hash=generate_password_hash(new_password)),
                achiever_id,
            )
            db.session.commit()
            logger.info(f"Achiever {achiever.get('email')} changed password.")
            return jsonify(response={'message': 'Password changed successfully.'}, status=200, bool=True)

        except Exception as e:
            db.session.rollback()
            logger.error(f"Achiever change-password error: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)
