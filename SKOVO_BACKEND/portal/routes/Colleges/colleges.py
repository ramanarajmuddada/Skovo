import json
import math
import re
from portal.helpers.error_capture import capture_error
from flask import jsonify
from flask_restx import Resource, reqparse
from flask_jwt_extended import jwt_required, get_jwt_identity
from portal.helpers.sp import call_proc, call_proc_one
from portal.helpers import profile_cache
from portal.models import db
from . import ns, logger

# Below this many cutoff rows for an exam, the prediction is labelled `low` and
# the UI drops the confident Safe/Target/Reach presentation. A wrong prediction
# is the one mistake this product cannot take back — a student screenshots it
# and plans around it — so the honest failure mode is to look unsure.
MIN_ROWS_FOR_CONFIDENCE = 50

predict_parser = reqparse.RequestParser()
predict_parser.add_argument('exam',     type=str, location='json', required=True, help='Exam is required.')
predict_parser.add_argument('rank',     type=int, location='json', required=True, help='Your rank is required.')
predict_parser.add_argument('category', type=str, location='json', required=False)
predict_parser.add_argument('state',    type=str, location='json', required=False)

list_parser = reqparse.RequestParser()
list_parser.add_argument('search',   type=str,  location='args', required=False)
list_parser.add_argument('type',     type=str,  location='args', required=False, help='government|private|deemed|autonomous')
list_parser.add_argument('state',    type=str,  location='args', required=False)
list_parser.add_argument('show_all', type=int,  location='args', default=0, help='1 = skip personalised filter')
list_parser.add_argument('page',     type=int,  location='args', default=1)
list_parser.add_argument('per_page', type=int,  location='args', default=10)

# Degree codes below are *canonical keys* — see _degree_key(). Write them the way
# the `degree_type` master does ('btech', not 'b.tech'), or they match nothing.
#
# UG-focused degree types — relevant to school + 12th students as future targets
_UG_DEGREES = {'btech', 'be', 'bca', 'bsc', 'bba', 'bcom', 'ba', 'bpharma',
               'mbbs', 'bds', 'llb', 'diploma', 'pharmd'}
# PG-focused — relevant to UG students planning postgrad
_PG_DEGREES = {'mba', 'mca', 'mtech', 'msc', 'ma', 'mpharma', 'md', 'ms', 'mdms'}

# One master option can cover several course codes, or spell one differently.
_DEGREE_ALIASES = {
    'mdms':   {'md', 'ms'},     # 'MD / MS' is a single master option, two course codes
    'bpharm': {'bpharma'},
    'mpharm': {'mpharma'},
    'be':     {'btech'},        # B.E. and B.Tech are interchangeable for college matching
}


def _degree_key(value):
    """Canonical degree key — 'B.Tech', 'b.tech' and 'btech' all collapse to 'btech'.

    `college_courses.degree_type` and the `degree_type` master both store compact
    lowercase codes ('btech', 'bpharma'); profile rows can hold the label instead
    ('B.Tech'). Comparing those two spellings directly matched nothing, so every
    B.Tech student — the largest group on the platform — saw an empty Colleges
    list. Strip to letters and both spellings land on the same key."""
    return re.sub(r'[^a-z]', '', (value or '').lower())


def _degree_variants(value):
    """Every course-side key that a student's degree should match."""
    key = _degree_key(value)
    return ({key} | _DEGREE_ALIASES.get(key, set())) if key else set()

_SCHOOL_LEVELS    = {'10th', '11th_12th', '12th'}
_COLLEGE_LEVELS   = {'ug', 'diploma'}
_GRAD_LEVELS      = {'graduated'}


def _as_list(v):
    if isinstance(v, str):
        try:
            return json.loads(v)
        except Exception:
            return []
    return v or []


def _get_student_profile(user_id):
    """The three profile fields the college screens care about, or None.

    Cached for a few seconds (portal.helpers.profile_cache) because every page
    of the browse list re-asks for it and the answer only changes when the
    student edits their profile, which invalidates it. See that module for the
    staleness this can and cannot produce.
    """
    def _load():
        try:
            # ── SP: sp_profile_get_by_user ──────────────────────────────────
            p = call_proc_one('sp_profile_get_by_user', user_id)
            if not p:
                return None
            return {
                'level':       (p.get('education_level') or '').lower().strip(),
                'degree_type': (p.get('degree_type') or '').strip(),
                'branch':      (p.get('branch') or '').strip(),
            }
        except Exception:
            return None

    return profile_cache.get_or_load(user_id, _load)


def _like_arg(value):
    """Escape a user string so SQL LIKE treats it as a plain substring.

    The Python this replaced did `needle in haystack`, so a student searching
    for "100%" or "IIT_M" expected those characters to mean themselves. Left
    unescaped they would be LIKE wildcards and quietly match far too much.
    """
    if not value:
        return ''
    out = value
    for ch in ('\\', '%', '_'):
        out = out.replace(ch, '\\' + ch)
    return out


def _degree_filter_csv(mode, profile):
    """Course-side degree keys this student's list should be limited to.

    Empty string = no personalised filter, which is what the old code did by
    falling through every branch: a `college` student whose profile names no
    degree saw the unfiltered list, not an empty one.

    The expansion (aliases, canonical keys) stays in Python — the SQL only tests
    membership with FIND_IN_SET, so there is still exactly one copy of the rule
    that B.E. counts as B.Tech.
    """
    if mode == 'school':
        keys = _UG_DEGREES
    elif mode == 'grad':
        keys = _PG_DEGREES
    elif mode == 'college':
        keys = _degree_variants((profile or {}).get('degree_type') or '')
    else:
        keys = set()
    return ','.join(sorted(keys))


def _build_student_context(profile):
    level = (profile or {}).get('level', '')
    if not level:
        return {'level': None, 'banner': None, 'banner_type': None, 'mode': 'all'}

    if level in {'10th', '11th_12th'}:
        return {
            'level': level,
            'banner': "You're in school — these colleges are your future destination! Explore now so you know what to aim for.",
            'banner_type': 'info',
            'mode': 'school',
        }
    if level == '12th':
        return {
            'level': level,
            'banner': "You've finished 12th — time to pick your college! Browse and shortlist your favourites.",
            'banner_type': 'success',
            'mode': 'school',
        }
    if level in _COLLEGE_LEVELS:
        degree = profile.get('degree_type', '')
        branch = profile.get('branch', '')
        hint = f"Showing colleges offering {degree}" + (f" ({branch})" if branch else "") + ". Browse All to see every college."
        return {
            'level': level,
            'banner': hint,
            'banner_type': 'info',
            'mode': 'college',
        }
    if level in _GRAD_LEVELS:
        return {
            'level': level,
            'banner': "Explore PG colleges and MBA programmes for your next step.",
            'banner_type': 'info',
            'mode': 'grad',
        }
    return {'level': level, 'banner': None, 'banner_type': None, 'mode': 'all'}


def _college_summary(c, courses):
    return {
        'id': c['id'],
        'name': c.get('name'),
        'type': c.get('type'),
        'location_city': c.get('location_city'),
        'location_state': c.get('location_state'),
        'nirf_ranking': c.get('nirf_ranking'),
        'naac_grade': c.get('naac_grade'),
        'annual_fees_min': c.get('annual_fees_min'),
        'annual_fees_max': c.get('annual_fees_max'),
        'placement_rate': c.get('placement_rate'),
        'avg_package': c.get('avg_package'),
        'logo_url': c.get('logo_url'),
        'courses': [cc.get('course_name') for cc in courses],
    }


@ns.route('/predict/exams')
class CollegePredictExams(Resource):
    @ns.doc(description='Exams the predictor has cutoff data for — drives the form.')
    @jwt_required()
    def get(self):
        try:
            # ── SP: sp_cutoff_exams ───────────────────────────────────────────
            rows = call_proc('sp_cutoff_exams') or []
            exams = [{
                'exam': r.get('exam_type'),
                'colleges': int(r.get('colleges') or 0),
                'latest_year': r.get('latest_year'),
            } for r in rows]
            return jsonify(response={'exams': exams}, status=200, bool=True)
        except Exception as e:
            logger.error(f"Error in GET /colleges/predict/exams: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id},
                           status=500, bool=False)


@ns.route('/predict')
class CollegePredict(Resource):
    @ns.doc(description=(
        'Predict admissible colleges from a rank, bucketed Safe / Target / Reach.\n\n'
        'Based on last year\'s cutoffs — a prediction, not a guarantee. Returns an '
        'empty list (not an error) when there is no cutoff data for that exam yet.'
    ))
    @jwt_required()
    def post(self):
        try:
            args = predict_parser.parse_args()
            exam = (args.get('exam') or '').strip()
            rank = args.get('rank')
            if not exam:
                return jsonify(response={'message': 'Pick an exam.'}, status=400, bool=False)
            if not rank or rank < 1:
                return jsonify(response={'message': 'Enter a valid rank.'}, status=400, bool=False)

            category = (args.get('category') or '').strip() or None
            state = (args.get('state') or '').strip() or None

            # How much data is actually standing behind this answer. A rank
            # bucketed off six rows must not be presented like one bucketed off
            # a full counselling dataset — this is the one screen where thin
            # data misleads instead of merely looking empty.
            # ── SP: sp_cutoff_coverage ────────────────────────────────────────
            cov = call_proc_one('sp_cutoff_coverage', exam, state) or {}
            rows_total = int(cov.get('rows_total') or 0)
            confidence = ('none' if rows_total == 0
                          else 'low' if rows_total < MIN_ROWS_FOR_CONFIDENCE
                          else 'usable')

            # ── SP: sp_college_predict ────────────────────────────────────────
            rows = call_proc('sp_college_predict', exam, int(rank), category, state, 100) or []

            # ── SP: sp_predictor_usage_log — first use per exam, for the
            # "Use the college predictor" score action (Excel C63). Never
            # allowed to break the prediction itself.
            try:
                call_proc('sp_predictor_usage_log', get_jwt_identity(), exam)
                db.session.commit()
            except Exception as e:
                db.session.rollback()
                logger.warning(f"predictor usage log failed: {e}")

            buckets = {'safe': [], 'target': [], 'reach': []}
            latest_year = None
            for r in rows:
                latest_year = r.get('year') or latest_year
                buckets.get(r.get('bucket'), buckets['target']).append({
                    'college_name': r.get('college_name'),
                    'city': r.get('college_city'),
                    'state': r.get('college_state'),
                    'college_type': r.get('college_type'),
                    'branch_name': r.get('branch_name'),
                    'category': r.get('category'),
                    'opening_rank': r.get('opening_rank'),
                    'closing_rank': r.get('closing_rank'),
                    'bucket': r.get('bucket'),
                })

            total = sum(len(v) for v in buckets.values())
            latest_year = latest_year or cov.get('latest_year')

            if confidence == 'none':
                message = 'No cutoff data for this exam yet — check back soon.'
            elif confidence == 'low':
                message = (
                    f'Early data — we hold only {rows_total} cutoff record'
                    f'{"s" if rows_total != 1 else ""} for this exam so far. '
                    'Treat this as a rough indication, not advice, and confirm on the '
                    'official counselling site.'
                )
            else:
                message = 'A prediction from past cutoffs, not a guarantee. Always confirm officially.'

            return jsonify(response={
                'exam': exam,
                'rank': int(rank),
                'based_on_year': latest_year,
                'total': total,
                'safe': buckets['safe'],
                'target': buckets['target'],
                'reach': buckets['reach'],
                # Lets the UI decide how confident to look, rather than always
                # rendering three tidy buckets.
                'confidence': confidence,
                'coverage': {
                    'rows': rows_total,
                    'colleges': int(cov.get('colleges') or 0),
                    'branches': int(cov.get('branches') or 0),
                    'categories': int(cov.get('categories') or 0),
                    'earliest_year': cov.get('earliest_year'),
                    'latest_year': cov.get('latest_year'),
                    'min_rows_for_confidence': MIN_ROWS_FOR_CONFIDENCE,
                },
                'message': message,
            }, status=200, bool=True)
        except Exception as e:
            logger.error(f"Error in POST /colleges/predict: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id},
                           status=500, bool=False)


@ns.route('/')
class CollegeList(Resource):
    @ns.doc(description='Browse colleges with search, type filter, state filter. Returns student_context for education-level-aware UI.')
    @jwt_required()
    def get(self):
        try:
            user_id = get_jwt_identity()
            args    = list_parser.parse_args()
            profile = _get_student_profile(user_id)
            ctx     = _build_student_context(profile)
            mode    = ctx.get('mode', 'all')
            show_all = bool(args.get('show_all'))

            # `page` and `per_page` are what the SP's LIMIT/OFFSET are built
            # from, so they are clamped here rather than trusted. Nothing sends
            # per_page > 100; the ceiling exists so a crafted query cannot ask
            # the database for the whole table in one go.
            page     = max(1, args['page'] or 1)
            per_page = min(max(1, args['per_page'] or 10), 100)

            # ── Personalised filtering (skipped when show_all=1 or no profile) ──
            # Empty CSV = no degree filter, which is what the old branch chain
            # did when it fell through: a `college` student with no degree on
            # their profile sees the unfiltered list, not an empty one.
            degree_csv = ''
            if not show_all and profile and mode != 'all':
                degree_csv = _degree_filter_csv(mode, profile)

            # ── SP: sp_colleges_browse ──────────────────────────────────────
            # One query does the search, the type/state filters, the degree
            # match, the ordering and the page slice, and returns the twelve
            # columns this table renders. It replaces sp_colleges_list(5000) +
            # sp_college_courses_list(50000), which shipped every college row
            # (blobs and all) and every course row to Python on every request.
            # `total_count` rides on each row — see the procedure.
            rows = call_proc(
                'sp_colleges_browse',
                _like_arg(args.get('search')),
                (args.get('type') or ''),
                _like_arg(args.get('state')),
                degree_csv,
                per_page,
                (page - 1) * per_page,
            )

            total = int(rows[0]['total_count']) if rows else 0
            pages = math.ceil(total / per_page) if per_page else 1

            # ── SP: sp_college_courses_by_ids — this page's colleges only ────
            courses_by_college = {}
            if rows:
                page_ids = [r['id'] for r in rows]
                for cc in call_proc('sp_college_courses_by_ids', json.dumps(page_ids)) or []:
                    bucket = courses_by_college.setdefault(cc['college_id'], [])
                    if len(bucket) < 5:          # the summary shows at most five
                        bucket.append(cc)

            result = [_college_summary(c, courses_by_college.get(c['id'], [])) for c in rows]

            return jsonify(
                response={
                    'colleges': result,
                    'student_context': ctx,
                    'is_personalised': (not show_all and mode != 'all'),
                },
                pagination={
                    'total': total,
                    'page': page,
                    'pages': pages,
                    'per_page': per_page,
                },
                status=200, bool=True
            )
        except Exception as e:
            logger.error(f"Error in GET /colleges: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


# ══════════════════════════════════════════════════════════════════════════
# Scholarship matching — the Skovo Pro half of a college profile
# ══════════════════════════════════════════════════════════════════════════
# A college page that lists fees without listing the money available to pay
# them is only half the decision. `cg_scholarships` already holds the data
# (admin-managed); this matches it to the college in front of the student and
# to the student's own reservation category, and hands the result to Pro
# members only. Free members get the count, so the number is a real reason to
# upgrade rather than a wall with nothing behind it.
#
# Matching is deliberately generous — a state scheme shows on colleges in that
# state, everything else is treated as all-India. Under-matching here loses a
# student money; over-matching costs them one click on a scheme they skim past.

SCHOLARSHIP_PREVIEW = 2      # how many a free member sees before the lock


def _norm(v):
    return (v or '').strip().lower()


def _scholarship_matches(college, category=None):
    """Active scholarships plausibly open to a student at this college."""
    try:
        # ── SP: sp_cg_scholarships_list(limit, offset, only_active) ──────────
        rows = call_proc('sp_cg_scholarships_list', 5000, 0, 1) or []
    except Exception as e:
        logger.warning(f"scholarship match skipped: {e}")
        return []

    state = _norm(college.get('location_state'))
    cat = _norm(category)
    out = []
    for r in rows:
        for_state = _norm(r.get('for_state'))
        # No state on the scheme = all-India. A state scheme only shows on
        # colleges in that state.
        if for_state and for_state not in ('all', 'all india', 'india') and for_state != state:
            continue
        # Categories are advisory: a scheme that names categories and does not
        # name the student's is dropped, but a scheme that names none is kept.
        cats = [_norm(c) for c in _as_list(r.get('eligible_categories'))]
        if cat and cats and cat not in cats:
            continue
        out.append(r)

    # Biggest benefit first, then named schemes — a ₹0 row is usually a stipend
    # with no amount recorded, not a worthless scheme, so it sorts last but stays.
    out.sort(key=lambda r: (r.get('benefit_amount') or 0), reverse=True)
    return out


def _scholarship_dict(r):
    return {
        'id': r.get('id'),
        'name': r.get('name'),
        'provider': r.get('provider'),
        'scheme_type': r.get('scheme_type'),
        'mode': r.get('scholarship_mode'),
        'for_state': r.get('for_state'),
        'benefit_type': r.get('benefit_type'),
        'benefit_amount': r.get('benefit_amount'),
        'income_limit': r.get('income_limit'),
        'eligibility_criteria': r.get('eligibility_criteria'),
        'eligible_categories': _as_list(r.get('eligible_categories')),
        'required_documents': _as_list(r.get('required_documents')),
        'application_url': r.get('application_url'),
        'application_deadline_info': r.get('application_deadline_info'),
        'notification_pdf_url': r.get('notification_pdf_url'),
    }


def _student_category(user_id):
    """Reservation category from the student's goals — drives which schemes match."""
    try:
        # ── SP: sp_student_goals_get ────────────────────────────────────────
        g = call_proc_one('sp_student_goals_get', user_id) or {}
        return g.get('reservation_category')
    except Exception:
        return None


@ns.route('/<string:college_id>')
class CollegeDetail(Resource):
    @ns.doc(description='Get full college profile including courses and placement insights.')
    @jwt_required()
    def get(self, college_id):
        try:
            # ── SP: sp_colleges_get ──────────────────────────────────────────────
            c = call_proc_one('sp_colleges_get', college_id)
            if not c or not c.get('is_active'):
                return jsonify(response={'message': 'College not found.'}, status=404, bool=False)

            # ── SP: sp_college_courses_list, sp_college_placement_insights_list —
            # no by-college-id filter on the generic CRUD procs, so pull bounded
            # batches and filter in Python. ────────────────────────────────────
            all_courses = call_proc('sp_college_courses_list', 50000, 0)
            courses = [cc for cc in all_courses if cc.get('college_id') == college_id]

            # Score signal: viewing a college in detail (0 points by spec, capped
            # daily — it exists to keep the activity clock alive, not to score).
            from portal.models import db
            from portal.helpers import score
            score.award(get_jwt_identity(), score.COLLEGE_VIEWED, ref_id=college_id)
            db.session.commit()

            # ── Skovo Pro: scholarships matched to this college ──────────────
            from portal.routes.Subscription.subscription import is_pro
            _uid = get_jwt_identity()
            pro = is_pro(_uid)
            matches = _scholarship_matches(c, _student_category(_uid))
            # Free members see the first couple in full. Two is enough to prove
            # the data is real and specific to this college; hiding all of them
            # reads as an empty section, which is worse than a locked one.
            shown = matches if pro else matches[:SCHOLARSHIP_PREVIEW]
            scholarships = {
                'is_pro': pro,
                'total': len(matches),
                'locked': (not pro) and len(matches) > len(shown),
                'hidden': 0 if pro else max(0, len(matches) - len(shown)),
                'items': [_scholarship_dict(r) for r in shown],
                'upgrade': None if pro else {
                    'headline': 'See every scholarship you qualify for',
                    'benefit': 'Skovo Pro matches central, state and private schemes to '
                               'your category on every college you open.',
                    'cta_label': 'See what Pro includes',
                    'cta_route': '/skovo-pro',
                },
            }

            all_insights = call_proc('sp_college_placement_insights_list', 50000, 0)
            insights = [pi for pi in all_insights if pi.get('college_id') == college_id]
            insights.sort(key=lambda pi: pi.get('year') or 0, reverse=True)
            insights = insights[:5]

            return jsonify(
                response={
                    'id': c['id'],
                    'name': c.get('name'),
                    'type': c.get('type'),
                    'location_city': c.get('location_city'),
                    'location_state': c.get('location_state'),
                    'nirf_ranking': c.get('nirf_ranking'),
                    'naac_grade': c.get('naac_grade'),
                    'annual_fees_min': c.get('annual_fees_min'),
                    'annual_fees_max': c.get('annual_fees_max'),
                    'placement_rate': c.get('placement_rate'),
                    'avg_package': c.get('avg_package'),
                    'highest_package': c.get('highest_package'),
                    'website_url': c.get('website_url'),
                    'logo_url': c.get('logo_url'),
                    'banner_url': c.get('banner_url'),
                    'about': c.get('about'),
                    'accreditation': c.get('accreditation'),
                    'established_year': c.get('established_year'),
                    'total_students': c.get('total_students'),
                    'facilities': _as_list(c.get('facilities')),
                    'top_recruiters': _as_list(c.get('top_recruiters')),
                    'achievements': _as_list(c.get('achievements')),
                    'entrance_exams_accepted': _as_list(c.get('entrance_exams_accepted')),
                    'hostel_fee': c.get('hostel_fee'),
                    'courses': [
                        {'id': cc['id'], 'name': cc.get('course_name'), 'duration': cc.get('duration_years'), 'degree': cc.get('degree_type')}
                        for cc in courses
                    ],
                    'scholarships': scholarships,
                    'placement_insights': [
                        {
                            'year': pi.get('year'),
                            'placement_rate': pi.get('placement_rate'),
                            'avg_package': pi.get('avg_package'),
                            'highest_package': pi.get('highest_package'),
                        }
                        for pi in insights
                    ],
                },
                status=200, bool=True
            )
        except Exception as e:
            logger.error(f"Error in GET /colleges/{college_id}: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


# ══════════════════════════════════════════════════════════════════════════
# Saved colleges — free tier keeps 3, Skovo Pro unlimited (v1 §4.1)
# ══════════════════════════════════════════════════════════════════════════

# Default only. Live gates read free_limit('saved_colleges') so Admin can change N.
from portal.helpers.pro_limits import free_limit, upgrade_payload
FREE_SAVED_COLLEGES = 3
PRO_COMPARE_LIMIT = 10


@ns.route('/saved')
class SavedColleges(Resource):
    @ns.doc(description='The student\'s saved comparison list, with the free-tier allowance.')
    @jwt_required()
    def get(self):
        try:
            user_id = get_jwt_identity()
            from portal.routes.Subscription.subscription import is_pro
            pro = is_pro(user_id)
            cap = free_limit('saved_colleges')
            # ── SP: sp_saved_colleges_list ───────────────────────────────────
            rows = call_proc('sp_saved_colleges_list', user_id) or []
            used = len(rows)
            return jsonify(response={
                'colleges': [_college_summary(c, []) for c in rows],
                'total': used,
                'is_pro': pro,
                'limit': None if pro else cap,
                'remaining': None if pro else max(0, cap - used),
                'compare_limit': PRO_COMPARE_LIMIT if pro else cap,
            }, status=200, bool=True)
        except Exception as e:
            logger.error(f"Error in GET /colleges/saved: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/<string:college_id>/save')
class SavedCollegeItem(Resource):
    @ns.doc(description='Save a college to the comparison list. Free plan keeps 3.')
    @jwt_required()
    def post(self, college_id):
        try:
            import uuid
            from portal.models import db
            user_id = get_jwt_identity()

            if not call_proc_one('sp_colleges_get', college_id):
                return jsonify(response={'message': 'College not found.'}, status=404, bool=False)

            # ── Free tier: 3-college comparison list ─────────────────────────
            from portal.routes.Subscription.subscription import is_pro
            if not is_pro(user_id):
                cap = free_limit('saved_colleges')
                used = (call_proc_one('sp_saved_colleges_count', user_id) or {}).get('total', 0) or 0
                # cap None = Unlimited; skip the gate rather than compare to it.
                if cap is not None and int(used) >= cap:
                    return jsonify(response=upgrade_payload('colleges', used=int(used), limit=cap),
                                   status=403, bool=False)

            # ── SP: sp_saved_colleges_add ────────────────────────────────────
            res = call_proc_one('sp_saved_colleges_add', str(uuid.uuid4()), user_id, college_id, None) or {}
            db.session.commit()

            # Score signal: saving a college (0 points by spec, but it keeps the
            # activity clock fresh and is capped at 10 lifetime).
            if res.get('result') == 'saved':
                from portal.helpers import score
                score.award(user_id, score.COLLEGE_SAVED, ref_id=college_id)
                db.session.commit()

            return jsonify(response={
                'message': 'Saved to your list.' if res.get('result') == 'saved' else 'Already saved.',
                'is_saved': True,
            }, status=200, bool=True)
        except Exception as e:
            from portal.models import db
            db.session.rollback()
            logger.error(f"Error in POST /colleges/{college_id}/save: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @ns.doc(description='Remove a college from the comparison list.')
    @jwt_required()
    def delete(self, college_id):
        try:
            from portal.models import db
            user_id = get_jwt_identity()
            # ── SP: sp_saved_colleges_remove ─────────────────────────────────
            call_proc_one('sp_saved_colleges_remove', user_id, college_id)
            db.session.commit()
            return jsonify(response={'message': 'Removed from your list.', 'is_saved': False},
                           status=200, bool=True)
        except Exception as e:
            from portal.models import db
            db.session.rollback()
            logger.error(f"Error in DELETE /colleges/{college_id}/save: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)
