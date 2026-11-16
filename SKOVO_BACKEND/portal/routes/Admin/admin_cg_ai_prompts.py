from portal.helpers.error_capture import capture_error
from portal.helpers.helpers import serialize_datetime
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


def _dict(p):
    if not p:
        return None
    created_at, updated_at = p.get('created_at'), p.get('updated_at')
    return {
        'id': p.get('id'), 'prompt_type': p.get('prompt_type'), 'prompt_text': p.get('prompt_text'),
        'version': p.get('version'), 'is_active': bool(p.get('is_active')),
        'updated_by_email': p.get('updated_by_email'),
        'created_at': serialize_datetime(created_at) if created_at else None,
        'updated_at': serialize_datetime(updated_at) if updated_at else None,
    }


@ns.route('/cg/ai-prompts')
class AdminCGAiPromptList(Resource):
    @jwt_required()
    def get(self):
        if not _require_admin():
            return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
        try:
            # ── SP: sp_cg_ai_prompts_list ─────────────────────────────────────
            rows = call_proc('sp_cg_ai_prompts_list', 1000, 0, 0)
            rows.sort(key=lambda p: p.get('prompt_type') or '')
            return jsonify(response={'prompts': [_dict(p) for p in rows]}, status=200, bool=True)
        except Exception as e:
            logger.error(f"CG GET /ai-prompts: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @jwt_required()
    def post(self):
        if not _require_admin():
            return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
        try:
            d = request.get_json() or {}
            if not d.get('prompt_type') or not d.get('prompt_text'):
                return jsonify(response={'message': 'prompt_type and prompt_text are required.'}, status=400, bool=False)
            email = get_jwt_identity()
            # ── SP: sp_cg_ai_prompts_create — uq_cg_ai_prompts_prompt_type
            # enforces the duplicate check via IntegrityError. ────────────────
            try:
                p = call_proc_one(
                    'sp_cg_ai_prompts_create',
                    str(uuid.uuid4()), d['prompt_type'], d['prompt_text'], 1,
                    1 if d.get('is_active', True) else 0, email, email, email,
                )
                db.session.commit()
            except IntegrityError:
                db.session.rollback()
                return jsonify(response={'message': 'Prompt type already exists. Use PUT to update.'}, status=400, bool=False)
            return jsonify(response={'message': 'Prompt created.', 'prompt': _dict(p)}, status=201, bool=True)
        except Exception as e:
            db.session.rollback(); logger.error(f"CG POST /ai-prompts: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/cg/ai-prompts/<string:pid>')
class AdminCGAiPromptDetail(Resource):
    @jwt_required()
    def put(self, pid):
        if not _require_admin():
            return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
        try:
            # ── SP: sp_cg_ai_prompts_get + sp_cg_ai_prompts_update (full replace) ─
            existing = call_proc_one('sp_cg_ai_prompts_get', pid)
            if not existing:
                return jsonify(response={'message': 'Not found.'}, status=404, bool=False)
            d = request.get_json() or {}

            prompt_text = existing['prompt_text']
            version = existing.get('version') or 1
            updated_by_email = existing.get('updated_by_email')
            if 'prompt_text' in d:
                prompt_text = d['prompt_text']
                version = version + 1
                updated_by_email = get_jwt_identity()
            is_active = d['is_active'] if 'is_active' in d else existing.get('is_active')

            admin_id = get_jwt_identity()
            p = call_proc_one(
                'sp_cg_ai_prompts_update',
                pid, existing['prompt_type'], prompt_text, version,
                1 if is_active else 0, updated_by_email, existing.get('created_by'), admin_id,
            )
            db.session.commit()
            return jsonify(response={'message': 'Prompt updated.', 'prompt': _dict(p)}, status=200, bool=True)
        except Exception as e:
            db.session.rollback(); logger.error(f"CG PUT /ai-prompts/{pid}: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @jwt_required()
    def delete(self, pid):
        if not _require_admin():
            return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
        try:
            # ── SP: sp_cg_ai_prompts_get + sp_cg_ai_prompts_delete (hard delete) ─
            existing = call_proc_one('sp_cg_ai_prompts_get', pid)
            if not existing:
                return jsonify(response={'message': 'Not found.'}, status=404, bool=False)
            call_proc('sp_cg_ai_prompts_delete', pid)
            db.session.commit()
            return jsonify(response={'message': 'Deleted.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback(); logger.error(f"CG DELETE /ai-prompts/{pid}: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)
