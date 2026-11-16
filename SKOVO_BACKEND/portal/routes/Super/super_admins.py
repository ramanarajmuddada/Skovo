from portal.helpers.error_capture import capture_error
from portal.helpers.helpers import serialize_datetime
import datetime
import uuid
from sqlalchemy.exc import IntegrityError
from werkzeug.security import generate_password_hash
from flask import jsonify
from flask_restx import Resource, reqparse
from flask_jwt_extended import jwt_required, get_jwt, get_jwt_identity
from portal.models import db
from portal.helpers.audit import log_audit
from portal.helpers.sp import call_proc, call_proc_one
from . import ns, logger


def _is_super(claims):
    return claims.get('super_admin') is True


# ── Platform Stats ─────────────────────────────────────────────────────────────

@ns.route('/stats')
class SuperStats(Resource):
    @jwt_required()
    def get(self):
        try:
            claims = get_jwt()
            if not _is_super(claims):
                return jsonify(response={'message': 'Super admin access required.'}, status=403, bool=False)

            # ── SP: sp_super_platform_metrics — single source of truth for
            # platform-wide counts + revenue. Response shape kept stable
            # (users/mentors/cohorts/admins/roles) for existing frontend callers,
            # with the extra business metrics surfaced under 'business'.
            m = call_proc_one('sp_super_platform_metrics') or {}

            return jsonify(
                response={
                    'users':   {'total': m.get('total_students', 0)},
                    'mentors': {'total': m.get('total_achievers', 0)},
                    'cohorts': {'total': m.get('total_cohorts', 0)},
                    'admins':  {'total': m.get('total_admins', 0)},
                    'roles':   {'total': 4},
                    'business': {
                        'total_super_admins':  m.get('total_super_admins', 0),
                        'total_courses':       m.get('total_courses', 0),
                        'total_communities':   m.get('total_communities', 0),
                        'total_colleges':      m.get('total_colleges', 0),
                        'total_opportunities': m.get('total_opportunities', 0),
                        'total_tenants':       m.get('total_tenants', 0),
                        'gross_revenue':       float(m.get('gross_revenue') or 0),
                        'gst_collected':       float(m.get('gst_collected') or 0),
                        'pending_payouts':     m.get('pending_payouts', 0),
                        'total_paid_out':      float(m.get('total_paid_out') or 0),
                    },
                },
                status=200, bool=True
            )
        except Exception as e:
            logger.error(f"GET /super/stats error: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/stats/trends')
class SuperStatsTrends(Resource):
    @jwt_required()
    def get(self):
        try:
            claims = get_jwt()
            if not _is_super(claims):
                return jsonify(response={'message': 'Super admin access required.'}, status=403, bool=False)

            today = datetime.date.today()
            weeks = []
            for i in range(7, -1, -1):
                week_start = today - datetime.timedelta(days=today.weekday() + 7 * i)
                week_end   = week_start + datetime.timedelta(days=6)
                weeks.append((week_start, week_end, week_start.strftime('%d %b')))

            # ── SP: sp_super_trend_* — one COUNT per (metric, week), mirroring
            # the prior ORM loop exactly. See database/stored_procedures/
            # endpoints/super_stats_trends.sql ─────────────────────────────────
            def week_counts(proc_name):
                result = []
                for start, end, label in weeks:
                    row = call_proc_one(
                        proc_name,
                        datetime.datetime.combine(start, datetime.time.min),
                        datetime.datetime.combine(end, datetime.time.max),
                    )
                    result.append({'label': label, 'value': (row or {}).get('cnt', 0)})
                return result

            return jsonify(
                response={
                    'user_registrations':      week_counts('sp_super_trend_user_registrations'),
                    'cohort_enrollments':       week_counts('sp_super_trend_cohort_enrollments'),
                    'opportunity_applications': week_counts('sp_super_trend_opportunity_applications'),
                },
                status=200, bool=True
            )
        except Exception as e:
            logger.error(f"GET /super/stats/trends error: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


# ── Admin Accounts Management ──────────────────────────────────────────────────

list_parser = reqparse.RequestParser()
list_parser.add_argument('page',     type=int, location='args', default=1)
list_parser.add_argument('per_page', type=int, location='args', default=20)
list_parser.add_argument('search',   type=str, location='args', required=False)

create_parser = reqparse.RequestParser()
create_parser.add_argument('full_name',  type=str, location='json', required=True,
                           help='Name is required.')
create_parser.add_argument('email',      type=str, location='json', required=True,
                           help='Email is required.')
create_parser.add_argument('password',   type=str, location='json', required=True,
                           help='Password is required.')

update_parser = reqparse.RequestParser()
update_parser.add_argument('status', type=str, location='json', required=False)


def _serialize_admin(admin):
    created_at = admin.get('created_at')
    return {
        'id':         admin.get('id'),
        'full_name':  admin.get('full_name'),
        'email':      admin.get('email'),
        # `state` is the access gate — pending | active | suspended — and it is
        # what decides whether this person can do anything. `status` is an older
        # column that is 'active' from the moment the row is inserted, so
        # showing it made a pending admin look approved. Both are sent; the UI
        # must badge `state`.
        'state':        admin.get('state') or 'pending',
        'state_reason': admin.get('state_reason'),
        'status':       admin.get('status'),
        'created_at': serialize_datetime(created_at) if created_at else None,
    }


@ns.route('/admins')
class SuperAdminList(Resource):
    @jwt_required()
    def get(self):
        try:
            claims = get_jwt()
            if not _is_super(claims):
                return jsonify(response={'message': 'Super admin access required.'}, status=403, bool=False)

            args  = list_parser.parse_args()

            # ── SP: sp_admins_list — no search filter on the generic CRUD proc,
            # so pull a bounded batch and filter here. ────────────────────────
            rows = call_proc('sp_admins_list', 5000, 0)
            if args.get('search'):
                s = args['search'].lower()
                rows = [a for a in rows if s in (a.get('full_name') or '').lower() or s in (a.get('email') or '').lower()]
            rows.sort(key=lambda a: a.get('created_at') or datetime.datetime.min, reverse=True)

            total  = len(rows)
            per_page = args['per_page']
            page = args['page']
            offset = (page - 1) * per_page
            items  = rows[offset:offset + per_page]
            pages  = (total + per_page - 1) // per_page if per_page else 1

            return jsonify(
                response={'admins': [_serialize_admin(a) for a in items]},
                pagination={'total': total, 'pages': pages, 'page': page, 'per_page': per_page},
                status=200, bool=True
            )
        except Exception as e:
            logger.error(f"GET /super/admins error: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    # Direct admin creation removed on purpose.
    #
    # This endpoint let the super admin mint a staff account with a password it
    # chose. That is the one thing the access model forbids: nobody creates an
    # account for anybody else. An account made this way has a password its
    # owner did not pick, and every later action under it is deniable.
    #
    # The replacement is the flow the console already describes — an admin
    # self-registers at the admin portal, lands in `pending`, and the super
    # admin approves or rejects them through POST /admins/<id>/state. The
    # concern in the original note (an owner who could block admins but not add
    # one) is answered by approval, which adds an admin without ever holding
    # their credentials.


# ─────────────────────────────────────────────────────────────────────────────
# Removed on purpose: PATCH /admins/<id>, the legacy active/blocked toggle.
#
# It wrote `status`, a column parallel to `state` and unrelated to approval, so
# the platform had two answers to "can this admin log in" — and the screens
# disagreed. Access is decided in one place now: POST /admins/<id>/state, which
# moves pending → active → suspended, records a reason, and writes an audit
# event. Keeping `status` consistent is sp_admin_set_state's job.
# ─────────────────────────────────────────────────────────────────────────────
