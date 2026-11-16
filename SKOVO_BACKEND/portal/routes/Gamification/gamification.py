"""
Gamification — badges, streaks, leaderboard (SP-only: sp_badges_*, sp_streak_*, sp_leaderboard)
Admin: manage badges. Student: view own badges/streaks.
"""
from portal.helpers.error_capture import capture_error
from portal.helpers.helpers import serialize_datetime
import uuid
import json
import datetime
from flask import jsonify, request
from flask_restx import Resource
from flask_jwt_extended import jwt_required, get_jwt_identity
from portal.helpers.decorators import require_role
from portal.helpers.sp import call_proc, call_proc_one
from portal.models import db
from . import ns, logger

from portal.api import api as _api
_admin_ns = _api.namespace('admin', description='Admin Panel')


def _as_json(v):
    if isinstance(v, str):
        try:
            return json.loads(v)
        except Exception:
            return v
    return v


# ── Admin: manage badge definitions ──────────────────────────────────────────

@_admin_ns.route('/badges')
class AdminBadgeList(Resource):
    @require_role('admin', 'super_admin')
    def get(self):
        try:
            badges = [_badge_dict(b) for b in call_proc('sp_badges_list')]
            return jsonify(response={'badges': badges}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @require_role('admin', 'super_admin')
    def post(self):
        try:
            data = request.get_json() or {}
            if not data.get('name'):
                return jsonify(response={'message': 'name required.'}, status=400, bool=False)
            new_id = str(uuid.uuid4())
            criteria = data.get('criteria')
            call_proc(
                'sp_badges_create',
                new_id, data['name'].strip(), data.get('description'), data.get('icon_url'),
                data.get('badge_type', 'achievement'),
                json.dumps(criteria) if criteria is not None else None,
                int(data.get('points') or 10),
            )
            db.session.commit()
            return jsonify(response={'message': 'Badge created.', 'id': new_id}, status=201, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@_admin_ns.route('/badges/<string:badge_id>/award/<string:user_id>')
class AdminAwardBadge(Resource):
    @require_role('admin', 'super_admin')
    def post(self, badge_id, user_id):
        try:
            res = call_proc_one('sp_badges_award', badge_id, user_id)
            result = (res or {}).get('result')
            if result == 'no_badge':
                return jsonify(response={'message': 'Badge not found.'}, status=404, bool=False)
            if result == 'already':
                return jsonify(response={'message': 'Already awarded.'}, status=409, bool=False)
            return jsonify(response={'message': 'Badge awarded.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


# ── Student: view own gamification state ─────────────────────────────────────

@ns.route('/my-badges')
class MyBadges(Resource):
    @jwt_required()
    def get(self):
        try:
            user_id = get_jwt_identity()
            result = []
            for ub in call_proc('sp_my_badges', user_id):
                ea = ub.get('earned_at')
                result.append({**_badge_dict(ub), 'earned_at': serialize_datetime(ea) if ea else None})
            return jsonify(response={'badges': result, 'total': len(result)}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/my-streak')
class MyStreak(Resource):
    """Kept for older app versions. The career streak (GET /gamification/streak)
    replaced the manual check-in: login alone never keeps a streak (§3)."""

    @jwt_required()
    def get(self):
        try:
            from portal.helpers import streaks
            s = streaks.summary(get_jwt_identity(), days=1)
            db.session.commit()
            return jsonify(response={
                'current_streak': s['lifetime_current'],
                'longest_streak': s['lifetime_best'],
                'stage_streak': s['stage_current'],
                'total_points': 0,
                'last_active_date': None,
            }, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @jwt_required()
    def post(self):
        """No-op: a check-in no longer keeps the streak. Do a task instead."""
        return jsonify(response={'message': 'Your streak grows when you complete a task, quiz or lesson.'},
                       status=200, bool=True)


@ns.route('/leaderboard')
class Leaderboard(Resource):
    """Kept for older app versions. Now the same-class board (§4): this week,
    the student's own school, never the whole platform. New screens use
    GET /gamification/board."""

    @jwt_required()
    def get(self):
        try:
            from portal.helpers import leaderboard as lb
            data = lb.board(get_jwt_identity(), 'school', 'week')
            result = [{
                'user_id': r['user_id'], 'full_name': r['name'], 'avatar_url': r['photo'],
                'total_points': r['points'], 'current_streak': r['stage_streak'],
            } for r in data.get('rows', [])]
            return jsonify(response={'leaderboard': result}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


def _badge_dict(b):
    return {
        'id': b.get('id'), 'name': b.get('name'), 'description': b.get('description'),
        'icon_url': b.get('icon_url'), 'badge_type': b.get('badge_type'),
        'criteria': _as_json(b.get('criteria')), 'points': b.get('points'),
        'is_active': bool(b.get('is_active')),
    }
