"""Admin › Platform settings › Landing FAQs.

The homepage FAQ used to be a literal list in LandingPage.jsx, so changing a
question meant a deploy. Admins now add, edit, hide, reorder and delete them;
the homepage reads the active ones from /public/landing.
"""
import uuid

from flask import jsonify, request
from flask_restx import Resource
from flask_jwt_extended import jwt_required, get_jwt_identity

from portal.helpers.admin_auth import can, AREA_CONTENT
from portal.helpers.audit import log_audit
from portal.helpers.error_capture import capture_error
from portal.helpers.sp import call_proc, call_proc_one
from portal.models import db
from . import ns, logger

Q_MAX, A_MAX = 300, 2000


def _denied():
    return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)


def _err(where, e):
    db.session.rollback()
    logger.error(f"{where}: {e}")
    return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)},
                   status=500, bool=False)


def _row(r):
    return {
        'id': r['id'], 'question': r['question'], 'answer': r['answer'],
        'sort_order': r.get('sort_order'), 'is_active': bool(r.get('is_active')),
        'updated_at': r['updated_at'].isoformat() if r.get('updated_at') else None,
    }


def _clean(d, partial):
    """Trimmed question/answer, or an error message."""
    q = d.get('question')
    a = d.get('answer')
    if not partial or q is not None:
        q = (q or '').strip()
        if not q:
            return None, None, 'Question is required.'
        if len(q) > Q_MAX:
            return None, None, f'Question must be {Q_MAX} characters or fewer.'
    if not partial or a is not None:
        a = (a or '').strip()
        if not a:
            return None, None, 'Answer is required.'
        if len(a) > A_MAX:
            return None, None, f'Answer must be {A_MAX} characters or fewer.'
    return q, a, None


@ns.route('/landing-faqs')
class AdminLandingFaqs(Resource):
    @jwt_required()
    def get(self):
        try:
            if not can(AREA_CONTENT):
                return _denied()
            return jsonify(response={'faqs': [_row(r) for r in call_proc('sp_site_faqs_admin_list')]},
                           status=200, bool=True)
        except Exception as e:
            return _err('GET landing faqs', e)

    @jwt_required()
    def post(self):
        try:
            if not can(AREA_CONTENT):
                return _denied()
            d = request.get_json() or {}
            q, a, msg = _clean(d, partial=False)
            if msg:
                return jsonify(response={'message': msg}, status=400, bool=False)
            admin = get_jwt_identity()
            r = call_proc_one('sp_site_faq_create', str(uuid.uuid4()), q, a,
                              0 if d.get('is_active') is False else 1, admin)
            db.session.commit()
            log_audit('landing_faq_created', 'site_faq', r['id'], admin, {'question': q})
            return jsonify(response={'faq': _row(r), 'message': 'FAQ added.'}, status=201, bool=True)
        except Exception as e:
            return _err('POST landing faq', e)


@ns.route('/landing-faqs/<string:faq_id>')
class AdminLandingFaq(Resource):
    @jwt_required()
    def put(self, faq_id):
        try:
            if not can(AREA_CONTENT):
                return _denied()
            d = request.get_json() or {}
            admin = get_jwt_identity()
            if d.get('move') in ('up', 'down'):
                call_proc_one('sp_site_faq_move', faq_id, -1 if d['move'] == 'up' else 1, admin)
                db.session.commit()
                return jsonify(response={'message': 'Moved.'}, status=200, bool=True)
            q, a, msg = _clean(d, partial=True)
            if msg:
                return jsonify(response={'message': msg}, status=400, bool=False)
            active = None if 'is_active' not in d else (1 if d['is_active'] else 0)
            r = call_proc_one('sp_site_faq_update', faq_id, q, a, active, admin)
            db.session.commit()
            if not r:
                return jsonify(response={'message': 'FAQ not found.'}, status=404, bool=False)
            log_audit('landing_faq_updated', 'site_faq', faq_id, admin, d)
            return jsonify(response={'faq': _row(r), 'message': 'Saved.'}, status=200, bool=True)
        except Exception as e:
            return _err('PUT landing faq', e)

    @jwt_required()
    def delete(self, faq_id):
        try:
            if not can(AREA_CONTENT):
                return _denied()
            admin = get_jwt_identity()
            r = call_proc_one('sp_site_faq_delete', faq_id, admin)
            db.session.commit()
            if not int((r or {}).get('deleted') or 0):
                return jsonify(response={'message': 'FAQ not found.'}, status=404, bool=False)
            log_audit('landing_faq_deleted', 'site_faq', faq_id, admin)
            return jsonify(response={'message': 'FAQ deleted.'}, status=200, bool=True)
        except Exception as e:
            return _err('DELETE landing faq', e)
