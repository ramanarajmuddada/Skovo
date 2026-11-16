"""
User Certifications Tracker — student CRUD (SP-only: sp_certifications_*)
"""
from portal.helpers.error_capture import capture_error
from portal.helpers.helpers import serialize_datetime
import uuid
import json
from flask import jsonify, request
from flask_restx import Resource
from flask_jwt_extended import jwt_required, get_jwt_identity
from portal.helpers.sp import call_proc, call_proc_one
from portal.models import db
from . import ns, logger


def _as_list(v):
    if isinstance(v, str):
        try:
            return json.loads(v)
        except Exception:
            return []
    return v or []


@ns.route('/')
class CertificationList(Resource):
    @jwt_required()
    def get(self):
        try:
            user_id = get_jwt_identity()
            items = [_dict(c) for c in call_proc('sp_certifications_by_user', user_id)]
            return jsonify(response={'certifications': items, 'total': len(items)},
                           status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @jwt_required()
    def post(self):
        try:
            user_id = get_jwt_identity()
            data = request.get_json() or {}
            if not data.get('title'):
                return jsonify(response={'message': 'title required.'}, status=400, bool=False)
            new_id = str(uuid.uuid4())
            call_proc(
                'sp_certifications_create',
                new_id, user_id, data['title'].strip(),
                data.get('provider'), data.get('credential_id'),
                data.get('issue_date'), data.get('expiry_date'),
                data.get('certificate_url'),
                json.dumps(data.get('skills') or []),
            )
            db.session.commit()
            return jsonify(response={'message': 'Added.', 'id': new_id}, status=201, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/<string:cert_id>')
class CertificationDetail(Resource):
    @jwt_required()
    def put(self, cert_id):
        try:
            user_id = get_jwt_identity()
            data = request.get_json() or {}
            skills = json.dumps(data['skills']) if 'skills' in data else None
            res = call_proc_one(
                'sp_certifications_update_owner',
                cert_id, user_id,
                data.get('title'), data.get('provider'), data.get('credential_id'),
                data.get('issue_date'), data.get('expiry_date'),
                data.get('certificate_url'), skills,
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
    def delete(self, cert_id):
        try:
            user_id = get_jwt_identity()
            res = call_proc_one('sp_certifications_delete_owner', cert_id, user_id)
            db.session.commit()
            if not res or not res.get('deleted'):
                return jsonify(response={'message': 'Not found.'}, status=404, bool=False)
            return jsonify(response={'message': 'Deleted.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


def _dict(c):
    idt, ext = c.get('issue_date'), c.get('expiry_date')
    ca = c.get('created_at')
    return {
        'id': c.get('id'), 'title': c.get('title'), 'provider': c.get('provider'),
        'credential_id': c.get('credential_id'),
        'issue_date': serialize_datetime(idt) if idt else None,
        'expiry_date': serialize_datetime(ext) if ext else None,
        'certificate_url': c.get('certificate_url'), 'skills': _as_list(c.get('skills')),
        'is_verified': bool(c.get('is_verified')),
        'created_at': serialize_datetime(ca) if ca else None,
    }
