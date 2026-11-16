import json
from portal.helpers.error_capture import capture_error
from portal.helpers.helpers import serialize_datetime
from flask import jsonify
from flask_restx import Resource, reqparse
from flask_jwt_extended import jwt_required
from portal.helpers.sp import call_proc
from . import ns, logger

_page_parser = reqparse.RequestParser()
_page_parser.add_argument('page',     type=int, location='args', default=1)
_page_parser.add_argument('per_page', type=int, location='args', default=12)
_page_parser.add_argument('search',   type=str, location='args', required=False)


def _as_list(v):
    if isinstance(v, str):
        try:
            return json.loads(v)
        except Exception:
            return []
    return v or []


def _fetch_active(proc_name):
    # ── SP: sp_<table>_list — no search/type filters on the generic CRUD
    # procs, so pull a bounded batch and filter/paginate here. ────────────────
    return call_proc(proc_name, 5000, 0, 1)


def _search_filter(items, search, fields):
    if not search or search == 'undefined':
        return items
    s = search.lower()
    return [it for it in items if any(s in (it.get(f) or '').lower() for f in fields)]


def _paginate(items, page, per_page):
    total = len(items)
    pages = (total + per_page - 1) // per_page if per_page else 1
    start = (page - 1) * per_page
    return items[start:start + per_page], total, pages


# ── Entrance Exams ────────────────────────────────────────────────────────────

exam_parser = _page_parser.copy()
exam_parser.add_argument('exam_type', type=str, location='args', required=False)

@ns.route('/entrance-exams')
class CGEntranceExamList(Resource):
    @jwt_required()
    def get(self):
        try:
            args = exam_parser.parse_args()
            items = _fetch_active('sp_cg_entrance_exams_list')

            if args.get('exam_type') and args['exam_type'] != 'undefined':
                items = [e for e in items if e.get('exam_type') == args['exam_type']]
            items = _search_filter(items, args.get('search'), ('exam_name', 'exam_code'))
            items.sort(key=lambda e: e.get('exam_name') or '')

            page_items, total, pages = _paginate(items, args['page'], args['per_page'])
            return jsonify(
                response={'exams': [{
                    'id': e['id'], 'exam_code': e.get('exam_code'), 'exam_name': e.get('exam_name'),
                    'exam_type': e.get('exam_type'), 'for_stream': e.get('for_stream'),
                    'conducting_authority': e.get('conducting_authority'), 'exam_mode': e.get('exam_mode'),
                    'eligibility': e.get('eligibility'), 'exam_pattern': _as_list(e.get('exam_pattern')),
                    'syllabus_highlights': e.get('syllabus_highlights'), 'counseling_info': e.get('counseling_info'),
                    'cutoff_notes': e.get('cutoff_notes'), 'registration_period': e.get('registration_period'),
                    'exam_period': e.get('exam_period'), 'useful_for_states': _as_list(e.get('useful_for_states')),
                    'official_url': e.get('official_url'), 'preparation_tips': e.get('preparation_tips'),
                    'important_books': _as_list(e.get('important_books')),
                } for e in page_items]},
                pagination={'total': total, 'pages': pages, 'page': args['page'], 'per_page': args['per_page']},
                status=200, bool=True
            )
        except Exception as e:
            logger.error(f"GET /cg/entrance-exams: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


# ── Scholarships ──────────────────────────────────────────────────────────────

scholar_parser = _page_parser.copy()
scholar_parser.add_argument('scheme_type', type=str, location='args', required=False)

@ns.route('/scholarships')
class CGScholarshipList(Resource):
    @jwt_required()
    def get(self):
        try:
            args = scholar_parser.parse_args()
            items = _fetch_active('sp_cg_scholarships_list')

            if args.get('scheme_type') and args['scheme_type'] != 'undefined':
                items = [s for s in items if s.get('scheme_type') == args['scheme_type']]
            items = _search_filter(items, args.get('search'), ('name', 'provider'))
            items.sort(key=lambda s: s.get('name') or '')

            page_items, total, pages = _paginate(items, args['page'], args['per_page'])
            return jsonify(
                response={'scholarships': [{
                    'id': s['id'], 'name': s.get('name'), 'provider': s.get('provider'),
                    'scheme_type': s.get('scheme_type'), 'scholarship_mode': s.get('scholarship_mode'),
                    'for_state': s.get('for_state'), 'eligible_categories': _as_list(s.get('eligible_categories')),
                    'eligible_qualifications': _as_list(s.get('eligible_qualifications')),
                    'eligible_courses': _as_list(s.get('eligible_courses')), 'income_limit': s.get('income_limit'),
                    'benefit_type': s.get('benefit_type'), 'benefit_amount': s.get('benefit_amount'),
                    'eligibility_criteria': s.get('eligibility_criteria'),
                    'required_documents': _as_list(s.get('required_documents')),
                    'application_url': s.get('application_url'),
                    'application_deadline_info': s.get('application_deadline_info'),
                } for s in page_items]},
                pagination={'total': total, 'pages': pages, 'page': args['page'], 'per_page': args['per_page']},
                status=200, bool=True
            )
        except Exception as e:
            logger.error(f"GET /cg/scholarships: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


# ── Government Exams ──────────────────────────────────────────────────────────

govt_parser = _page_parser.copy()
govt_parser.add_argument('exam_category', type=str, location='args', required=False)

@ns.route('/govt-exams')
class CGGovtExamList(Resource):
    @jwt_required()
    def get(self):
        try:
            args = govt_parser.parse_args()
            items = _fetch_active('sp_cg_govt_exams_list')

            if args.get('exam_category') and args['exam_category'] != 'undefined':
                items = [g for g in items if g.get('exam_category') == args['exam_category']]
            items = _search_filter(items, args.get('search'), ('name', 'conducting_body'))
            items.sort(key=lambda g: g.get('name') or '')

            page_items, total, pages = _paginate(items, args['page'], args['per_page'])
            return jsonify(
                response={'exams': [{
                    'id': g['id'], 'name': g.get('name'), 'exam_category': g.get('exam_category'),
                    'conducting_body': g.get('conducting_body'), 'for_state': g.get('for_state'),
                    'eligible_qualifications': _as_list(g.get('eligible_qualifications')),
                    'eligible_age_min': g.get('eligible_age_min'), 'eligible_age_max': g.get('eligible_age_max'),
                    'salary_min': g.get('salary_min'), 'salary_max': g.get('salary_max'),
                    'competition_level': g.get('competition_level'),
                    'preparation_timeline_months': g.get('preparation_timeline_months'),
                    'syllabus': _as_list(g.get('syllabus')), 'roadmap': _as_list(g.get('roadmap')),
                    'recommended_books': _as_list(g.get('recommended_books')),
                    'official_website': g.get('official_website'),
                    'notification_url': g.get('notification_url'),
                } for g in page_items]},
                pagination={'total': total, 'pages': pages, 'page': args['page'], 'per_page': args['per_page']},
                status=200, bool=True
            )
        except Exception as e:
            logger.error(f"GET /cg/govt-exams: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


# ── Abroad Programs ───────────────────────────────────────────────────────────

abroad_parser = _page_parser.copy()
abroad_parser.add_argument('country',      type=str, location='args', required=False)
abroad_parser.add_argument('program_type', type=str, location='args', required=False)

@ns.route('/abroad')
class CGAbroadList(Resource):
    @jwt_required()
    def get(self):
        try:
            args = abroad_parser.parse_args()
            items = _fetch_active('sp_cg_abroad_programs_list')

            if args.get('country') and args['country'] != 'undefined':
                items = [a for a in items if a.get('country') == args['country']]
            if args.get('program_type') and args['program_type'] != 'undefined':
                items = [a for a in items if a.get('program_type') == args['program_type']]
            items = _search_filter(items, args.get('search'), ('country', 'university_name'))
            items.sort(key=lambda a: a.get('country') or '')

            page_items, total, pages = _paginate(items, args['page'], args['per_page'])
            return jsonify(
                response={'programs': [{
                    'id': a['id'], 'country': a.get('country'), 'university_name': a.get('university_name'),
                    'program_type': a.get('program_type'), 'intake_season': a.get('intake_season'),
                    'required_exams': _as_list(a.get('required_exams')),
                    'min_gre_score': a.get('min_gre_score'), 'min_ielts_score': a.get('min_ielts_score'),
                    'min_toefl_score': a.get('min_toefl_score'), 'min_gpa': a.get('min_gpa'),
                    'tuition_per_year_usd': a.get('tuition_per_year_usd'),
                    'living_cost_per_year_usd': a.get('living_cost_per_year_usd'),
                    'scholarship_available': a.get('scholarship_available'),
                    'scholarship_info': a.get('scholarship_info'),
                    'popular_scholarships': _as_list(a.get('popular_scholarships')),
                    'visa_guidance': a.get('visa_guidance'),
                    'application_process': a.get('application_process'),
                    'best_for_branches': _as_list(a.get('best_for_branches')),
                    'duration_years': a.get('duration_years'),
                    'job_opportunities': a.get('job_opportunities'),
                    'pr_opportunities': a.get('pr_opportunities'),
                    'avg_salary_after_ms_usd': a.get('avg_salary_after_ms_usd'),
                    'application_deadline': serialize_datetime(a['application_deadline']) if a.get('application_deadline') else None,
                } for a in page_items]},
                pagination={'total': total, 'pages': pages, 'page': args['page'], 'per_page': args['per_page']},
                status=200, bool=True
            )
        except Exception as e:
            logger.error(f"GET /cg/abroad: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


# ── Branches ──────────────────────────────────────────────────────────────────

branch_parser = _page_parser.copy()
branch_parser.add_argument('per_page', type=int, location='args', default=15)
branch_parser.add_argument('category', type=str, location='args', required=False)

@ns.route('/branches')
class CGBranchList(Resource):
    @jwt_required()
    def get(self):
        try:
            args = branch_parser.parse_args()
            items = _fetch_active('sp_cg_branches_list')

            if args.get('category') and args['category'] != 'undefined':
                items = [b for b in items if b.get('category') == args['category']]
            items = _search_filter(items, args.get('search'), ('name', 'code'))
            items.sort(key=lambda b: b.get('name') or '')

            page_items, total, pages = _paginate(items, args['page'], args['per_page'])
            return jsonify(
                response={'branches': [{
                    'id': b['id'], 'code': b.get('code'), 'name': b.get('name'), 'category': b.get('category'),
                    'description': b.get('description'), 'future_scope': b.get('future_scope'),
                    'salary_fresher_min': b.get('salary_fresher_min'), 'salary_fresher_max': b.get('salary_fresher_max'),
                    'salary_5yr_min': b.get('salary_5yr_min'), 'salary_5yr_max': b.get('salary_5yr_max'),
                    'salary_10yr_min': b.get('salary_10yr_min'), 'salary_10yr_max': b.get('salary_10yr_max'),
                    'demand_level': b.get('demand_level'), 'ai_impact': b.get('ai_impact'),
                    'difficulty_level': b.get('difficulty_level'), 'work_life_balance': b.get('work_life_balance'),
                    'coding_required': b.get('coding_required'),
                    'govt_opportunities': b.get('govt_opportunities'),
                    'abroad_opportunities': b.get('abroad_opportunities'),
                    'skills_required': _as_list(b.get('skills_required')),
                    'top_companies': _as_list(b.get('top_companies')), 'related_roles': _as_list(b.get('related_roles')),
                } for b in page_items]},
                pagination={'total': total, 'pages': pages, 'page': args['page'], 'per_page': args['per_page']},
                status=200, bool=True
            )
        except Exception as e:
            logger.error(f"GET /cg/branches: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


# ── Guides & Articles (cg_content) ────────────────────────────────────────────

@ns.route('/content')
class CGContentList(Resource):
    @jwt_required()
    def get(self):
        """Published career-guidance articles/guides for students."""
        try:
            args = _page_parser.parse_args()
            # sp_cg_content_list takes (limit, offset) — NOT the 3-arg
            # _fetch_active signature — so call it directly.
            items = [c for c in call_proc('sp_cg_content_list', 5000, 0) if c.get('is_published')]
            items = _search_filter(items, args.get('search'), ('title', 'summary'))
            items.sort(key=lambda c: str(c.get('published_at') or c.get('created_at') or ''), reverse=True)
            page_items, total, pages = _paginate(items, args['page'], args['per_page'])
            return jsonify(
                response={'content': [{
                    'id': c.get('id'), 'title': c.get('title'), 'slug': c.get('slug'),
                    'content_type': c.get('content_type'), 'summary': c.get('summary'),
                    'tags': _as_list(c.get('tags')), 'thumbnail_url': c.get('thumbnail_url'),
                    'author_name': c.get('author_name'), 'view_count': c.get('view_count') or 0,
                    'published_at': serialize_datetime(c['published_at']) if c.get('published_at') else None,
                } for c in page_items]},
                pagination={'total': total, 'pages': pages, 'page': args['page'], 'per_page': args['per_page']},
                status=200, bool=True
            )
        except Exception as e:
            logger.error(f"GET /cg/content: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/content/<string:content_id>')
class CGContentDetail(Resource):
    @jwt_required()
    def get(self, content_id):
        try:
            from portal.helpers.sp import call_proc_one
            c = call_proc_one('sp_cg_content_get', content_id)
            if not c or not c.get('is_published') or c.get('deleted_at'):
                return jsonify(response={'message': 'Content not found.'}, status=404, bool=False)
            return jsonify(response={
                'id': c.get('id'), 'title': c.get('title'), 'slug': c.get('slug'),
                'content_type': c.get('content_type'), 'summary': c.get('summary'),
                'body': c.get('body'), 'tags': _as_list(c.get('tags')),
                'thumbnail_url': c.get('thumbnail_url'), 'author_name': c.get('author_name'),
                'view_count': c.get('view_count') or 0,
                'published_at': serialize_datetime(c['published_at']) if c.get('published_at') else None,
            }, status=200, bool=True)
        except Exception as e:
            logger.error(f"GET /cg/content/{content_id}: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)
