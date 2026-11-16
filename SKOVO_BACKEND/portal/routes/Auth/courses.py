"""
Course catalogue lookups — the searchable "what are you studying?" field.

One row carries degree_category / degree / branch, so picking a course fills all
three profile columns at once. The same rows back audience targeting, which is
what stops a cohort and a student from spelling a course differently.
"""
from portal.helpers.error_capture import capture_error
from flask import jsonify
from flask_restx import Resource, reqparse
from portal.helpers.sp import call_proc
from . import ns, logger

course_parser = reqparse.RequestParser()
course_parser.add_argument('q',     type=str, location='args')
course_parser.add_argument('level', type=str, location='args',
                           help='ug | pg | diploma | iti | professional | phd')
course_parser.add_argument('limit', type=int, location='args', default=25)


def _course_dict(c):
    return {
        'id':              c.get('id'),
        'level':           c.get('level'),
        'degree_category': c.get('degree_category'),
        'degree':          c.get('degree'),
        'branch':          c.get('branch') or None,   # '' in the table means "no branch"
        'display_name':    c.get('display_name'),
        'duration_years':  float(c['duration_years']) if c.get('duration_years') is not None else None,
    }


@ns.route('/courses/search')
class CourseSearch(Resource):
    @ns.doc(description='Search the course catalogue: ?q=btech cs&level=ug. '
                        'Empty q returns the top of the list for that level.')
    def get(self):
        try:
            args = course_parser.parse_args()

            # "btech cs" is two requirements, not one substring — split it and
            # let every token have to match. Punctuation is stripped because the
            # indexed text stores both "b.tech" and "btech".
            raw = (args.get('q') or '').lower().replace('.', '').replace('&', ' ')
            tokens = [t for t in raw.split() if t][:5]
            tokens += [None] * (5 - len(tokens))

            # ── SP: sp_course_catalogue_search ───────────────────────────────
            rows = call_proc('sp_course_catalogue_search', *tokens,
                             (args.get('level') or '').strip() or None,
                             args.get('limit') or 25)
            return jsonify(response={'courses': [_course_dict(c) for c in rows]}, status=200, bool=True)
        except Exception as e:
            logger.error(f"GET /auth/courses/search error: {e}")
            return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)},
                           status=500, bool=False)


@ns.route('/courses/facets')
class CourseFacets(Resource):
    @ns.doc(description='Distinct degree categories, degrees and branches across the '
                        'catalogue — the option lists an audience-targeting UI needs.')
    def get(self):
        try:
            args = course_parser.parse_args()
            level = (args.get('level') or '').strip() or None

            # The catalogue is a few hundred rows, so pull it once and derive the
            # facets here rather than adding three more procedures. What matters
            # is that targeting offers exactly the values a profile can hold —
            # a cohort aimed at "CSE" never reaches a student whose profile says
            # "Computer Science (CSE)".
            # ── SP: sp_course_catalogue_list ─────────────────────────────────
            rows = call_proc('sp_course_catalogue_list', level, 2000, 0, 1) or []

            def distinct(field):
                seen = []
                for r in rows:
                    v = (r.get(field) or '').strip()
                    if v and v not in seen:
                        seen.append(v)
                return sorted(seen)

            return jsonify(response={
                'degree_categories': distinct('degree_category'),
                'degrees':           distinct('degree'),
                'branches':          distinct('branch'),
            }, status=200, bool=True)
        except Exception as e:
            logger.error(f"GET /auth/courses/facets error: {e}")
            return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)},
                           status=500, bool=False)


@ns.route('/courses/categories')
class CourseCategories(Resource):
    @ns.doc(description='Degree categories available at a level (?level=pg) — the filter chips.')
    def get(self):
        try:
            args = course_parser.parse_args()
            # ── SP: sp_course_categories_by_level ────────────────────────────
            rows = call_proc('sp_course_categories_by_level', (args.get('level') or '').strip() or None)
            return jsonify(response={'categories': [{
                'degree_category': r.get('degree_category'),
                'course_count':    r.get('course_count'),
            } for r in rows]}, status=200, bool=True)
        except Exception as e:
            logger.error(f"GET /auth/courses/categories error: {e}")
            return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)},
                           status=500, bool=False)
