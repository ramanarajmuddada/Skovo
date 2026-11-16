"""
SOP / LOR Builder — student manages SOP/LOR drafts (SP-only: sp_sop_*)
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

DOC_TYPES = ('sop', 'lor', 'personal_statement', 'motivation_letter')


@ns.route('/')
class SOPList(Resource):
    @jwt_required()
    def get(self):
        try:
            user_id = get_jwt_identity()
            docs = [_dict(d) for d in call_proc('sp_sop_by_user', user_id, request.args.get('doc_type'))]
            return jsonify(response={'documents': docs, 'total': len(docs)}, status=200, bool=True)
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
            content = data.get('content', '')
            new_id = str(uuid.uuid4())
            call_proc(
                'sp_sop_create',
                new_id, user_id, data['title'].strip(), data.get('doc_type', 'sop'),
                data.get('target_institution'), data.get('target_program'),
                content, len(content.split()) if content else 0, data.get('status', 'draft'),
            )
            from portal.helpers import engagement
            engagement.track(user_id, 'career_tool_used')   # §3, if switched on
            db.session.commit()
            return jsonify(response={'message': 'Created.', 'id': new_id}, status=201, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/<string:doc_id>')
class SOPDetail(Resource):
    @jwt_required()
    def get(self, doc_id):
        try:
            user_id = get_jwt_identity()
            d = call_proc_one('sp_sop_get_owner', doc_id, user_id)
            if not d:
                return jsonify(response={'message': 'Not found.'}, status=404, bool=False)
            return jsonify(response=_dict(d), status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @jwt_required()
    def put(self, doc_id):
        try:
            user_id = get_jwt_identity()
            if not call_proc_one('sp_sop_get_owner', doc_id, user_id):
                return jsonify(response={'message': 'Not found.'}, status=404, bool=False)
            data = request.get_json() or {}
            content = data['content'] if 'content' in data else None
            word_count = (len(content.split()) if content else 0) if 'content' in data else None
            res = call_proc_one(
                'sp_sop_update_owner',
                doc_id, user_id, data.get('title'), data.get('doc_type'),
                data.get('target_institution'), data.get('target_program'),
                data.get('status'), content, word_count,
            )
            db.session.commit()
            return jsonify(response={'message': 'Saved.', 'word_count': (res or {}).get('word_count')}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @jwt_required()
    def delete(self, doc_id):
        try:
            user_id = get_jwt_identity()
            res = call_proc_one('sp_sop_delete_owner', doc_id, user_id)
            db.session.commit()
            if not res or not res.get('deleted'):
                return jsonify(response={'message': 'Not found.'}, status=404, bool=False)
            return jsonify(response={'message': 'Deleted.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


def _dict(d):
    ca, ua = d.get('created_at'), d.get('updated_at')
    return {
        'id': d.get('id'), 'title': d.get('title'), 'doc_type': d.get('doc_type'),
        'target_institution': d.get('target_institution'), 'target_program': d.get('target_program'),
        'content': d.get('content'), 'word_count': d.get('word_count'), 'status': d.get('status'),
        'created_at': serialize_datetime(ca) if ca else None,
        'updated_at': serialize_datetime(ua) if ua else None,
    }
