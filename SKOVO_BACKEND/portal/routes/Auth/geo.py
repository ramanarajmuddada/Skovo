"""
Geography lookups for onboarding and profile: states, then cities in a state.

Public (no JWT) on purpose — the same lists are needed on the signup side and
they are not user data. Reads go through stored procedures like everything else.
"""
from portal.helpers.error_capture import capture_error
from flask import jsonify
from flask_restx import Resource, reqparse
from portal.helpers.sp import call_proc, call_proc_one
from . import ns, logger

city_parser = reqparse.RequestParser()
city_parser.add_argument('state_id',   type=str, location='args')
city_parser.add_argument('state_code', type=str, location='args')
city_parser.add_argument('q',          type=str, location='args', help='Prefix search on city name')
city_parser.add_argument('limit',      type=int, location='args', default=25)


def _state_dict(s):
    return {
        'id':     s.get('id'),
        'code':   s.get('code'),
        'name':   s.get('name'),
        'kind':   s.get('kind'),        # state | ut
        'region': s.get('region'),
    }


def _city_dict(c):
    return {
        'id':         c.get('id'),
        'name':       c.get('name'),
        'district':   c.get('district'),
        'tier':       c.get('tier'),
        'state_id':   c.get('state_id'),
        'state_code': c.get('state_code'),
    }


@ns.route('/states')
class StateList(Resource):
    @ns.doc(description='All Indian states and union territories, sorted for display.')
    def get(self):
        try:
            # ── SP: sp_states_list ───────────────────────────────────────────
            rows = call_proc('sp_states_list', 1)
            return jsonify(response={'states': [_state_dict(s) for s in rows]}, status=200, bool=True)
        except Exception as e:
            logger.error(f"GET /auth/states error: {e}")
            return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)},
                           status=500, bool=False)


@ns.route('/cities')
class CityList(Resource):
    @ns.doc(description='Cities in a state (?state_id= or ?state_code=), or a prefix search (?q=).')
    def get(self):
        try:
            args = city_parser.parse_args()
            state_id, state_code, q = args.get('state_id'), args.get('state_code'), (args.get('q') or '').strip()

            # A search box needs prefix matching; a dropdown needs the whole
            # state. Same table, two different procs.
            if q:
                if not state_id and state_code:
                    st = call_proc_one('sp_states_get_by_code', state_code) or {}
                    state_id = st.get('id')
                # ── SP: sp_cities_search ─────────────────────────────────────
                rows = call_proc('sp_cities_search', q, state_id, args.get('limit') or 25)
            elif state_id:
                # ── SP: sp_cities_by_state ───────────────────────────────────
                rows = call_proc('sp_cities_by_state', state_id, 1)
            elif state_code:
                # ── SP: sp_cities_by_state_code ──────────────────────────────
                rows = call_proc('sp_cities_by_state_code', state_code, 1)
            else:
                return jsonify(response={'message': 'Pass state_id, state_code or q.'}, status=400, bool=False)

            return jsonify(response={'cities': [_city_dict(c) for c in rows]}, status=200, bool=True)
        except Exception as e:
            logger.error(f"GET /auth/cities error: {e}")
            return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)},
                           status=500, bool=False)
