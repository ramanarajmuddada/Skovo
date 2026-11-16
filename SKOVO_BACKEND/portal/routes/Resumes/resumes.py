"""
Resume Builder — student CRUD (SP-only: sp_resumes_*)
Each student can have multiple resume versions.
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

_JSON_FIELDS = ('personal_info', 'education', 'experience', 'skills', 'projects',
                'certifications', 'achievements', 'languages')


def _as_json(v):
    if isinstance(v, str):
        try:
            return json.loads(v)
        except Exception:
            return v
    return v


@ns.route('/')
class ResumeList(Resource):
    @jwt_required()
    def get(self):
        try:
            user_id = get_jwt_identity()
            items = [_dict(r) for r in call_proc('sp_resumes_by_user', user_id)]
            return jsonify(response={'resumes': items, 'total': len(items)}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @jwt_required()
    def post(self):
        try:
            user_id = get_jwt_identity()
            data = request.get_json() or {}
            pi = data.get('personal_info')
            call_proc(
                'sp_resumes_create',
                str(uuid.uuid4()), user_id, data.get('title', 'My Resume'), data.get('template', 'classic'),
                json.dumps(pi) if pi is not None else None,
                json.dumps(data.get('education') or []),
                json.dumps(data.get('experience') or []),
                json.dumps(data.get('skills') or []),
                json.dumps(data.get('projects') or []),
                json.dumps(data.get('certifications') or []),
                json.dumps(data.get('achievements') or []),
                json.dumps(data.get('languages') or []),
                data.get('summary'),
            )
            from portal.helpers import engagement
            engagement.track(user_id, 'career_tool_used')   # §3, if switched on
            db.session.commit()
            return jsonify(response={'message': 'Resume created.'}, status=201, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/<string:resume_id>')
class ResumeDetail(Resource):
    @jwt_required()
    def get(self, resume_id):
        try:
            user_id = get_jwt_identity()
            r = call_proc_one('sp_resumes_get_owner', resume_id, user_id)
            if not r:
                return jsonify(response={'message': 'Not found.'}, status=404, bool=False)
            return jsonify(response=_dict(r), status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @jwt_required()
    def put(self, resume_id):
        try:
            user_id = get_jwt_identity()
            data = request.get_json() or {}

            def jf(field):  # JSON field: encode if present, else None (keep existing)
                return json.dumps(data[field]) if field in data else None

            res = call_proc_one(
                'sp_resumes_update_owner',
                resume_id, user_id,
                data.get('title'), data.get('template'),
                jf('personal_info'), jf('education'), jf('experience'), jf('skills'),
                jf('projects'), jf('certifications'), jf('achievements'), jf('languages'),
                data.get('summary'),
            )
            db.session.commit()
            if not res or not res.get('updated'):
                return jsonify(response={'message': 'Not found.'}, status=404, bool=False)
            return jsonify(response={'message': 'Saved.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @jwt_required()
    def delete(self, resume_id):
        try:
            user_id = get_jwt_identity()
            res = call_proc_one('sp_resumes_delete_owner', resume_id, user_id)
            db.session.commit()
            if not res or not res.get('deleted'):
                return jsonify(response={'message': 'Not found.'}, status=404, bool=False)
            return jsonify(response={'message': 'Deleted.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


def _dict(r):
    ld, ca, ua = r.get('last_downloaded_at'), r.get('created_at'), r.get('updated_at')
    out = {'id': r.get('id'), 'title': r.get('title'), 'template': r.get('template'),
           'summary': r.get('summary'),
           'last_downloaded_at': serialize_datetime(ld) if ld else None,
           'created_at': serialize_datetime(ca) if ca else None,
           'updated_at': serialize_datetime(ua) if ua else None}
    for f in _JSON_FIELDS:
        val = _as_json(r.get(f))
        out[f] = val if val is not None else ([] if f != 'personal_info' else None)
    return out
