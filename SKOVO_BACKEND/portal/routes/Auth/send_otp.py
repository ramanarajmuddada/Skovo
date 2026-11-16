from portal.helpers.error_capture import capture_error
import uuid
import re
import hashlib
import datetime
from flask import jsonify
from flask_restx import Resource, reqparse
from portal.models import db
from portal.helpers.sp import call_proc, call_proc_one
from portal.helpers.sms import send_otp_sms
from portal.helpers.email_template import send_otp_email
from portal.helpers.helpers import generate_otp
from portal.helpers.identity import email_conflict, conflict_message, email_exists
from portal.helpers.rate_limit import limiter
from portal.helpers.email_hygiene import suggest_email
from . import ns, logger

parser = reqparse.RequestParser()
parser.add_argument('phone', type=str, location='json', required=False, help='Mobile number (e.g. +919876543210)')
parser.add_argument('email', type=str, location='json', required=False, help='Email address')
# What the code is FOR. Defaults to 'register' so every existing caller keeps
# the behaviour it has today; 'reset' is the password-reset flow, which needs
# the opposite guard.
parser.add_argument('purpose', type=str, location='json', required=False,
                    help="'register' (default) or 'reset'")
# Which portal is asking, so a reset checks the right table. Optional: without
# it a reset matches an account in any of the four.
parser.add_argument('role', type=str, location='json', required=False,
                    help="'student' | 'achiever' | 'admin' | 'super_admin'")

# Said for BOTH reset outcomes -- code sent and no such account. Wording that
# differed between the two would be the same enumeration oracle as naming the
# owning portal, just phrased as good news.
_RESET_SENT = 'If that address has an account, a code is on its way.'

_PHONE_RE = re.compile(r'^\+?[1-9]\d{6,14}$')
_EMAIL_RE = re.compile(r'^[^\s@]+@[^\s@]+\.[^\s@]+$')


@ns.route('/otp/send')
class SendOTP(Resource):
    # IP-level guard on top of the per-target 5/10min + 60s cooldown below.
    decorators = [limiter.limit("15 per hour")]

    @ns.doc(
        description='Send a 6-digit OTP via SMS (phone) or email. Rate limited to 5 per 10 minutes per target.',
        responses={200: 'OTP sent', 400: 'Validation error', 429: 'Rate limit exceeded', 500: 'Server error'}
    )
    @ns.expect(parser, validate=False)
    def post(self):
        try:
            args = parser.parse_args(strict=False)
            phone = (args.get('phone') or '').strip()
            email = (args.get('email') or '').strip().lower()
            purpose = (args.get('purpose') or 'register').strip().lower()
            if purpose not in ('register', 'reset', 'login'):
                purpose = 'register'
            role = (args.get('role') or '').strip().lower() or None
            if role not in ('student', 'achiever', 'admin', 'super_admin'):
                role = None

            if not phone and not email:
                return jsonify(response={'message': 'Either phone or email is required.'}, status=400, bool=False)

            if phone and not _PHONE_RE.match(phone):
                return jsonify(response={'message': 'Invalid phone number format.'}, status=400, bool=False)

            if email and not _EMAIL_RE.match(email):
                return jsonify(response={'message': 'Invalid email address format.'}, status=400, bool=False)

            # A domain one keystroke wrong is valid syntax and reaches nobody --
            # the person waits for a code that cannot arrive, and on a live
            # sender it is a hard bounce, which is the number Amazon watches.
            # Offered, never applied: the address is refused with the correction
            # so the person confirms it, because only they know what is right.
            _sug = suggest_email(email)
            if _sug:
                return jsonify(response={
                    'message': f'Did you mean {_sug}? Check the address and try again.',
                    'suggestion': _sug,
                }, status=400, bool=False)

            # An email that already belongs to an achiever, admin or owner cannot
            # become a student -- /auth/register enforces that and returns 409.
            # This endpoint did not, so a code was emailed to an address the flow
            # was always going to reject, and the person only found out three
            # steps later. The achiever's own send-otp has checked this from the
            # start; this brings the student flow in line.
            #
            # Only for email: a phone number is not what identifies an account
            # across the four tables, so there is nothing to check against.
            # Registration wants the address to be FREE. Password reset wants
            # the opposite -- it is by definition an address that already has an
            # account. Running one guard for both inverted the reset flow
            # completely: every real account was refused with a signup error
            # telling the owner to "use a different email address", while an
            # address that had never registered sailed through to the code
            # screen. The only people who could not reset a password were the
            # ones who had one.
            if email and purpose == 'register':
                clash = email_conflict(email, 'student')
                if clash:
                    return jsonify(response={'message': conflict_message(clash)},
                                   status=409, bool=False)
                # Same table too: a student signing up again with their own
                # address got a code, then the verify step quietly signed them
                # in and the screen said "Account created". Say it up front,
                # as the achiever sign-up does.
                if email_exists(email, 'student'):
                    return jsonify(response={'message': 'An account with this email already exists. '
                                                        'Sign in, or use Forgot password.'},
                                   status=409, bool=False)

            # Reset: no code for an address with no account -- but the caller is
            # told the same thing either way. Answering "no such account" here
            # would turn this endpoint into the account-enumeration oracle that
            # conflict_message() above exists to avoid, and an unauthenticated
            # reset form is the easiest place in the product to probe.
            # 'login' joins 'reset' here. OTP login used to send with no purpose
            # at all, so it fell to the 'register' branch above -- which only
            # looks for a CROSS-TABLE clash and deliberately expects the account
            # not to exist yet. The result was an unauthenticated send-mail
            # primitive: any address on earth got a real 6-digit code, and the
            # sign-in screen cheerfully said a code was on its way to an account
            # that had never existed. Same neutral answer either way, for the
            # enumeration reason above.
            if email and purpose in ('reset', 'login') and not email_exists(email, role):
                logger.info(f'otp/send {purpose} requested for an address with no account')
                # Answered plainly rather than with _RESET_SENT. The neutral
                # wording was there to stop this endpoint confirming which
                # addresses have accounts -- but /signup already answers that
                # outright ("An account with this email already exists"), so the
                # oracle exists regardless and the hedge only bought confusion:
                # a sign-in with no account walked on to an OTP screen to wait
                # for a code that was never coming.
                return jsonify(response={'message': 'No account found with this email address.'},
                               status=404, bool=False)

            channel = 'sms' if phone else 'email'
            target = phone if phone else email

            # ── SP: sp_otp_requests_list — no channel/target/time filter on the
            # generic CRUD proc, so pull a bounded recent batch and count here. ─
            # created_at comes back on the DB's clock (CURRENT_TIMESTAMP), so
            # compare against the DB's own NOW() — NOT Python utcnow(), which is
            # 5.5h off when the MySQL server runs in IST.
            from sqlalchemy import text as _text
            now = db.session.execute(_text('SELECT NOW()')).scalar()
            ten_min_ago = now - datetime.timedelta(minutes=10)
            recent_rows = call_proc('sp_otp_requests_list', 5000, 0)
            same_target = [
                r for r in recent_rows
                if r.get('channel') == channel and r.get('target') == target and r.get('created_at')
            ]
            recent_count = sum(1 for r in same_target if r['created_at'] > ten_min_ago)

            # Hard cap: 5 per 10 minutes per target.
            if recent_count >= 5:
                return jsonify(
                    response={'message': 'Too many OTP requests. Please wait 10 minutes and try again.'},
                    status=429, bool=False
                )

            # Resend cooldown: must wait 60s since the last OTP to this target.
            # Blocks rapid-fire spamming (and SMS cost) even within the 5/10min cap.
            COOLDOWN_SECONDS = 60
            last_sent = max((r['created_at'] for r in same_target), default=None)
            if last_sent is not None:
                elapsed = (now - last_sent).total_seconds()
                if 0 <= elapsed < COOLDOWN_SECONDS:
                    wait = int(COOLDOWN_SECONDS - elapsed)
                    return jsonify(
                        response={'message': f'Please wait {wait}s before requesting another OTP.'},
                        retry_after=wait, status=429, bool=False
                    )

            otp = generate_otp(6)
            otp_hash = hashlib.sha256(otp.encode()).hexdigest()

            # ── SP: sp_otp_requests_create ─────────────────────────────────────
            call_proc_one(
                'sp_otp_requests_create',
                str(uuid.uuid4()), channel, target, otp_hash, 'auth', 0,
                datetime.datetime.utcnow() + datetime.timedelta(minutes=10), None, None, None,
            )
            db.session.commit()

            sent = False
            if channel == 'sms':
                sent = send_otp_sms(phone, otp)
            else:
                sent = send_otp_email(email, otp)

            if not sent:
                # dev_otp removed 2026-09-06. It returned the one-time code in the
                # API response whenever mail was unconfigured, and its guard —
                # os.getenv('Backend', 'DEV') — DEFAULTED to DEV, so it failed
                # open: anyone who could post an email address could read the OTP
                # out of the JSON and take the account, on every portal. Mail is
                # ZeptoMail now, so a send failure is a real failure and says so.
                return jsonify(
                    response={'message': 'Failed to send OTP. Please try again later.'},
                    status=500, bool=False
                )

            logger.info(f"OTP sent via {channel} to {target}")
            return jsonify(
                response={'message': _RESET_SENT if purpose == 'reset'
                          else f'OTP sent successfully to your {channel}.'},
                status=200, bool=True
            )

        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in POST /auth/otp/send: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)
