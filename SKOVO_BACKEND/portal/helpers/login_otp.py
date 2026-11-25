"""
Email one-time codes for the second step of sign-in (students and achievers).

A correct password no longer signs anyone in. It opens a *challenge*: a code is
emailed to the address on the account and the client gets back a challenge id
and no session. Only `verify()` returning ok lets the route issue tokens.

Properties (all enforced here, on the server):
  * unique       -- 6 random digits per challenge, hashed with HMAC-SHA256 keyed by
                    the server secret and the challenge id, so two challenges never
                    share a hash and a leaked table cannot be brute-forced offline.
  * time-limited -- 10 minutes (OTP_TTL_MINUTES).
  * single-use   -- consumed with one atomic UPDATE ... WHERE verified_at IS NULL;
                    a second use (or a race between two requests) affects 0 rows.
  * guess-limited-- 5 wrong tries (atomic counter), then the challenge is dead.
  * resend       -- one new code per 60 s; a new code kills the previous one; at
                    most 5 codes per 10 minutes per address and purpose.

All times use the database's UTC_TIMESTAMP() so nothing depends on the server's
timezone or on Python/DB clock skew.
"""
import hashlib
import hmac
import os
import uuid

from sqlalchemy import text

from portal.models import db
from portal.helpers.helpers import generate_otp

OTP_TTL_MINUTES = 10
MAX_ATTEMPTS = 5
RESEND_COOLDOWN_SECONDS = 60
MAX_CODES_PER_WINDOW = 5
WINDOW_MINUTES = 10

ROLES = ('student', 'achiever')
EXPIRED_MSG = 'This code has expired or was already used. Please request a new one.'


def enabled():
    """Whether sign-in asks for an emailed code after the password.

    OFF by default: product rule is that OTP is for signup and password reset
    only, and people sign in with email + password. The two-step login stays in
    the code behind this switch -- set LOGIN_OTP_REQUIRED=1 to turn it back on.
    """
    return os.environ.get('LOGIN_OTP_REQUIRED', '0').strip() in ('1', 'true', 'True', 'yes')


def purpose_for(role):
    if role not in ROLES:
        raise ValueError('role must be student or achiever')
    return f'login_{role}'


def mask_email(email):
    name, _, domain = (email or '').partition('@')
    if not domain:
        return ''
    shown = name[:2] if len(name) > 2 else name[:1]
    return f"{shown}{'*' * max(1, len(name) - len(shown))}@{domain}"


def _hash(challenge_id, otp):
    key = (os.environ.get('APP_SECRET_KEY') or 'dev-only').encode()
    return hmac.new(key, f'{challenge_id}:{otp}'.encode(), hashlib.sha256).hexdigest()


def _result(ok, message=None, http=200, **extra):
    return {'ok': ok, 'message': message, 'http': http, **extra}


def lookup_target(challenge_id, role):
    """The email a challenge was issued to (in any state), or None. Used by resend."""
    row = db.session.execute(
        text("SELECT target FROM otp_requests WHERE id = :i AND purpose = :p"),
        {'i': (challenge_id or '').strip(), 'p': purpose_for(role)}).fetchone()
    return row[0] if row else None


def start(role, email, name='there'):
    """Create a challenge and email the code.

    Returns a dict with ok / message / http and, on success, challenge_id,
    email_masked, resend_in and expires_in.
    """
    from portal.helpers.email_template import send_otp_email

    purpose = purpose_for(role)
    email = (email or '').strip().lower()

    stats = db.session.execute(text(
        "SELECT COUNT(*), "
        "       COALESCE(MIN(TIMESTAMPDIFF(SECOND, created_at, UTC_TIMESTAMP())), 9999) "
        "FROM otp_requests WHERE purpose = :p AND target = :t "
        "AND created_at > UTC_TIMESTAMP() - INTERVAL :w MINUTE"),
        {'p': purpose, 't': email, 'w': WINDOW_MINUTES}).fetchone()
    count, since_last = int(stats[0]), int(stats[1])

    if count >= MAX_CODES_PER_WINDOW:
        return _result(False, f'Too many codes requested. Please wait {WINDOW_MINUTES} minutes and try again.', 429,
                       retry_after=WINDOW_MINUTES * 60)
    if since_last < RESEND_COOLDOWN_SECONDS:
        wait = RESEND_COOLDOWN_SECONDS - since_last
        return _result(False, f'Please wait {wait}s before requesting another code.', 429, retry_after=wait)

    cid = str(uuid.uuid4())
    otp = generate_otp(6)
    # A new code kills every earlier one for this address, so only the newest works.
    db.session.execute(text(
        "UPDATE otp_requests SET expires_at = UTC_TIMESTAMP() - INTERVAL 1 SECOND "
        "WHERE purpose = :p AND target = :t AND verified_at IS NULL"), {'p': purpose, 't': email})
    db.session.execute(text(
        "INSERT INTO otp_requests (id, channel, target, otp_hash, purpose, attempt_count, expires_at, created_at, updated_at) "
        "VALUES (:i, 'email', :t, :h, :p, 0, UTC_TIMESTAMP() + INTERVAL :m MINUTE, UTC_TIMESTAMP(), UTC_TIMESTAMP())"),
        {'i': cid, 't': email, 'h': _hash(cid, otp), 'p': purpose, 'm': OTP_TTL_MINUTES})
    db.session.commit()

    if not send_otp_email(email, otp, name or 'there'):
        db.session.execute(text(
            "UPDATE otp_requests SET expires_at = UTC_TIMESTAMP() - INTERVAL 1 SECOND WHERE id = :i"), {'i': cid})
        db.session.commit()
        return _result(False, 'We could not send the code to your email. Please try again in a moment.', 500)

    return _result(True, 'We sent a 6-digit code to your email.', 200,
                   challenge_id=cid, email_masked=mask_email(email),
                   resend_in=RESEND_COOLDOWN_SECONDS, expires_in=OTP_TTL_MINUTES * 60)


def verify(role, challenge_id, otp):
    """Check a code. On success the challenge is consumed and the result has `email`."""
    purpose = purpose_for(role)
    challenge_id = (challenge_id or '').strip()
    otp = (otp or '').strip()
    if not challenge_id or not otp:
        return _result(False, 'Enter the 6-digit code from your email.', 400)
    if not (otp.isdigit() and len(otp) == 6):
        return _result(False, 'The code is 6 digits. Check your email and try again.', 400)

    row = db.session.execute(text(
        "SELECT target, otp_hash, attempt_count, verified_at, (expires_at > UTC_TIMESTAMP()) AS live "
        "FROM otp_requests WHERE id = :i AND purpose = :p"),
        {'i': challenge_id, 'p': purpose}).fetchone()
    if row is None or row[3] is not None or not row[4]:
        return _result(False, EXPIRED_MSG, 400, expired=True)

    # Count the try first, atomically, so parallel guesses cannot exceed the limit.
    bumped = db.session.execute(text(
        "UPDATE otp_requests SET attempt_count = attempt_count + 1 "
        "WHERE id = :i AND verified_at IS NULL AND expires_at > UTC_TIMESTAMP() AND attempt_count < :m"),
        {'i': challenge_id, 'm': MAX_ATTEMPTS}).rowcount
    db.session.commit()
    if bumped == 0:
        return _result(False, 'Too many incorrect attempts. Please request a new code.', 429, expired=True)

    used = int(row[2] or 0) + 1
    if not hmac.compare_digest(_hash(challenge_id, otp), row[1] or ''):
        left = max(0, MAX_ATTEMPTS - used)
        msg = (f'Incorrect code. {left} attempt{"s" if left != 1 else ""} remaining.' if left
               else 'Incorrect code. Too many attempts. Please request a new code.')
        return _result(False, msg, 400, attempts_left=left)

    consumed = db.session.execute(text(
        "UPDATE otp_requests SET verified_at = UTC_TIMESTAMP() "
        "WHERE id = :i AND verified_at IS NULL AND expires_at > UTC_TIMESTAMP()"),
        {'i': challenge_id}).rowcount
    db.session.commit()
    if consumed != 1:
        return _result(False, EXPIRED_MSG, 400, expired=True)
    return _result(True, None, 200, email=row[0])
