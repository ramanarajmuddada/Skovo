from portal.helpers.error_capture import capture_error
from portal.helpers.helpers import serialize_datetime
import datetime
from flask import jsonify, request
from flask_restx import Resource
from flask_jwt_extended import jwt_required, get_jwt
from portal.helpers.sp import call_proc, call_proc_one
from . import ns, logger
from portal.helpers.admin_auth import can, AREA_OPS

@ns.route('/stats')
class AdminStats(Resource):
    @ns.doc(description='Get admin dashboard stats: total counts and recent users.')
    @jwt_required()
    def get(self):
        try:
            claims = get_jwt()
            if not can(AREA_OPS):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)

            # ── SP: sp_admin_dashboard_stats, sp_admin_recent_users — content
            # counts + business/revenue numbers in one summary row, plus the
            # 5 most recently registered users. ─────────────────────────────────
            biz = call_proc_one('sp_admin_dashboard_stats') or {}
            recent_users_rows = call_proc('sp_admin_recent_users', 5)

            recent_users = [
                {
                    'id':         u['id'],
                    'full_name':  u.get('full_name'),
                    'email':      u.get('email'),
                    'phone':      u.get('phone'),
                    'role_code':  'student',   # recent signups via the public site are students
                    'created_at': serialize_datetime(u['created_at']) if u.get('created_at') else None,
                }
                for u in recent_users_rows
            ]

            return jsonify(
                response={
                    'totals': {
                        'users': biz.get('total_users', 0),
                        'cohorts': biz.get('total_cohorts', 0),
                        'colleges': biz.get('total_colleges', 0),
                        'opportunities': biz.get('total_opportunities', 0),
                        'coaching_centres': biz.get('total_coaching_centres', 0),
                        'groups': biz.get('total_groups', 0),
                    },
                    'business': {
                        'total_achievers':          biz.get('total_achievers', 0),
                        'achievers_pending_verify': biz.get('achievers_pending_verify', 0),
                        'total_enrollments':        biz.get('total_enrollments', 0),
                        'active_opportunities':     biz.get('active_opportunities', 0),
                        'gross_revenue':            float(biz.get('gross_revenue') or 0),
                        'platform_earnings':        float(biz.get('platform_earnings') or 0),
                        'pending_payouts':          biz.get('pending_payouts', 0),
                    },
                    'recent_users': recent_users,
                },
                status=200, bool=True
            )
        except Exception as e:
            logger.error(f"Error in GET /admin/stats: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/recent-signups')
class AdminRecentSignups(Resource):
    @ns.doc(description='Signups inside the dashboard date filter, one page. '
                        '?from=&to= (YYYY-MM-DD, IST days; default today), ?page=&per_page=.')
    @jwt_required()
    def get(self):
        try:
            if not can(AREA_OPS):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)

            def _d(raw):
                try:
                    return datetime.date.fromisoformat((raw or '').strip())
                except (TypeError, ValueError):
                    return None

            def _i(raw, fallback):
                try:
                    return int(raw)
                except (TypeError, ValueError):
                    return fallback

            d_from, d_to = _d(request.args.get('from')), _d(request.args.get('to'))
            if d_from and d_to and d_from > d_to:
                d_from, d_to = d_to, d_from
            page = max(_i(request.args.get('page'), 1), 1)
            # Same clamp as the procedure, so `pages` below matches what it returns.
            per_page = min(max(_i(request.args.get('per_page'), 10), 1), 100)

            # ── SP: sp_admin_recent_signups ─────────────────────────────────
            rows = call_proc('sp_admin_recent_signups', d_from, d_to, per_page, (page - 1) * per_page)
            total = int(rows[0]['total_rows']) if rows else 0

            return jsonify(response={
                'items': [
                    {
                        'id':         u['id'],
                        'full_name':  u.get('full_name'),
                        'email':      u.get('email'),
                        'phone':      u.get('phone'),
                        'role_code':  'student',
                        'created_at': serialize_datetime(u['created_at']) if u.get('created_at') else None,
                    }
                    for u in rows
                ],
                'total': total,
                'page': page,
                'per_page': per_page,
                'pages': max((total + per_page - 1) // per_page, 1),
            }, status=200, bool=True)

        except Exception as e:
            logger.error(f"admin recent signups failed: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id},
                           status=500, bool=False)
