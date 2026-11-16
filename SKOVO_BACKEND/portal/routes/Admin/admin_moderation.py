"""
Admin — DM report moderation queue.

Student safety is non-negotiable in v1, especially for the 14–17 age band, so
every reported direct message lands here with both sides' names and the message
body attached. Resolving a report is an explicit action, never automatic.
"""
from portal.helpers.error_capture import capture_error
from flask import jsonify, request
from flask_restx import Resource
from flask_jwt_extended import jwt_required, get_jwt
from portal.models import db
from portal.helpers.sp import call_proc, call_proc_one
from portal.helpers.message_crypto import decrypt_message
from portal.helpers.helpers import serialize_datetime
from . import ns, logger
from portal.helpers.admin_auth import can, AREA_MODERATION

RESOLUTIONS = ('open', 'actioned', 'dismissed')


def _require_admin():
    """This module lives in the 'moderation' area — see portal/helpers/admin_auth."""
    return can(AREA_MODERATION)


@ns.route('/dm-reports')
class AdminDMReports(Resource):
    @ns.doc(description='Admin: the DM abuse-report queue, open first.')
    @jwt_required()
    def get(self):
        try:
            if not _require_admin():
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
            status = request.args.get('status') or None
            page = max(1, int(request.args.get('page', 1) or 1))
            per_page = min(200, max(1, int(request.args.get('per_page', 50) or 50)))

            # ── SP: sp_dm_reports_list, sp_dm_reports_counts ─────────────────
            rows = call_proc('sp_dm_reports_list', status, per_page, (page - 1) * per_page) or []
            counts = call_proc_one('sp_dm_reports_counts') or {}

            return jsonify(response={
                'reports': [{
                    'id': r.get('id'),
                    'reporter': {'id': r.get('reporter_id'), 'name': r.get('reporter_name')},
                    'reported': {'id': r.get('reported_user_id'), 'name': r.get('reported_name')},
                    'reason': r.get('reason'),
                    'message_body': decrypt_message(r.get('message_body')),
                    'status': r.get('status'),
                    'created_at': serialize_datetime(r.get('created_at')),
                } for r in rows],
                'counts': {
                    'open': int(counts.get('open_count') or 0),
                    'closed': int(counts.get('closed_count') or 0),
                    'total': int(counts.get('total') or 0),
                },
                'page': page,
            }, status=200, bool=True)
        except Exception as e:
            logger.error(f"Error in GET /admin/dm-reports: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/dm-reports/<string:report_id>')
class AdminDMReportItem(Resource):
    @ns.doc(description='Admin: resolve a report as actioned or dismissed.')
    @jwt_required()
    def patch(self, report_id):
        try:
            if not _require_admin():
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
            status = ((request.get_json() or {}).get('status') or '').strip()
            if status not in RESOLUTIONS:
                return jsonify(response={
                    'message': f"status must be one of: {', '.join(RESOLUTIONS)}."
                }, status=400, bool=False)

            # ── SP: sp_dm_report_resolve ─────────────────────────────────────
            res = call_proc_one('sp_dm_report_resolve', report_id, status) or {}
            db.session.commit()
            if not res.get('updated'):
                return jsonify(response={'message': 'Report not found.'}, status=404, bool=False)
            return jsonify(response={'message': f'Report marked {status}.', 'status': status},
                           status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in PATCH /admin/dm-reports/{report_id}: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)
