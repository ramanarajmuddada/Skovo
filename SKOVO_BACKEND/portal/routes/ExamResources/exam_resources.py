"""
Exam Resources (Study Materials) — admin manages, students browse/download (SP-only)
"""
from portal.helpers.error_capture import capture_error
from portal.helpers.helpers import serialize_datetime
import uuid
import json
from flask import jsonify, request
from flask_restx import Resource
from flask_jwt_extended import jwt_required, get_jwt_identity
from portal.helpers.decorators import require_role
from portal.helpers.sp import call_proc, call_proc_one
from portal.models import db
from . import ns, logger

from portal.api import api as _api
_admin_ns = _api.namespace('skovo-platform-panel-admin', description='Admin Panel')


def _as_list(v):
    if isinstance(v, str):
        try:
            return json.loads(v)
        except Exception:
            return []
    return v or []


@_admin_ns.route('/exam-resources')
class AdminExamResourceList(Resource):
    @require_role('admin', 'super_admin')
    def get(self):
        try:
            return jsonify(response={'resources': [_dict(r) for r in call_proc('sp_examres_list_all')]},
                           status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @require_role('admin', 'super_admin')
    def post(self):
        try:
            data = request.get_json() or {}
            if not data.get('title'):
                return jsonify(response={'message': 'title required.'}, status=400, bool=False)
            new_id = str(uuid.uuid4())
            call_proc(
                'sp_examres_create',
                new_id, data['title'].strip(), data.get('description'), data.get('exam_type'),
                data.get('subject'), data.get('resource_type', 'notes'), data.get('file_url'),
                data.get('external_url'), data.get('thumbnail_url'),
                json.dumps(data.get('tags') or []),
                1 if data.get('is_free', True) else 0,
                1 if data.get('is_active', True) else 0,
                get_jwt_identity(),
            )
            db.session.commit()
            return jsonify(response={'message': 'Created.', 'id': new_id}, status=201, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@_admin_ns.route('/exam-resources/<string:res_id>')
class AdminExamResourceDetail(Resource):
    @require_role('admin', 'super_admin')
    def put(self, res_id):
        try:
            data = request.get_json() or {}
            tags = json.dumps(data['tags']) if 'tags' in data else None
            is_active = (1 if data['is_active'] else 0) if 'is_active' in data else None
            is_free = (1 if data['is_free'] else 0) if 'is_free' in data else None
            res = call_proc_one(
                'sp_examres_update', res_id,
                data.get('title'), data.get('description'), data.get('exam_type'), data.get('subject'),
                data.get('resource_type'), data.get('file_url'), data.get('external_url'),
                data.get('thumbnail_url'), tags, is_active, is_free, get_jwt_identity(),
            )
            db.session.commit()
            if not res or not res.get('updated'):
                return jsonify(response={'message': 'Not found.'}, status=404, bool=False)
            return jsonify(response={'message': 'Updated.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @require_role('admin', 'super_admin')
    def delete(self, res_id):
        try:
            res = call_proc_one('sp_examres_soft_delete', res_id)
            db.session.commit()
            if not res or not res.get('deleted'):
                return jsonify(response={'message': 'Not found.'}, status=404, bool=False)
            return jsonify(response={'message': 'Deleted.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/')
class ExamResourceList(Resource):
    @jwt_required()
    def get(self):
        try:
            resources = call_proc('sp_examres_student_list',
                                  request.args.get('exam_type'), request.args.get('resource_type'))
            return jsonify(response={'resources': [_dict(r) for r in resources], 'total': len(resources)},
                           status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/<string:res_id>/download')
class ExamResourceDownload(Resource):
    @jwt_required()
    def post(self, res_id):
        try:
            res = call_proc_one('sp_examres_download', res_id)
            db.session.commit()   # proc increments the download counter
            result = (res or {}).get('result')
            if result == 'notfound':
                return jsonify(response={'message': 'Not found.'}, status=404, bool=False)
            if result == 'premium':
                return jsonify(response={'message': 'This is a premium resource and requires purchase.'}, status=403, bool=False)
            return jsonify(response={'file_url': res.get('file_url'), 'external_url': res.get('external_url')},
                           status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


def _dict(r):
    ca = r.get('created_at')
    return {
        'id': r.get('id'), 'title': r.get('title'), 'description': r.get('description'),
        'exam_type': r.get('exam_type'), 'subject': r.get('subject'),
        'resource_type': r.get('resource_type'), 'file_url': r.get('file_url'),
        'external_url': r.get('external_url'), 'thumbnail_url': r.get('thumbnail_url'),
        'tags': _as_list(r.get('tags')), 'downloads': r.get('downloads'),
        'is_free': bool(r.get('is_free')), 'is_active': bool(r.get('is_active')),
        'created_at': serialize_datetime(ca) if ca else None,
    }
