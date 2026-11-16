from portal.helpers.error_capture import capture_error
from portal.helpers.helpers import serialize_datetime
from flask import jsonify
from flask_restx import Resource, reqparse
from flask_jwt_extended import jwt_required, get_jwt
from portal.helpers.sp import call_proc
from . import ns, logger
from portal.helpers.admin_auth import can, AREA_FINANCE

list_parser = reqparse.RequestParser()
list_parser.add_argument('page',     type=int, location='args', default=1)
list_parser.add_argument('per_page', type=int, location='args', default=25)
list_parser.add_argument('status',   type=str, location='args', required=False)

@ns.route('/payments')
class AdminPaymentList(Resource):
    @ns.doc(description='Admin: list all payment transactions with revenue stats.')
    @jwt_required()
    def get(self):
        try:
            claims = get_jwt()
            if not can(AREA_FINANCE):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)

            args = list_parser.parse_args()

            # ── SP: sp_cohort_enrollments_list + sp_users_list + sp_cohorts_list
            # — no status filter or joins on the generic CRUD procs, so pull
            # bounded batches and join/filter/aggregate here. ─────────────────
            enrollments = call_proc('sp_cohort_enrollments_list', 50000, 0)
            all_users = call_proc('sp_users_list', 50000, 0)
            users_by_id = {u['id']: u for u in all_users if not u.get('deleted_at')}
            all_cohorts = call_proc('sp_cohorts_list', 5000, 0)
            cohorts_by_id = {c['id']: c for c in all_cohorts}

            stats_map = {}
            rows = []
            for enr in enrollments:
                user = users_by_id.get(enr.get('user_id'))
                if not user:
                    continue
                status = enr.get('payment_status')
                stats_map[status] = stats_map.get(status, 0.0) + float(enr.get('amount_paid') or 0)
                if status in ('paid', 'pending', 'refunded'):
                    cohort = cohorts_by_id.get(enr.get('cohort_id'))
                    if cohort:
                        rows.append((enr, user, cohort))

            if args.get('status'):
                rows = [(enr, user, cohort) for enr, user, cohort in rows if enr.get('payment_status') == args['status']]

            rows.sort(key=lambda t: t[0].get('enrolled_at') or t[0].get('created_at'), reverse=True)

            total_revenue = stats_map.get('paid', 0)
            total_refunded = stats_map.get('refunded', 0)
            total_pending = stats_map.get('pending', 0)
            net_revenue = total_revenue - total_refunded

            total = len(rows)
            per_page = args['per_page']
            page = args['page']
            pages = (total + per_page - 1) // per_page if per_page else 1
            start = (page - 1) * per_page
            page_rows = rows[start:start + per_page]

            result = []
            for enr, user, cohort in page_rows:
                enrolled_at = enr.get('enrolled_at')
                result.append({
                    'id': enr.get('id'),
                    'user_name': user.get('full_name'),
                    'user_email': user.get('email'),
                    'cohort_title': cohort.get('title'),
                    'amount_paid': float(enr.get('amount_paid') or 0),
                    'payment_status': enr.get('payment_status'),
                    'payment_order_id': enr.get('payment_order_id'),
                    'payment_id': enr.get('payment_id'),
                    'enrolled_at': serialize_datetime(enrolled_at) if enrolled_at else None,
                })

            return jsonify(
                response={
                    'payments': result,
                    'stats': {
                        'total_revenue': round(total_revenue, 2),
                        'total_refunded': round(total_refunded, 2),
                        'total_pending': round(total_pending, 2),
                        'net_revenue': round(net_revenue, 2),
                    },
                },
                pagination={
                    'total': total,
                    'pages': pages,
                    'page': page,
                },
                status=200,
                bool=True,
            )

        except Exception as e:
            logger.error(f"Error in GET /admin/payments: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)
