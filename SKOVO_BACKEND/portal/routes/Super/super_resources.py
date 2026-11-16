from portal.helpers.error_capture import capture_error
from portal.helpers.helpers import serialize_datetime
"""
Super admin: enrollments, readiness, communities, opportunities
"""
import json
import uuid
import datetime
from flask import jsonify
from flask_restx import Resource, reqparse
from flask_jwt_extended import jwt_required, get_jwt, get_jwt_identity
from portal.models import db
from portal.helpers.audit import log_audit
from portal.helpers.sp import call_proc, call_proc_one
from . import ns, logger


def _is_super(claims):
    return claims.get('super_admin') is True


def _as_list(v):
    if isinstance(v, str):
        try:
            return json.loads(v)
        except Exception:
            return []
    return v or []


def _paginate_rows(rows, page, per_page):
    total = len(rows)
    pages = (total + per_page - 1) // per_page if per_page else 1
    start = (page - 1) * per_page
    return rows[start:start + per_page], total, pages


# ── Enrollments ───────────────────────────────────────────────────────────────

enroll_parser = reqparse.RequestParser()
enroll_parser.add_argument('page',           type=int, location='args', default=1)
enroll_parser.add_argument('per_page',       type=int, location='args', default=25)
enroll_parser.add_argument('search',         type=str, location='args', required=False)
enroll_parser.add_argument('payment_status', type=str, location='args', required=False)


@ns.route('/enrollments')
class SuperEnrollments(Resource):
    @jwt_required()
    def get(self):
        try:
            claims = get_jwt()
            if not _is_super(claims):
                return jsonify(response={'message': 'Super admin access required.'}, status=403, bool=False)

            args = enroll_parser.parse_args()

            # ── SP: sp_cohort_enrollments_list + sp_users_list + sp_cohorts_list ─
            all_enrollments = call_proc('sp_cohort_enrollments_list', 50000, 0)
            all_users = call_proc('sp_users_list', 50000, 0)
            users_by_id = {u['id']: u for u in all_users}
            all_cohorts = call_proc('sp_cohorts_list', 5000, 0)
            cohorts_by_id = {c['id']: c for c in all_cohorts}

            rows = []
            for e in all_enrollments:
                u = users_by_id.get(e.get('user_id'))
                c = cohorts_by_id.get(e.get('cohort_id'))
                if u and c:
                    rows.append((e, u, c))

            if args.get('search'):
                s = args['search'].lower()
                rows = [
                    (e, u, c) for e, u, c in rows
                    if s in (u.get('full_name') or '').lower() or s in (u.get('email') or '').lower()
                    or s in (c.get('title') or '').lower()
                ]
            if args.get('payment_status'):
                rows = [(e, u, c) for e, u, c in rows if e.get('payment_status') == args['payment_status']]

            rows.sort(key=lambda t: t[0].get('enrolled_at') or t[0].get('created_at'), reverse=True)
            items, total, pages = _paginate_rows(rows, args['page'], args['per_page'])

            result = []
            for e, u, c in items:
                enrolled_at = e.get('enrolled_at')
                result.append({
                    'id':             e.get('id'),
                    'user_name':      u.get('full_name'),
                    'user_email':     u.get('email'),
                    'cohort_title':   c.get('title'),
                    'cohort_status':  c.get('status'),
                    'payment_status': e.get('payment_status'),
                    'amount_paid':    float(e.get('amount_paid')) if e.get('amount_paid') else 0,
                    'attended':       bool(e.get('attended')),
                    'enrolled_at':    serialize_datetime(enrolled_at) if enrolled_at else None,
                })

            return jsonify(
                response={'enrollments': result},
                pagination={'total': total, 'pages': pages, 'page': args['page'], 'per_page': args['per_page']},
                status=200, bool=True
            )
        except Exception as e:
            logger.error(f"GET /super/enrollments error: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


# ── Readiness Scores ──────────────────────────────────────────────────────────

readiness_parser = reqparse.RequestParser()
readiness_parser.add_argument('page',     type=int, location='args', default=1)
readiness_parser.add_argument('per_page', type=int, location='args', default=25)
readiness_parser.add_argument('search',   type=str, location='args', required=False)
readiness_parser.add_argument('level',    type=str, location='args', required=False)

override_parser = reqparse.RequestParser()
override_parser.add_argument('score',  type=int, location='json', required=True)
override_parser.add_argument('reason', type=str, location='json', required=False)


@ns.route('/readiness')
class SuperReadinessList(Resource):
    @jwt_required()
    def get(self):
        try:
            claims = get_jwt()
            if not _is_super(claims):
                return jsonify(response={'message': 'Super admin access required.'}, status=403, bool=False)

            args = readiness_parser.parse_args()

            # ── SP: sp_readiness_scores_list + sp_users_list ───────────────────
            all_scores = call_proc('sp_readiness_scores_list', 50000, 0)
            all_users = call_proc('sp_users_list', 50000, 0)
            users_by_id = {u['id']: u for u in all_users}

            rows = [(r, users_by_id[r['user_id']]) for r in all_scores if r.get('user_id') in users_by_id]

            if args.get('search'):
                s = args['search'].lower()
                rows = [(r, u) for r, u in rows if s in (u.get('full_name') or '').lower() or s in (u.get('email') or '').lower()]
            if args.get('level'):
                rows = [(r, u) for r, u in rows if r.get('level') == args['level']]

            rows.sort(key=lambda t: t[0].get('score') or 0, reverse=True)
            items, total, pages = _paginate_rows(rows, args['page'], args['per_page'])

            result = []
            for r, u in items:
                updated_at = r.get('updated_at')
                result.append({
                    'id':                   r.get('id'),
                    'user_name':            u.get('full_name'),
                    'user_email':           u.get('email'),
                    'score':                r.get('score'),
                    'level':                r.get('level'),
                    'cohorts_completed':    r.get('cohorts_completed'),
                    'tasks_completed':      r.get('tasks_completed'),
                    'assessment_completed': bool(r.get('assessment_completed')),
                    'updated_at':           serialize_datetime(updated_at) if updated_at else None,
                })

            return jsonify(
                response={'readiness': result},
                pagination={'total': total, 'pages': pages, 'page': args['page'], 'per_page': args['per_page']},
                status=200, bool=True
            )
        except Exception as e:
            logger.error(f"GET /super/readiness error: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


# ─────────────────────────────────────────────────────────────────────────────
# Removed on purpose: readiness override (PATCH) and readiness delete.
#
# A student's readiness score is operational data. Changing or deleting it is
# admin work and should carry the name of the admin who did it. The super admin
# reads the list above to see the platform's state, and nothing more.
# ─────────────────────────────────────────────────────────────────────────────


# List filters shared by the communities and courses listings. Restored after
# an edit removing the community-create endpoint took this definition with it —
# both GETs call comm_parser.parse_args() and were raising NameError.
comm_parser = reqparse.RequestParser()
comm_parser.add_argument('page',       type=int, location='args', default=1)
comm_parser.add_argument('per_page',   type=int, location='args', default=20)
comm_parser.add_argument('search',     type=str, location='args', required=False)
comm_parser.add_argument('group_type', type=str, location='args', required=False)

comm_update_parser = reqparse.RequestParser()
comm_update_parser.add_argument('is_active', type=bool, location='json', required=False)


@ns.route('/communities')
class SuperCommunityList(Resource):
    @jwt_required()
    def get(self):
        try:
            claims = get_jwt()
            if not _is_super(claims):
                return jsonify(response={'message': 'Super admin access required.'}, status=403, bool=False)

            args  = comm_parser.parse_args()
            # ── SP: sp_groups_list — no search/group_type filter on the generic
            # CRUD proc, so pull a bounded batch and filter here. ─────────────
            rows = call_proc('sp_groups_list', 5000, 0, 0)
            if args.get('search'):
                s = args['search'].lower()
                rows = [g for g in rows if s in (g.get('name') or '').lower()]
            if args.get('group_type'):
                rows = [g for g in rows if g.get('group_type') == args['group_type']]
            rows.sort(key=lambda g: g.get('created_at') or datetime.datetime.min, reverse=True)

            items, total, pages = _paginate_rows(rows, args['page'], args['per_page'])

            result = []
            for g in items:
                created_at = g.get('created_at')
                result.append({
                    'id':           g.get('id'),
                    'name':         g.get('name'),
                    'description':  g.get('description'),
                    'category':     g.get('category'),
                    'group_type':   g.get('group_type'),
                    'member_count': g.get('member_count'),
                    'join_type':    g.get('join_type'),
                    'is_active':    bool(g.get('is_active')),
                    'created_at':   serialize_datetime(created_at) if created_at else None,
                })

            return jsonify(
                response={'communities': result},
                pagination={'total': total, 'pages': pages, 'page': args['page'], 'per_page': args['per_page']},
                status=200, bool=True
            )
        except Exception as e:
            logger.error(f"GET /super/communities error: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    # Community creation removed on purpose. Admins create communities; the
    # super admin reads them above and can deactivate one through the PATCH
    # below, which is the break-glass switch for a group that has turned
    # harmful. Creation lives in the admin portal so there is one place it
    # happens and one name against it in the audit log.


@ns.route('/courses')
class SuperCourseList(Resource):
    @jwt_required()
    def get(self):
        """All achiever courses across the platform, with enrollment revenue."""
        try:
            claims = get_jwt()
            if not _is_super(claims):
                return jsonify(response={'message': 'Super admin access required.'}, status=403, bool=False)

            args = comm_parser.parse_args()
            # ── SP: sp_achiever_courses_list, sp_achievers_list, sp_course_enrollments_list ─
            rows = call_proc('sp_achiever_courses_list', 5000, 0, 0)
            if args.get('search'):
                s = args['search'].lower()
                rows = [c for c in rows if s in (c.get('title') or '').lower()]
            rows.sort(key=lambda c: c.get('created_at') or datetime.datetime.min, reverse=True)

            achievers_by_id = {a['id']: a for a in call_proc('sp_achievers_list', 5000, 0, 0)}
            all_enr = call_proc('sp_course_enrollments_list', 200000, 0)
            enr_by_course = {}
            for e in all_enr:
                if e.get('payment_status') in ('paid', 'free'):
                    stats = enr_by_course.setdefault(e.get('course_id'), {'count': 0, 'revenue': 0.0})
                    stats['count'] += 1
                    stats['revenue'] += float(e.get('amount_paid') or 0)

            items, total, pages = _paginate_rows(rows, args['page'], args['per_page'])
            result = []
            for c in items:
                ach = achievers_by_id.get(c.get('achiever_id')) or {}
                stats = enr_by_course.get(c.get('id')) or {'count': 0, 'revenue': 0.0}
                created_at = c.get('created_at')
                result.append({
                    'id':            c.get('id'),
                    'title':         c.get('title'),
                    'achiever_name': ach.get('full_name') or 'Unknown',
                    'level':         c.get('level'),
                    'price':         float(c.get('price') or 0),
                    'status':        c.get('status'),
                    'is_active':     bool(c.get('is_active')),
                    'enrolled':      stats['count'],
                    'revenue':       stats['revenue'],
                    'created_at':    serialize_datetime(created_at) if created_at else None,
                })
            return jsonify(
                response={'courses': result},
                pagination={'total': total, 'pages': pages, 'page': args['page'], 'per_page': args['per_page']},
                status=200, bool=True
            )
        except Exception as e:
            logger.error(f"GET /super/courses error: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/communities/<string:group_id>')
class SuperCommunityDetail(Resource):
    @jwt_required()
    def patch(self, group_id):
        try:
            claims = get_jwt()
            if not _is_super(claims):
                return jsonify(response={'message': 'Super admin access required.'}, status=403, bool=False)

            # ── SP: sp_groups_get + _update (full replace) ─────────────────────
            group = call_proc_one('sp_groups_get', group_id)
            if not group:
                return jsonify(response={'message': 'Group not found.'}, status=404, bool=False)

            args = comm_update_parser.parse_args(strict=False)
            is_active = args['is_active'] if args.get('is_active') is not None else group.get('is_active')

            actor_id = get_jwt_identity()
            call_proc_one(
                'sp_groups_update',
                group_id, group.get('name'), group.get('description'), group.get('category'),
                group.get('group_type'), group.get('icon_url'), group.get('icon_color'),
                group.get('min_members'), group.get('max_members'), group.get('join_type'),
                group.get('member_count'), group.get('created_by'), 1 if is_active else 0,
                actor_id, group.get('deleted_at'),
            )
            db.session.commit()
            return jsonify(response={'id': group_id, 'is_active': is_active}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"PATCH /super/communities/{group_id} error: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


# ── Opportunities ─────────────────────────────────────────────────────────────

opp_list_parser = reqparse.RequestParser()
opp_list_parser.add_argument('page',     type=int, location='args', default=1)
opp_list_parser.add_argument('per_page', type=int, location='args', default=20)
opp_list_parser.add_argument('search',   type=str, location='args', required=False)
opp_list_parser.add_argument('type',     type=str, location='args', required=False)
opp_list_parser.add_argument('status',   type=str, location='args', required=False)

opp_body_parser = reqparse.RequestParser()
opp_body_parser.add_argument('title',               type=str,  location='json', required=False)
opp_body_parser.add_argument('company',             type=str,  location='json', required=False)
opp_body_parser.add_argument('type',                type=str,  location='json', required=False)
opp_body_parser.add_argument('domain',              type=str,  location='json', required=False)
opp_body_parser.add_argument('location',            type=str,  location='json', required=False)
opp_body_parser.add_argument('is_remote',           type=bool, location='json', required=False)
opp_body_parser.add_argument('duration',            type=str,  location='json', required=False)
opp_body_parser.add_argument('stipend_min',         type=int,  location='json', required=False)
opp_body_parser.add_argument('stipend_max',         type=int,  location='json', required=False)
opp_body_parser.add_argument('stipend_type',        type=str,  location='json', required=False)
opp_body_parser.add_argument('min_readiness_score', type=int,  location='json', required=False)
opp_body_parser.add_argument('deadline',            type=str,  location='json', required=False)
opp_body_parser.add_argument('description',         type=str,  location='json', required=False)
opp_body_parser.add_argument('status',              type=str,  location='json', required=False)


# order matches sp_opportunities_create/_update after (id, title)
_OPP_FIELDS = [
    ('company', None), ('type', None), ('domain', None), ('location', None), ('is_remote', 'bool'),
    ('duration', None), ('stipend_min', None), ('stipend_max', None), ('stipend_type', None),
    ('min_readiness_score', None), ('deadline', None), ('skills_required', 'json_raw'),
    ('eligibility_criteria', None), ('experience_level', None), ('application_link', None),
    ('is_featured', 'bool'), ('description', None), ('requirements', 'json_raw'), ('status', None),
    ('posted_by', None),
]


def _build_opp_args(oid, title, d, existing=None):
    existing = existing or {}
    args = [oid, title]
    for field, caster in _OPP_FIELDS:
        if field in d:
            v = d[field]
            if caster == 'bool':
                v = 1 if v else 0
            args.append(v)
        else:
            args.append(existing.get(field))
    return args


def _serialize_opp(o, app_count=0):
    deadline = o.get('deadline')
    created_at = o.get('created_at')
    return {
        'id':                  o.get('id'),
        'title':               o.get('title'),
        'company':             o.get('company'),
        'type':                o.get('type'),
        'domain':              o.get('domain'),
        'location':            o.get('location'),
        'is_remote':           bool(o.get('is_remote')),
        'duration':            o.get('duration'),
        'stipend_min':         o.get('stipend_min'),
        'stipend_max':         o.get('stipend_max'),
        'stipend_type':        o.get('stipend_type'),
        'min_readiness_score': o.get('min_readiness_score'),
        'deadline':            serialize_datetime(deadline) if deadline else None,
        'description':         o.get('description'),
        'status':              o.get('status'),
        'application_count':   app_count,
        'created_at':          serialize_datetime(created_at) if created_at else None,
    }


@ns.route('/opportunities')
class SuperOpportunityList(Resource):
    @jwt_required()
    def get(self):
        try:
            claims = get_jwt()
            if not _is_super(claims):
                return jsonify(response={'message': 'Super admin access required.'}, status=403, bool=False)

            args  = opp_list_parser.parse_args()
            # ── SP: sp_opportunities_list + sp_opportunity_applications_list ──
            rows = call_proc('sp_opportunities_list', 20000, 0)
            rows = [o for o in rows if not o.get('deleted_at')]
            if args.get('search'):
                s = args['search'].lower()
                rows = [o for o in rows if s in (o.get('title') or '').lower() or s in (o.get('company') or '').lower()]
            if args.get('type'):
                rows = [o for o in rows if o.get('type') == args['type']]
            if args.get('status'):
                rows = [o for o in rows if o.get('status') == args['status']]
            rows.sort(key=lambda o: o.get('created_at') or datetime.datetime.min, reverse=True)

            items, total, pages = _paginate_rows(rows, args['page'], args['per_page'])

            all_apps = call_proc('sp_opportunity_applications_list', 200000, 0)
            app_counts = {}
            for a in all_apps:
                app_counts[a.get('opportunity_id')] = app_counts.get(a.get('opportunity_id'), 0) + 1

            return jsonify(
                response={'opportunities': [_serialize_opp(o, app_counts.get(o.get('id'), 0)) for o in items]},
                pagination={'total': total, 'pages': pages, 'page': args['page'], 'per_page': args['per_page']},
                status=200, bool=True
            )
        except Exception as e:
            logger.error(f"GET /super/opportunities error: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


# ─────────────────────────────────────────────────────────────────────────────
# Removed on purpose: opportunity create / edit / delete.
#
# The super admin decides who holds admin access; admins run the platform.
# Content lives entirely in the admin portal, so there is exactly one place any
# given opportunity can be created or changed, and exactly one name on it in
# the audit log. A capability that exists in two portals is one nobody can
# answer "who changed this" for.
#
# Read access stays (GET /opportunities above) — oversight without visibility
# is a rubber stamp. What is gone is the ability to write.
#
# Admin equivalents: POST/PATCH/DELETE /skovo-platform-panel-admin/opportunities
# ─────────────────────────────────────────────────────────────────────────────
