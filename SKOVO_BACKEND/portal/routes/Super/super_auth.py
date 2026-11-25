from portal.helpers.error_capture import capture_error
import uuid
import time
import hashlib
import datetime
from flask import jsonify
from flask_restx import Resource, reqparse
from flask_jwt_extended import create_access_token, jwt_required, get_jwt, get_jwt_identity
from werkzeug.security import check_password_hash, generate_password_hash
from portal.models import db
from portal.helpers.sp import call_proc, call_proc_one
from portal.helpers.rate_limit import limiter
from portal.helpers.platform_admins import is_allowed_super_admin_email
from portal.helpers.email_template import send_otp_email
from portal.helpers.helpers import generate_otp
from . import ns, logger

login_parser = reqparse.RequestParser()
login_parser.add_argument('email',    type=str, location='json', required=True)
login_parser.add_argument('password', type=str, location='json', required=True)


def _is_super(claims):
    return claims.get('super_admin') is True


# ── Removed 2026-09-06: admin/super-admin are login-only ───────────────────────
# Self-registration and OTP password-reset were removed from both consoles on
# request. The two console accounts are provisioned directly in the database and
# there is no signup path, so `/send-otp`, `/register` and `/reset-password` are
# gone from the SERVER, not merely hidden in the SPA — a route the client no
# longer links to is still open to anyone who posts at it, and open registration
# on an admin console is the whole attack.
# A signed-in admin can still change their own password via /change-password;
# a forgotten one is reset by whoever holds database access.
# ──────────────────────────────────────────────────────────────────────────────

@ns.route('/login')
class SuperLogin(Resource):
    decorators = [limiter.limit("10 per minute;50 per hour")]

    def post(self):
        try:
            args = login_parser.parse_args(strict=False)
            email    = (args.get('email') or '').strip().lower()
            password = (args.get('password') or '').strip()

            if not email or not password:
                return jsonify(response={'message': 'Email and password required.'}, status=400, bool=False)

            # ── SP: sp_super_admins_list — no by-email lookup proc exists, so
            # scan the bounded batch this returns. ─────────────────────────────
            all_supers = call_proc('sp_super_admins_list', 5000, 0)
            sa = next((s for s in all_supers if (s.get('email') or '').lower() == email and s.get('status') == 'active'), None)
            if not is_allowed_super_admin_email(email) or not sa or not check_password_hash(sa['password_hash'], password):
                return jsonify(response={'message': 'Invalid credentials.'}, status=401, bool=False)

            token = create_access_token(
                identity=sa['id'],
                additional_claims={'super_admin': True, 'role': 'super_admin', 'full_name': sa.get('full_name')},
                expires_delta=datetime.timedelta(hours=24)
            )
            logger.info(f"Super admin logged in: {email}")
            return jsonify(
                response={'id': sa['id'], 'full_name': sa.get('full_name'), 'email': sa.get('email')},
                access_token=token,
                expires_at=int(time.time()) + 86400,
                status=200, bool=True
            )
        except Exception as e:
            logger.error(f"Super login error: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/me')
class SuperMe(Resource):
    @jwt_required()
    def get(self):
        claims = get_jwt()
        if not _is_super(claims):
            return jsonify(response={'message': 'Super admin access required.'}, status=403, bool=False)
        # ── SP: sp_super_admins_get ─────────────────────────────────────────────
        sa = call_proc_one('sp_super_admins_get', get_jwt_identity())
        if not sa:
            return jsonify(response={'message': 'Not found.'}, status=404, bool=False)
        return jsonify(response={'id': sa['id'], 'full_name': sa.get('full_name'), 'email': sa.get('email')}, status=200, bool=True)


# ── Update Profile (name) ──────────────────────────────────────────────────────

profile_parser = reqparse.RequestParser()
profile_parser.add_argument('full_name', type=str, location='json', required=True)


@ns.route('/profile')
class SuperProfile(Resource):
    @jwt_required()
    def patch(self):
        try:
            claims = get_jwt()
            if not _is_super(claims):
                return jsonify(response={'message': 'Super admin access required.'}, status=403, bool=False)

            args      = profile_parser.parse_args(strict=False)
            full_name = (args.get('full_name') or '').strip()
            if not full_name:
                return jsonify(response={'message': 'Full name is required.'}, status=400, bool=False)

            # ── SP: sp_super_admins_get + _update (full replace) ─────────────────
            sa_id = get_jwt_identity()
            sa = call_proc_one('sp_super_admins_get', sa_id)
            if not sa:
                return jsonify(response={'message': 'Super admin not found.'}, status=404, bool=False)

            call_proc_one(
                'sp_super_admins_update',
                sa_id, full_name, sa.get('email'), sa.get('password_hash'),
                sa.get('status'), sa.get('created_by'), sa_id,
            )
            db.session.commit()
            logger.info(f"Super admin {sa.get('email')} updated name to {full_name}")
            return jsonify(response={'message': 'Profile updated.', 'full_name': full_name}, status=200, bool=True)

        except Exception as e:
            db.session.rollback()
            logger.error(f"Super profile update error: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


# ── Change Password ────────────────────────────────────────────────────────────

change_pw_parser = reqparse.RequestParser()
change_pw_parser.add_argument('current_password', type=str, location='json', required=True)
change_pw_parser.add_argument('new_password',     type=str, location='json', required=True)


@ns.route('/change-password')
class SuperChangePassword(Resource):
    @jwt_required()
    def post(self):
        try:
            claims = get_jwt()
            if not _is_super(claims):
                return jsonify(response={'message': 'Super admin access required.'}, status=403, bool=False)

            args             = change_pw_parser.parse_args(strict=False)
            current_password = (args.get('current_password') or '').strip()
            new_password     = (args.get('new_password') or '').strip()

            if not current_password or not new_password:
                return jsonify(response={'message': 'Both fields are required.'}, status=400, bool=False)
            if len(new_password) < 6:
                return jsonify(response={'message': 'New password must be at least 6 characters.'}, status=400, bool=False)

            # ── SP: sp_super_admins_get + _update (full replace) ─────────────────
            sa_id = get_jwt_identity()
            sa = call_proc_one('sp_super_admins_get', sa_id)
            if not sa:
                return jsonify(response={'message': 'Super admin not found.'}, status=404, bool=False)

            if not check_password_hash(sa['password_hash'], current_password):
                return jsonify(response={'message': 'Current password is incorrect.'}, status=400, bool=False)

            call_proc_one(
                'sp_super_admins_update',
                sa_id, sa.get('full_name'), sa.get('email'),
                generate_password_hash(new_password), sa.get('status'),
                sa.get('created_by'), sa_id,
            )
            db.session.commit()
            logger.info(f"Super admin {sa.get('email')} changed password.")
            return jsonify(response={'message': 'Password changed successfully.'}, status=200, bool=True)

        except Exception as e:
            db.session.rollback()
            logger.error(f"Super change-password error: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)
