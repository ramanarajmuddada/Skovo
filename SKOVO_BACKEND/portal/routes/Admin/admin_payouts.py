from portal.helpers.error_capture import capture_error
from portal.helpers.helpers import serialize_datetime
import math
from flask import jsonify
from flask_restx import Resource, reqparse
from flask_jwt_extended import jwt_required, get_jwt, get_jwt_identity
from portal.models import db
from sqlalchemy import text
from portal.helpers.sp import call_proc, call_proc_one
from . import ns, logger
from portal.helpers.admin_auth import can, AREA_FINANCE

list_parser = reqparse.RequestParser()
list_parser.add_argument('page',      type=int, location='args', default=1)
list_parser.add_argument('per_page',  type=int, location='args', default=25)
list_parser.add_argument('status',    type=str, location='args', required=False)
list_parser.add_argument('search',    type=str, location='args', required=False)
list_parser.add_argument('date_from', type=str, location='args', required=False)
list_parser.add_argument('date_to',   type=str, location='args', required=False)
list_parser.add_argument('export',    type=int, location='args', default=0)

update_parser = reqparse.RequestParser()
update_parser.add_argument('status', type=str, location='json', required=True)
update_parser.add_argument('reason', type=str, location='json', required=False)

STATUSES = ('pending', 'processing', 'paid', 'failed', 'rejected')


def _num(v):
    return float(v or 0)


@ns.route('/payouts')
class AdminPayoutList(Resource):
    @ns.doc(description='Admin: payout requests with status tabs, search, date range, '
                        'summary boxes and who acted on each one. export=1 returns every row.')
    @jwt_required()
    def get(self):
        try:
            if not can(AREA_FINANCE):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
            args = list_parser.parse_args()

            # Search and date narrow the list AND the tab counts; the summary
            # boxes above always show the whole picture.
            where, params = ["1 = 1"], {}
            q = (args.get('search') or '').strip()
            if q:
                where.append("(a.full_name LIKE :q OR p.utr LIKE :q OR p.upi LIKE :q)")
                params['q'] = f"%{q}%"
            if args.get('date_from'):
                where.append("p.created_at >= DATE_SUB(:df, INTERVAL 330 MINUTE)")
                params['df'] = args['date_from'][:10] + ' 00:00:00'
            if args.get('date_to'):
                where.append("p.created_at < DATE_SUB(DATE_ADD(:dt, INTERVAL 1 DAY), INTERVAL 330 MINUTE)")
                params['dt'] = args['date_to'][:10] + ' 00:00:00'
            base = (" FROM payout_requests p LEFT JOIN achievers a ON a.id = p.achiever_id"
                    " WHERE " + " AND ".join(where))

            counts = {s_: 0 for s_ in STATUSES}
            for st, n in db.session.execute(text("SELECT p.status, COUNT(*)" + base + " GROUP BY p.status"), params):
                counts[st] = int(n)
            counts['all'] = sum(counts.values())

            status = (args.get('status') or '').strip()
            where_status = ''
            if status in STATUSES:
                where_status = " AND p.status = :st"
                params['st'] = status
            total = int(db.session.execute(text("SELECT COUNT(*)" + base + where_status), params).scalar() or 0)
            per_page = 100000 if args.get('export') else max(1, min(int(args['per_page'] or 25), 100))
            page = 1 if args.get('export') else max(1, int(args['page'] or 1))
            rows = db.session.execute(text(
                "SELECT p.*, a.full_name AS achiever_name,"
                " (SELECT CONCAT(l.action, '|', IFNULL(ad.full_name, 'Admin'), '|',"
                "         DATE_FORMAT(l.created_at, '%Y-%m-%dT%H:%i:%sZ'))"
                "    FROM audit_logs l LEFT JOIN admins ad ON ad.id = l.user_id"
                "   WHERE l.resource_type = 'payout_request' AND l.resource_id = p.id"
                "   ORDER BY l.created_at DESC LIMIT 1) AS last_action"
                + base + where_status + " ORDER BY p.created_at DESC LIMIT :lim OFFSET :off"),
                {**params, 'lim': per_page, 'off': (page - 1) * per_page}).mappings().fetchall()

            result = []
            for p in rows:
                done_by = done_at = None
                if p.get('last_action'):
                    parts = (p['last_action'].split('|') + [None, None, None])[:3]
                    done_by, done_at = parts[1], parts[2]
                result.append({
                    'id': p['id'],
                    'achiever_id': p.get('achiever_id'),
                    'achiever_name': p.get('achiever_name') or 'Unknown',
                    'amount': _num(p.get('amount')),
                    'status': p.get('status'),
                    'method': p.get('method'),
                    'account_name': p.get('account_name'),
                    'account_number': p.get('account_number'),
                    'ifsc': p.get('ifsc'),
                    'upi': p.get('upi'),
                    'utr': p.get('utr'),
                    'failure_reason': p.get('failure_reason'),
                    'reject_reason': p.get('failure_reason') if p.get('status') == 'rejected' else None,
                    'note': p.get('note'),
                    'done_by': done_by,
                    'done_at': done_at,
                    'created_at': serialize_datetime(p['created_at']) if p.get('created_at') else None,
                    'processed_at': serialize_datetime(p['processed_at']) if p.get('processed_at') else None,
                })

            month = ("DATE_FORMAT(DATE_ADD(processed_at, INTERVAL 330 MINUTE), '%Y-%m')"
                     " = DATE_FORMAT(DATE_ADD(UTC_TIMESTAMP(), INTERVAL 330 MINUTE), '%Y-%m')")
            sm = db.session.execute(text(
                "SELECT"
                " IFNULL(SUM(status = 'pending'), 0) AS pc, IFNULL(SUM(CASE WHEN status = 'pending' THEN amount END), 0) AS pa,"
                " IFNULL(SUM(status = 'processing'), 0) AS sc, IFNULL(SUM(CASE WHEN status = 'processing' THEN amount END), 0) AS sa,"
                " IFNULL(SUM(status = 'failed'), 0) AS fc, IFNULL(SUM(CASE WHEN status = 'failed' THEN amount END), 0) AS fa,"
                f" IFNULL(SUM(status = 'paid' AND {month}), 0) AS mc,"
                f" IFNULL(SUM(CASE WHEN status = 'paid' AND {month} THEN amount END), 0) AS ma,"
                " IFNULL(SUM(CASE WHEN status = 'paid' THEN amount END), 0) AS ta,"
                " IFNULL(SUM(CASE WHEN status = 'rejected' THEN amount END), 0) AS ra"
                " FROM payout_requests")).mappings().first()
            summary = {
                'to_pay':     {'count': int(sm['pc']), 'amount': _num(sm['pa'])},
                'sending':    {'count': int(sm['sc']), 'amount': _num(sm['sa'])},
                'paid_month': {'count': int(sm['mc']), 'amount': _num(sm['ma'])},
                'failed':     {'count': int(sm['fc']), 'amount': _num(sm['fa'])},
            }
            return jsonify(
                response={
                    'payouts': result,
                    'counts': counts,
                    'summary': summary,
                    'stats': {   # kept for older callers
                        'total_pending': summary['to_pay']['amount'],
                        'total_processing': summary['sending']['amount'],
                        'total_failed': summary['failed']['amount'],
                        'total_paid': _num(sm['ta']),
                        'total_rejected': _num(sm['ra']),
                    },
                },
                pagination={'total': total, 'pages': max(1, math.ceil(total / per_page)), 'page': page},
                status=200, bool=True,
            )
        except Exception as e:
            logger.error(f"Error in GET /admin/payouts: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/payouts/<string:request_id>/check')
class AdminPayoutCheck(Resource):
    @ns.doc(description='Admin: before paying, what the payout is made of and how the achiever stands.')
    @jwt_required()
    def get(self, request_id):
        try:
            if not can(AREA_FINANCE):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
            p = db.session.execute(text("SELECT id, achiever_id FROM payout_requests WHERE id = :i"),
                                   {'i': request_id}).mappings().first()
            if not p:
                return jsonify(response={'message': 'Payout request not found.'}, status=404, bool=False)
            aid = p['achiever_id']
            from portal.helpers.payout_lines import made_up_of
            rows = made_up_of(request_id) or []
            ids = [r.get('source_id') for r in rows if r.get('source_id')]
            open_ids = set()
            if ids:
                from sqlalchemy import bindparam
                open_ids = {r[0] for r in db.session.execute(text(
                    "SELECT booking_id FROM class_issues WHERE status = 'open' AND booking_id IN :ids"
                    " UNION SELECT source_id FROM class_issues WHERE status = 'open' AND source_id IN :ids"
                ).bindparams(bindparam('ids', expanding=True)), {'ids': ids})}
            lines = [{
                'title': r.get('title'),
                'source_type': r.get('source_type'),
                'amount': _num(r.get('amount')),
                'earned': _num(r.get('earned')),
                'part': bool(r.get('part')),
                'occurred_at': serialize_datetime(r['occurred_at']) if r.get('occurred_at') else None,
                'open_complaint': r.get('source_id') in open_ids,
            } for r in rows]

            from portal.helpers import class_rules as CR
            sp = call_proc_one('sp_achiever_strike_points', aid) or {}
            r_ = CR.rules()
            days = int(r_.get('strike_days') or 30)
            missed = int(db.session.execute(text(
                "SELECT COUNT(*) FROM achiever_strikes WHERE achiever_id = :a AND reason = 'missed'"
                " AND removed_at IS NULL AND created_at >= UTC_TIMESTAMP() - INTERVAL :d DAY"),
                {'a': aid, 'd': days}).scalar() or 0)
            complaints = int(db.session.execute(text(
                "SELECT COUNT(*) FROM class_issues WHERE achiever_id = :a AND status = 'open'"),
                {'a': aid}).scalar() or 0)
            st = sp.get('state') or 'active'
            standing = {
                'state': st,
                'paused': bool(sp.get('paused_at')) or st in ('suspended', 'banned'),
                'strike_points': int(sp.get('points') or 0),
                'strike_days': days,
                'missed_recent': missed,
                'open_complaints': complaints,
            }
            in_payout = any(l['open_complaint'] for l in lines)
            warnings = []
            if in_payout:
                warnings.append('A class in this payout has an open complaint. Settle it before paying.')
            elif complaints:
                warnings.append(f"The achiever has {complaints} open complaint(s) on other classes.")
            if st in ('suspended', 'banned'):
                warnings.append(f"The achiever is {st}.")
            elif standing['paused']:
                warnings.append('The achiever is paused (too many strikes).')
            return jsonify(response={
                'lines': lines,
                'lines_total': round(sum(l['amount'] for l in lines), 2),
                'standing': standing,
                'warnings': warnings,
            }, status=200, bool=True)
        except Exception as e:
            logger.error(f"Error in GET /admin/payouts/{request_id}/check: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/payouts/<string:request_id>')
class AdminPayoutDetail(Resource):
    @ns.doc(description="Admin: Pay sends the bank/UPI transfer; rejected frees the request.")
    @jwt_required()
    def patch(self, request_id):
        try:
            claims = get_jwt()
            if not can(AREA_FINANCE):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)

            args = update_parser.parse_args()
            new_status = (args.get('status') or '').strip().lower()
            if new_status not in ('paid', 'rejected'):
                return jsonify(response={'message': "status must be 'paid' or 'rejected'."}, status=400, bool=False)

            admin_id = get_jwt_identity()
            if new_status == 'paid':
                from portal.helpers.payout_transfer import initiate_payout
                ok, payload, http = initiate_payout(request_id, admin_id)
                return jsonify(response=payload, status=http, bool=ok)

            # A reject must say why: the achiever is told the reason.
            reason = (args.get('reason') or '').strip()[:500]
            if len(reason) < 5:
                return jsonify(response={'message': 'Write the reason for rejecting (at least 5 characters).'},
                               status=400, bool=False)

            # ── SP: sp_admin_payout_reject — row-locks the request, refuses
            # a transfer already in flight, records an audit_logs entry.
            result = call_proc_one('sp_admin_payout_reject', request_id, admin_id)
            db.session.commit()

            if not result or not result.get('ok'):
                message = (result.get('message') if result else None) or 'Payout request not found.'
                status_code = 404 if 'not found' in message.lower() else 409
                return jsonify(response={'message': message}, status=status_code, bool=False)

            row = db.session.execute(text("SELECT achiever_id, amount FROM payout_requests WHERE id = :i"),
                                     {'i': request_id}).mappings().first() or {}
            db.session.execute(text("UPDATE payout_requests SET failure_reason = :r WHERE id = :i"),
                               {'r': reason, 'i': request_id})
            db.session.commit()
            try:
                from portal.helpers.notifications import notify_user
                notify_user(row.get('achiever_id'), 'Payout rejected',
                            f"Your payout of \u20b9{float(row.get('amount') or 0):,.2f} was rejected: {reason} "
                            "The amount is back in Available.", type='payout',
                            reference_type='payout', reference_id=request_id)
            except Exception as ne:
                logger.warning(f"payout reject notice failed: {ne}")
            return jsonify(response={'message': 'Payout rejected. The achiever has been told why.'}, status=200, bool=True)

        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in PATCH /admin/payouts/{request_id}: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)
