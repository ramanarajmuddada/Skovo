"""Career streaks — student API (feature-updates.md §3).

GET    /gamification/streak                 both counters, freezes, calendar
GET    /gamification/streak/buddies         active + pending buddy streaks
POST   /gamification/streak/buddies/invite  new invite code (share link / QR)
POST   /gamification/streak/buddies/accept  {code}
DELETE /gamification/streak/buddies/<id>    end a buddy streak
"""
from portal.helpers.error_capture import capture_error
from flask import jsonify, request
from flask_restx import Resource
from flask_jwt_extended import jwt_required, get_jwt_identity
from portal.models import db
from portal.helpers import streaks
from . import ns, logger

_ACCEPT_MESSAGES = {
    'invalid_code': 'That invite code is not valid or was already used.',
    'own_code': 'That is your own invite code.',
    'already_buddies': 'You already have a streak with this student.',
    'buddy_limit': 'One of you already has the maximum number of buddies.',
    'different_class': 'Buddy streaks are only with students in your own class.',
}
_GROUP_MESSAGES = {
    'invalid_code': 'That group code is not valid, or the group has ended.',
    'already_member': 'You are already in this group.',
    'different_class': 'Groups are only with students in your own class.',
    'group_full': 'That group is full.',
    'group_limit': 'You are already in the maximum number of groups.',
}


def _err(where, e):
    db.session.rollback()
    logger.error(f"{where}: {e}")
    return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)},
                   status=500, bool=False)


def _buddy_dict(b, me):
    return {
        'id': b.get('id'),
        'status': b.get('status'),
        'invite_code': b.get('invite_code') if b.get('user_a') == me and b.get('status') == 'pending' else None,
        'buddy_id': b.get('buddy_id'),
        'buddy_name': b.get('buddy_name'),
        'buddy_avatar': b.get('buddy_avatar'),
        'current': int(b.get('current') or 0),
        'best': int(b.get('best') or 0),
        'kept_through': b['covered_through'].isoformat() if b.get('covered_through') else None,
        'buddy_done_today': bool(b.get('buddy_done_today')),
        'nudged_today': bool(b.get('nudged_today')),
    }


@ns.route('/streak')
class MyCareerStreak(Resource):
    @jwt_required()
    def get(self):
        try:
            user_id = get_jwt_identity()
            data = streaks.summary(user_id)
            db.session.commit()       # sp_streak_get creates the row on first read
            return jsonify(response=data, status=200, bool=True)
        except Exception as e:
            return _err('GET /gamification/streak', e)


@ns.route('/streak/groups')
class Groups(Resource):
    @jwt_required()
    def get(self):
        try:
            me = get_jwt_identity()
            s = streaks.settings()
            return jsonify(response={
                'enabled': bool(s.get('enabled')) and bool(s.get('group_enabled')),
                'min': int(s.get('group_min') or 3), 'max': int(s.get('group_max') or 5),
                'per_student': int(s.get('group_per_student') or 1),
                'groups': streaks.groups(me)}, status=200, bool=True)
        except Exception as e:
            return _err('GET /gamification/streak/groups', e)

    @jwt_required()
    def post(self):
        try:
            me = get_jwt_identity()
            s = streaks.settings()
            if not (s.get('enabled') and s.get('group_enabled')):
                return jsonify(response={'message': 'Group streaks are not switched on.'}, status=409, bool=False)
            name = ((request.get_json() or {}).get('name') or '').strip()
            if len(name) < 2:
                return jsonify(response={'message': 'Give your group a name.'}, status=400, bool=False)
            res = streaks.group_create(me, name)
            db.session.commit()
            if not res.get('ok'):
                return jsonify(response={'message': _GROUP_MESSAGES.get(res.get('result'), 'Could not create.')},
                               status=409, bool=False)
            return jsonify(response={'message': 'Group created.', 'invite_code': res.get('invite_code'),
                                     'id': res.get('id')}, status=201, bool=True)
        except Exception as e:
            return _err('POST /gamification/streak/groups', e)


@ns.route('/streak/groups/join')
class GroupJoin(Resource):
    @jwt_required()
    def post(self):
        try:
            me = get_jwt_identity()
            s = streaks.settings()
            if not (s.get('enabled') and s.get('group_enabled')):
                return jsonify(response={'message': 'Group streaks are not switched on.'}, status=409, bool=False)
            code = ((request.get_json() or {}).get('code') or '').strip()
            if not code:
                return jsonify(response={'message': 'Enter the group code.'}, status=400, bool=False)
            res = streaks.group_join(me, code)
            db.session.commit()
            if not res.get('ok'):
                return jsonify(response={'message': _GROUP_MESSAGES.get(res.get('result'), 'Could not join.')},
                               status=409, bool=False)
            from portal.helpers.notifications import notify_user
            notify_user(res.get('owner_id'), 'Someone joined your group',
                        'Your group streak grows on days every member does one task.',
                        type='system', reference_type='streak')
            return jsonify(response={'message': 'You joined the group.'}, status=200, bool=True)
        except Exception as e:
            return _err('POST /gamification/streak/groups/join', e)


@ns.route('/streak/groups/<string:group_id>')
class GroupLeave(Resource):
    @jwt_required()
    def delete(self, group_id):
        try:
            res = streaks.group_leave(get_jwt_identity(), group_id)
            db.session.commit()
            if not res.get('ok'):
                return jsonify(response={'message': 'You are not in that group.'}, status=404, bool=False)
            return jsonify(response={'message': 'You left the group.'}, status=200, bool=True)
        except Exception as e:
            return _err('DELETE /gamification/streak/groups/<id>', e)


_NUDGE_MESSAGES = {
    'sent': 'Nudge sent 👋',
    'already_nudged': 'You already nudged them today.',
    'already_done': 'They have already done a task today.',
    'not_partners': 'You can only nudge your buddies and group members.',
    'self': 'That is you.',
}


@ns.route('/streak/nudge')
class Nudge(Resource):
    @jwt_required()
    def post(self):
        try:
            to = ((request.get_json() or {}).get('user_id') or '').strip()
            if not to:
                return jsonify(response={'message': 'Who to nudge?'}, status=400, bool=False)
            result = streaks.nudge(get_jwt_identity(), to)
            db.session.commit()
            ok = result == 'sent'
            return jsonify(response={'message': _NUDGE_MESSAGES.get(result, 'Could not nudge.'), 'result': result},
                           status=200 if ok else 409, bool=ok)
        except Exception as e:
            return _err('POST /gamification/streak/nudge', e)


@ns.route('/streak/social-leaderboard')
class SocialLeaderboard(Resource):
    @jwt_required()
    def get(self):
        try:
            s = streaks.settings()
            if not (s.get('enabled') and s.get('social_leaderboard')):
                return jsonify(response={'enabled': False, 'pairs': [], 'groups': []}, status=200, bool=True)
            data = streaks.social_leaderboard(get_jwt_identity())
            return jsonify(response={'enabled': True, **data}, status=200, bool=True)
        except Exception as e:
            return _err('GET /gamification/streak/social-leaderboard', e)


@ns.route('/streak/buddies')
class Buddies(Resource):
    @jwt_required()
    def get(self):
        try:
            me = get_jwt_identity()
            return jsonify(response={'buddies': [_buddy_dict(b, me) for b in streaks.buddies(me)],
                                     'max': int(streaks.settings().get('buddy_max') or 0)},
                           status=200, bool=True)
        except Exception as e:
            return _err('GET /gamification/streak/buddies', e)


@ns.route('/streak/buddies/invite')
class BuddyInvite(Resource):
    @jwt_required()
    def post(self):
        try:
            me = get_jwt_identity()
            if not streaks.settings().get('enabled'):
                return jsonify(response={'message': 'Streaks are not switched on yet.'}, status=409, bool=False)
            row = streaks.invite(me)
            db.session.commit()
            return jsonify(response={'invite_code': row.get('invite_code'), 'id': row.get('id')},
                           status=201, bool=True)
        except Exception as e:
            return _err('POST /gamification/streak/buddies/invite', e)


@ns.route('/streak/buddies/accept')
class BuddyAccept(Resource):
    @jwt_required()
    def post(self):
        try:
            me = get_jwt_identity()
            code = ((request.get_json() or {}).get('code') or '').strip()
            if not code:
                return jsonify(response={'message': 'Enter the invite code.'}, status=400, bool=False)
            res = streaks.accept(me, code)
            db.session.commit()
            if not res.get('ok'):
                return jsonify(response={'message': _ACCEPT_MESSAGES.get(res.get('result'), 'Could not accept.')},
                               status=409, bool=False)
            from portal.helpers.notifications import notify_user
            notify_user(res.get('buddy_id'), 'New buddy streak',
                        'Your invite was accepted — do one task each day, together.',
                        type='system', reference_type='streak')
            return jsonify(response={'message': 'Buddy streak started.'}, status=200, bool=True)
        except Exception as e:
            return _err('POST /gamification/streak/buddies/accept', e)


@ns.route('/streak/buddies/<string:buddy_row_id>')
class BuddyEnd(Resource):
    @jwt_required()
    def delete(self, buddy_row_id):
        try:
            me = get_jwt_identity()
            n = streaks.end_buddy(me, buddy_row_id)
            db.session.commit()
            if not n:
                return jsonify(response={'message': 'Not found.'}, status=404, bool=False)
            return jsonify(response={'message': 'Buddy streak ended.'}, status=200, bool=True)
        except Exception as e:
            return _err('DELETE /gamification/streak/buddies', e)
