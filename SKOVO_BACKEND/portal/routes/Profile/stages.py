"""Student career timeline (feature-updates.md §2).

GET /profile/stages -> the active stage + every closed one, oldest first.
"""
from portal.helpers.error_capture import capture_error
from flask import jsonify
from flask_restx import Resource
from flask_jwt_extended import jwt_required, get_jwt_identity
from portal.helpers import stages
from . import ns, logger


@ns.route('/stages')
class MyStages(Resource):
    @ns.doc(description='Career timeline: current stage and closed stages with their final score.')
    @jwt_required()
    def get(self):
        try:
            user_id = get_jwt_identity()
            rows = stages.history(user_id)
            timeline = [stages.timeline_entry(s) for s in rows]
            current = next((t for t in timeline if t['status'] == 'active'), None)
            return jsonify(response={'current': current, 'timeline': timeline},
                           status=200, bool=True)
        except Exception as e:
            logger.error(f"GET /profile/stages: {e}")
            return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)},
                           status=500, bool=False)
