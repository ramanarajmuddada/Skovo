from portal.helpers.error_capture import capture_error
from portal.helpers.helpers import serialize_datetime
import uuid
import secrets
import datetime
from flask import jsonify
from flask_restx import Resource, reqparse
from flask_jwt_extended import jwt_required, get_jwt, get_jwt_identity
from portal.models import db
from portal.helpers.sp import call_proc, call_proc_one
from portal.helpers.audit import log_audit
from . import ns, logger
from portal.helpers.admin_auth import can, AREA_OPS

list_parser = reqparse.RequestParser()
list_parser.add_argument('page', type=int, location='args', default=1)
list_parser.add_argument('per_page', type=int, location='args', default=20)

create_parser = reqparse.RequestParser()
create_parser.add_argument('email', type=str, location='json', required=True, help='Email is required.')
create_parser.add_argument('role_code', type=str, location='json', required=True,
                           choices=('mentor',),
                           help='role_code must be mentor. Admin accounts cannot be created by invitation.')
create_parser.add_argument('message', type=str, location='json', required=False)

def _compute_status(invite):
    now = datetime.datetime.utcnow()
    if invite.get('accepted_at'):
        return 'accepted'
    if invite.get('revoked_at'):
        return 'revoked'
    if invite.get('expires_at') and invite['expires_at'] < now:
        return 'expired'
    return 'pending'

def _serialize_invite(invite):
    expires_at, accepted_at, revoked_at, created_at = (
        invite.get('expires_at'), invite.get('accepted_at'), invite.get('revoked_at'), invite.get('created_at')
    )
    return {
        'id': invite.get('id'),
        'token': invite.get('token'),
        'email': invite.get('email'),
        'role_code': invite.get('role_code'),
        'invited_by_email': invite.get('invited_by_email'),
        'message': invite.get('message'),
        'expires_at': serialize_datetime(expires_at) if expires_at else None,
        'accepted_at': serialize_datetime(accepted_at) if accepted_at else None,
        'revoked_at': serialize_datetime(revoked_at) if revoked_at else None,
        'created_at': serialize_datetime(created_at) if created_at else None,
        'status': _compute_status(invite),
    }

@ns.route('/invites')
class AdminInviteList(Resource):
    @ns.doc(description='List all invitations (paginated).')
    @jwt_required()
    def get(self):
        try:
            claims = get_jwt()
            if not can(AREA_OPS):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)

            args = list_parser.parse_args()
            page = args['page']
            per_page = args['per_page']

            # ── SP: sp_invitations_list — pull a bounded batch and paginate
            # here (mirrors prior offset/limit behavior). ────────────────────
            rows = call_proc('sp_invitations_list', 5000, 0)
            rows.sort(key=lambda i: i.get('created_at') or datetime.datetime.min, reverse=True)

            total = len(rows)
            pages = (total + per_page - 1) // per_page if per_page else 1
            offset = (page - 1) * per_page
            invites = rows[offset:offset + per_page]

            return jsonify(
                response={'invites': [_serialize_invite(i) for i in invites]},
                pagination={
                    'total': total,
                    'pages': pages,
                    'page': page,
                    'per_page': per_page,
                },
                status=200, bool=True
            )
        except Exception as e:
            logger.error(f"Error in GET /admin/invites: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @ns.doc(description='Create a new invitation link.')
    @jwt_required()
    def post(self):
        try:
            claims = get_jwt()
            if not can(AREA_OPS):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)

            args = create_parser.parse_args()
            email = (args.get('email') or '').strip().lower()
            role_code = (args.get('role_code') or '').strip()
            message = args.get('message')

            if not email:
                return jsonify(response={'message': 'Email is required.'}, status=400, bool=False)

            actor_id = get_jwt_identity()
            # ── SP: sp_users_get — look up the inviting admin's email ────────
            actor = call_proc_one('sp_users_get', actor_id)
            actor_email = actor['email'] if actor else ''

            token = secrets.token_hex(32)
            now = datetime.datetime.utcnow()
            expires_at = now + datetime.timedelta(days=7)

            # ── SP: sp_invitations_create ─────────────────────────────────────
            invite_id = str(uuid.uuid4())
            invite = call_proc_one(
                'sp_invitations_create',
                invite_id, token, email, role_code, actor_id, actor_email, message,
                expires_at, None, None, None, actor_id, actor_id,
            )
            db.session.commit()

            log_audit(
                action='invite.created',
                resource_type='invitation',
                resource_id=invite_id,
                actor_id=actor_id,
                meta={'email': email, 'role_code': role_code},
            )

            result = _serialize_invite(invite)
            result['token_url'] = token

            logger.info(f"Admin {actor_id} created invite for {email} role={role_code}")
            return jsonify(response=result, status=200, bool=True)

        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in POST /admin/invites: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

@ns.route('/invites/<string:invite_id>')
class AdminInviteDetail(Resource):
    @ns.doc(description='Revoke an invitation (soft delete — sets revoked_at).')
    @jwt_required()
    def delete(self, invite_id):
        try:
            claims = get_jwt()
            if not can(AREA_OPS):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)

            # ── SP: sp_invitations_get + _update (full replace) ───────────────
            invite = call_proc_one('sp_invitations_get', invite_id)
            if not invite:
                return jsonify(response={'message': 'Invitation not found.'}, status=404, bool=False)

            if invite.get('revoked_at'):
                return jsonify(response={'message': 'Invitation is already revoked.'}, status=409, bool=False)

            actor_id = get_jwt_identity()
            call_proc_one(
                'sp_invitations_update',
                invite_id, invite['token'], invite['email'], invite['role_code'], invite['invited_by_id'],
                invite['invited_by_email'], invite.get('message'), invite['expires_at'],
                invite.get('accepted_at'), invite.get('accepted_by_id'), datetime.datetime.utcnow(),
                invite.get('created_by'), actor_id,
            )
            db.session.commit()

            log_audit(
                action='invite.revoked',
                resource_type='invitation',
                resource_id=invite_id,
                actor_id=actor_id,
                meta={'email': invite.get('email'), 'role_code': invite.get('role_code')},
            )

            logger.info(f"Admin {actor_id} revoked invite {invite_id}")
            return jsonify(response={'message': 'Invitation revoked.'}, status=200, bool=True)

        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in DELETE /admin/invites/{invite_id}: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)
