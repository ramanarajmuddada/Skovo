from portal.helpers.error_capture import capture_error
import uuid
import hashlib
import datetime
import time
from flask import jsonify
from flask_restx import Resource, reqparse
from flask_jwt_extended import create_access_token, jwt_required, get_jwt, get_jwt_identity
from werkzeug.security import generate_password_hash, check_password_hash
from sqlalchemy.exc import IntegrityError
from portal.models import db
from portal.helpers.sp import call_proc, call_proc_one
from portal.helpers.rate_limit import limiter
from portal.helpers.platform_admins import is_allowed_admin_email
from portal.helpers.email_template import send_otp_email
from portal.helpers.helpers import generate_otp
from . import ns, logger

# ── Parsers ────────────────────────────────────────────────────────────────────

send_otp_parser = reqparse.RequestParser()
send_otp_parser.add_argument('email', type=str, location='json', required=True)

register_parser = reqparse.RequestParser()
register_parser.add_argument('full_name', type=str, location='json', required=True)
register_parser.add_argument('email',     type=str, location='json', required=True)
register_parser.add_argument('password',  type=str, location='json', required=True)
register_parser.add_argument('otp',       type=str, location='json', required=True)

login_parser = reqparse.RequestParser()
login_parser.add_argument('email',    type=str, location='json', required=True)
login_parser.add_argument('password', type=str, location='json', required=True)


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

# ── Login ──────────────────────────────────────────────────────────────────────

@ns.route('/login')
class AdminLogin(Resource):
    decorators = [limiter.limit("10 per minute;50 per hour")]

    def post(self):
        try:
            args     = login_parser.parse_args(strict=False)
            email    = (args.get('email') or '').strip().lower()
            password = (args.get('password') or '').strip()

            if not email or not password:
                return jsonify(response={'message': 'Email and password are required.'}, status=400, bool=False)

            # ── SP: sp_admins_list — no by-email lookup proc exists, so scan
            # the bounded batch this returns. ──────────────────────────────────
            all_admins = call_proc('sp_admins_list', 5000, 0)
            admin = next((a for a in all_admins if (a.get('email') or '').lower() == email and a.get('status') == 'active'), None)
            # Allowlist first, with the same answer as a wrong password so the
            # response does not reveal which emails exist.
            if not is_allowed_admin_email(email) or not admin or not check_password_hash(admin['password_hash'], password):
                return jsonify(response={'message': 'Invalid email or password.'}, status=401, bool=False)

            token = create_access_token(
                identity=admin['id'],
                additional_claims={
                    'admin': True,
                    'role': 'admin',
                    'full_name': admin.get('full_name'),
                },
                expires_delta=datetime.timedelta(hours=24)
            )

            logger.info(f"Admin logged in: {email}")
            return jsonify(
                response={
                    'id':       admin['id'],
                    'full_name': admin.get('full_name'),
                    'email':    admin.get('email'),
                    'role':     'admin',
                },
                access_token=token,
                expires_at=int(time.time()) + 86400,
                status=200, bool=True
            )

        except Exception as e:
            logger.error(f"Admin login error: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


# ── Me ─────────────────────────────────────────────────────────────────────────

@ns.route('/me')
class AdminMe(Resource):
    @jwt_required()
    def get(self):
        try:
            claims = get_jwt()
            # Accept super_admin too: the admin data routes already allow super_admin,
            # so /me must not 403 a super acting in the admin panel.
            if not (claims.get('admin') or claims.get('role') == 'super_admin'):
                return jsonify(response={'message': 'Admin access required.'}, status=403, bool=False)

            # ── SP: sp_admins_get ────────────────────────────────────────────────
            admin = call_proc_one('sp_admins_get', get_jwt_identity())
            if not admin:
                # A super_admin has no Admins row — return identity from the token.
                if claims.get('role') == 'super_admin':
                    return jsonify(
                        response={
                            'id':        get_jwt_identity(),
                            'full_name': claims.get('full_name'),
                            'email':     None,
                            'role':      'super_admin',
                        },
                        status=200, bool=True
                    )
                return jsonify(response={'message': 'Admin not found.'}, status=404, bool=False)

            return jsonify(
                response={
                    'id':        admin['id'],
                    'full_name': admin.get('full_name'),
                    'email':     admin.get('email'),
                    'role':      'admin',
                },
                status=200, bool=True
            )
        except Exception as e:
            logger.error(f"Admin me error: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


# ── Update Profile (name) ──────────────────────────────────────────────────────

profile_parser = reqparse.RequestParser()
profile_parser.add_argument('full_name', type=str, location='json', required=True)


@ns.route('/profile')
class AdminProfile(Resource):
    @jwt_required()
    def patch(self):
        try:
            claims = get_jwt()
            if not claims.get('admin'):
                return jsonify(response={'message': 'Admin access required.'}, status=403, bool=False)

            args = profile_parser.parse_args(strict=False)
            full_name = (args.get('full_name') or '').strip()
            if not full_name:
                return jsonify(response={'message': 'Full name is required.'}, status=400, bool=False)

            # ── SP: sp_admins_get + _update (full replace) ───────────────────────
            admin_id = get_jwt_identity()
            admin = call_proc_one('sp_admins_get', admin_id)
            if not admin:
                return jsonify(response={'message': 'Admin not found.'}, status=404, bool=False)

            call_proc_one(
                'sp_admins_update',
                admin_id, full_name, admin.get('email'), admin.get('password_hash'),
                admin.get('status'), admin.get('created_by'), admin_id,
            )
            db.session.commit()
            logger.info(f"Admin {admin.get('email')} updated name to {full_name}")
            return jsonify(response={'message': 'Profile updated.', 'full_name': full_name}, status=200, bool=True)

        except Exception as e:
            db.session.rollback()
            logger.error(f"Admin profile update error: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


# ── Change Password ────────────────────────────────────────────────────────────

change_pw_parser = reqparse.RequestParser()
change_pw_parser.add_argument('current_password', type=str, location='json', required=True)
change_pw_parser.add_argument('new_password',     type=str, location='json', required=True)


@ns.route('/change-password')
class AdminChangePassword(Resource):
    @jwt_required()
    def post(self):
        try:
            claims = get_jwt()
            if not claims.get('admin'):
                return jsonify(response={'message': 'Admin access required.'}, status=403, bool=False)

            args = change_pw_parser.parse_args(strict=False)
            current_password = (args.get('current_password') or '').strip()
            new_password     = (args.get('new_password') or '').strip()

            if not current_password or not new_password:
                return jsonify(response={'message': 'Both fields are required.'}, status=400, bool=False)
            if len(new_password) < 6:
                return jsonify(response={'message': 'New password must be at least 6 characters.'}, status=400, bool=False)

            # ── SP: sp_admins_get + _update (full replace) ───────────────────────
            admin_id = get_jwt_identity()
            admin = call_proc_one('sp_admins_get', admin_id)
            if not admin:
                return jsonify(response={'message': 'Admin not found.'}, status=404, bool=False)

            if not check_password_hash(admin['password_hash'], current_password):
                return jsonify(response={'message': 'Current password is incorrect.'}, status=400, bool=False)

            call_proc_one(
                'sp_admins_update',
                admin_id, admin.get('full_name'), admin.get('email'),
                generate_password_hash(new_password), admin.get('status'),
                admin.get('created_by'), admin_id,
            )
            db.session.commit()
            logger.info(f"Admin {admin.get('email')} changed password.")
            return jsonify(response={'message': 'Password changed successfully.'}, status=200, bool=True)

        except Exception as e:
            db.session.rollback()
            logger.error(f"Admin change-password error: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)
