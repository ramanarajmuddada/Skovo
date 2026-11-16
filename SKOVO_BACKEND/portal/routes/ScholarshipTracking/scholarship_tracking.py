"""
Scholarship Application Tracker — student CRUD (SP-only: sp_scholtrack_*)
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


@ns.route('/')
class ScholarshipTrackerList(Resource):
    @jwt_required()
    def get(self):
        try:
            user_id = get_jwt_identity()
            items = [_dict(i) for i in call_proc('sp_scholtrack_by_user', user_id)]
            return jsonify(response={'items': items, 'total': len(items)}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @jwt_required()
    def post(self):
        try:
            user_id = get_jwt_identity()
            data = request.get_json() or {}
            if not data.get('scholarship_name'):
                return jsonify(response={'message': 'scholarship_name required.'}, status=400, bool=False)
            new_id = str(uuid.uuid4())
            call_proc(
                'sp_scholtrack_create',
                new_id, user_id, data.get('scholarship_id'), data['scholarship_name'].strip(),
                data.get('provider'),
                int(data['amount']) if data.get('amount') else None,
                data.get('deadline_date'), data.get('status', 'interested'),
                data.get('applied_at'), data.get('result'), data.get('notes'),
                data.get('application_url'),
            )
            db.session.commit()
            return jsonify(response={'message': 'Added.', 'id': new_id}, status=201, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/<string:item_id>')
class ScholarshipTrackerDetail(Resource):
    @jwt_required()
    def put(self, item_id):
        try:
            user_id = get_jwt_identity()
            data = request.get_json() or {}
            amount = None
            if 'amount' in data:
                amount = int(data['amount']) if data['amount'] not in (None, '') else None
            res = call_proc_one(
                'sp_scholtrack_update_owner',
                item_id, user_id, data.get('scholarship_name'), data.get('provider'), amount,
                data.get('deadline_date'), data.get('status'), data.get('applied_at'),
                data.get('result'), data.get('notes'), data.get('application_url'),
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
    def delete(self, item_id):
        try:
            user_id = get_jwt_identity()
            res = call_proc_one('sp_scholtrack_delete_owner', item_id, user_id)
            db.session.commit()
            if not res or not res.get('deleted'):
                return jsonify(response={'message': 'Not found.'}, status=404, bool=False)
            return jsonify(response={'message': 'Deleted.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


def _dict(i):
    dd, aa, ca = i.get('deadline_date'), i.get('applied_at'), i.get('created_at')
    return {
        'id': i.get('id'), 'scholarship_id': i.get('scholarship_id'),
        'scholarship_name': i.get('scholarship_name'), 'provider': i.get('provider'),
        'amount': i.get('amount'),
        'deadline_date': serialize_datetime(dd) if dd else None,
        'status': i.get('status'),
        'applied_at': serialize_datetime(aa) if aa else None,
        'result': i.get('result'), 'notes': i.get('notes'), 'application_url': i.get('application_url'),
        'created_at': serialize_datetime(ca) if ca else None,
    }
