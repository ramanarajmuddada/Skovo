from portal.helpers.error_capture import capture_error
import datetime
from flask import jsonify
from flask_restx import Resource
from flask_jwt_extended import (
    jwt_required, get_jwt_identity, get_jwt,
    create_access_token
)
from portal.helpers.sp import call_proc_one
from . import ns, logger


@ns.route('/token/refresh')
class RefreshToken(Resource):
    @ns.doc(
        description='Issue a new access token using a valid (non-revoked) refresh token.',
        responses={200: 'New access token issued', 401: 'Invalid or revoked token', 500: 'Server error'}
    )
    @jwt_required(refresh=True)
    def post(self):
        try:
            user_id = get_jwt_identity()
            claims = get_jwt()
            jti = claims.get('jti')

            # ── SP: sp_sessions_get_by_jti — validate session is still active ──
            if jti:
                session = call_proc_one('sp_sessions_get_by_jti', jti)
                if not session or session.get('revoked_at') is not None:
                    return jsonify(
                        response={'message': 'Refresh token has been revoked. Please log in again.'},
                        status=401, bool=False
                    )
                if session.get('expires_at') and session['expires_at'] < datetime.datetime.utcnow():
                    return jsonify(
                        response={'message': 'Session expired. Please log in again.'},
                        status=401, bool=False
                    )

            # ── SP: sp_users_get ────────────────────────────────────────────────
            user = call_proc_one('sp_users_get', user_id)
            if not user or user.get('deleted_at') is not None:
                return jsonify(response={'message': 'User not found.'}, status=401, bool=False)
            if user.get('status') == 'blocked':
                return jsonify(response={'message': 'Account suspended. Contact support.'}, status=401, bool=False)

            role_code = 'student'

            additional_claims = {
                'userid': user_id,
                'role': role_code,
                'is_new_user': False,
            }

            access_token = create_access_token(
                identity=str(user_id),
                additional_claims=additional_claims,
                fresh=False
            )

            return jsonify(access_token=access_token, status=200, bool=True)

        except Exception as e:
            logger.error(f"Error in POST /auth/token/refresh: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)
