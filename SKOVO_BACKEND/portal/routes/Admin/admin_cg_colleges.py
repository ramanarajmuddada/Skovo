from portal.helpers.error_capture import capture_error
from portal.helpers.helpers import serialize_datetime
"""
Career Guidance — College & Cutoff Management
Admin can:
  - Add colleges with full details (fees, placements, NAAC, NIRF)
  - Add branch-wise EAMCET/ECET cutoffs per category per year
  - Predict colleges a student can get based on rank + category
"""
import json
import uuid
import datetime
from flask import jsonify, request
from flask_restx import Resource, reqparse
from flask_jwt_extended import jwt_required, get_jwt, get_jwt_identity
from portal.models import db
from portal.helpers.sp import call_proc, call_proc_one
from . import ns, logger
from portal.helpers.admin_auth import can, AREA_CONTENT


# ── Parsers ───────────────────────────────────────────────────────────────────

college_list_parser = reqparse.RequestParser()
college_list_parser.add_argument('page',    type=int, location='args', default=1)
college_list_parser.add_argument('per_page',type=int, location='args', default=20)
college_list_parser.add_argument('search',  type=str, location='args')
college_list_parser.add_argument('type',    type=str, location='args')
college_list_parser.add_argument('state',   type=str, location='args')

predict_parser = reqparse.RequestParser()
predict_parser.add_argument('rank',       type=int, location='args', required=True)
predict_parser.add_argument('category',   type=str, location='args', required=True)
predict_parser.add_argument('exam_type',  type=str, location='args', default='EAMCET')
predict_parser.add_argument('branch_code',type=str, location='args')
predict_parser.add_argument('year',       type=int, location='args', default=2024)


def _require_admin():
    """This module lives in the 'content' area — see portal/helpers/admin_auth."""
    return can(AREA_CONTENT)


def _int(v):
    try: return int(v) if v not in (None, '', 'null') else None
    except: return None

def _float(v):
    try: return float(v) if v not in (None, '', 'null') else None
    except: return None

def _str(v):
    s = (v or '').strip()
    return s if s else None

def _as_list(v):
    if isinstance(v, str):
        try:
            return json.loads(v)
        except Exception:
            return []
    return v or []


def _college_dict(c):
    created_at = c.get('created_at')
    return {
        'id':               c.get('id'),
        'name':             c.get('name'),
        'type':             c.get('type'),
        'location_city':    c.get('location_city'),
        'location_state':   c.get('location_state'),
        'nirf_ranking':     c.get('nirf_ranking'),
        'naac_grade':       c.get('naac_grade'),
        'annual_fees_min':  c.get('annual_fees_min'),
        'annual_fees_max':  c.get('annual_fees_max'),
        'placement_rate':   c.get('placement_rate'),
        'avg_package':      c.get('avg_package'),
        'highest_package':  c.get('highest_package'),
        'website_url':      c.get('website_url'),
        'about':            c.get('about'),
        'hostel_fee':       c.get('hostel_fee'),
        'established_year': c.get('established_year'),
        'total_students':   c.get('total_students'),
        'facilities':       _as_list(c.get('facilities')),
        'top_recruiters':   _as_list(c.get('top_recruiters')),
        'achievements':     _as_list(c.get('achievements')),
        'is_active':        bool(c.get('is_active')),
        'created_at':       serialize_datetime(created_at) if created_at else None,
    }


def _course_dict(c):
    annual_fee = c.get('annual_fee')
    return {
        'id':            c.get('id'),
        'course_name':   c.get('course_name'),
        'branch_code':   c.get('branch_code'),
        'degree_type':   c.get('degree_type'),
        'duration_years':c.get('duration_years'),
        'total_seats':   c.get('total_seats'),
        'annual_fee':    float(annual_fee) if annual_fee else None,
    }


def _placement_dict(p):
    return {
        'id':             p.get('id'),
        'year':           p.get('year'),
        'placement_rate': p.get('placement_rate'),
        'avg_package':    p.get('avg_package'),
        'highest_package':p.get('highest_package'),
        'median_package': p.get('median_package'),
        'total_students': p.get('total_students'),
        'placed_students':p.get('placed_students'),
        'top_recruiters': _as_list(p.get('top_recruiters')),
    }


def _cutoff_dict(ct):
    return {
        'id':           ct.get('id'),
        'college_name': ct.get('college_name'),
        'branch_code':  ct.get('branch_code'),
        'branch_name':  ct.get('branch_name'),
        'exam_type':    ct.get('exam_type'),
        'year':         ct.get('year'),
        'category':     ct.get('category'),
        'gender':       ct.get('gender'),
        'opening_rank': ct.get('opening_rank'),
        'closing_rank': ct.get('closing_rank'),
        'total_seats':  ct.get('total_seats'),
    }


# 31-param order for sp_colleges_create/_update, after (id, name)
_COLLEGE_FIELDS = [
    ('type', None), ('location_city', None), ('location_state', None), ('nirf_ranking', _int),
    ('naac_grade', None), ('annual_fees_min', _int), ('annual_fees_max', _int), ('placement_rate', _float),
    ('avg_package', _float), ('highest_package', _float), ('website_url', None), ('logo_url', None),
    ('banner_url', None), ('about', None), ('accreditation', None), ('contact_info', None),
    ('admission_process', None), ('entrance_exams_accepted', 'json'), ('hostel_fee', _int),
    ('established_year', _int), ('total_students', _int), ('facilities', 'json'),
    ('top_recruiters', 'json'), ('achievements', 'json'), ('is_active', 'bool'),
]


def _college_sp_args(cid, name, d, existing=None):
    existing = existing or {}
    args = [cid, name]
    for field, caster in _COLLEGE_FIELDS:
        if field in d:
            v = d[field]
            if caster == 'json':
                v = json.dumps(v if isinstance(v, list) else (v or [])) if v is not None else '[]'
            elif caster == 'bool':
                v = 1 if v else 0
            elif caster:
                v = caster(v)
            args.append(v)
        else:
            args.append(existing.get(field))
    return args


def _cutoff_sp_args(ctid, college, d, existing=None):
    """order: id, college_name, college_city, college_state, college_type, branch_code,
    branch_name, exam_type, year, category, gender, opening_rank, closing_rank, total_seats"""
    existing = existing or {}
    return [
        ctid,
        college.get('name') if college else existing.get('college_name'),
        college.get('location_city') if college else existing.get('college_city'),
        college.get('location_state') if college else existing.get('college_state'),
        college.get('type') if college else existing.get('college_type'),
        d.get('branch_code', existing.get('branch_code')),
        d.get('branch_name', existing.get('branch_name')),
        d.get('exam_type', existing.get('exam_type', 'EAMCET')),
        d.get('year', existing.get('year', datetime.datetime.utcnow().year)),
        d.get('category', existing.get('category')),
        d.get('gender', existing.get('gender', 'CoEd')),
        d.get('opening_rank', existing.get('opening_rank')),
        d.get('closing_rank', existing.get('closing_rank')),
        d.get('total_seats', existing.get('total_seats')),
    ]


# ── College List + Create ─────────────────────────────────────────────────────

@ns.route('/cg/colleges')
class AdminCGCollegeList(Resource):

    @jwt_required()
    def get(self):
        if not _require_admin():
            return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
        try:
            args = college_list_parser.parse_args()

            # ── SP: sp_colleges_list — no search/type/state filters on the
            # generic CRUD proc, so pull a bounded batch and filter here. ────
            rows = call_proc('sp_colleges_list', 5000, 0, 0)
            if args.get('search'):
                s = args['search'].lower()
                rows = [c for c in rows if s in (c.get('name') or '').lower()]
            if args.get('type'):
                rows = [c for c in rows if c.get('type') == args['type']]
            if args.get('state'):
                s = args['state'].lower()
                rows = [c for c in rows if s in (c.get('location_state') or '').lower()]
            rows.sort(key=lambda c: c.get('name') or '')

            total = len(rows)
            per_page = args['per_page']
            page = args['page']
            pages = (total + per_page - 1) // per_page if per_page else 1
            start = (page - 1) * per_page
            page_rows = rows[start:start + per_page]

            # ── SP: sp_cg_college_cutoffs_list — count cutoffs per college ────
            all_cutoffs = call_proc('sp_cg_college_cutoffs_list', 100000, 0)
            cutoff_counts = {}
            for ct in all_cutoffs:
                cutoff_counts[ct.get('college_name')] = cutoff_counts.get(ct.get('college_name'), 0) + 1

            result = []
            for c in page_rows:
                d = _college_dict(c)
                d['cutoff_count'] = cutoff_counts.get(c.get('name'), 0)
                result.append(d)

            return jsonify(
                response={'colleges': result},
                pagination={'total': total, 'pages': pages, 'page': page, 'per_page': per_page},
                status=200, bool=True
            )
        except Exception as e:
            logger.error(f"CG GET /colleges: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @jwt_required()
    def post(self):
        if not _require_admin():
            return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
        try:
            data = request.get_json() or {}
            name = (data.get('name') or '').strip()
            if not name:
                return jsonify(response={'message': 'College name is required.'}, status=400, bool=False)

            admin_id = get_jwt_identity()
            # ── SP: sp_colleges_create ─────────────────────────────────────────
            college_id = str(uuid.uuid4())
            data.setdefault('is_active', True)
            sp_args = _college_sp_args(college_id, name, data) + [admin_id, admin_id, None]
            college = call_proc_one('sp_colleges_create', *sp_args)

            # ── SP: sp_cg_college_cutoffs_create — add cutoffs if provided ────
            cutoffs_added = 0
            for ct in data.get('cutoffs', []):
                call_proc(
                    'sp_cg_college_cutoffs_create',
                    *_cutoff_sp_args(str(uuid.uuid4()), college, ct), admin_id, admin_id,
                )
                cutoffs_added += 1

            db.session.commit()
            logger.info(f"CG college created: {college_id} with {cutoffs_added} cutoffs")
            d = _college_dict(college)
            d['cutoff_count'] = cutoffs_added
            return jsonify(response={'message': 'College created.', 'college': d}, status=201, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"CG POST /colleges: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


# ── College Detail + Update + Delete ─────────────────────────────────────────

@ns.route('/cg/colleges/<string:college_id>')
class AdminCGCollegeDetail(Resource):

    @jwt_required()
    def get(self, college_id):
        if not _require_admin():
            return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
        try:
            # ── SP: sp_colleges_get + related lists ────────────────────────────
            college = call_proc_one('sp_colleges_get', college_id)
            if not college or college.get('deleted_at'):
                return jsonify(response={'message': 'College not found.'}, status=404, bool=False)

            all_cutoffs = call_proc('sp_cg_college_cutoffs_list', 100000, 0)
            cutoffs = [ct for ct in all_cutoffs if ct.get('college_name') == college['name']]
            cutoffs.sort(key=lambda ct: (ct.get('exam_type') or '', ct.get('branch_code') or '', ct.get('category') or '', -(ct.get('year') or 0)))

            all_courses = call_proc('sp_college_courses_list', 100000, 0)
            courses = sorted(
                [c for c in all_courses if c.get('college_id') == college_id],
                key=lambda c: c.get('course_name') or ''
            )

            all_placements = call_proc('sp_college_placement_insights_list', 100000, 0)
            placements = sorted(
                [p for p in all_placements if p.get('college_id') == college_id],
                key=lambda p: -(p.get('year') or 0)
            )

            d = _college_dict(college)
            d['cutoffs']    = [_cutoff_dict(ct) for ct in cutoffs]
            d['courses']    = [_course_dict(c) for c in courses]
            d['placements'] = [_placement_dict(p) for p in placements]
            return jsonify(response={'college': d}, status=200, bool=True)
        except Exception as e:
            logger.error(f"CG GET /colleges/{college_id}: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @jwt_required()
    def put(self, college_id):
        if not _require_admin():
            return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
        try:
            # ── SP: sp_colleges_get + _update (full replace) ───────────────────
            existing = call_proc_one('sp_colleges_get', college_id)
            if not existing or existing.get('deleted_at'):
                return jsonify(response={'message': 'College not found.'}, status=404, bool=False)

            data = request.get_json() or {}
            old_name = existing['name']
            new_name = _str(data['name']) if data.get('name') else old_name

            admin_id = get_jwt_identity()
            sp_args = _college_sp_args(college_id, new_name, data, existing) + [existing.get('created_by'), admin_id, None]
            college = call_proc_one('sp_colleges_update', *sp_args)

            # Sync college_name in cutoffs if name changed
            if new_name != old_name:
                all_cutoffs = call_proc('sp_cg_college_cutoffs_list', 100000, 0)
                for ct in all_cutoffs:
                    if ct.get('college_name') == old_name:
                        args = _cutoff_sp_args(ct['id'], college, {}, ct)
                        call_proc('sp_cg_college_cutoffs_update', *args, ct.get('created_by'), admin_id)

            db.session.commit()
            return jsonify(response={'message': 'College updated.', 'college': _college_dict(college)}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"CG PUT /colleges/{college_id}: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @jwt_required()
    def delete(self, college_id):
        if not _require_admin():
            return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
        try:
            # ── SP: sp_colleges_get + _delete (soft) + cutoffs cleanup ────────
            existing = call_proc_one('sp_colleges_get', college_id)
            if not existing or existing.get('deleted_at'):
                return jsonify(response={'message': 'College not found.'}, status=404, bool=False)

            call_proc('sp_colleges_delete', college_id)

            all_cutoffs = call_proc('sp_cg_college_cutoffs_list', 100000, 0)
            for ct in all_cutoffs:
                if ct.get('college_name') == existing['name']:
                    call_proc('sp_cg_college_cutoffs_delete', ct['id'])

            db.session.commit()
            return jsonify(response={'message': 'College deleted.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"CG DELETE /colleges/{college_id}: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


# ── Cutoffs for a college ─────────────────────────────────────────────────────

@ns.route('/cg/colleges/<string:college_id>/cutoffs')
class AdminCGCutoffList(Resource):

    @jwt_required()
    def post(self, college_id):
        """Add one or many cutoff rows for a college."""
        if not _require_admin():
            return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
        try:
            # ── SP: sp_colleges_get + sp_cg_college_cutoffs_create ────────────
            college = call_proc_one('sp_colleges_get', college_id)
            if not college or college.get('deleted_at'):
                return jsonify(response={'message': 'College not found.'}, status=404, bool=False)

            data = request.get_json() or {}
            rows = data if isinstance(data, list) else [data]
            admin_id = get_jwt_identity()
            added = []
            for ct in rows:
                entry = call_proc_one(
                    'sp_cg_college_cutoffs_create',
                    *_cutoff_sp_args(str(uuid.uuid4()), college, ct), admin_id, admin_id,
                )
                added.append(entry)

            db.session.commit()
            return jsonify(
                response={'message': f'{len(added)} cutoff(s) added.', 'cutoffs': [_cutoff_dict(x) for x in added]},
                status=201, bool=True
            )
        except Exception as e:
            db.session.rollback()
            logger.error(f"CG POST /colleges/{college_id}/cutoffs: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/cg/cutoffs/<string:cutoff_id>')
class AdminCGCutoffDetail(Resource):

    @jwt_required()
    def put(self, cutoff_id):
        if not _require_admin():
            return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
        try:
            # ── SP: sp_cg_college_cutoffs_get + _update (full replace) ───────
            ct = call_proc_one('sp_cg_college_cutoffs_get', cutoff_id)
            if not ct:
                return jsonify(response={'message': 'Cutoff not found.'}, status=404, bool=False)
            data = request.get_json() or {}
            admin_id = get_jwt_identity()

            updated = call_proc_one(
                'sp_cg_college_cutoffs_update',
                *_cutoff_sp_args(cutoff_id, None, data, ct), ct.get('created_by'), admin_id,
            )
            db.session.commit()
            return jsonify(response={'message': 'Cutoff updated.', 'cutoff': _cutoff_dict(updated)}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"CG PUT /cutoffs/{cutoff_id}: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @jwt_required()
    def delete(self, cutoff_id):
        if not _require_admin():
            return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
        try:
            # ── SP: sp_cg_college_cutoffs_get + _delete (hard delete) ────────
            ct = call_proc_one('sp_cg_college_cutoffs_get', cutoff_id)
            if not ct:
                return jsonify(response={'message': 'Cutoff not found.'}, status=404, bool=False)
            call_proc('sp_cg_college_cutoffs_delete', cutoff_id)
            db.session.commit()
            return jsonify(response={'message': 'Cutoff deleted.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"CG DELETE /cutoffs/{cutoff_id}: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


# ── College Predictor ─────────────────────────────────────────────────────────

@ns.route('/cg/predict')
class AdminCGPredict(Resource):

    @jwt_required()
    def get(self):
        """
        Given rank + category + exam_type, returns colleges & branches the student can get.
        Logic: closing_rank >= student_rank (student rank is better than or equal to closing rank)
        """
        if not _require_admin():
            return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
        try:
            args = predict_parser.parse_args()
            rank      = args['rank']
            category  = args['category']
            exam_type = args['exam_type']
            year      = args['year']

            # ── SP: sp_cg_college_cutoffs_list — no rank/category/year filter
            # proc exists, so pull a bounded batch and filter in Python. ─────
            all_cutoffs = call_proc('sp_cg_college_cutoffs_list', 100000, 0)
            cutoffs = [
                ct for ct in all_cutoffs
                if ct.get('exam_type') == exam_type and ct.get('category') == category
                and ct.get('year') == year and (ct.get('closing_rank') or 0) >= rank
            ]
            if args.get('branch_code'):
                cutoffs = [ct for ct in cutoffs if ct.get('branch_code') == args['branch_code']]
            cutoffs.sort(key=lambda ct: ct.get('closing_rank') or 0)

            # ── SP: sp_colleges_list — enrich with college details ────────────
            all_colleges = call_proc('sp_colleges_list', 5000, 0, 0)
            colleges_by_name = {c['name'].lower(): c for c in all_colleges if not c.get('deleted_at')}

            results = []
            seen = set()
            for ct in cutoffs:
                college = colleges_by_name.get((ct.get('college_name') or '').lower())
                key = f"{ct.get('college_name')}|{ct.get('branch_code')}|{ct.get('category')}"
                if key in seen:
                    continue
                seen.add(key)
                entry = _cutoff_dict(ct)
                if college:
                    entry['annual_fees_min'] = college.get('annual_fees_min')
                    entry['annual_fees_max'] = college.get('annual_fees_max')
                    entry['placement_rate']  = college.get('placement_rate')
                    entry['avg_package']     = college.get('avg_package')
                    entry['highest_package'] = college.get('highest_package')
                    entry['naac_grade']      = college.get('naac_grade')
                    entry['nirf_ranking']    = college.get('nirf_ranking')
                    entry['website_url']     = college.get('website_url')
                results.append(entry)

            return jsonify(
                response={'results': results, 'total': len(results)},
                query={'rank': rank, 'category': category, 'exam_type': exam_type, 'year': year},
                status=200, bool=True
            )
        except Exception as e:
            logger.error(f"CG GET /predict: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


# ── College Courses (Branches offered by a college) ───────────────────────────

@ns.route('/cg/colleges/<string:college_id>/courses')
class AdminCGCourseList(Resource):

    @jwt_required()
    def get(self, college_id):
        if not _require_admin():
            return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
        try:
            # ── SP: sp_college_courses_list — no college_id filter on the
            # generic CRUD proc, so pull a bounded batch and filter here. ────
            rows = call_proc('sp_college_courses_list', 100000, 0)
            courses = sorted(
                [c for c in rows if c.get('college_id') == college_id],
                key=lambda c: c.get('course_name') or ''
            )
            return jsonify(response={'courses': [_course_dict(c) for c in courses]}, status=200, bool=True)
        except Exception as e:
            logger.error(f"CG GET /colleges/{college_id}/courses: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @jwt_required()
    def post(self, college_id):
        if not _require_admin():
            return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
        try:
            # ── SP: sp_colleges_get + sp_college_courses_create ───────────────
            college = call_proc_one('sp_colleges_get', college_id)
            if not college:
                return jsonify(response={'message': 'College not found.'}, status=404, bool=False)
            data = request.get_json() or {}
            rows = data if isinstance(data, list) else [data]
            admin_id = get_jwt_identity()
            added = []
            for d in rows:
                c = call_proc_one(
                    'sp_college_courses_create',
                    str(uuid.uuid4()), college_id, d.get('course_name'), d.get('branch_code'),
                    d.get('duration_years', 4), d.get('degree_type', 'UG'), d.get('total_seats'),
                    d.get('annual_fee'), admin_id, admin_id,
                )
                added.append(c)
            db.session.commit()
            return jsonify(response={'message': f'{len(added)} branch(es) added.', 'courses': [_course_dict(c) for c in added]}, status=201, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"CG POST /colleges/{college_id}/courses: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/cg/courses/<string:course_id>')
class AdminCGCourseDetail(Resource):

    @jwt_required()
    def put(self, course_id):
        if not _require_admin():
            return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
        try:
            # ── SP: sp_college_courses_get + _update (full replace) ───────────
            c = call_proc_one('sp_college_courses_get', course_id)
            if not c:
                return jsonify(response={'message': 'Not found.'}, status=404, bool=False)
            d = request.get_json() or {}
            admin_id = get_jwt_identity()

            def val(key):
                return d[key] if key in d else c.get(key)

            updated = call_proc_one(
                'sp_college_courses_update',
                course_id, c.get('college_id'), val('course_name'), val('branch_code'),
                val('duration_years'), val('degree_type'), val('total_seats'), val('annual_fee'),
                c.get('created_by'), admin_id,
            )
            db.session.commit()
            return jsonify(response={'message': 'Updated.', 'course': _course_dict(updated)}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"CG PUT /courses/{course_id}: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @jwt_required()
    def delete(self, course_id):
        if not _require_admin():
            return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
        try:
            # ── SP: sp_college_courses_get + _delete (hard delete) ────────────
            c = call_proc_one('sp_college_courses_get', course_id)
            if not c:
                return jsonify(response={'message': 'Not found.'}, status=404, bool=False)
            call_proc('sp_college_courses_delete', course_id)
            db.session.commit()
            return jsonify(response={'message': 'Deleted.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"CG DELETE /courses/{course_id}: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


# ── College Placement Insights ────────────────────────────────────────────────

@ns.route('/cg/colleges/<string:college_id>/placements')
class AdminCGPlacementList(Resource):

    @jwt_required()
    def post(self, college_id):
        if not _require_admin():
            return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
        try:
            # ── SP: sp_colleges_get + sp_college_placement_insights_create ───
            college = call_proc_one('sp_colleges_get', college_id)
            if not college:
                return jsonify(response={'message': 'College not found.'}, status=404, bool=False)
            d = request.get_json() or {}
            admin_id = get_jwt_identity()
            p = call_proc_one(
                'sp_college_placement_insights_create',
                str(uuid.uuid4()), college_id, d.get('year', datetime.datetime.utcnow().year),
                d.get('placement_rate'), d.get('avg_package'), d.get('highest_package'),
                d.get('total_students'), d.get('placed_students'), d.get('median_package'),
                json.dumps(d.get('top_recruiters')) if d.get('top_recruiters') is not None else None,
                admin_id, admin_id,
            )
            db.session.commit()
            return jsonify(response={'message': 'Placement record added.', 'placement': _placement_dict(p)}, status=201, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"CG POST /colleges/{college_id}/placements: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/cg/placements/<string:pid>')
class AdminCGPlacementDetail(Resource):

    @jwt_required()
    def put(self, pid):
        if not _require_admin():
            return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
        try:
            # ── SP: sp_college_placement_insights_get + _update (full replace) ─
            p = call_proc_one('sp_college_placement_insights_get', pid)
            if not p:
                return jsonify(response={'message': 'Not found.'}, status=404, bool=False)
            d = request.get_json() or {}
            admin_id = get_jwt_identity()

            def val(key):
                return d[key] if key in d else p.get(key)

            top_recruiters = json.dumps(d['top_recruiters']) if 'top_recruiters' in d else p.get('top_recruiters')

            updated = call_proc_one(
                'sp_college_placement_insights_update',
                pid, p.get('college_id'), val('year'), val('placement_rate'), val('avg_package'),
                val('highest_package'), val('total_students'), val('placed_students'),
                val('median_package'), top_recruiters, p.get('created_by'), admin_id,
            )
            db.session.commit()
            return jsonify(response={'message': 'Updated.', 'placement': _placement_dict(updated)}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"CG PUT /placements/{pid}: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @jwt_required()
    def delete(self, pid):
        if not _require_admin():
            return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
        try:
            # ── SP: sp_college_placement_insights_get + _delete (hard delete) ─
            p = call_proc_one('sp_college_placement_insights_get', pid)
            if not p:
                return jsonify(response={'message': 'Not found.'}, status=404, bool=False)
            call_proc('sp_college_placement_insights_delete', pid)
            db.session.commit()
            return jsonify(response={'message': 'Deleted.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"CG DELETE /placements/{pid}: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)
