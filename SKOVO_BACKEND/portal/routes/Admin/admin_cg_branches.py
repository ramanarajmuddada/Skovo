from portal.helpers.error_capture import capture_error
from portal.helpers.helpers import serialize_datetime
import json
import uuid
from flask import jsonify, request
from flask_restx import Resource
from flask_jwt_extended import jwt_required, get_jwt, get_jwt_identity
from sqlalchemy.exc import IntegrityError
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


FIELDS = [
    ('category', None), ('description', None), ('future_scope', None),
    ('salary_fresher_min', _int), ('salary_fresher_max', _int),
    ('salary_5yr_min', _int), ('salary_5yr_max', _int),
    ('salary_10yr_min', _int), ('salary_10yr_max', _int),
    ('demand_level', None), ('ai_impact', None), ('difficulty_level', None), ('work_life_balance', None),
    ('coding_required', 'bool'), ('govt_opportunities', 'bool'), ('abroad_opportunities', 'bool'),
    ('skills_required', 'json'), ('top_companies', 'json'), ('related_roles', 'json'),
    ('is_active', 'bool'),
]


def _build_args(bid, code, name, d, existing=None):
    existing = existing or {}
    args = [bid, code, name]
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


def _dict(b):
    if not b:
        return None
    created_at = b.get('created_at')
    return {
        'id': b.get('id'), 'code': b.get('code'), 'name': b.get('name'), 'category': b.get('category'),
        'description': b.get('description'), 'future_scope': b.get('future_scope'),
        'salary_fresher_min': b.get('salary_fresher_min'), 'salary_fresher_max': b.get('salary_fresher_max'),
        'salary_5yr_min': b.get('salary_5yr_min'), 'salary_5yr_max': b.get('salary_5yr_max'),
        'salary_10yr_min': b.get('salary_10yr_min'), 'salary_10yr_max': b.get('salary_10yr_max'),
        'demand_level': b.get('demand_level'), 'ai_impact': b.get('ai_impact'),
        'difficulty_level': b.get('difficulty_level'), 'work_life_balance': b.get('work_life_balance'),
        'coding_required': bool(b.get('coding_required')), 'govt_opportunities': bool(b.get('govt_opportunities')),
        'abroad_opportunities': bool(b.get('abroad_opportunities')),
        'skills_required': _as_list(b.get('skills_required')), 'top_companies': _as_list(b.get('top_companies')),
        'related_roles': _as_list(b.get('related_roles')), 'is_active': bool(b.get('is_active')),
        'created_at': serialize_datetime(created_at) if created_at else None,
    }


@ns.route('/cg/branches')
class AdminCGBranchList(Resource):
    @jwt_required()
    def get(self):
        if not _require_admin():
            return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
        try:
            search = request.args.get('search', '')
            # ── SP: sp_cg_branches_list — no search filter on the generic
            # CRUD proc, so pull a bounded batch and filter here. ────────────
            rows = call_proc('sp_cg_branches_list', 2000, 0, 0)
            if search:
                s = search.lower()
                rows = [b for b in rows if s in (b.get('name') or '').lower() or s in (b.get('code') or '').lower()]
            rows.sort(key=lambda b: b.get('name') or '')
            return jsonify(response={'branches': [_dict(b) for b in rows]}, status=200, bool=True)
        except Exception as e:
            logger.error(f"CG GET /branches: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @jwt_required()
    def post(self):
        if not _require_admin():
            return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
        try:
            d = request.get_json() or {}
            if not d.get('code') or not d.get('name'):
                return jsonify(response={'message': 'Code and name are required.'}, status=400, bool=False)

            admin_id = get_jwt_identity()
            # ── SP: sp_cg_branches_create — uq_cg_branches_code enforces the
            # duplicate check via IntegrityError. ─────────────────────────────
            try:
                bid = str(uuid.uuid4())
                args = _build_args(bid, d['code'].upper(), d['name'], d) + [admin_id, admin_id]
                b = call_proc_one('sp_cg_branches_create', *args)
                db.session.commit()
            except IntegrityError:
                db.session.rollback()
                return jsonify(response={'message': 'Branch code already exists.'}, status=400, bool=False)
            return jsonify(response={'message': 'Branch created.', 'branch': _dict(b)}, status=201, bool=True)
        except Exception as e:
            db.session.rollback(); logger.error(f"CG POST /branches: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/cg/branches/<string:branch_id>')
class AdminCGBranchDetail(Resource):
    @jwt_required()
    def put(self, branch_id):
        if not _require_admin():
            return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
        try:
            # ── SP: sp_cg_branches_get + _update (full replace) ───────────────
            existing = call_proc_one('sp_cg_branches_get', branch_id)
            if not existing:
                return jsonify(response={'message': 'Branch not found.'}, status=404, bool=False)
            d = request.get_json() or {}

            admin_id = get_jwt_identity()
            name = d['name'] if 'name' in d else existing['name']
            args = _build_args(branch_id, existing['code'], name, d, existing) + [existing.get('created_by'), admin_id]
            b = call_proc_one('sp_cg_branches_update', *args)
            db.session.commit()
            return jsonify(response={'message': 'Branch updated.', 'branch': _dict(b)}, status=200, bool=True)
        except Exception as e:
            db.session.rollback(); logger.error(f"CG PUT /branches/{branch_id}: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @jwt_required()
    def delete(self, branch_id):
        if not _require_admin():
            return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
        try:
            # ── SP: sp_cg_branches_get + _delete (hard delete) ────────────────
            existing = call_proc_one('sp_cg_branches_get', branch_id)
            if not existing:
                return jsonify(response={'message': 'Branch not found.'}, status=404, bool=False)
            call_proc('sp_cg_branches_delete', branch_id)
            db.session.commit()
            return jsonify(response={'message': 'Branch deleted.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback(); logger.error(f"CG DELETE /branches/{branch_id}: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)
