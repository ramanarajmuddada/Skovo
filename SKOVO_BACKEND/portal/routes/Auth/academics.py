"""
Board and stream lookups for onboarding and profile.

Boards are national + the student's own state. Streams come back in that board's
vocabulary (MPC in Telangana, PCM in CBSE) with the canonical value alongside —
the label is for the student, the canonical is what gets stored and targeted.
"""
from portal.helpers.error_capture import capture_error
from flask import jsonify
from flask_restx import Resource, reqparse
from portal.helpers.sp import call_proc, call_proc_one
from . import ns, logger

board_parser = reqparse.RequestParser()
board_parser.add_argument('state_id',   type=str, location='args')
board_parser.add_argument('state_code', type=str, location='args')

stream_parser = reqparse.RequestParser()
stream_parser.add_argument('board_id',   type=str, location='args')
stream_parser.add_argument('board_code', type=str, location='args')


@ns.route('/boards')
class BoardList(Resource):
    @ns.doc(description='National boards plus the boards of one state (?state_id= or ?state_code=).')
    def get(self):
        try:
            args = board_parser.parse_args()
            state_id = args.get('state_id')
            if not state_id and args.get('state_code'):
                # ── SP: sp_states_get_by_code ────────────────────────────────
                state_id = (call_proc_one('sp_states_get_by_code', args['state_code']) or {}).get('id')

            # ── SP: sp_boards_for_state ──────────────────────────────────────
            rows = call_proc('sp_boards_for_state', state_id)
            # The procedure does not return `level`, so every board came back
            # as 'all' and a Class 10 student was offered the Inter board
            # (BIEAP). Read the level from the table until the procedure does.
            levels = {}
            try:
                from sqlalchemy import text
                from portal.models import db
                levels = {r[0]: r[1] for r in db.session.execute(text("SELECT id, level FROM boards"))}
            except Exception as lv_err:
                logger.warning(f"boards level lookup failed: {lv_err}")
            return jsonify(response={'boards': [{
                'id':          b.get('id'),
                'code':        b.get('code'),
                'name':        b.get('name'),
                'is_national': bool(b.get('is_national')),
                # 'school' (Class 10 / SSC), 'intermediate' (Inter) or 'all'.
                # Screens show SSC boards to Class 10 and Inter boards to 11/12.
                'level':       b.get('level') or levels.get(b.get('id')) or 'all',
            } for b in rows]}, status=200, bool=True)
        except Exception as e:
            logger.error(f"GET /auth/boards error: {e}")
            return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)},
                           status=500, bool=False)


@ns.route('/streams')
class StreamList(Resource):
    @ns.doc(description="A board's stream options (?board_id= or ?board_code=). "
                        'Unmapped boards fall back to the default vocabulary.')
    def get(self):
        try:
            args = stream_parser.parse_args()
            board_id = args.get('board_id')
            if not board_id and args.get('board_code'):
                # ── SP: sp_boards_get_by_code ────────────────────────────────
                board_id = (call_proc_one('sp_boards_get_by_code', args['board_code']) or {}).get('id')

            # ── SP: sp_streams_by_board (NULL board → default set) ────────────
            rows = call_proc('sp_streams_by_board', board_id)
            return jsonify(response={'streams': [{
                'canonical':   s.get('canonical'),
                'label':       s.get('label'),
                'short_label': s.get('short_label'),
            } for s in rows]}, status=200, bool=True)
        except Exception as e:
            logger.error(f"GET /auth/streams error: {e}")
            return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)},
                           status=500, bool=False)


@ns.route('/streams/canonical')
class StreamCanonicalList(Resource):
    @ns.doc(description='Distinct canonical stream values — what audience targeting must offer '
                        'so a cohort and a student can never spell a stream differently.')
    def get(self):
        try:
            # ── SP: sp_streams_canonical_list ────────────────────────────────
            rows = call_proc('sp_streams_canonical_list')
            return jsonify(response={'streams': [{
                'canonical':   s.get('canonical'),
                'short_label': s.get('short_label'),
            } for s in rows]}, status=200, bool=True)
        except Exception as e:
            logger.error(f"GET /auth/streams/canonical error: {e}")
            return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)},
                           status=500, bool=False)
