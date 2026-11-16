from portal.helpers.error_capture import capture_error
from portal.helpers.helpers import serialize_datetime
import uuid
from flask import jsonify, request
from flask_restx import Resource
from flask_jwt_extended import jwt_required, get_jwt_identity, get_jwt
from portal.helpers.sp import call_proc, call_proc_one
from portal.models import db
from . import ns, logger


def _msg_dict(m):
    from portal.helpers.message_crypto import decrypt_message
    ca = m.get('created_at')
    return {
        'id': m.get('id'),
        'session_id': m.get('session_id'),
        'sender_id': m.get('sender_id'),
        'sender_role': m.get('sender_role'),
        'body': decrypt_message(m.get('body')),
        'is_read': bool(m.get('is_read')),
        'created_at': serialize_datetime(ca) if ca else None,
    }


def _can_access_session(session_id, user_id, role):
    """Check that caller is either the student or the achiever of this session."""
    actors = call_proc_one('sp_chat_session_actors', session_id)
    if not actors:
        return None, 'Session not found.'
    if role == 'student' and actors.get('student_id') != user_id:
        return None, 'Access denied.'
    if role in ('mentor', 'achiever') and actors.get('mentor_id') != user_id:
        return None, 'Access denied.'
    return actors, None


@ns.route('/sessions/<string:session_id>/messages')
class SessionMessageList(Resource):
    @jwt_required()
    def get(self, session_id):
        """Fetch all messages for a session."""
        try:
            user_id = get_jwt_identity()
            role = get_jwt().get('role', 'student')

            session, err = _can_access_session(session_id, user_id, role)
            if err:
                return jsonify(response={'message': err}, status=404 if 'not found' in err else 403, bool=False)

            msgs = call_proc('sp_chat_messages_read_and_list', session_id, user_id)
            db.session.commit()   # the proc marks the other party's messages read
            return jsonify(
                response={'messages': [_msg_dict(m) for m in msgs], 'total': len(msgs)},
                status=200, bool=True
            )
        except Exception as e:
            logger.error(f"GET /chat/sessions/{session_id}/messages error: {e}")
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @jwt_required()
    def post(self, session_id):
        """Send a message in a session thread."""
        try:
            user_id = get_jwt_identity()
            role = get_jwt().get('role', 'student')

            session, err = _can_access_session(session_id, user_id, role)
            if err:
                return jsonify(response={'message': err}, status=404 if 'not found' in err else 403, bool=False)

            data = request.get_json() or {}
            body = (data.get('body') or '').strip()
            if not body:
                return jsonify(response={'message': 'Message body cannot be empty.'}, status=400, bool=False)
            if len(body) > 2000:
                return jsonify(response={'message': 'Message too long (max 2000 chars).'}, status=400, bool=False)

            # Mentor chat safety (feature-updates.md §16 item 12): no phone
            # numbers, no outside links, blocked words masked.
            from portal.helpers import chat_safety
            body, _flags, refuse = chat_safety.clean(body, allow_links=False)
            if refuse:
                return jsonify(response={'message': refuse}, status=400, bool=False)

            from portal.helpers.message_crypto import encrypt_message
            sender_role = 'mentor' if role in ('mentor', 'achiever') else 'student'
            msg = call_proc_one('sp_chat_message_create', str(uuid.uuid4()), session_id, user_id, sender_role, encrypt_message(body))
            db.session.commit()

            # Notify the other party
            try:
                from portal.helpers.notifications import notify_user
                # The notification row is a second copy. Keep the alert, not the words.
                if role == 'student':
                    notify_user(user_id=session.get('mentor_id'), title='New message from student',
                                body='Open the conversation to read it.', type='chat',
                                reference_type='session', reference_id=session_id)
                else:
                    notify_user(user_id=session.get('student_id'), title='Your mentor replied',
                                body='Open the conversation to read it.', type='chat',
                                reference_type='session', reference_id=session_id)
            except Exception:
                pass

            return jsonify(response=_msg_dict(msg), status=201, bool=True)
        except Exception as e:
            logger.error(f"POST /chat/sessions/{session_id}/messages error: {e}")
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/sessions/<string:session_id>/messages/unread-count')
class SessionUnreadCount(Resource):
    @jwt_required()
    def get(self, session_id):
        """Count unread messages from the other party."""
        try:
            user_id = get_jwt_identity()
            role = get_jwt().get('role', 'student')

            session, err = _can_access_session(session_id, user_id, role)
            if err:
                return jsonify(response={'message': err}, status=404 if 'not found' in err else 403, bool=False)

            res = call_proc_one('sp_chat_unread_count', session_id, user_id)
            return jsonify(response={'count': res.get('count') if res else 0}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)
