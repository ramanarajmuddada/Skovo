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


def _as_list(v):
    if isinstance(v, str):
        try:
            return json.loads(v)
        except Exception:
            return None
    return v


# order matches sp_cg_entrance_exams_create/_update after (id, exam_code, exam_name)
FIELDS = [
    ('exam_type', None), ('for_stream', None), ('conducting_authority', None), ('exam_mode', None),
    ('eligibility', None), ('exam_pattern', 'json'), ('notification_pdf_url', None),
    ('syllabus_highlights', None), ('counseling_info', None), ('cutoff_notes', None),
    ('registration_period', None), ('exam_period', None), ('useful_for_states', 'json'),
    ('official_url', None), ('preparation_tips', None), ('important_books', 'json'), ('is_active', 'bool'),
]


def _build_args(eid, code, name, d, existing=None):
    existing = existing or {}
    args = [eid, code, name]
    for field, caster in FIELDS:
        if field in d:
            v = d[field]
            if caster == 'json':
                v = json.dumps(v) if v is not None else None
            elif caster == 'bool':
                v = 1 if v else 0
            args.append(v)
        else:
            args.append(existing.get(field))
    return args


def _dict(e):
    if not e:
        return None
    created_at = e.get('created_at')
    return {
        'id': e.get('id'), 'exam_code': e.get('exam_code'), 'exam_name': e.get('exam_name'),
        'exam_type': e.get('exam_type'), 'for_stream': e.get('for_stream'),
        'conducting_authority': e.get('conducting_authority'), 'exam_mode': e.get('exam_mode'),
        'eligibility': e.get('eligibility'), 'exam_pattern': _as_list(e.get('exam_pattern')),
        'syllabus_highlights': e.get('syllabus_highlights'), 'counseling_info': e.get('counseling_info'),
        'cutoff_notes': e.get('cutoff_notes'), 'registration_period': e.get('registration_period'),
        'exam_period': e.get('exam_period'), 'useful_for_states': _as_list(e.get('useful_for_states')),
        'official_url': e.get('official_url'), 'notification_pdf_url': e.get('notification_pdf_url'),
        'preparation_tips': e.get('preparation_tips'),
        'important_books': _as_list(e.get('important_books')), 'is_active': bool(e.get('is_active')),
        'created_at': serialize_datetime(created_at) if created_at else None,
    }


@ns.route('/cg/entrance-exams')
class AdminCGExamList(Resource):
    @jwt_required()
    def get(self):
        if not _require_admin():
            return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
        try:
            # ── SP: sp_cg_entrance_exams_list ─────────────────────────────────
            rows = call_proc('sp_cg_entrance_exams_list', 2000, 0, 0)
            rows.sort(key=lambda e: e.get('exam_name') or '')
            return jsonify(response={'exams': [_dict(e) for e in rows]}, status=200, bool=True)
        except Exception as e:
            logger.error(f"CG GET /entrance-exams: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @jwt_required()
    def post(self):
        if not _require_admin():
            return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
        try:
            d = request.get_json() or {}
            if not d.get('exam_code') or not d.get('exam_name'):
                return jsonify(response={'message': 'exam_code and exam_name are required.'}, status=400, bool=False)

            admin_id = get_jwt_identity()
            # ── SP: sp_cg_entrance_exams_create — uq_cg_entrance_exams_exam_code
            # enforces the duplicate check via IntegrityError. ─────────────────
            try:
                eid = str(uuid.uuid4())
                args = _build_args(eid, d['exam_code'].upper(), d['exam_name'], d) + [admin_id, admin_id]
                e = call_proc_one('sp_cg_entrance_exams_create', *args)
                db.session.commit()
            except IntegrityError:
                db.session.rollback()
                return jsonify(response={'message': 'Exam code already exists.'}, status=400, bool=False)
            return jsonify(response={'message': 'Exam created.', 'exam': _dict(e)}, status=201, bool=True)
        except Exception as ex:
            db.session.rollback(); logger.error(f"CG POST /entrance-exams: {ex}")
            error_id = capture_error(ex)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/cg/entrance-exams/<string:exam_id>')
class AdminCGExamDetail(Resource):
    @jwt_required()
    def put(self, exam_id):
        if not _require_admin():
            return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
        try:
            # ── SP: sp_cg_entrance_exams_get + _update (full replace) ─────────
            existing = call_proc_one('sp_cg_entrance_exams_get', exam_id)
            if not existing:
                return jsonify(response={'message': 'Exam not found.'}, status=404, bool=False)
            d = request.get_json() or {}

            admin_id = get_jwt_identity()
            name = d['exam_name'] if 'exam_name' in d else existing['exam_name']
            args = _build_args(exam_id, existing['exam_code'], name, d, existing) + [existing.get('created_by'), admin_id]
            e = call_proc_one('sp_cg_entrance_exams_update', *args)
            db.session.commit()
            return jsonify(response={'message': 'Exam updated.', 'exam': _dict(e)}, status=200, bool=True)
        except Exception as ex:
            db.session.rollback(); logger.error(f"CG PUT /entrance-exams/{exam_id}: {ex}")
            error_id = capture_error(ex)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @jwt_required()
    def delete(self, exam_id):
        if not _require_admin():
            return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
        try:
            # ── SP: sp_cg_entrance_exams_get + _delete (hard delete) ──────────
            existing = call_proc_one('sp_cg_entrance_exams_get', exam_id)
            if not existing:
                return jsonify(response={'message': 'Exam not found.'}, status=404, bool=False)
            call_proc('sp_cg_entrance_exams_delete', exam_id)
            db.session.commit()
            return jsonify(response={'message': 'Exam deleted.'}, status=200, bool=True)
        except Exception as ex:
            db.session.rollback(); logger.error(f"CG DELETE /entrance-exams/{exam_id}: {ex}")
            error_id = capture_error(ex)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)
