"""Admin — community chat moderation (feature-updates.md §6).

GET    /community-reports?status=open|resolved&group_id=    reported messages
POST   /community-reports/<id>/resolve                     {action: dismiss | delete_message | remove_member}
GET    /community-blocked-words                            Telugu + English list
POST   /community-blocked-words                            {word, lang}
DELETE /community-blocked-words/<word>
GET    /communities/<gid>/chat?before=                     read any community's chat
"""
from portal.helpers.error_capture import capture_error
from flask import jsonify, request
from flask_restx import Resource
from flask_jwt_extended import jwt_required, get_jwt_identity
from portal.models import db
from portal.helpers.sp import call_proc, call_proc_one
from portal.helpers.admin_auth import can, AREA_MODERATION
from portal.helpers.audit import log_audit
from . import ns, logger

ACTIONS = ('dismiss', 'delete_message', 'remove_member')


def _denied():
    return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)


def _err(where, e):
    db.session.rollback()
    logger.error(f"{where}: {e}")
    return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)},
                   status=500, bool=False)


@ns.route('/community-reports')
class AdminCommunityReports(Resource):
    @jwt_required()
    def get(self):
        try:
            if not can(AREA_MODERATION):
                return _denied()
            a = request.args
            page = max(1, int(a.get('page') or 1))
            rows = call_proc('sp_cm_reports_list', a.get('group_id') or None, a.get('status') or 'open',
                             50, (page - 1) * 50) or []
            return jsonify(response={'reports': [{
                'id': r['id'], 'message_id': r['message_id'], 'group_id': r['group_id'],
                'group_name': r['group_name'], 'body': r['body'], 'sender_id': r['sender_id'],
                'sender_name': r['sender_name'], 'reporter_name': r['reporter_name'], 'reason': r['reason'],
                'status': r['status'], 'action': r.get('action'),
                'created_at': r['created_at'].isoformat() if r.get('created_at') else None,
            } for r in rows]}, status=200, bool=True)
        except Exception as e:
            return _err('GET /admin/community-reports', e)


@ns.route('/community-reports/<string:report_id>/resolve')
class AdminCommunityReportResolve(Resource):
    @jwt_required()
    def post(self, report_id):
        try:
            if not can(AREA_MODERATION):
                return _denied()
            action = (request.get_json() or {}).get('action') or 'dismiss'
            if action not in ACTIONS:
                return jsonify(response={'message': f"Action must be one of {', '.join(ACTIONS)}."},
                               status=400, bool=False)
            admin = get_jwt_identity()
            rep = next((r for r in call_proc('sp_cm_reports_list', None, '', 500, 0) or [] if r['id'] == report_id), None)
            if not rep:
                return jsonify(response={'message': 'Report not found.'}, status=404, bool=False)
            if action == 'delete_message':
                call_proc_one('sp_cm_message_delete', rep['message_id'], admin)
            elif action == 'remove_member':
                call_proc_one('sp_cm_message_delete', rep['message_id'], admin)
                call_proc_one('sp_assemble_member_remove', rep['group_id'], rep['sender_id'])
            call_proc_one('sp_cm_report_resolve', report_id, admin, action)
            db.session.commit()
            log_audit('community_report_resolved', 'community_reports', report_id, admin,
                      {'action': action, 'message_id': rep['message_id'], 'group_id': rep['group_id']})
            return jsonify(response={'message': 'Report resolved.'}, status=200, bool=True)
        except Exception as e:
            return _err('POST /admin/community-reports/<id>/resolve', e)


@ns.route('/community-blocked-words')
class AdminBlockedWords(Resource):
    @jwt_required()
    def get(self):
        try:
            if not can(AREA_MODERATION):
                return _denied()
            return jsonify(response={'words': call_proc('sp_cm_blocked_words') or []}, status=200, bool=True)
        except Exception as e:
            return _err('GET /admin/community-blocked-words', e)

    @jwt_required()
    def post(self):
        try:
            if not can(AREA_MODERATION):
                return _denied()
            d = request.get_json() or {}
            word = (d.get('word') or '').strip()
            lang = (d.get('lang') or 'en').strip()[:5]
            if not word or len(word) > 60 or ' ' in word.strip():
                return jsonify(response={'message': 'Add one word (up to 60 characters).'}, status=400, bool=False)
            admin = get_jwt_identity()
            call_proc_one('sp_cm_blocked_word_add', word, lang if lang in ('en', 'te', 'hi') else 'en', admin)
            db.session.commit()
            log_audit('community_blocked_word_added', 'community_blocked_words', word, admin, {'lang': lang})
            return jsonify(response={'message': 'Added.'}, status=201, bool=True)
        except Exception as e:
            return _err('POST /admin/community-blocked-words', e)


@ns.route('/community-blocked-words/<string:word>')
class AdminBlockedWord(Resource):
    @jwt_required()
    def delete(self, word):
        try:
            if not can(AREA_MODERATION):
                return _denied()
            n = (call_proc_one('sp_cm_blocked_word_delete', word) or {}).get('deleted', 0)
            db.session.commit()
            log_audit('community_blocked_word_removed', 'community_blocked_words', word, get_jwt_identity(), {})
            return jsonify(response={'message': 'Removed.' if n else 'Not in the list.'}, status=200, bool=True)
        except Exception as e:
            return _err('DELETE /admin/community-blocked-words', e)


@ns.route('/communities/<string:group_id>/chat')
class AdminCommunityChat(Resource):
    @jwt_required()
    def get(self, group_id):
        try:
            if not can(AREA_MODERATION):
                return _denied()
            rows = call_proc('sp_cm_messages_list', group_id, 0, int(request.args.get('before') or 0), 100) or []
            return jsonify(response={'messages': [{
                'id': r['id'], 'seq': int(r['seq']), 'sender_id': r['sender_id'], 'sender_name': r.get('sender_name'),
                'body': r.get('body'), 'deleted': bool(r.get('deleted_at')), 'flags': r.get('flags_json'),
                'is_doubt': bool(r.get('is_doubt')),
                'created_at': r['created_at'].isoformat() if r.get('created_at') else None,
            } for r in rows]}, status=200, bool=True)
        except Exception as e:
            return _err('GET /admin/communities/<id>/chat', e)
