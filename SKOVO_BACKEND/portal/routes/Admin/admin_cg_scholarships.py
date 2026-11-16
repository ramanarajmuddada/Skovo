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


# order matches sp_cg_scholarships_create/_update after (id, name)
FIELDS = [
    ('provider', None), ('scheme_type', None), ('scholarship_mode', None), ('notification_pdf_url', None),
    ('for_state', None), ('eligible_categories', 'json'), ('eligible_courses', 'json'),
    ('eligible_qualifications', 'json'), ('income_limit', _int), ('benefit_type', None),
    ('benefit_amount', _int), ('eligibility_criteria', None), ('required_documents', 'json'),
    ('application_url', None), ('application_deadline_info', None), ('contact_info', None), ('is_active', 'bool'),
]


def _build_args(sid, name, d, existing=None):
    existing = existing or {}
    args = [sid, name]
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


def _dict(s):
    if not s:
        return None
    created_at = s.get('created_at')
    return {
        'id': s.get('id'), 'name': s.get('name'), 'provider': s.get('provider'),
        'scheme_type': s.get('scheme_type'), 'scholarship_mode': s.get('scholarship_mode'), 'for_state': s.get('for_state'),
        'eligible_categories': _as_list(s.get('eligible_categories')), 'eligible_courses': _as_list(s.get('eligible_courses')),
        'eligible_qualifications': _as_list(s.get('eligible_qualifications')), 'income_limit': s.get('income_limit'),
        'benefit_type': s.get('benefit_type'), 'benefit_amount': s.get('benefit_amount'),
        'eligibility_criteria': s.get('eligibility_criteria'), 'required_documents': _as_list(s.get('required_documents')),
        'application_url': s.get('application_url'), 'application_deadline_info': s.get('application_deadline_info'),
        'notification_pdf_url': s.get('notification_pdf_url'),
        'contact_info': s.get('contact_info'), 'is_active': bool(s.get('is_active')),
        'created_at': serialize_datetime(created_at) if created_at else None,
    }


@ns.route('/cg/scholarships')
class AdminCGScholarshipList(Resource):
    @jwt_required()
    def get(self):
        if not _require_admin():
            return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
        try:
            search = request.args.get('search', '')
            # ── SP: sp_cg_scholarships_list — no search filter on the generic
            # CRUD proc, so pull a bounded batch and filter here. ────────────
            rows = call_proc('sp_cg_scholarships_list', 2000, 0, 0)
            if search:
                s_lower = search.lower()
                rows = [s for s in rows if s_lower in (s.get('name') or '').lower()]
            rows.sort(key=lambda s: s.get('name') or '')
            return jsonify(response={'scholarships': [_dict(s) for s in rows]}, status=200, bool=True)
        except Exception as e:
            logger.error(f"CG GET /scholarships: {e}")
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
            # ── SP: sp_cg_scholarships_create ─────────────────────────────────
            sid = str(uuid.uuid4())
            args = _build_args(sid, d['name'], d) + [admin_id, admin_id]
            s = call_proc_one('sp_cg_scholarships_create', *args)
            db.session.commit()
            return jsonify(response={'message': 'Scholarship created.', 'scholarship': _dict(s)}, status=201, bool=True)
        except Exception as e:
            db.session.rollback(); logger.error(f"CG POST /scholarships: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/cg/scholarships/<string:sid>')
class AdminCGScholarshipDetail(Resource):
    @jwt_required()
    def put(self, sid):
        if not _require_admin():
            return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
        try:
            # ── SP: sp_cg_scholarships_get + _update (full replace) ───────────
            existing = call_proc_one('sp_cg_scholarships_get', sid)
            if not existing:
                return jsonify(response={'message': 'Not found.'}, status=404, bool=False)
            d = request.get_json() or {}

            admin_id = get_jwt_identity()
            name = d['name'] if 'name' in d else existing['name']
            args = _build_args(sid, name, d, existing) + [existing.get('created_by'), admin_id]
            s = call_proc_one('sp_cg_scholarships_update', *args)
            db.session.commit()
            return jsonify(response={'message': 'Updated.', 'scholarship': _dict(s)}, status=200, bool=True)
        except Exception as e:
            db.session.rollback(); logger.error(f"CG PUT /scholarships/{sid}: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @jwt_required()
    def delete(self, sid):
        if not _require_admin():
            return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
        try:
            # ── SP: sp_cg_scholarships_get + _delete (hard delete) ─────────────
            existing = call_proc_one('sp_cg_scholarships_get', sid)
            if not existing:
                return jsonify(response={'message': 'Not found.'}, status=404, bool=False)
            call_proc('sp_cg_scholarships_delete', sid)
            db.session.commit()
            return jsonify(response={'message': 'Deleted.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback(); logger.error(f"CG DELETE /scholarships/{sid}: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)
