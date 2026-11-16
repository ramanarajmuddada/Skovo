from portal.helpers.error_capture import capture_error
from portal.helpers.helpers import serialize_datetime
from flask import jsonify
from flask_restx import Resource, reqparse
from flask_jwt_extended import jwt_required, get_jwt, get_jwt_identity
from portal.models import db
from portal.helpers.sp import call_proc, call_proc_one
from . import ns, logger
from portal.helpers.admin_auth import can, AREA_CONTENT

list_parser = reqparse.RequestParser()
list_parser.add_argument('page',     type=int, location='args', default=1)
list_parser.add_argument('per_page', type=int, location='args', default=20)
list_parser.add_argument('search',   type=str, location='args', required=False)
list_parser.add_argument('status',   type=str, location='args', required=False)


def _course_row(c, achievers_by_id, enrollments_by_course):
    achiever = achievers_by_id.get(c.get('achiever_id'))
    paid_enrollments = [
        e for e in enrollments_by_course.get(c.get('id'), [])
        if e.get('payment_status') in ('paid', 'free')
    ]
    total_revenue = sum(float(e.get('amount_paid') or 0) for e in paid_enrollments)
    platform_revenue = sum(float(e.get('platform_fee') or 0) for e in paid_enrollments)
    created_at = c.get('created_at')
    return {
        'id':               c.get('id'),
        'title':            c.get('title'),
        'category':         c.get('category'),
        'price':            float(c.get('price') or 0),
        'level':            c.get('level'),
        'status':           c.get('status'),
        'is_active':        bool(c.get('is_active')),
        'enrolled_count':   len(paid_enrollments),
        'total_revenue':    round(total_revenue, 2),
        'platform_revenue': round(platform_revenue, 2),
        'duration_weeks':   c.get('duration_weeks'),
        'created_at':       serialize_datetime(created_at) if created_at else None,
        'achiever': {
            'id':        achiever.get('id')        if achiever else None,
            'full_name': achiever.get('full_name') if achiever else 'Unknown',
            'email':     achiever.get('email')     if achiever else None,
        },
    }


@ns.route('/courses')
class AdminCourseList(Resource):
    @jwt_required()
    def get(self):
        try:
            if not can(AREA_CONTENT):
                return jsonify(response={'message': 'Admin access only.'}, status=403, bool=False)
            args  = list_parser.parse_args()

            # ── SP: sp_achiever_courses_list — no search/status filters on the
            # generic CRUD proc, so pull a bounded batch and filter here. ────
            rows = call_proc('sp_achiever_courses_list', 5000, 0, 0)
            rows = [c for c in rows if not c.get('deleted_at')]
            if args.get('search'):
                s = args['search'].lower()
                rows = [c for c in rows if s in (c.get('title') or '').lower() or s in (c.get('category') or '').lower()]
            if args.get('status'):
                rows = [c for c in rows if c.get('status') == args['status']]
            rows.sort(key=lambda c: c.get('created_at') or '', reverse=True)

            total = len(rows)
            per_page = args['per_page']
            page = args['page']
            pages = (total + per_page - 1) // per_page if per_page else 1
            start = (page - 1) * per_page
            page_rows = rows[start:start + per_page]

            # ── SP: sp_achievers_list + sp_course_enrollments_list ────────────
            all_achievers = call_proc('sp_achievers_list', 5000, 0, 0)
            achievers_by_id = {a['id']: a for a in all_achievers}

            all_enrollments = call_proc('sp_course_enrollments_list', 100000, 0)
            enrollments_by_course = {}
            for e in all_enrollments:
                enrollments_by_course.setdefault(e.get('course_id'), []).append(e)

            return jsonify(
                response={
                    'courses': [_course_row(c, achievers_by_id, enrollments_by_course) for c in page_rows],
                    'total': total,
                },
                pagination={'page': page, 'pages': pages, 'total': total},
                status=200, bool=True
            )
        except Exception as e:
            logger.error(f"AdminCourseList.get: {e}")
            return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)}, status=500, bool=False)


@ns.route('/courses/<string:course_id>/toggle-status')
class AdminCourseToggle(Resource):
    @jwt_required()
    def post(self, course_id):
        try:
            if not can(AREA_CONTENT):
                return jsonify(response={'message': 'Admin access only.'}, status=403, bool=False)

            # ── SP: sp_achiever_courses_get + _update (full replace) ──────────
            c = call_proc_one('sp_achiever_courses_get', course_id)
            if not c:
                return jsonify(response={'message': 'Course not found.'}, status=404, bool=False)

            new_active = not c.get('is_active')
            new_status = 'draft' if (not new_active and c.get('status') == 'published') else c.get('status')

            admin_id = get_jwt_identity()
            updated = call_proc_one(
                'sp_achiever_courses_update',
                course_id, c.get('achiever_id'), c.get('title'), c.get('description'), c.get('thumbnail_url'),
                c.get('price'), c.get('duration_weeks'), c.get('level'), c.get('category'),
                c.get('what_you_learn'), c.get('requirements'), new_status, c.get('enrolled_count'),
                c.get('target_categories'), c.get('target_streams'), c.get('target_degree_cats'),
                c.get('target_exam_targets'), c.get('target_prof_courses'), c.get('target_years'),
                c.get('target_degrees'), c.get('target_branches'), 1 if new_active else 0,
                c.get('deleted_at'), c.get('created_by'), admin_id,
            )
            db.session.commit()
            return jsonify(response={'message': f"Course {'enabled' if new_active else 'disabled'}.", 'is_active': new_active, 'status': new_status}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)}, status=500, bool=False)
