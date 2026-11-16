from portal.helpers.error_capture import capture_error
from portal.helpers.helpers import serialize_datetime
import datetime
from flask import jsonify
from flask_restx import Resource, reqparse
from flask_jwt_extended import jwt_required, get_jwt
from portal.helpers.sp import call_proc
from . import ns, logger
from portal.helpers.admin_auth import can, AREA_OPS

list_parser = reqparse.RequestParser()
list_parser.add_argument('page',     type=int, location='args', default=1)
list_parser.add_argument('per_page', type=int, location='args', default=20)
list_parser.add_argument('error_id', type=str, location='args', required=False)
list_parser.add_argument('endpoint', type=str, location='args', required=False)


def _row_dict(row):
    created_at = row.get('created_at')
    return {
        'id':            row.get('id'),
        'error_id':      row.get('error_id'),
        'endpoint':      row.get('endpoint'),
        'method':        row.get('method'),
        'status_code':   row.get('status_code'),
        'error_type':    row.get('error_type'),
        'error_message': row.get('error_message'),
        'traceback':     row.get('traceback'),
        'user_id':       row.get('user_id'),
        'role':          row.get('role'),
        'ip_address':    row.get('ip_address'),
        'created_at':    serialize_datetime(created_at) if created_at else None,
    }


@ns.route('/error-logs')
class AdminErrorLogList(Resource):
    @jwt_required()
    def get(self):
        try:
            claims = get_jwt()
            if not can(AREA_OPS):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)

            args     = list_parser.parse_args()
            page     = args['page']
            per_page = args['per_page']
            error_id = args.get('error_id')
            endpoint = args.get('endpoint')

            # ── SP: sp_error_logs_list — no error_id/endpoint filters on the
            # generic CRUD proc, so pull a bounded batch and filter here. ────
            rows = call_proc('sp_error_logs_list', 5000, 0)
            if error_id:
                s = error_id.lower()
                rows = [r for r in rows if s in (r.get('error_id') or '').lower()]
            if endpoint:
                s = endpoint.lower()
                rows = [r for r in rows if s in (r.get('endpoint') or '').lower()]

            total  = len(rows)
            offset = (page - 1) * per_page
            page_rows = rows[offset:offset + per_page]
            pages  = (total + per_page - 1) // per_page if per_page else 1

            return jsonify(
                response={'errors': [_row_dict(r) for r in page_rows]},
                pagination={'total': total, 'pages': pages, 'page': page, 'per_page': per_page},
                status=200, bool=True
            )
        except Exception as e:
            logger.error(f"Error in GET /admin/error-logs: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/error-logs/<string:error_id>')
class AdminErrorLogDetail(Resource):
    @jwt_required()
    def get(self, error_id):
        try:
            claims = get_jwt()
            if not can(AREA_OPS):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)

            # ── SP: sp_error_logs_list — lookup is by the human-facing error_id
            # code, not the primary key, so filter the generic list. ─────────
            rows = call_proc('sp_error_logs_list', 5000, 0)
            target = error_id.upper()
            log = next((r for r in rows if r.get('error_id') == target), None)
            if not log:
                return jsonify(response={'message': 'Error log not found'}, status=404, bool=False)

            return jsonify(response=_row_dict(log), status=200, bool=True)
        except Exception as e:
            logger.error(f"Error in GET /admin/error-logs/{error_id}: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)
