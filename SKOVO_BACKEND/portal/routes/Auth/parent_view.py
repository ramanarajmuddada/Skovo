"""Minimal parent screen (feature-updates.md §16 item 6).

The parent's consent link (parental_consents.token) is their key — no account.
Version 1 shows only: consent status and the child's SKOVO Wallet activity.
A parent can ask for the child's account to be deleted (admin follows up).

GET  /auth/parent/overview?token=
POST /auth/parent/delete-request?token=
"""
from portal.helpers.error_capture import capture_error
from flask import jsonify, request
from flask_restx import Resource
from sqlalchemy import text
from portal.models import db
from . import ns, logger


def _consent(token):
    if not token or len(token) > 64:
        return None
    r = db.session.execute(text(
        "SELECT pc.user_id, pc.status, pc.parent_name, u.full_name FROM parental_consents pc "
        "JOIN users u ON u.id = pc.user_id AND u.deleted_at IS NULL WHERE pc.token = :t"), {'t': token}).mappings().first()
    return dict(r) if r else None


@ns.route('/parent/overview')
class ParentOverview(Resource):
    def get(self):
        try:
            c = _consent(request.args.get('token'))
            if not c:
                return jsonify(response={'message': 'This link is not valid.'}, status=404, bool=False)
            from portal.helpers import wallet
            out = {'child_name': c['full_name'], 'consent_status': c['status'], 'parent_name': c['parent_name']}
            if c['status'] == 'confirmed':
                out['wallet'] = {**wallet.balances(c['user_id']), 'history': wallet.history(c['user_id'], 50)}
            db.session.commit()
            return jsonify(response=out, status=200, bool=True)
        except Exception as e:
            logger.error(f"GET /auth/parent/overview: {e}")
            return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)},
                           status=500, bool=False)


@ns.route('/parent/delete-request')
class ParentDeleteRequest(Resource):
    def post(self):
        try:
            c = _consent(request.args.get('token'))
            if not c or c['status'] != 'confirmed':
                return jsonify(response={'message': 'This link is not valid.'}, status=404, bool=False)
            from portal.helpers import wallet
            wallet.alert('parent_deletion_request', c['user_id'],
                         f"Parent of {c['full_name']} asked to delete the account (user {c['user_id']}).")
            db.session.commit()
            return jsonify(response={'message': 'Request received. SKOVO will contact you to confirm.'},
                           status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"POST /auth/parent/delete-request: {e}")
            return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)},
                           status=500, bool=False)
