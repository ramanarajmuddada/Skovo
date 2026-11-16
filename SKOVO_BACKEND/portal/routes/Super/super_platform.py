from portal.helpers.error_capture import capture_error
"""
Platform-wide super admin endpoints.
All resources — users, mentors, cohorts, audit logs.
"""
import datetime
import json
from flask import jsonify, request
from flask_restx import Resource, reqparse
from flask_jwt_extended import jwt_required, get_jwt, get_jwt_identity
from portal.models import db
from portal.helpers.sp import call_proc, call_proc_one
from portal.helpers.helpers import serialize_datetime
from . import ns, logger


def _as_meta(v):
    if isinstance(v, str):
        try:
            return json.loads(v)
        except Exception:
            return None
    return v


def _as_list(v):
    if isinstance(v, str):
        try:
            return json.loads(v)
        except Exception:
            return []
    return v or []


def _is_super(claims):
    return claims.get('super_admin') is True


_list_parser = reqparse.RequestParser()
_list_parser.add_argument('page',     type=int, location='args', default=1)
_list_parser.add_argument('per_page', type=int, location='args', default=20)
_list_parser.add_argument('search',   type=str, location='args', required=False)

_audit_parser = reqparse.RequestParser()
_audit_parser.add_argument('page',          type=int, location='args', default=1)
_audit_parser.add_argument('per_page',      type=int, location='args', default=25)
_audit_parser.add_argument('action',        type=str, location='args', required=False)
_audit_parser.add_argument('resource_type', type=str, location='args', required=False)
_audit_parser.add_argument('actor',         type=str, location='args', required=False)
_audit_parser.add_argument('from_date',     type=str, location='args', required=False)
_audit_parser.add_argument('to_date',       type=str, location='args', required=False)

_cohort_parser = reqparse.RequestParser()
_cohort_parser.add_argument('page',     type=int, location='args', default=1)
_cohort_parser.add_argument('per_page', type=int, location='args', default=20)
_cohort_parser.add_argument('search',   type=str, location='args', required=False)
_cohort_parser.add_argument('status',   type=str, location='args', required=False)


@ns.route('/users')
class SuperUserList(Resource):
    @jwt_required()
    def get(self):
        try:
            claims = get_jwt()
            if not _is_super(claims):
                return jsonify(response={'message': 'Super admin access required.'}, status=403, bool=False)

            args = _list_parser.parse_args()

            # ── SP: sp_users_list + sp_user_profiles_list — no search filter or
            # join on the generic CRUD procs, so pull bounded batches and
            # join/filter/paginate here. ───────────────────────────────────────
            rows = call_proc('sp_users_list', 50000, 0)
            all_profiles = call_proc('sp_user_profiles_list', 50000, 0)
            profiles_by_user = {p.get('user_id'): p for p in all_profiles}

            if args.get('search'):
                s = args['search'].lower()
                rows = [
                    u for u in rows
                    if s in (u.get('full_name') or '').lower() or s in (u.get('email') or '').lower()
                    or s in (u.get('phone') or '').lower()
                ]
            rows.sort(key=lambda u: u.get('created_at') or datetime.datetime.min, reverse=True)

            total = len(rows)
            per_page = args['per_page']
            page = args['page']
            pages = (total + per_page - 1) // per_page if per_page else 1
            start = (page - 1) * per_page
            items = rows[start:start + per_page]

            result = []
            for u in items:
                p = profiles_by_user.get(u.get('id'))
                created_at = u.get('created_at')
                result.append({
                    'id':               u.get('id'),
                    'full_name':        u.get('full_name'),
                    'email':            u.get('email'),
                    'phone':            u.get('phone'),
                    'status':           u.get('status'),
                    'avatar_url':       u.get('avatar_url'),
                    'role_code':        'student',
                    'city':             p.get('city') if p else None,
                    'state':            p.get('state') if p else None,
                    'education_level':  p.get('education_level') if p else None,
                    'stream':           p.get('stream') if p else None,
                    'branch':           p.get('branch') if p else None,
                    'college_name':     p.get('college_name') if p else None,
                    'year_of_study':    p.get('year_of_study') if p else None,
                    'career_interests': _as_list(p.get('career_interests')) if p else [],
                    'created_at':       serialize_datetime(created_at) if created_at else None,
                })

            return jsonify(
                response={'users': result},
                pagination={'total': total, 'pages': pages, 'page': args['page'], 'per_page': args['per_page']},
                status=200, bool=True
            )
        except Exception as e:
            logger.error(f"GET /super/users error: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/achievers')
class SuperAchieverList(Resource):
    @jwt_required()
    def get(self):
        try:
            claims = get_jwt()
            if not _is_super(claims):
                return jsonify(response={'message': 'Super admin access required.'}, status=403, bool=False)

            args = _list_parser.parse_args()

            # ── SP: sp_achievers_list — no search filter on the generic CRUD
            # proc, so pull a bounded batch and filter here. ──────────────────
            rows = call_proc('sp_achievers_list', 20000, 0, 0)
            rows = [m for m in rows if m.get('email')]
            if args.get('search'):
                s = args['search'].lower()
                rows = [
                    m for m in rows
                    if s in (m.get('full_name') or '').lower() or s in (m.get('email') or '').lower()
                    or s in (m.get('designation') or '').lower() or s in (m.get('company') or '').lower()
                ]
            rows.sort(key=lambda m: m.get('created_at') or datetime.datetime.min, reverse=True)

            total = len(rows)
            per_page = args['per_page']
            page = args['page']
            pages = (total + per_page - 1) // per_page if per_page else 1
            start = (page - 1) * per_page
            items = rows[start:start + per_page]

            result = []
            for m in items:
                created_at = m.get('created_at')
                result.append({
                    'id':           m.get('id'),
                    'full_name':    m.get('full_name'),
                    'email':        m.get('email'),
                    'designation':  m.get('designation'),
                    'company':      m.get('company'),
                    'domains':      _as_list(m.get('domains')),
                    'linkedin_url': m.get('linkedin_url'),
                    'is_verified':  bool(m.get('is_verified')),
                    'is_active':    bool(m.get('is_active')),
                    'created_at':   serialize_datetime(created_at) if created_at else None,
                })

            return jsonify(
                response={'achievers': result},
                pagination={'total': total, 'pages': pages, 'page': args['page'], 'per_page': args['per_page']},
                status=200, bool=True
            )
        except Exception as e:
            logger.error(f"GET /super/achievers error: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/cohorts')
class SuperCohortList(Resource):
    @jwt_required()
    def get(self):
        try:
            claims = get_jwt()
            if not _is_super(claims):
                return jsonify(response={'message': 'Super admin access required.'}, status=403, bool=False)

            args = _cohort_parser.parse_args()

            # ── SP: sp_cohorts_list — no search/status filter on the generic
            # CRUD proc, so pull a bounded batch and filter here. ────────────
            rows = call_proc('sp_cohorts_list', 20000, 0)
            rows = [c for c in rows if not c.get('deleted_at')]
            if args.get('search'):
                s = args['search'].lower()
                rows = [c for c in rows if s in (c.get('title') or '').lower()]
            if args.get('status'):
                rows = [c for c in rows if c.get('status') == args['status']]
            rows.sort(key=lambda c: c.get('created_at') or datetime.datetime.min, reverse=True)

            total = len(rows)
            per_page = args['per_page']
            page = args['page']
            pages = (total + per_page - 1) // per_page if per_page else 1
            start = (page - 1) * per_page
            items = rows[start:start + per_page]

            result = [
                {
                    'id':           c.get('id'),
                    'title':        c.get('title'),
                    'status':       c.get('status'),
                    'session_date': serialize_datetime(c.get('session_date')),
                    'total_seats':  c.get('total_seats'),
                    'filled_seats': c.get('filled_seats'),
                    'price':        c.get('price'),
                    'created_at':   serialize_datetime(c.get('created_at')),
                }
                for c in items
            ]

            return jsonify(
                response={'cohorts': result},
                pagination={'total': total, 'pages': pages, 'page': args['page'], 'per_page': args['per_page']},
                status=200, bool=True
            )
        except Exception as e:
            logger.error(f"GET /super/cohorts error: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/audit')
class SuperAuditLog(Resource):
    @jwt_required()
    def get(self):
        try:
            claims = get_jwt()
            if not _is_super(claims):
                return jsonify(response={'message': 'Super admin access required.'}, status=403, bool=False)

            args = _audit_parser.parse_args()

            # ── SP: sp_super_audit_log — resolves actor across users/admins/
            # super_admins already, so pull a bounded batch and filter here
            # to preserve the same filter set the ORM version supported. ─────
            rows = call_proc('sp_super_audit_log', 20000, 0)

            if args.get('action'):
                rows = [r for r in rows if r.get('action') == args['action']]
            if args.get('resource_type'):
                rows = [r for r in rows if r.get('resource_type') == args['resource_type']]
            if args.get('actor'):
                a = args['actor'].lower()
                rows = [
                    r for r in rows
                    if a in (r.get('actor_name') or '').lower()
                    or a in (r.get('actor_email') or '').lower()
                    or a in (r.get('actor_id') or '').lower()
                ]
            if args.get('from_date'):
                try:
                    from_dt = datetime.datetime.fromisoformat(args['from_date'])
                    rows = [r for r in rows if r.get('created_at') and r['created_at'] >= from_dt]
                except ValueError:
                    pass
            if args.get('to_date'):
                try:
                    to_dt = datetime.datetime.fromisoformat(args['to_date'])
                    rows = [r for r in rows if r.get('created_at') and r['created_at'] <= to_dt]
                except ValueError:
                    pass

            total = len(rows)
            per_page = args['per_page']
            page = args['page']
            pages = (total + per_page - 1) // per_page if per_page else 1
            start = (page - 1) * per_page
            items = rows[start:start + per_page]

            result = [
                {
                    'id':            log.get('id'),
                    'action':        log.get('action'),
                    'resource_type': log.get('resource_type'),
                    'resource_id':   log.get('resource_id'),
                    'actor_name':    log.get('actor_name'),
                    'actor_email':   log.get('actor_email'),
                    'meta':          _as_meta(log.get('meta')),
                    'created_at':    serialize_datetime(log['created_at']) if log.get('created_at') else None,
                }
                for log in items
            ]

            return jsonify(
                response={'logs': result},
                pagination={'total': total, 'pages': pages, 'page': args['page'], 'per_page': args['per_page']},
                status=200, bool=True
            )
        except Exception as e:
            logger.error(f"GET /super/audit error: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


# ── Mutations ─────────────────────────────────────────────────────────────────

_user_status_parser = reqparse.RequestParser()
_user_status_parser.add_argument('status', type=str, location='json', required=True)

_achiever_active_parser = reqparse.RequestParser()
_achiever_active_parser.add_argument('is_active', type=bool, location='json', required=True)

# cohorts.status column: upcoming | live | completed | cancelled
VALID_COHORT_STATUS = {'upcoming', 'live', 'completed', 'cancelled'}

_cohort_status_parser = reqparse.RequestParser()
_cohort_status_parser.add_argument('status', type=str, location='json', required=True)


@ns.route('/users/<string:user_id>')
class SuperUserDetail(Resource):
    @jwt_required()
    def patch(self, user_id):
        try:
            claims = get_jwt()
            if not _is_super(claims):
                return jsonify(response={'message': 'Super admin access required.'}, status=403, bool=False)

            # ── SP: sp_users_get + _update (full replace) ──────────────────────
            user = call_proc_one('sp_users_get', user_id)
            if not user or user.get('deleted_at'):
                return jsonify(response={'message': 'User not found.'}, status=404, bool=False)

            args = _user_status_parser.parse_args(strict=False)
            status = (args.get('status') or '').strip()
            if not status:
                return jsonify(response={'message': 'Status is required.'}, status=400, bool=False)

            actor_id = get_jwt_identity()
            call_proc_one(
                'sp_users_update',
                user_id, user.get('phone'), user.get('email'), user.get('full_name'),
                user.get('password_hash'), user.get('avatar_url'), status,
                user.get('created_by'), actor_id, None,
            )
            db.session.commit()
            return jsonify(response={'id': user_id, 'status': status}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"PATCH /super/users/{user_id} error: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/achievers/<string:achiever_id>')
class SuperAchieverDetail(Resource):
    @jwt_required()
    def patch(self, achiever_id):
        try:
            claims = get_jwt()
            if not _is_super(claims):
                return jsonify(response={'message': 'Super admin access required.'}, status=403, bool=False)

            # ── SP: sp_achievers_get + _update (full replace) ──────────────────
            achiever = call_proc_one('sp_achievers_get', achiever_id)
            if not achiever:
                return jsonify(response={'message': 'Achiever not found.'}, status=404, bool=False)

            args = _achiever_active_parser.parse_args(strict=False)
            if args.get('is_active') is None:
                return jsonify(response={'message': 'is_active is required.'}, status=400, bool=False)

            is_active = args['is_active']
            actor_id = get_jwt_identity()
            call_proc_one(
                'sp_achievers_update',
                achiever_id, achiever.get('full_name'), achiever.get('achievement_title'),
                achiever.get('designation'), achiever.get('company'), achiever.get('bio'),
                achiever.get('avatar_url'), achiever.get('skills'), achiever.get('domain_id'),
                achiever.get('linkedin_url'), achiever.get('is_verified'), achiever.get('is_featured'),
                1 if is_active else 0, achiever.get('email'), achiever.get('password_hash'),
                achiever.get('status'), achiever.get('phone'), achiever.get('profile_image_url'),
                achiever.get('domains'), achiever.get('suitable_for'), achiever.get('session_rate'),
                achiever.get('payout_account_name'), achiever.get('payout_account_number'),
                achiever.get('payout_ifsc'), achiever.get('payout_upi'), achiever.get('created_by'), actor_id,
            )
            db.session.commit()
            return jsonify(response={'id': achiever_id, 'is_active': is_active}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"PATCH /super/achievers/{achiever_id} error: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/cohorts/<string:cohort_id>')
class SuperCohortDetail(Resource):
    @jwt_required()
    def patch(self, cohort_id):
        try:
            claims = get_jwt()
            if not _is_super(claims):
                return jsonify(response={'message': 'Super admin access required.'}, status=403, bool=False)

            # ── SP: sp_cohorts_get + _update (full replace) ────────────────────
            cohort = call_proc_one('sp_cohorts_get', cohort_id)
            if not cohort or cohort.get('deleted_at'):
                return jsonify(response={'message': 'Cohort not found.'}, status=404, bool=False)

            # Status only, deliberately.
            #
            # This used to accept title, price, seats, dates and body copy — a
            # full content edit sitting in the oversight portal. Cohorts are
            # authored and corrected by admins; what the super admin needs is
            # the switch that stops one, which is `cancelled`.
            data = request.get_json() or {}
            status = (data.get('status') or '').strip()
            if status not in VALID_COHORT_STATUS:
                return jsonify(
                    response={'message': f"status must be one of: {', '.join(sorted(VALID_COHORT_STATUS))}."},
                    status=400, bool=False)

            actor_id = get_jwt_identity()
            call_proc_one(
                'sp_cohorts_update',
                cohort_id, cohort.get('title'), cohort.get('achiever_id'), cohort.get('domain_id'),
                cohort.get('session_date'), cohort.get('duration_minutes'), cohort.get('total_seats'),
                cohort.get('filled_seats'), cohort.get('price'), status, cohort.get('reminder_sent'),
                cohort.get('about'), cohort.get('what_you_learn'), cohort.get('thumbnail_url'),
                cohort.get('level'), cohort.get('registration_deadline'), cohort.get('meeting_link'),
                cohort.get('target_categories'), cohort.get('target_streams'), cohort.get('target_degree_cats'),
                cohort.get('target_exam_targets'), cohort.get('target_prof_courses'), cohort.get('target_years'),
                cohort.get('target_degrees'), cohort.get('target_branches'),
                cohort.get('created_by'), actor_id, cohort.get('deleted_at'),
            )
            db.session.commit()
            return jsonify(response={'id': cohort_id, 'status': status}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"PATCH /super/cohorts/{cohort_id} error: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    # Cohort deletion removed on purpose. Suspending beats deleting: a cancelled
    # cohort still has enrolments, payments and refunds hanging off it, and
    # destroying the row destroys the trail you need exactly when something has
    # gone wrong. The PATCH above sets its status, which is the reversible
    # version of the same intent. Deletion, if it is ever right, is admin work.
