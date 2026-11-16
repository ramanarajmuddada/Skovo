from portal.helpers.error_capture import capture_error
import json
from flask import jsonify
from flask_restx import Resource
from flask_jwt_extended import jwt_required, get_jwt_identity
from portal.helpers.sp import call_proc_one
from portal.helpers.helpers import opportunity_hub_min_score
from . import ns, logger


def _as_list(v):
    if isinstance(v, str):
        try:
            return json.loads(v)
        except Exception:
            return []
    return v or []


@ns.route('/me')
class Me(Resource):
    @ns.doc(description='Get the currently authenticated user profile.')
    @jwt_required()
    def get(self):
        try:
            user_id = get_jwt_identity()
            # ── SP: sp_users_get, sp_profile_get_by_user, sp_readiness_score_get ─
            user = call_proc_one('sp_users_get', user_id)
            if not user:
                return jsonify(response={'message': 'User not found.'}, status=404, bool=False)

            profile = call_proc_one('sp_profile_get_by_user', user_id)
            readiness = call_proc_one('sp_readiness_score_get', user_id)
            hub_min = opportunity_hub_min_score()

            return jsonify(
                response={
                    'user_id': user.get('id'),
                    'full_name': user.get('full_name'),
                    'phone': user.get('phone'),
                    'email': user.get('email'),
                    'avatar_url': user.get('avatar_url'),
                    'status': user.get('status'),
                    # DPDP consent gate — the client redirects to /consent while
                    # this is anything other than 'granted'.
                    'consent_status': user.get('consent_status') or 'granted',
                    'profile': {
                        'education_level': profile.get('education_level') if profile else None,
                        'stream': profile.get('stream') if profile else None,
                        'city': profile.get('city') if profile else None,
                        'state': profile.get('state') if profile else None,
                        'career_interests': _as_list(profile.get('career_interests')) if profile else [],
                    },
                    'readiness': {
                        'score': readiness.get('score') if readiness else 0,
                        'level': readiness.get('level') if readiness else 'Explorer',
                        'cohorts_completed': readiness.get('cohorts_completed') if readiness else 0,
                        'tasks_completed': readiness.get('tasks_completed') if readiness else 0,
                        # Config-driven, same as every other place the gate is
                        # shown or enforced.
                        'hub_min_score': hub_min,
                        'opportunity_hub_unlocked': int(readiness.get('score') or 0) >= hub_min if readiness else False,
                    }
                },
                status=200,
                bool=True
            )

        except Exception as e:
            logger.error(f"Error in GET /auth/me: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)
