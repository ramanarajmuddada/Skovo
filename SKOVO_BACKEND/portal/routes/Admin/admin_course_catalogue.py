"""Admin CRUD for `course_catalogue` — the trade / course list students pick from.

Why this exists: the catalogue backs the "What are you studying?" search in
onboarding and the audience targeting an achiever sets on a cohort, and until
now nothing could edit it. The rows came from a migration, so adding a trade
meant a deploy. That is the wrong shape for a list that grows — ITI alone has
trades appearing and being retired by NCVT every year.

Scoped by `level`, so the same screen serves ITI trades, diploma branches, UG
degrees and the rest. The ITI list is the one with a formal shape behind it:

    degree_category  →  Engineering | Non-Engineering
    degree           →  trade category (Electrical, Automobile, …)
    branch           →  trade name
    duration_years   →  NULL where it varies by curriculum
    eligibility      →  entry qualification
    is_active        →  the activate / deactivate switch

The stored procedures already existed (sp_course_catalogue_* in
database/stored_procedures/course_catalogue.sql) — only these routes were
missing. `eligibility` was added to them by
database/migrations/migrate_iti_trades.py.
"""
from portal.helpers.error_capture import capture_error
from portal.helpers.helpers import serialize_datetime
import uuid
from flask import jsonify, request
from flask_restx import Resource, reqparse
from flask_jwt_extended import jwt_required, get_jwt_identity
from portal.models import db
from portal.helpers.sp import call_proc, call_proc_one
from . import ns, logger
from portal.helpers.admin_auth import can, AREA_CONTENT

LEVELS = ('ug', 'pg', 'diploma', 'iti', 'professional', 'phd')

create_parser = reqparse.RequestParser()
create_parser.add_argument('level',           type=str,   location='json', required=True)
create_parser.add_argument('degree_category', type=str,   location='json', required=True)
create_parser.add_argument('degree',          type=str,   location='json', required=True)
create_parser.add_argument('branch',          type=str,   location='json', required=False)
create_parser.add_argument('duration_years',  type=float, location='json', required=False)
create_parser.add_argument('eligibility',     type=str,   location='json', required=False)
create_parser.add_argument('sort_order',      type=int,   location='json', required=False)
create_parser.add_argument('is_active',       type=bool,  location='json', required=False, default=True)


def _course_dict(c):
    if not c:
        return None
    return {
        'id':              c.get('id'),
        'level':           c.get('level'),
        'degree_category': c.get('degree_category'),
        'degree':          c.get('degree'),
        'branch':          c.get('branch') or None,
        'display_name':    c.get('display_name'),
        'duration_years':  float(c['duration_years']) if c.get('duration_years') is not None else None,
        'eligibility':     c.get('eligibility'),
        'sort_order':      c.get('sort_order'),
        'is_active':       bool(c.get('is_active')) if c.get('is_active') is not None else True,
        'created_at':      serialize_datetime(c.get('created_at')) if c.get('created_at') else None,
        'updated_at':      serialize_datetime(c.get('updated_at')) if c.get('updated_at') else None,
    }


def _search_text(degree_category, degree, branch):
    """The words the student-facing token search matches against.

    Rebuilt on every write rather than stored by hand: a trade renamed in the
    admin screen whose search text kept the old spelling is a trade nobody can
    find, and that failure is silent. Punctuation is stripped and appended so
    "Draughtsman (Civil)" answers to "civil" and "R&AC" to "rac".
    """
    parts = [branch or '', degree or '', degree_category or '']
    plain = ' '.join(p for p in parts if p)
    stripped = (plain.replace('.', '').replace('&', ' ')
                     .replace('(', ' ').replace(')', ' ').replace('/', ' '))
    words = f"{plain} {stripped}".lower().replace('(', ' ').replace(')', ' ')
    return ' '.join(dict.fromkeys(words.split()))[:400]


def _display_name(level, degree, branch):
    """ITI reads as "ITI — Welder"; everything else as "B.Tech — CSE"."""
    head = 'ITI' if level == 'iti' else (degree or '')
    return f'{head} — {branch}' if branch else (head or degree or '')


@ns.route('/course-catalogue')
class AdminCourseCatalogueList(Resource):
    @ns.doc(description='Admin: the course/trade catalogue for a level '
                        '(?level=iti). Includes inactive rows so they can be restored.')
    @jwt_required()
    def get(self):
        try:
            if not can(AREA_CONTENT):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)

            level = (request.args.get('level') or '').strip().lower() or None
            if level and level not in LEVELS:
                return jsonify(response={'message': f'Unknown level. Use one of: {", ".join(LEVELS)}.'},
                               status=400, bool=False)

            # ── SP: sp_course_catalogue_list — only_active = 0 so deactivated
            # rows are visible here; the student search passes is_active = 1. ─
            rows = call_proc('sp_course_catalogue_list', level, 5000, 0, 0) or []
            items = [_course_dict(c) for c in rows]

            # Grouping is what makes an ITI list of 36 readable. Derived here so
            # the screen never has to know the Engineering/Non-Engineering rule.
            groups = {}
            for it in items:
                groups.setdefault(it['degree_category'] or '—', {}) \
                      .setdefault(it['degree'] or '—', []).append(it)

            return jsonify(response={
                'courses': items,
                'total': len(items),
                'active': sum(1 for i in items if i['is_active']),
                'levels': list(LEVELS),
                'streams': sorted(groups.keys()),
                'categories': sorted({i['degree'] for i in items if i['degree']}),
            }, status=200, bool=True)
        except Exception as e:
            logger.error(f"Error in GET /admin/course-catalogue: {e}")
            return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)},
                           status=500, bool=False)

    @ns.doc(description='Admin: add a course/trade to the catalogue.')
    @jwt_required()
    def post(self):
        try:
            if not can(AREA_CONTENT):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)

            args = create_parser.parse_args()
            level = (args.get('level') or '').strip().lower()
            if level not in LEVELS:
                return jsonify(response={'message': f'Unknown level. Use one of: {", ".join(LEVELS)}.'},
                               status=400, bool=False)

            category = (args.get('degree_category') or '').strip()
            degree = (args.get('degree') or '').strip()
            branch = (args.get('branch') or '').strip()
            if not category or not degree:
                return jsonify(response={'message': 'Stream and category are both required.'},
                               status=400, bool=False)
            if level == 'iti' and not branch:
                return jsonify(response={'message': 'A trade name is required.'},
                               status=400, bool=False)

            duration = args.get('duration_years')
            if duration is not None and (duration <= 0 or duration > 10):
                return jsonify(response={'message': 'Duration must be between 0 and 10 years. '
                                                    'Leave it empty if it varies by curriculum.'},
                               status=400, bool=False)

            # The unique key is (level, degree, branch), but a duplicate TRADE
            # under a different category would slip past it and put the same
            # trade in the picker twice. Names are compared case-insensitively
            # across the whole level for that reason.
            existing = call_proc('sp_course_catalogue_list', level, 5000, 0, 0) or []
            clash = next((c for c in existing
                          if (c.get('branch') or '').strip().lower() == branch.lower()
                          and branch), None)
            if clash:
                if not clash.get('is_active'):
                    # Almost always someone re-adding a trade that was retired.
                    # Reactivating keeps the id, so profiles pointing at it stay
                    # valid rather than being orphaned by a fresh row.
                    restored = call_proc_one(
                        'sp_course_catalogue_update', clash['id'], None, category, degree,
                        branch, _display_name(level, degree, branch),
                        _search_text(category, degree, branch), duration,
                        args.get('eligibility'), args.get('sort_order'), 1, get_jwt_identity())
                    db.session.commit()
                    logger.info(f"Admin reactivated catalogue row {clash['id']} ({branch})")
                    return jsonify(response={'message': f'"{branch}" was inactive and has been restored.',
                                             'course': _course_dict(restored)}, status=200, bool=True)
                return jsonify(response={'message': f'"{branch}" already exists for this level.'},
                               status=409, bool=False)

            admin_id = get_jwt_identity()
            # ── SP: sp_course_catalogue_create ───────────────────────────────
            course = call_proc_one(
                'sp_course_catalogue_create', str(uuid.uuid4()), level, category, degree,
                branch, _display_name(level, degree, branch),
                _search_text(category, degree, branch), duration,
                args.get('eligibility'), args.get('sort_order'),
                1 if args.get('is_active', True) else 0, admin_id)
            db.session.commit()

            logger.info(f"Admin created catalogue row {(course or {}).get('id')} ({branch or degree})")
            return jsonify(response={'message': f'"{branch or degree}" added.',
                                     'course': _course_dict(course)}, status=201, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in POST /admin/course-catalogue: {e}")
            return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)},
                           status=500, bool=False)


@ns.route('/course-catalogue/<string:course_id>')
class AdminCourseCatalogueDetail(Resource):
    @ns.doc(description='Admin: edit a course/trade, or activate / deactivate it.')
    @jwt_required()
    def put(self, course_id):
        try:
            if not can(AREA_CONTENT):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)

            # ── SP: sp_course_catalogue_get ──────────────────────────────────
            current = call_proc_one('sp_course_catalogue_get', course_id)
            if not current:
                return jsonify(response={'message': 'Course not found.'}, status=404, bool=False)

            d = request.get_json() or {}
            if 'branch' in d and not (d.get('branch') or '').strip() \
                    and (current.get('level') == 'iti'):
                return jsonify(response={'message': 'A trade name cannot be empty.'},
                               status=400, bool=False)

            duration = d.get('duration_years', None)
            if duration is not None and duration != '' and (float(duration) <= 0 or float(duration) > 10):
                return jsonify(response={'message': 'Duration must be between 0 and 10 years.'},
                               status=400, bool=False)

            level = current.get('level')
            category = (d.get('degree_category') or current.get('degree_category') or '').strip()
            degree = (d.get('degree') or current.get('degree') or '').strip()
            branch = (d.get('branch') if 'branch' in d else current.get('branch')) or ''
            branch = branch.strip()

            # display_name and search_text are derived, never taken from the
            # client — see _search_text on why a stale one is invisible damage.
            # ── SP: sp_course_catalogue_update ───────────────────────────────
            updated = call_proc_one(
                'sp_course_catalogue_update', course_id, None, category, degree, branch,
                _display_name(level, degree, branch), _search_text(category, degree, branch),
                None if duration in (None, '') else float(duration),
                d.get('eligibility'), d.get('sort_order'),
                None if 'is_active' not in d else (1 if d['is_active'] else 0),
                get_jwt_identity())
            db.session.commit()

            logger.info(f"Admin updated catalogue row {course_id}")
            return jsonify(response={'message': 'Saved.', 'course': _course_dict(updated)},
                           status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in PUT /admin/course-catalogue/{course_id}: {e}")
            return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)},
                           status=500, bool=False)

    @ns.doc(description='Admin: deactivate a course/trade. It is hidden from students, '
                        'not deleted, so profiles that recorded it stay valid.')
    @jwt_required()
    def delete(self, course_id):
        try:
            if not can(AREA_CONTENT):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)

            current = call_proc_one('sp_course_catalogue_get', course_id)
            if not current:
                return jsonify(response={'message': 'Course not found.'}, status=404, bool=False)

            # ── SP: sp_course_catalogue_delete — sets is_active = 0. A hard
            # delete would orphan every profile that stored this course as text.
            call_proc('sp_course_catalogue_delete', course_id)
            db.session.commit()

            name = current.get('branch') or current.get('degree')
            logger.info(f"Admin deactivated catalogue row {course_id} ({name})")
            return jsonify(response={'message': f'"{name}" deactivated. Students will no longer see it.'},
                           status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in DELETE /admin/course-catalogue/{course_id}: {e}")
            return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)},
                           status=500, bool=False)
