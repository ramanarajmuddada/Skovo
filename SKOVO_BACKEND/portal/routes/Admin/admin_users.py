from portal.helpers.error_capture import capture_error
from portal.helpers.helpers import serialize_datetime
import json
import datetime
from flask import jsonify
from flask_restx import Resource, reqparse
from flask_jwt_extended import jwt_required, get_jwt_identity, get_jwt
from portal.models import db
from portal.helpers.sp import call_proc, call_proc_one
from portal.helpers.audit import log_audit
from . import ns, logger
from portal.helpers.admin_auth import can, AREA_USERS

list_parser = reqparse.RequestParser()
list_parser.add_argument('page',     type=int, location='args', default=1)
list_parser.add_argument('per_page', type=int, location='args', default=20)
list_parser.add_argument('search',   type=str, location='args', required=False)
list_parser.add_argument('status',   type=str, location='args', required=False)
list_parser.add_argument('class',    type=str, location='args', required=False, dest='klass')
list_parser.add_argument('from',     type=str, location='args', required=False, dest='date_from')
list_parser.add_argument('to',       type=str, location='args', required=False, dest='date_to')
list_parser.add_argument('sort',     type=str, location='args', required=False)

SORTS = ('newest', 'score', 'streak', 'active', 'name')

status_parser = reqparse.RequestParser()
status_parser.add_argument('status', type=str, location='json', required=True,
                           choices=('active', 'blocked'),
                           help='Status must be active or blocked')


def _day(v):
    try:
        return datetime.date.fromisoformat((v or '')[:10]) if v else None
    except ValueError:
        return None


# JSON_OBJECT renders DATETIMEs as "YYYY-MM-DD HH:MM:SS.ffffff" with no zone.
# They are UTC; say so, or the browser reads them as local time.
_TIME_KEYS = {'at', 'started_at', 'ended_at', 'expires_at', 'session_date', 'stage_started_at',
              'last_points_at', 'occurred_at', 'created_at', 'last_login_at', 'covered_through'}


def _utc(v):
    if isinstance(v, (datetime.datetime, datetime.date)):
        return serialize_datetime(v)
    if isinstance(v, str) and len(v) >= 19 and v[10] == ' ':
        return v[:10] + 'T' + v[11:19] + 'Z'
    return v


def _clean(row):
    """SP row -> JSON-safe dict: *_json columns parsed (and renamed), times
    marked UTC, decimals as numbers."""
    import decimal
    out = {}
    for k, v in (row or {}).items():
        if k.endswith('_json'):
            k = k[:-5]
            try:
                v = json.loads(v) if isinstance(v, str) else (v or [])
            except ValueError:
                v = []
            if isinstance(v, list):
                v = [{ik: (_utc(iv) if ik in _TIME_KEYS else iv) for ik, iv in i.items()} if isinstance(i, dict) else i
                     for i in v]
        elif isinstance(v, decimal.Decimal):
            v = float(v)
        elif k in _TIME_KEYS or isinstance(v, (datetime.datetime, datetime.date)):
            v = _utc(v)
        out[k] = v
    return out


def _as_list(v):
    if isinstance(v, str):
        try:
            return json.loads(v)
        except Exception:
            return []
    return v or []


@ns.route('/users')
class AdminUserList(Resource):
    @ns.doc(description='Paginated list of all students.')
    @jwt_required()
    def get(self):
        try:
            claims = get_jwt()
            if not can(AREA_USERS):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)

            args     = list_parser.parse_args()
            page     = args['page']
            per_page = args['per_page']
            search   = args.get('search')

            # ── SP: sp_admin_students_page — filters, sort and paging in MySQL ──
            per_page = max(1, min(int(per_page or 20), 100))
            page = max(1, int(page or 1))
            status = args.get('status') if args.get('status') in ('active', 'blocked') else None
            sort = args.get('sort') if args.get('sort') in SORTS else 'newest'
            rows = call_proc('sp_admin_students_page', search or '', status or '', (args.get('klass') or '')[:50],
                             _day(args.get('date_from')), _day(args.get('date_to')), sort,
                             per_page, (page - 1) * per_page) or []
            total = int(rows[0]['total_rows']) if rows else 0
            pages = (total + per_page - 1) // per_page if total else 1
            result = []
            for u in rows:
                r = _clean(u)
                r.pop('total_rows', None)
                result.append(r)

            return jsonify(
                response={'users': result},
                pagination={'total': total, 'pages': pages, 'page': page, 'per_page': per_page},
                status=200, bool=True
            )
        except Exception as e:
            logger.error(f"Error in GET /admin/users: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/users/<string:user_id>/dossier')
class AdminUserDossier(Resource):
    """Everything about one student, in one call.

    The console could list students and block them and nothing else -- so an
    admin on a phone could block someone without being able to look at them
    first. This is the read behind that panel.
    """

    @ns.doc(description="One student's full record: profile, score, activity, money.")
    @jwt_required()
    def get(self, user_id):
        try:
            if not can(AREA_USERS):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)

            # ── SP: sp_admin_student_dossier ────────────────────────────────
            row = call_proc_one('sp_admin_student_dossier', user_id)
            if not row:
                return jsonify(response={'message': 'Student not found.'}, status=404, bool=False)

            for key in ('created_at', 'updated_at', 'last_login_at',
                        'plan_expires_at', 'last_event_at', 'date_of_birth'):
                if row.get(key) is not None:
                    row[key] = serialize_datetime(row[key])

            # career_interests is stored as JSON text; hand the client a list.
            ci = row.get('career_interests')
            if isinstance(ci, str):
                try:
                    row['career_interests'] = json.loads(ci)
                except Exception:
                    row['career_interests'] = []

            for key in ('base_points', 'decay_points', 'amount_paid'):
                if row.get(key) is not None:
                    row[key] = float(row[key])

            return jsonify(response={'student': row}, status=200, bool=True)
        except Exception as e:
            logger.error(f"GET /admin/users/{user_id}/dossier: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id},
                           status=500, bool=False)


@ns.route('/users/stats')
class AdminUserStats(Resource):
    @ns.doc(description='Counts for the tiles over the Students list.')
    @jwt_required()
    def get(self):
        try:
            if not can(AREA_USERS):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
            r = call_proc_one('sp_admin_students_stats') or {}
            return jsonify(response={k: int(r.get(k) or 0) for k in ('total', 'new_week', 'active_week', 'blocked')},
                           status=200, bool=True)
        except Exception as e:
            logger.error(f"GET /admin/users/stats: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


_SECTIONS = {
    'summary':  ('sp_admin_student_summary', False),
    'habits':   ('sp_admin_student_habits', True),
    'practice': ('sp_admin_student_practice', True),
    'activity': ('sp_admin_student_activity', False),
    'money':    ('sp_admin_student_money', False),
}


@ns.route('/users/<string:user_id>/dossier/<string:section>')
class AdminUserDossierSection(Resource):
    @ns.doc(description='One tab of the student page: summary, habits, practice, activity or money.')
    @jwt_required()
    def get(self, user_id, section):
        try:
            if not can(AREA_USERS):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
            if section not in _SECTIONS:
                return jsonify(response={'message': 'Unknown section.'}, status=404, bool=False)
            proc, needs_day = _SECTIONS[section]
            from portal.helpers.streaks import ist_today
            row = call_proc_one(proc, user_id, *((ist_today(),) if needs_day else ()))
            return jsonify(response={section: _clean(row)}, status=200, bool=True)
        except Exception as e:
            logger.error(f"GET /admin/users/{user_id}/dossier/{section}: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id},
                           status=500, bool=False)


@ns.route('/users/<string:user_id>/points')
class AdminUserPoints(Resource):
    @ns.doc(description='Every score event for one student, newest first, paged.')
    @jwt_required()
    def get(self, user_id):
        try:
            if not can(AREA_USERS):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
            args = list_parser.parse_args()
            per_page = max(1, min(int(args['per_page'] or 20), 100))
            page = max(1, int(args['page'] or 1))
            rows = call_proc('sp_admin_student_points', user_id, per_page, (page - 1) * per_page) or []
            total = int(rows[0]['total_rows']) if rows else 0
            events = []
            for r in rows:
                e = _clean(r)
                e.pop('total_rows', None)
                events.append(e)
            return jsonify(response={'events': events},
                           pagination={'total': total, 'page': page, 'per_page': per_page,
                                       'pages': (total + per_page - 1) // per_page if total else 1},
                           status=200, bool=True)
        except Exception as e:
            logger.error(f"GET /admin/users/{user_id}/points: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id},
                           status=500, bool=False)


@ns.route('/users/<string:user_id>/status')
class AdminUserStatus(Resource):
    @ns.doc(description='Block or unblock a student.')
    @jwt_required()
    def patch(self, user_id):
        try:
            claims = get_jwt()
            if not can(AREA_USERS):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)

            args       = status_parser.parse_args()
            new_status = args['status']

            # ── SP: sp_users_get + _update (full replace) ─────────────────────
            user = call_proc_one('sp_users_get', user_id)
            if not user or user.get('deleted_at'):
                return jsonify(response={'message': 'User not found.'}, status=404, bool=False)

            admin_id = get_jwt_identity()
            call_proc_one(
                'sp_users_update',
                user_id, user.get('phone'), user.get('email'), user.get('full_name'),
                user.get('password_hash'), user.get('avatar_url'), new_status,
                user.get('created_by'), admin_id, None,
            )
            db.session.commit()

            log_audit(
                'user.status_changed', 'user', user_id,
                actor_id=admin_id,
                meta={'new_status': new_status, 'user_email': user.get('email')},
            )

            return jsonify(response={'message': f'Status updated to {new_status}.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in PATCH /admin/users/{user_id}/status: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)
