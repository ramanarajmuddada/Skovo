from portal.helpers.error_capture import capture_error
import datetime
from flask import jsonify
from flask_restx import Resource
from flask_jwt_extended import jwt_required, get_jwt_identity, get_jwt
from portal.models import db
from portal.helpers.sp import call_proc_one
from . import ns, logger


@ns.route('/logout')
class Logout(Resource):
    @ns.doc(
        description=(
            'Logout the current user. Revokes the active session tied to the current '
            'refresh token JTI. Also sweeps all expired sessions for this user.'
        ),
        responses={200: 'Logged out', 401: 'Unauthorized', 500: 'Server error'}
    )
    @jwt_required()
    def post(self):
        try:
            user_id = get_jwt_identity()
            claims = get_jwt()
            jti = claims.get('jti')
            now = datetime.datetime.utcnow()

            # ── SP: sp_sessions_revoke_by_jti, sp_sessions_revoke_all_by_user ──
            if jti:
                call_proc_one('sp_sessions_revoke_by_jti', jti, now)

            # Also revoke all sessions for safety (full logout)
            call_proc_one('sp_sessions_revoke_all_by_user', user_id, now)

            db.session.commit()
            return jsonify(response={'message': 'Logged out successfully.'}, status=200, bool=True)

        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in POST /auth/logout: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)
