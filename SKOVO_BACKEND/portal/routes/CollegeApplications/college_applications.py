"""
College Application Tracker — student CRUD (SP-only: sp_collegeapp_*)
"""
from portal.helpers.error_capture import capture_error
from portal.helpers.helpers import serialize_datetime
import uuid
from flask import jsonify, request
from flask_restx import Resource
from flask_jwt_extended import jwt_required, get_jwt_identity
from portal.helpers.sp import call_proc, call_proc_one
from portal.models import db
from . import ns, logger

STATUS_OPTIONS = ('planning', 'applied', 'under_review', 'interview', 'accepted', 'rejected', 'waitlisted', 'withdrawn')
PRIORITY_OPTIONS = ('low', 'medium', 'high')


@ns.route('/')
class CollegeAppList(Resource):
    @jwt_required()
    def get(self):
        try:
            user_id = get_jwt_identity()
            apps = [_dict(a) for a in call_proc('sp_collegeapp_by_user', user_id)]
            return jsonify(response={'applications': apps, 'total': len(apps)}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @jwt_required()
    def post(self):
        try:
            user_id = get_jwt_identity()
            data = request.get_json() or {}
            if not data.get('college_name') and not data.get('college_id'):
                return jsonify(response={'message': 'college_name or college_id required.'}, status=400, bool=False)
            new_id = str(uuid.uuid4())
            call_proc(
                'sp_collegeapp_create',
                new_id, user_id, data.get('college_id'),
                (data.get('college_name') or '').strip() or None,
                data.get('program_name'), data.get('exam_type'),
                data.get('application_date'), data.get('deadline_date'),
                data.get('status', 'planning'), data.get('priority', 'medium'),
                data.get('notes'), data.get('application_url'),
            )
            db.session.commit()
            return jsonify(response={'message': 'Added.', 'id': new_id}, status=201, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/<string:app_id>')
class CollegeAppDetail(Resource):
    @jwt_required()
    def put(self, app_id):
        try:
            user_id = get_jwt_identity()
            data = request.get_json() or {}
            res = call_proc_one(
                'sp_collegeapp_update_owner',
                app_id, user_id, data.get('college_name'), data.get('program_name'),
                data.get('exam_type'), data.get('application_date'), data.get('deadline_date'),
                data.get('status'), data.get('priority'), data.get('notes'),
                data.get('application_url'), data.get('college_id'),
            )
            db.session.commit()
            if not res or not res.get('updated'):
                return jsonify(response={'message': 'Not found.'}, status=404, bool=False)
            return jsonify(response={'message': 'Updated.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @jwt_required()
    def delete(self, app_id):
        try:
            user_id = get_jwt_identity()
            res = call_proc_one('sp_collegeapp_delete_owner', app_id, user_id)
            db.session.commit()
            if not res or not res.get('deleted'):
                return jsonify(response={'message': 'Not found.'}, status=404, bool=False)
            return jsonify(response={'message': 'Deleted.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


def _dict(a):
    ad, dd = a.get('application_date'), a.get('deadline_date')
    ca, ua = a.get('created_at'), a.get('updated_at')
    return {
        'id': a.get('id'), 'college_id': a.get('college_id'), 'college_name': a.get('college_name'),
        'program_name': a.get('program_name'), 'exam_type': a.get('exam_type'),
        'application_date': serialize_datetime(ad) if ad else None,
        'deadline_date': serialize_datetime(dd) if dd else None,
        'status': a.get('status'), 'priority': a.get('priority'),
        'notes': a.get('notes'), 'application_url': a.get('application_url'),
        'created_at': serialize_datetime(ca) if ca else None,
        'updated_at': serialize_datetime(ua) if ua else None,
    }
