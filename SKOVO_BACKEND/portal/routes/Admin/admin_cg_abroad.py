from portal.helpers.error_capture import capture_error
from portal.helpers.helpers import serialize_datetime
import json
import uuid
from datetime import date
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


def _float(v):
    try:
        return float(v) if v not in (None, '', 'null') else None
    except (ValueError, TypeError):
        return None


def _as_list(v):
    if isinstance(v, str):
        try:
            return json.loads(v)
        except Exception:
            return None
    return v


# (field, caster) in the exact order sp_cg_abroad_programs_create/_update expect,
# after `id` and before created_by/updated_by. caster=None means pass through as-is;
# 'json' means json.dumps() a fresh value from the request body.
FIELDS = [
    ('country', None), ('university_name', None), ('program_type', None), ('intake_season', None),
    ('required_exams', 'json'), ('min_gre_score', _int), ('min_ielts_score', _float),
    ('min_toefl_score', _int), ('min_gpa', _float), ('tuition_per_year_usd', _int),
    ('living_cost_per_year_usd', _int), ('scholarship_available', 'bool'), ('scholarship_info', None),
    ('popular_scholarships', 'json'), ('duration_years', _float), ('language_of_instruction', None),
    ('visa_type', None), ('job_opportunities', None), ('pr_opportunities', None),
    ('avg_salary_after_ms_usd', _int), ('visa_guidance', None), ('application_process', None),
    ('application_deadline', 'date'), ('best_for_branches', 'json'), ('is_active', 'bool'),
]


def _build_args(pid, d, existing=None):
    existing = existing or {}
    args = [pid]
    for field, caster in FIELDS:
        if field in d:
            v = d[field]
            if caster == 'json':
                v = json.dumps(v) if v is not None else None
            elif caster == 'bool':
                v = 1 if v else 0
            elif caster == 'date':
                v = date.fromisoformat(v) if v else None
            elif caster:
                v = caster(v)
            args.append(v)
        else:
            args.append(existing.get(field))
    return args


def _dict(a):
    if not a:
        return None
    deadline, created_at = a.get('application_deadline'), a.get('created_at')
    return {
        'id': a.get('id'), 'country': a.get('country'), 'university_name': a.get('university_name'),
        'program_type': a.get('program_type'), 'intake_season': a.get('intake_season'),
        'required_exams': _as_list(a.get('required_exams')),
        'min_gre_score': a.get('min_gre_score'), 'min_ielts_score': a.get('min_ielts_score'),
        'min_toefl_score': a.get('min_toefl_score'), 'min_gpa': a.get('min_gpa'),
        'tuition_per_year_usd': a.get('tuition_per_year_usd'), 'living_cost_per_year_usd': a.get('living_cost_per_year_usd'),
        'scholarship_available': bool(a.get('scholarship_available')), 'scholarship_info': a.get('scholarship_info'),
        'popular_scholarships': _as_list(a.get('popular_scholarships')), 'duration_years': a.get('duration_years'),
        'language_of_instruction': a.get('language_of_instruction'), 'visa_type': a.get('visa_type'),
        'job_opportunities': a.get('job_opportunities'), 'pr_opportunities': a.get('pr_opportunities'),
        'avg_salary_after_ms_usd': a.get('avg_salary_after_ms_usd'),
        'visa_guidance': a.get('visa_guidance'), 'application_process': a.get('application_process'),
        'application_deadline': serialize_datetime(deadline) if deadline else None,
        'best_for_branches': _as_list(a.get('best_for_branches')), 'is_active': bool(a.get('is_active')),
        'created_at': serialize_datetime(created_at) if created_at else None,
    }


@ns.route('/cg/abroad')
class AdminCGAbroadList(Resource):
    @jwt_required()
    def get(self):
        if not _require_admin():
            return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
        try:
            country = request.args.get('country', '')
            # ── SP: sp_cg_abroad_programs_list — no country filter on the
            # generic CRUD proc, so pull a bounded batch and filter here. ────
            rows = call_proc('sp_cg_abroad_programs_list', 5000, 0, 0)
            if country:
                c = country.lower()
                rows = [a for a in rows if c in (a.get('country') or '').lower()]
            rows.sort(key=lambda a: (a.get('country') or '', a.get('university_name') or ''))
            return jsonify(response={'programs': [_dict(a) for a in rows]}, status=200, bool=True)
        except Exception as e:
            logger.error(f"CG GET /abroad: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @jwt_required()
    def post(self):
        if not _require_admin():
            return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
        try:
            d = request.get_json() or {}
            if not d.get('country'):
                return jsonify(response={'message': 'Country is required.'}, status=400, bool=False)
            d.setdefault('scholarship_available', False)
            d.setdefault('is_active', True)

            admin_id = get_jwt_identity()
            # ── SP: sp_cg_abroad_programs_create ─────────────────────────────
            aid = str(uuid.uuid4())
            args = _build_args(aid, d) + [admin_id, admin_id]
            a = call_proc_one('sp_cg_abroad_programs_create', *args)
            db.session.commit()
            return jsonify(response={'message': 'Created.', 'program': _dict(a)}, status=201, bool=True)
        except Exception as e:
            db.session.rollback(); logger.error(f"CG POST /abroad: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/cg/abroad/<string:aid>')
class AdminCGAbroadDetail(Resource):
    @jwt_required()
    def put(self, aid):
        if not _require_admin():
            return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
        try:
            # ── SP: sp_cg_abroad_programs_get + _update (full replace) ───────
            existing = call_proc_one('sp_cg_abroad_programs_get', aid)
            if not existing:
                return jsonify(response={'message': 'Not found.'}, status=404, bool=False)
            d = request.get_json() or {}

            admin_id = get_jwt_identity()
            args = _build_args(aid, d, existing) + [existing.get('created_by'), admin_id]
            a = call_proc_one('sp_cg_abroad_programs_update', *args)
            db.session.commit()
            return jsonify(response={'message': 'Updated.', 'program': _dict(a)}, status=200, bool=True)
        except Exception as e:
            db.session.rollback(); logger.error(f"CG PUT /abroad/{aid}: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @jwt_required()
    def delete(self, aid):
        if not _require_admin():
            return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
        try:
            # ── SP: sp_cg_abroad_programs_get + _delete (hard delete) ────────
            existing = call_proc_one('sp_cg_abroad_programs_get', aid)
            if not existing:
                return jsonify(response={'message': 'Not found.'}, status=404, bool=False)
            call_proc('sp_cg_abroad_programs_delete', aid)
            db.session.commit()
            return jsonify(response={'message': 'Deleted.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback(); logger.error(f"CG DELETE /abroad/{aid}: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)
