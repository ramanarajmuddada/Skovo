from portal.helpers.error_capture import capture_error
from portal.helpers.helpers import serialize_datetime
import uuid
import json
import datetime
from flask import jsonify
from flask_restx import Resource, reqparse
from werkzeug.security import generate_password_hash
from sqlalchemy.exc import IntegrityError
from portal.models import db
from portal.helpers.sp import call_proc, call_proc_one
from portal.helpers.audit import log_audit
from . import ns, logger

get_parser = reqparse.RequestParser()

accept_parser = reqparse.RequestParser()
accept_parser.add_argument('full_name', type=str, location='json', required=True, help='Full name is required.')
accept_parser.add_argument('password', type=str, location='json', required=True, help='Password is required.')


def _invite_status(invite):
    now = datetime.datetime.utcnow()
    if invite.get('accepted_at'):
        return 'accepted'
    if invite.get('revoked_at'):
        return 'revoked'
    if invite.get('expires_at') and invite['expires_at'] < now:
        return 'expired'
    return 'pending'


@ns.route('/invite/<string:token>')
class AcceptInvite(Resource):
    @ns.doc(
        description='Look up an invite by token. Returns invite details or 404/410.',
        responses={200: 'OK', 404: 'Not found', 410: 'Expired/revoked/already accepted'}
    )
    def get(self, token):
        try:
            # ── SP: sp_invitations_get_by_token ─────────────────────────────────
            invite = call_proc_one('sp_invitations_get_by_token', token)
            if not invite:
                return jsonify(response={'message': 'Invitation not found.'}, status=404, bool=False)

            status = _invite_status(invite)
            if status in ('accepted', 'revoked', 'expired'):
                return jsonify(
                    response={
                        'message': f'This invitation is {status} and can no longer be used.',
                        'status': status,
                    },
                    status=410, bool=False
                )

            return jsonify(
                response={
                    'email': invite.get('email'),
                    'role_code': invite.get('role_code'),
                    'invited_by_email': invite.get('invited_by_email'),
                    'message': invite.get('message'),
                    'expires_at': serialize_datetime(invite['expires_at']) if invite.get('expires_at') else None,
                    'status': status,
                },
                status=200, bool=True
            )
        except Exception as e:
            logger.error(f"Error in GET /auth/invite/{token}: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @ns.doc(
        description=(
            'Accept an invitation. Provide full_name and password (min 6 chars). '
            'Creates or updates the user account with the invited role. '
            'Does not auto-login — proceed to /auth/login after accepting.'
        ),
        responses={200: 'Accepted', 400: 'Validation error', 404: 'Not found', 410: 'No longer valid', 500: 'Server error'}
    )
    @ns.expect(accept_parser, validate=False)
    def post(self, token):
        try:
            args = accept_parser.parse_args(strict=False)
            full_name = (args.get('full_name') or '').strip()
            password = (args.get('password') or '').strip()

            if not full_name:
                return jsonify(response={'message': 'Full name is required.'}, status=400, bool=False)
            if not password or len(password) < 6:
                return jsonify(response={'message': 'Password must be at least 6 characters.'}, status=400, bool=False)

            # 1. Look up the invite
            # ── SP: sp_invitations_get_by_token ─────────────────────────────────
            invite = call_proc_one('sp_invitations_get_by_token', token)
            if not invite:
                return jsonify(response={'message': 'Invitation not found.'}, status=404, bool=False)

            status = _invite_status(invite)
            if status != 'pending':
                return jsonify(
                    response={
                        'message': f'This invitation is {status} and can no longer be used.',
                        'status': status,
                    },
                    status=410, bool=False
                )

            email = invite.get('email')
            role_code = invite.get('role_code')
            now = datetime.datetime.utcnow()

            # 2. Check if user already exists
            # ── SP: sp_users_list — no by-email lookup proc exists, so scan the
            # (deleted_at-filtered) bounded batch this already returns. ───────
            all_users = call_proc('sp_users_list', 50000, 0)
            existing_user = next((u for u in all_users if (u.get('email') or '').lower() == (email or '').lower()), None)

            if existing_user:
                user_id = existing_user['id']
                logger.info(f"Existing user {user_id} accepted invite {invite['id']}")
            else:
                # 3b. Create new user
                user_id = str(uuid.uuid4())
                password_hash = generate_password_hash(password)

                # ── SP: sp_users_create ────────────────────────────────────────
                try:
                    call_proc_one(
                        'sp_users_create',
                        user_id, None, email, full_name, password_hash, None, 'active', user_id, user_id, None,
                    )
                except IntegrityError:
                    db.session.rollback()
                    return jsonify(response={'message': 'An account with this email already exists.'}, status=409, bool=False)

                # ── SP: sp_auth_identities_create, sp_user_profiles_create,
                # sp_readiness_scores_create ───────────────────────────────────
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

                logger.info(f"Created new user {user_id} via invite {invite['id']} with role={role_code}")

            # 4. Mark invite as accepted
            # ── SP: sp_invitations_mark_accepted ───────────────────────────────
            call_proc_one('sp_invitations_mark_accepted', token, now, user_id)
            db.session.commit()

            # 5. Log audit
            log_audit(
                action='invite.accepted',
                resource_type='invitation',
                resource_id=invite['id'],
                actor_id=user_id,
                meta={'email': email, 'role_code': role_code},
            )

            return jsonify(
                response={
                    'message': 'Invitation accepted. You can now log in.',
                    'email': email,
                    'role_code': role_code,
                },
                status=200, bool=True
            )

        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in POST /auth/invite/{token}: {e}")
            logger.exception(e)
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)
