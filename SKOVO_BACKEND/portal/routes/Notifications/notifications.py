from portal.helpers.error_capture import capture_error
from portal.helpers.helpers import serialize_datetime
import json
import time
import uuid
from flask import jsonify, Response, request, stream_with_context
from flask_restx import Resource
from flask_jwt_extended import jwt_required, get_jwt_identity, decode_token
from portal.helpers.sp import call_proc, call_proc_one
from portal.models import db
from . import ns, logger


def _serialize(n):
    ca = n.get('created_at')
    return {
        'id':         n.get('id'),
        'title':      n.get('title'),
        'message':    n.get('body'),
        'type':       n.get('type') or 'system',
        'is_read':    bool(n.get('is_read')),
        'reference_type': n.get('reference_type'),
        'reference_id':   n.get('reference_id'),
        'created_at': serialize_datetime(ca) if ca else None,
    }


@ns.route('/register-device')
class RegisterDevice(Resource):
    @jwt_required()
    def post(self):
        """Save/refresh a mobile push token for the current user (Expo/FCM/APNs)."""
        try:
            user_id = get_jwt_identity()
            data = request.get_json() or {}
            token = (data.get('token') or '').strip()
            platform = (data.get('platform') or 'android')[:10]
            if not token:
                return jsonify(response={'message': 'token required.'}, status=400, bool=False)
            call_proc('sp_notif_register_device', str(uuid.uuid4()), user_id, token, platform)
            db.session.commit()
            return jsonify(response={'message': 'Device registered.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/')
class NotificationList(Resource):
    @jwt_required()
    def get(self):
        try:
            user_id = get_jwt_identity()
            # ?page= turns on paging (with a total, for "Load more"); without it
            # the old latest-50 list is returned, so other callers are unchanged.
            if request.args.get('page'):
                try:
                    page = max(1, int(request.args.get('page', 1)))
                    per_page = min(100, max(1, int(request.args.get('per_page', 20))))
                except ValueError:
                    page, per_page = 1, 20
                rows = call_proc('sp_notif_list_page', user_id, per_page, (page - 1) * per_page)
                total = int(rows[0]['total_rows']) if rows else 0
                return jsonify(response={
                    'notifications': [_serialize({k: v for k, v in n.items() if k != 'total_rows'}) for n in rows],
                    'total': total, 'page': page, 'per_page': per_page,
                    'has_more': page * per_page < total,
                }, status=200, bool=True)
            notifs = call_proc('sp_notif_list', user_id)
            return jsonify(response={'notifications': [_serialize(n) for n in notifs]}, status=200, bool=True)
        except Exception as e:
            logger.error(f"GET /notifications error: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/unread-count')
class NotificationUnreadCount(Resource):
    @jwt_required()
    def get(self):
        try:
            user_id = get_jwt_identity()
            res = call_proc_one('sp_notif_unread_count', user_id)
            return jsonify(response={'count': res.get('count') if res else 0}, status=200, bool=True)
        except Exception as e:
            logger.error(f"GET /notifications/unread-count error: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/mark-all-read')
class NotificationMarkAllRead(Resource):
    @jwt_required()
    def post(self):
        try:
            user_id = get_jwt_identity()
            call_proc('sp_notif_mark_all_read', user_id)
            db.session.commit()
            return jsonify(response={'message': 'All notifications marked as read.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"POST /notifications/mark-all-read error: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/stream')
class NotificationStream(Resource):
    def get(self):
        """
        SSE stream — client connects with ?token=<access_token>.
        Polls DB every 4s (via sp_notif_stream_after) and pushes new notifications.
        """
        raw_token = request.args.get('token', '')
        if not raw_token:
            return jsonify(response={'message': 'token required'}, status=401, bool=False)

        from portal.helpers.jwt import _account_deactivated
        try:
            decoded = decode_token(raw_token)
            if decoded.get('type') != 'access':
                return jsonify(response={'message': 'Invalid token'}, status=401, bool=False)
            if _account_deactivated(decoded):
                return jsonify(response={'message': 'Token has been revoked'}, status=401, bool=False)
            user_id = decoded.get('sub')
        except Exception:
            return jsonify(response={'message': 'Invalid token'}, status=401, bool=False)

        def generate(uid, claims):
            last_id = None
            cycles = 0
            yield ": connected\n\n"
            while True:
                cycles += 1
                if cycles % 15 == 0 and _account_deactivated(claims):
                    yield "event: revoked\ndata: {}\n\n"
                    break
                try:
                    notifs = call_proc('sp_notif_stream_after', uid, last_id)
                    for n in notifs:
                        last_id = n.get('id')
                        yield f"data: {json.dumps(_serialize(n))}\n\n"
                    if not notifs:
                        yield ": ping\n\n"
                except Exception as e:
                    logger.error(f"SSE stream error: {e}")
                    yield ": error\n\n"
                time.sleep(4)

        return Response(
            stream_with_context(generate(user_id, decoded)),
            mimetype='text/event-stream',
            headers={
                'Cache-Control': 'no-cache',
                'X-Accel-Buffering': 'no',
                'Connection': 'keep-alive',
            }
        )


@ns.route('/<string:notif_id>/read')
class NotificationMarkRead(Resource):
    @jwt_required()
    def patch(self, notif_id):
        try:
            user_id = get_jwt_identity()
            res = call_proc_one('sp_notif_mark_read', notif_id, user_id)
            db.session.commit()
            if not res or not res.get('updated'):
                return jsonify(response={'message': 'Notification not found.'}, status=404, bool=False)
            return jsonify(response={'message': 'Marked as read.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"PATCH /notifications/{notif_id}/read error: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/<string:notif_id>/unread')
class NotificationMarkUnread(Resource):
    @jwt_required()
    def patch(self, notif_id):
        """Flag a read notification to come back to."""
        try:
            user_id = get_jwt_identity()
            res = call_proc_one('sp_notif_mark_unread', notif_id, user_id)
            db.session.commit()
            if not res or not res.get('updated'):
                return jsonify(response={'message': 'Notification not found.'}, status=404, bool=False)
            return jsonify(response={'message': 'Marked as unread.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"PATCH /notifications/{notif_id}/unread error: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)
