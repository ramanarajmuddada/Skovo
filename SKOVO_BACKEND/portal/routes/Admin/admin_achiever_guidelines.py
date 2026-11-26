"""Admin -- the guidelines an achiever reads on the Verification screen.

GET    /achiever-guidelines            every state's copy: the admin's, or the built-in default
PUT    /achiever-guidelines/<state>    save the admin's copy (version goes up)
DELETE /achiever-guidelines/<state>    back to the built-in default

Copy per state: title, summary, steps[], sections[{heading, points[]}], note.
"""
from portal.helpers.error_capture import capture_error
import json
from flask import jsonify, request
from flask_restx import Resource
from flask_jwt_extended import jwt_required, get_jwt_identity
from portal.models import db
from portal.helpers.sp import call_proc, call_proc_one
from portal.helpers.admin_auth import can, AREA_CONTENT
from portal.helpers.audit import log_audit
from portal.routes.AchieverApplication.achiever_lifecycle import GUIDELINES
from . import ns, logger

STATES = ('pending', 'active', 'suspended', 'banned', 'cohort_guide')
LABELS = {'pending': 'Applying (before approval)', 'active': 'Live', 'suspended': 'Suspended', 'banned': 'Closed',
          'cohort_guide': 'Create cohort guide'}


def _err(where, e):
    db.session.rollback()
    logger.error(f"{where}: {e}")
    return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)}, status=500, bool=False)


def _bad(msg, status=400):
    return jsonify(response={'message': msg}, status=status, bool=False)


def _clean(d):
    """Body -> stored copy. Lines and blank items are trimmed away."""
    lines = lambda v: [x.strip() for x in (v.split('\n') if isinstance(v, str) else (v or [])) if str(x).strip()]
    sections = []
    for sec in d.get('sections') or []:
        heading = (sec.get('heading') or '').strip()[:120]
        points = lines(sec.get('points'))
        if heading and points:
            sections.append({'heading': heading, 'points': [p[:600] for p in points]})
    return {'title': (d.get('title') or '').strip()[:160], 'summary': (d.get('summary') or '').strip()[:600],
            'steps': [x[:300] for x in lines(d.get('steps'))], 'sections': sections,
            'note': (d.get('note') or '').strip()[:600] or None}


@ns.route('/achiever-guidelines')
class AdminAchieverGuidelines(Resource):
    @jwt_required()
    def get(self):
        try:
            if not can(AREA_CONTENT):
                return _bad('Admin access required', 403)
            try:
                stored = {r['state']: r for r in call_proc('sp_ach_guidelines_list') or []}
            except Exception as e:                           # table not created yet: show the built-in text
                logger.warning(f"achiever guidelines list failed: {e}")
                db.session.rollback()
                stored = {}
            out = []
            for st in STATES:
                r = stored.get(st)
                content = r.get('content') if r else None
                content = json.loads(content) if isinstance(content, (str, bytes)) else content
                base = content or GUIDELINES.get(st) or {}
                out.append({'state': st, 'label': LABELS[st], 'custom': bool(r), 'version': (r or {}).get('version'),
                            'updated_at': r['updated_at'].isoformat() if r and r.get('updated_at') else None,
                            'updated_by': (r or {}).get('updated_by_name'),
                            'title': base.get('title') or '', 'summary': base.get('summary') or '',
                            'steps': base.get('steps') or [], 'sections': base.get('sections') or [],
                            'note': base.get('note') or ''})
            return jsonify(response={'guidelines': out}, status=200, bool=True)
        except Exception as e:
            return _err('GET /admin/achiever-guidelines', e)


@ns.route('/achiever-guidelines/<string:state>')
class AdminAchieverGuideline(Resource):
    @jwt_required()
    def put(self, state):
        try:
            if not can(AREA_CONTENT):
                return _bad('Admin access required', 403)
            if state not in STATES:
                return _bad('Unknown state.', 404)
            content = _clean(request.get_json() or {})
            if not content['title'] or not content['summary']:
                return _bad('Give a title and a short summary.')
            if state == 'pending' and not content['sections']:
                return _bad('Applicants accept the full guidelines, so add at least one section.')
            admin = get_jwt_identity()
            row = call_proc_one('sp_ach_guidelines_set', state, json.dumps(content), admin) or {}
            db.session.commit()
            log_audit('achiever_guidelines_updated', 'achiever_guidelines', state, admin,
                      {'version': row.get('version')})
            return jsonify(response={'message': f"Saved (version {row.get('version')}).", 'version': row.get('version')},
                           status=200, bool=True)
        except Exception as e:
            return _err('PUT /admin/achiever-guidelines', e)

    @jwt_required()
    def delete(self, state):
        try:
            if not can(AREA_CONTENT):
                return _bad('Admin access required', 403)
            call_proc_one('sp_ach_guidelines_reset', state)
            db.session.commit()
            log_audit('achiever_guidelines_reset', 'achiever_guidelines', state, get_jwt_identity(), None)
            return jsonify(response={'message': 'Back to the built-in text.'}, status=200, bool=True)
        except Exception as e:
            return _err('DELETE /admin/achiever-guidelines', e)
