from portal.helpers.error_capture import capture_error
from portal.helpers.helpers import serialize_datetime
import json
import uuid
from flask import jsonify, request
from flask_restx import Resource
from flask_jwt_extended import jwt_required, get_jwt, get_jwt_identity
from portal.models import db
from portal.helpers.sp import call_proc, call_proc_one
from . import ns, logger
from portal.helpers.admin_auth import can, AREA_CONTENT


def _require_admin():
    """This module lives in the 'content' area — see portal/helpers/admin_auth."""
    return can(AREA_CONTENT)


def _int(v):
    try:
        return int(v) if v not in (None, '', 'null') else None
    except (ValueError, TypeError):
        return None


def _as_list(v):
    if isinstance(v, str):
        try:
            return json.loads(v)
        except Exception:
            return None
    return v


# order matches sp_cg_govt_exams_create/_update after (id, name)
FIELDS = [
    ('exam_category', None), ('conducting_body', None), ('for_state', None),
    ('eligible_qualifications', 'json'), ('eligible_age_min', _int), ('eligible_age_max', _int),
    ('age_relaxation_info', None), ('salary_min', _int), ('salary_max', _int),
    ('job_benefits', None), ('competition_level', None), ('preparation_timeline_months', _int),
    ('syllabus', 'json'), ('roadmap', 'json'), ('recommended_books', 'json'),
    ('notification_url', None), ('official_website', None), ('is_active', 'bool'),
]


def _build_args(gid, name, d, existing=None):
    existing = existing or {}
    args = [gid, name]
    for field, caster in FIELDS:
        if field in d:
            v = d[field]
            if caster == 'json':
                v = json.dumps(v) if v is not None else None
            elif caster == 'bool':
                v = 1 if v else 0
            elif caster:
                v = caster(v)
            args.append(v)
        else:
            args.append(existing.get(field))
    return args


def _dict(g):
    if not g:
        return None
    created_at = g.get('created_at')
    return {
        'id': g.get('id'), 'name': g.get('name'), 'exam_category': g.get('exam_category'),
        'conducting_body': g.get('conducting_body'), 'for_state': g.get('for_state'),
        'eligible_qualifications': _as_list(g.get('eligible_qualifications')),
        'eligible_age_min': g.get('eligible_age_min'), 'eligible_age_max': g.get('eligible_age_max'),
        'age_relaxation_info': g.get('age_relaxation_info'),
        'salary_min': g.get('salary_min'), 'salary_max': g.get('salary_max'), 'job_benefits': g.get('job_benefits'),
        'competition_level': g.get('competition_level'),
        'preparation_timeline_months': g.get('preparation_timeline_months'),
        'syllabus': _as_list(g.get('syllabus')), 'roadmap': _as_list(g.get('roadmap')),
        'recommended_books': _as_list(g.get('recommended_books')),
        'notification_url': g.get('notification_url'), 'official_website': g.get('official_website'),
        'is_active': bool(g.get('is_active')),
        'created_at': serialize_datetime(created_at) if created_at else None,
    }


@ns.route('/cg/govt-exams')
class AdminCGGovtExamList(Resource):
    @jwt_required()
    def get(self):
        if not _require_admin():
            return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
        try:
            category = request.args.get('category', '')
            search   = request.args.get('search', '')
            # ── SP: sp_cg_govt_exams_list — no category/search filters on the
            # generic CRUD proc, so pull a bounded batch and filter here. ────
            rows = call_proc('sp_cg_govt_exams_list', 2000, 0, 0)
            if category:
                rows = [g for g in rows if g.get('exam_category') == category]
            if search:
                s = search.lower()
                rows = [g for g in rows if s in (g.get('name') or '').lower()]
            rows.sort(key=lambda g: g.get('name') or '')
            return jsonify(response={'exams': [_dict(g) for g in rows]}, status=200, bool=True)
        except Exception as e:
            logger.error(f"CG GET /govt-exams: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @jwt_required()
    def post(self):
        if not _require_admin():
            return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
        try:
            d = request.get_json() or {}
            if not d.get('name'):
                return jsonify(response={'message': 'Name is required.'}, status=400, bool=False)

            admin_id = get_jwt_identity()
            # ── SP: sp_cg_govt_exams_create ────────────────────────────────────
            gid = str(uuid.uuid4())
            args = _build_args(gid, d['name'], d) + [admin_id, admin_id]
            g = call_proc_one('sp_cg_govt_exams_create', *args)
            db.session.commit()
            return jsonify(response={'message': 'Created.', 'exam': _dict(g)}, status=201, bool=True)
        except Exception as e:
            db.session.rollback(); logger.error(f"CG POST /govt-exams: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/cg/govt-exams/<string:gid>')
class AdminCGGovtExamDetail(Resource):
    @jwt_required()
    def put(self, gid):
        if not _require_admin():
            return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
        try:
            # ── SP: sp_cg_govt_exams_get + _update (full replace) ──────────────
            existing = call_proc_one('sp_cg_govt_exams_get', gid)
            if not existing:
                return jsonify(response={'message': 'Not found.'}, status=404, bool=False)
            d = request.get_json() or {}

            admin_id = get_jwt_identity()
            name = d['name'] if 'name' in d else existing['name']
            args = _build_args(gid, name, d, existing) + [existing.get('created_by'), admin_id]
            g = call_proc_one('sp_cg_govt_exams_update', *args)
            db.session.commit()
            return jsonify(response={'message': 'Updated.', 'exam': _dict(g)}, status=200, bool=True)
        except Exception as e:
            db.session.rollback(); logger.error(f"CG PUT /govt-exams/{gid}: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @jwt_required()
    def delete(self, gid):
        if not _require_admin():
            return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
        try:
            # ── SP: sp_cg_govt_exams_get + _delete (hard delete) ───────────────
            existing = call_proc_one('sp_cg_govt_exams_get', gid)
            if not existing:
                return jsonify(response={'message': 'Not found.'}, status=404, bool=False)
            call_proc('sp_cg_govt_exams_delete', gid)
            db.session.commit()
            return jsonify(response={'message': 'Deleted.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback(); logger.error(f"CG DELETE /govt-exams/{gid}: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)
