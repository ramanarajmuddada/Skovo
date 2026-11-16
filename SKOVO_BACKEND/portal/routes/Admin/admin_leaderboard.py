"""Admin — leaderboard, leagues, Hall of Fame (feature-updates.md §4).

GET/PUT /leaderboard/settings            on/off, daily cap, name format, photos
GET/PUT /leaderboard/leagues             on/off, group size, promote / demote, tiers
GET     /leaderboard/rule-points         every score rule with its leaderboard points
PUT     /leaderboard/rule-points/<event> set leaderboard points (payments stay 0)
GET     /leaderboard/removed             students removed from boards
POST    /leaderboard/remove/<user_id>    {reason}  remove
POST    /leaderboard/restore/<user_id>   put back
POST    /leaderboard/close-season        {season_label}  write the Hall of Fame
"""
from portal.helpers.error_capture import capture_error
from flask import jsonify, request
from flask_restx import Resource
from flask_jwt_extended import jwt_required, get_jwt_identity
from portal.models import db
from portal.helpers.sp import call_proc, call_proc_one
from portal.helpers.admin_auth import can, AREA_SCORE, AREA_MODERATION
from portal.helpers.audit import log_audit
from portal.helpers import leaderboard as lb
from . import ns, logger

NAME_FORMATS = ('full', 'initial')


def _int(v, default=None):
    try:
        return int(v) if v not in (None, '', 'null') else default
    except (ValueError, TypeError):
        return default


def _bool(v):
    return None if v is None else (1 if v in (True, 1, '1', 'true') else 0)


def _denied():
    return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)


def _err(where, e):
    db.session.rollback()
    logger.error(f"{where}: {e}")
    return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)},
                   status=500, bool=False)


def _lb(r):
    r = r or {}
    return {'enabled': bool(r.get('enabled')), 'daily_cap': int(r.get('daily_cap') or 0),
            'name_format': r.get('name_format') or 'full', 'photos': bool(r.get('photos'))}


def _league(r):
    r = r or {}
    return {'enabled': bool(r.get('enabled')), 'group_size': int(r.get('group_size') or 0),
            'promote_count': int(r.get('promote_count') or 0), 'demote_count': int(r.get('demote_count') or 0),
            'tiers': [t.strip() for t in (r.get('tiers') or '').split(',') if t.strip()]}


@ns.route('/leaderboard/settings')
class AdminLbSettings(Resource):
    @jwt_required()
    def get(self):
        try:
            if not can(AREA_SCORE):
                return _denied()
            return jsonify(response={'settings': _lb(lb.settings())}, status=200, bool=True)
        except Exception as e:
            return _err('GET /admin/leaderboard/settings', e)

    @jwt_required()
    def put(self):
        try:
            if not can(AREA_SCORE):
                return _denied()
            d = request.get_json() or {}
            cap = _int(d.get('daily_cap'))
            if cap is not None and not (0 <= cap <= 1000):
                return jsonify(response={'message': 'Daily cap must be 0–1000 (0 = no cap).'}, status=400, bool=False)
            fmt = d.get('name_format')
            if fmt is not None and fmt not in NAME_FORMATS:
                return jsonify(response={'message': 'Name format must be full or initial.'}, status=400, bool=False)
            admin = get_jwt_identity()
            before = _lb(lb.settings())
            row = call_proc_one('sp_lb_settings_set', _bool(d.get('enabled')), cap, fmt, _bool(d.get('photos')), admin)
            db.session.commit()
            log_audit('leaderboard_settings_updated', 'lb_settings', '1', admin, {'before': before, 'after': _lb(row)})
            return jsonify(response={'settings': _lb(row), 'message': 'Saved.'}, status=200, bool=True)
        except Exception as e:
            return _err('PUT /admin/leaderboard/settings', e)


@ns.route('/leaderboard/leagues')
class AdminLeagueSettings(Resource):
    @jwt_required()
    def get(self):
        try:
            if not can(AREA_SCORE):
                return _denied()
            return jsonify(response={'settings': _league(lb.league_settings())}, status=200, bool=True)
        except Exception as e:
            return _err('GET /admin/leaderboard/leagues', e)

    @jwt_required()
    def put(self):
        try:
            if not can(AREA_SCORE):
                return _denied()
            d = request.get_json() or {}
            size, up, down = _int(d.get('group_size')), _int(d.get('promote_count')), _int(d.get('demote_count'))
            if size is not None and not (5 <= size <= 200):
                return jsonify(response={'message': 'Group size must be 5–200.'}, status=400, bool=False)
            eff = size or int(lb.league_settings().get('group_size') or 30)
            if (up or 0) + (down or 0) >= eff:
                return jsonify(response={'message': 'Promote + demote must be smaller than the group size.'},
                               status=400, bool=False)
            tiers = d.get('tiers')
            if isinstance(tiers, list):
                tiers = [str(t).strip()[:30] for t in tiers if str(t).strip()]
                if not (2 <= len(tiers) <= 10):
                    return jsonify(response={'message': 'Use 2–10 league tiers.'}, status=400, bool=False)
                tiers = ','.join(tiers)
            else:
                tiers = None
            admin = get_jwt_identity()
            before = _league(lb.league_settings())
            row = call_proc_one('sp_league_settings_set', _bool(d.get('enabled')), size, up, down, tiers, admin)
            db.session.commit()
            log_audit('league_settings_updated', 'league_settings', '1', admin, {'before': before, 'after': _league(row)})
            return jsonify(response={'settings': _league(row), 'message': 'Saved.'}, status=200, bool=True)
        except Exception as e:
            return _err('PUT /admin/leaderboard/leagues', e)


@ns.route('/leaderboard/rule-points')
class AdminLbRulePoints(Resource):
    @jwt_required()
    def get(self):
        try:
            if not can(AREA_SCORE):
                return _denied()
            rows = call_proc('sp_lb_rule_points_list') or []
            return jsonify(response={'rules': [{
                'event_type': r['event_type'], 'label': r['label'], 'readiness_points': float(r['points'] or 0),
                'is_active': bool(r['is_active']), 'leaderboard_points': float(r['leaderboard_points'] or 0),
                'is_payment': lb.is_payment_rule(r['event_type']),
            } for r in rows]}, status=200, bool=True)
        except Exception as e:
            return _err('GET /admin/leaderboard/rule-points', e)


@ns.route('/leaderboard/rule-points/<string:event_type>')
class AdminLbRulePoint(Resource):
    @jwt_required()
    def put(self, event_type):
        try:
            if not can(AREA_SCORE):
                return _denied()
            if lb.is_payment_rule(event_type):
                return jsonify(response={'message': 'Payments never give leaderboard points.'}, status=400, bool=False)
            try:
                pts = float((request.get_json() or {}).get('leaderboard_points'))
            except (TypeError, ValueError):
                return jsonify(response={'message': 'Enter leaderboard points (0–100).'}, status=400, bool=False)
            if not (0 <= pts <= 100):
                return jsonify(response={'message': 'Leaderboard points must be 0–100.'}, status=400, bool=False)
            admin = get_jwt_identity()
            row = call_proc_one('sp_lb_rule_points_set', event_type, pts)
            db.session.commit()
            if not row:
                return jsonify(response={'message': 'Rule not found.'}, status=404, bool=False)
            log_audit('leaderboard_points_set', 'score_event_rules', event_type, admin, {'points': pts})
            return jsonify(response={'event_type': event_type, 'leaderboard_points': float(row['leaderboard_points'])},
                           status=200, bool=True)
        except Exception as e:
            return _err('PUT /admin/leaderboard/rule-points', e)


@ns.route('/leaderboard/removed')
class AdminLbRemoved(Resource):
    @jwt_required()
    def get(self):
        try:
            if not (can(AREA_MODERATION) or can(AREA_SCORE)):
                return _denied()
            rows = call_proc('sp_lb_removed_list') or []
            return jsonify(response={'removed': [{
                'user_id': r['user_id'], 'full_name': r['full_name'], 'email': r['email'],
                'reason': r['removed_reason'],
                'removed_at': r['removed_at'].isoformat() if r.get('removed_at') else None,
            } for r in rows]}, status=200, bool=True)
        except Exception as e:
            return _err('GET /admin/leaderboard/removed', e)


@ns.route('/leaderboard/remove/<string:user_id>')
class AdminLbRemove(Resource):
    @jwt_required()
    def post(self, user_id):
        try:
            if not (can(AREA_MODERATION) or can(AREA_SCORE)):
                return _denied()
            reason = ((request.get_json() or {}).get('reason') or '').strip()
            if not reason:
                return jsonify(response={'message': 'A reason is required.'}, status=400, bool=False)
            admin = get_jwt_identity()
            call_proc_one('sp_lb_remove', user_id, 1, reason[:255], admin)
            db.session.commit()
            log_audit('leaderboard_student_removed', 'users', user_id, admin, {'reason': reason})
            return jsonify(response={'message': 'Removed from all leaderboards.'}, status=200, bool=True)
        except Exception as e:
            return _err('POST /admin/leaderboard/remove', e)


@ns.route('/leaderboard/restore/<string:user_id>')
class AdminLbRestore(Resource):
    @jwt_required()
    def post(self, user_id):
        try:
            if not (can(AREA_MODERATION) or can(AREA_SCORE)):
                return _denied()
            admin = get_jwt_identity()
            call_proc_one('sp_lb_remove', user_id, 0, None, admin)
            db.session.commit()
            log_audit('leaderboard_student_restored', 'users', user_id, admin, {})
            return jsonify(response={'message': 'Back on the leaderboards.'}, status=200, bool=True)
        except Exception as e:
            return _err('POST /admin/leaderboard/restore', e)


@ns.route('/leaderboard/close-season')
class AdminCloseSeason(Resource):
    @jwt_required()
    def post(self):
        try:
            if not can(AREA_SCORE):
                return _denied()
            d = request.get_json() or {}
            label = (d.get('season_label') or '').strip()
            if not label or len(label) > 60:
                return jsonify(response={'message': 'Give the season a name, e.g. "2026-27".'}, status=400, bool=False)
            top_n = _int(d.get('top_n'), 10)
            if not (1 <= top_n <= 100):
                return jsonify(response={'message': 'Top N must be 1–100.'}, status=400, bool=False)
            admin = get_jwt_identity()
            res = lb.close_season(label, admin, top_n)
            if res.get('error') == 'exists':
                return jsonify(response={'message': 'That season is already in the Hall of Fame.'}, status=409, bool=False)
            db.session.commit()
            log_audit('season_closed', 'hall_of_fame', label, admin, res)
            return jsonify(response={'message': f"Hall of Fame written: {res['added']} entries.", **res},
                           status=200, bool=True)
        except Exception as e:
            return _err('POST /admin/leaderboard/close-season', e)
