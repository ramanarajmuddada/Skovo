from datetime import datetime
import json
from portal.helpers.error_capture import capture_error
from portal.helpers.helpers import serialize_datetime
from flask import jsonify
from flask_restx import Resource, reqparse
from flask_jwt_extended import jwt_required, get_jwt
from portal.helpers.sp import call_proc
from . import ns, logger
from portal.helpers.admin_auth import can, AREA_OPS


def _as_meta(v):
    if isinstance(v, str):
        try:
            return json.loads(v)
        except Exception:
            return None
    return v

list_parser = reqparse.RequestParser()
list_parser.add_argument('page', type=int, location='args', default=1)
list_parser.add_argument('per_page', type=int, location='args', default=20)
list_parser.add_argument('action', type=str, location='args', required=False)
list_parser.add_argument('resource_type', type=str, location='args', required=False)
list_parser.add_argument('actor', type=str, location='args', required=False)
list_parser.add_argument('from_date', type=str, location='args', required=False)
list_parser.add_argument('to_date', type=str, location='args', required=False)


def _parse_date(value):
    """Parse an ISO date/datetime string; return None if invalid."""
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except (ValueError, TypeError):
        for fmt in ('%Y-%m-%d', '%Y-%m-%dT%H:%M:%S', '%Y-%m-%dT%H:%M'):
            try:
                return datetime.strptime(value, fmt)
            except (ValueError, TypeError):
                continue
        return None

@ns.route('/audit')
class AdminAuditLog(Resource):
    @ns.doc(description='Paginated audit log with optional action/resource_type filters.')
    @jwt_required()
    def get(self):
        try:
            claims = get_jwt()
            if not can(AREA_OPS):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)

            args = list_parser.parse_args()
            page = args['page']
            per_page = args['per_page']
            action_filter = args.get('action')
            resource_type_filter = args.get('resource_type')
            actor_filter = args.get('actor')
            from_date = _parse_date(args.get('from_date'))
            to_date = _parse_date(args.get('to_date'))

            # ── SP: sp_super_audit_log — resolves actor across users/admins/
            # super_admins already, so pull a bounded batch and filter here
            # to preserve the same filter set the ORM version supported. ─────
            rows = call_proc('sp_super_audit_log', 20000, 0)

            if action_filter:
                rows = [r for r in rows if r.get('action') == action_filter]
            if resource_type_filter:
                rows = [r for r in rows if r.get('resource_type') == resource_type_filter]
            if actor_filter:
                s = actor_filter.lower()
                rows = [r for r in rows if s in (r.get('actor_email') or '').lower() or s in (r.get('actor_name') or '').lower()]
            if from_date:
                rows = [r for r in rows if r.get('created_at') and r['created_at'] >= from_date]
            if to_date:
                rows = [r for r in rows if r.get('created_at') and r['created_at'] <= to_date]

            total = len(rows)
            offset = (page - 1) * per_page
            page_rows = rows[offset:offset + per_page]
            pages = (total + per_page - 1) // per_page if per_page else 1

            result = []
            for log in page_rows:
                created_at = log.get('created_at')
                result.append({
                    'id': log.get('id'),
                    'action': log.get('action'),
                    'resource_type': log.get('resource_type'),
                    'resource_id': log.get('resource_id'),
                    'actor_name': log.get('actor_name'),
                    'actor_email': log.get('actor_email'),
                    'meta': _as_meta(log.get('meta')),
                    'created_at': serialize_datetime(created_at) if created_at else None,
                })

            return jsonify(
                response={'logs': result},
                pagination={
                    'total': total,
                    'pages': pages,
                    'page': page,
                    'per_page': per_page,
                },
                status=200, bool=True
            )
        except Exception as e:
            logger.error(f"Error in GET /admin/audit: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)
