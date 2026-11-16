"""Leaderboard — student API (feature-updates.md §4).

GET /gamification/board?scope=school|district|state|india&period=week|month|season&branch=1
GET /gamification/board/profile          my alias / photo setting
PUT /gamification/board/profile          {alias, hide_photo}  (students cannot hide)
GET /gamification/league                 my weekly league group
GET /gamification/hall-of-fame?mine=1
"""
from portal.helpers.error_capture import capture_error
import re
from flask import jsonify, request
from flask_restx import Resource
from flask_jwt_extended import jwt_required, get_jwt_identity
from portal.models import db
from portal.helpers.sp import call_proc, call_proc_one
from portal.helpers import leaderboard as lb
from . import ns, logger

ALIAS_RE = re.compile(r"^[\w .\-]{2,40}$", re.UNICODE)
PHONE_RE = re.compile(r"\d{6,}")


def _err(where, e):
    db.session.rollback()
    logger.error(f"{where}: {e}")
    return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)},
                   status=500, bool=False)


@ns.route('/board')
class Board(Resource):
    @jwt_required()
    def get(self):
        try:
            a = request.args
            page = max(1, int(a.get('page') or 1))
            data = lb.board(get_jwt_identity(), a.get('scope') or 'school', a.get('period') or 'week',
                            by_branch=a.get('branch') in ('1', 'true'), limit=50, offset=(page - 1) * 50)
            return jsonify(response=data, status=200, bool=True)
        except Exception as e:
            return _err('GET /gamification/board', e)


@ns.route('/board/profile')
class BoardProfile(Resource):
    @jwt_required()
    def get(self):
        try:
            r = call_proc_one('sp_lb_profile_get', get_jwt_identity()) or {}
            db.session.commit()
            return jsonify(response={'alias': r.get('alias'), 'hide_photo': bool(r.get('hide_photo'))},
                           status=200, bool=True)
        except Exception as e:
            return _err('GET /gamification/board/profile', e)

    @jwt_required()
    def put(self):
        try:
            d = request.get_json() or {}
            alias = (d.get('alias') or '').strip()
            if alias and (not ALIAS_RE.match(alias) or PHONE_RE.search(alias)):
                return jsonify(response={'message': 'Alias: 2–40 letters, numbers, spaces, dots or dashes. No phone numbers.'},
                               status=400, bool=False)
            hide = d.get('hide_photo')
            hide = None if hide is None else (1 if hide in (True, 1, '1', 'true') else 0)
            r = call_proc_one('sp_lb_profile_set', get_jwt_identity(), alias, hide) or {}
            db.session.commit()
            return jsonify(response={'alias': r.get('alias'), 'hide_photo': bool(r.get('hide_photo')),
                                     'message': 'Saved.'}, status=200, bool=True)
        except Exception as e:
            return _err('PUT /gamification/board/profile', e)


@ns.route('/league')
class MyLeague(Resource):
    @jwt_required()
    def get(self):
        try:
            return jsonify(response=lb.league(get_jwt_identity()), status=200, bool=True)
        except Exception as e:
            return _err('GET /gamification/league', e)


@ns.route('/hall-of-fame')
class HallOfFame(Resource):
    @jwt_required()
    def get(self):
        try:
            me = get_jwt_identity()
            mine = request.args.get('mine') in ('1', 'true')
            s = lb.settings()
            rows = call_proc('sp_hof_list', me if mine else None, request.args.get('season') or None) or []
            return jsonify(response={'entries': [{
                'season': r['season_label'], 'stage_group': r['stage_group'], 'sub_year': r['sub_year'],
                'scope': r['scope'], 'scope_value': r['scope_value'], 'rank': r['rank'],
                'points': float(r['points'] or 0), 'is_me': r['user_id'] == me,
                'name': lb.display_name(r, s.get('name_format') or 'full'),
            } for r in rows]}, status=200, bool=True)
        except Exception as e:
            return _err('GET /gamification/hall-of-fame', e)


@ns.route('/tournament')
class CurrentTournament(Resource):
    """The open Diamond tournament for my class, if one is running (§7)."""

    @jwt_required()
    def get(self):
        try:
            from sqlalchemy import text
            t = db.session.execute(text(
                "SELECT id FROM tournaments WHERE status = 'open' ORDER BY starts_on DESC LIMIT 1")).first()
            if not t:
                return jsonify(response={'tournament': None}, status=200, bool=True)
            return jsonify(response={'tournament': lb.tournament_board(t[0], get_jwt_identity(), 50)},
                           status=200, bool=True)
        except Exception as e:
            return _err('GET /gamification/tournament', e)
