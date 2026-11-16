"""Admin — career streak rules (feature-updates.md §3).

GET/PUT  /streaks/settings              on/off, freezes, reminder hour, buddy max
GET      /streaks/actions               actions that may count (all inactive by default)
PUT      /streaks/actions/<key>         switch on/off, min per day, segments
GET/POST /streaks/exam-windows          exam dates (no break, no freeze used)
PUT/DEL  /streaks/exam-windows/<id>
GET      /streaks/overview              how many students hold 7 / 30 / 100-day streaks

Milestone points are score rules (streak_7 ... buddy_streak_7) edited in
Score rules, so all points stay in one admin screen.
"""
from portal.helpers.error_capture import capture_error
import datetime
import uuid
from flask import jsonify, request
from flask_restx import Resource
from flask_jwt_extended import jwt_required, get_jwt_identity
from portal.models import db
from portal.helpers.sp import call_proc, call_proc_one
from portal.helpers.admin_auth import can, AREA_SCORE
from portal.helpers.audit import log_audit
from . import ns, logger

# Restore was removed (17 Oct 2026): a missed day is covered by a freeze or
# not at all. The procedure still takes the two restore arguments, so they are
# passed as 0 / unchanged below.
SETTING_KEYS = ('enabled', 'freeze_every_days', 'freeze_max', 'freeze_max_pro',
                'risk_reminder_hour', 'buddy_max')
# Buddy & group streaks card (migrate_v1_streaks_social.py).
SOCIAL_INTS = ('group_min', 'group_max', 'group_per_student', 'invite_expiry_days')
SOCIAL_BOOLS = ('buddy_same_class', 'group_enabled', 'social_leaderboard')


def _int(v, default=None):
    try:
        return int(v) if v not in (None, '', 'null') else default
    except (ValueError, TypeError):
        return default


def _denied():
    return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)


def _err(where, e):
    db.session.rollback()
    logger.error(f"{where}: {e}")
    return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)},
                   status=500, bool=False)


def _settings(r):
    r = r or {}
    out = {k: int(r.get(k) or 0) for k in SETTING_KEYS + SOCIAL_INTS}
    out['enabled'] = bool(r.get('enabled'))
    for k in SOCIAL_BOOLS:
        out[k] = bool(r.get(k))
    return out


def _action(a):
    return {'action_key': a.get('action_key'), 'label': a.get('label'), 'counts': bool(a.get('counts')),
            'min_per_day': int(a.get('min_per_day') or 1), 'segment_stage': a.get('segment_stage'),
            'segment_branch': a.get('segment_branch'), 'segment_state': a.get('segment_state')}


def _window(w):
    return {'id': w.get('id'), 'label': w.get('label'), 'stage_group': w.get('stage_group'),
            'state': w.get('state'), 'start_date': w['start_date'].isoformat() if w.get('start_date') else None,
            'end_date': w['end_date'].isoformat() if w.get('end_date') else None,
            'is_active': bool(w.get('is_active'))}


@ns.route('/streaks/settings')
class AdminStreakSettings(Resource):
    @jwt_required()
    def get(self):
        try:
            if not can(AREA_SCORE):
                return _denied()
            return jsonify(response={'settings': _settings(call_proc_one('sp_streak_settings_get'))},
                           status=200, bool=True)
        except Exception as e:
            return _err('GET /admin/streaks/settings', e)

    @jwt_required()
    def put(self):
        try:
            if not can(AREA_SCORE):
                return _denied()
            d = request.get_json() or {}
            en = d.get('enabled')
            en = None if en is None else (1 if en in (True, 1, '1', 'true') else 0)
            vals = {k: _int(d.get(k)) for k in SETTING_KEYS if k != 'enabled'}
            for k, v in vals.items():
                if v is not None and (v < 0 or v > 1000):
                    return jsonify(response={'message': f'{k} is out of range.'}, status=400, bool=False)
            if vals.get('risk_reminder_hour') is not None and not (0 <= vals['risk_reminder_hour'] <= 23):
                return jsonify(response={'message': 'Reminder hour must be 0–23.'}, status=400, bool=False)
            admin = get_jwt_identity()
            before = _settings(call_proc_one('sp_streak_settings_get'))
            row = call_proc_one('sp_streak_settings_set', en, vals['freeze_every_days'], vals['freeze_max'],
                                vals['freeze_max_pro'], 0, None, vals['risk_reminder_hour'],
                                vals['buddy_max'], admin)
            if any(k in d for k in SOCIAL_INTS + SOCIAL_BOOLS):
                b = lambda k: None if d.get(k) is None else (1 if d.get(k) in (True, 1, '1', 'true') else 0)
                gmin, gmax = _int(d.get('group_min')), _int(d.get('group_max'))
                if gmin is not None and gmax is not None and gmax < gmin:
                    return jsonify(response={'message': 'Largest group size must be at least the smallest.'},
                                   status=400, bool=False)
                row = call_proc_one('sp_streak_social_settings_set', b('buddy_same_class'), b('group_enabled'),
                                    gmin, gmax, _int(d.get('group_per_student')),
                                    _int(d.get('invite_expiry_days')), b('social_leaderboard'))
            db.session.commit()
            after = _settings(row)
            log_audit('streak_settings_updated', 'streak_settings', '1', admin, {'before': before, 'after': after})
            return jsonify(response={'settings': after, 'message': 'Streak settings saved.'},
                           status=200, bool=True)
        except Exception as e:
            return _err('PUT /admin/streaks/settings', e)


@ns.route('/streaks/actions')
class AdminStreakActions(Resource):
    @jwt_required()
    def get(self):
        try:
            if not can(AREA_SCORE):
                return _denied()
            return jsonify(response={'actions': [_action(a) for a in call_proc('sp_streak_actions_list') or []]},
                           status=200, bool=True)
        except Exception as e:
            return _err('GET /admin/streaks/actions', e)


@ns.route('/streaks/actions/<string:key>')
class AdminStreakAction(Resource):
    @jwt_required()
    def put(self, key):
        try:
            if not can(AREA_SCORE):
                return _denied()
            d = request.get_json() or {}
            counts = d.get('counts')
            counts = None if counts is None else (1 if counts in (True, 1, '1', 'true') else 0)
            mn = _int(d.get('min_per_day'))
            if mn is not None and not (1 <= mn <= 50):
                return jsonify(response={'message': 'Minimum per day must be 1–50.'}, status=400, bool=False)
            admin = get_jwt_identity()
            row = call_proc_one('sp_streak_action_set', key, counts, mn, d.get('segment_stage') or '',
                                d.get('segment_branch') or '', d.get('segment_state') or '', admin)
            db.session.commit()
            if not row:
                return jsonify(response={'message': 'Unknown action.'}, status=404, bool=False)
            log_audit('streak_action_updated', 'streak_actions', key, admin, _action(row))
            return jsonify(response={'action': _action(row)}, status=200, bool=True)
        except Exception as e:
            return _err('PUT /admin/streaks/actions/<key>', e)

    @jwt_required()
    def delete(self, key):
        # Hard delete. Days already counted stay counted (streak_days keeps its
        # own record); the action just stops being a choice.
        try:
            if not can(AREA_SCORE):
                return _denied()
            row = call_proc_one('sp_streak_action_delete', key) or {}
            db.session.commit()
            if row.get('result') != 'deleted':
                return jsonify(response={'message': 'Unknown action.'}, status=404, bool=False)
            log_audit('streak_action_deleted', 'streak_actions', key, get_jwt_identity(), {'action_key': key})
            return jsonify(response={'message': 'Streak action deleted.'}, status=200, bool=True)
        except Exception as e:
            return _err('DELETE /admin/streaks/actions/<key>', e)


def _parse_window(d):
    label = (d.get('label') or '').strip()
    try:
        start = datetime.date.fromisoformat(str(d.get('start_date')))
        end = datetime.date.fromisoformat(str(d.get('end_date')))
    except (TypeError, ValueError):
        return None, 'Start and end dates are required (YYYY-MM-DD).'
    if not label:
        return None, 'Give the exam window a name, e.g. "SSC exams 2027".'
    if end < start:
        return None, 'End date is before the start date.'
    if (end - start).days > 120:
        return None, 'An exam window can be at most 120 days.'
    return (label[:120], d.get('stage_group') or '', d.get('state') or '', start, end), None


@ns.route('/streaks/exam-windows')
class AdminExamWindows(Resource):
    @jwt_required()
    def get(self):
        try:
            if not can(AREA_SCORE):
                return _denied()
            return jsonify(response={'windows': [_window(w) for w in call_proc('sp_streak_exam_windows_list') or []]},
                           status=200, bool=True)
        except Exception as e:
            return _err('GET /admin/streaks/exam-windows', e)

    @jwt_required()
    def post(self):
        try:
            if not can(AREA_SCORE):
                return _denied()
            vals, err = _parse_window(request.get_json() or {})
            if err:
                return jsonify(response={'message': err}, status=400, bool=False)
            admin = get_jwt_identity()
            row = call_proc_one('sp_streak_exam_window_upsert', str(uuid.uuid4()), *vals, 1, admin)
            db.session.commit()
            log_audit('streak_exam_window_created', 'streak_exam_windows', row.get('id'), admin, _window(row))
            return jsonify(response={'window': _window(row)}, status=201, bool=True)
        except Exception as e:
            return _err('POST /admin/streaks/exam-windows', e)


@ns.route('/streaks/exam-windows/<string:window_id>')
class AdminExamWindow(Resource):
    @jwt_required()
    def put(self, window_id):
        try:
            if not can(AREA_SCORE):
                return _denied()
            d = request.get_json() or {}
            vals, err = _parse_window(d)
            if err:
                return jsonify(response={'message': err}, status=400, bool=False)
            active = d.get('is_active')
            active = None if active is None else (1 if active in (True, 1, '1', 'true') else 0)
            admin = get_jwt_identity()
            row = call_proc_one('sp_streak_exam_window_upsert', window_id, *vals, active, admin)
            db.session.commit()
            log_audit('streak_exam_window_updated', 'streak_exam_windows', window_id, admin, _window(row))
            return jsonify(response={'window': _window(row)}, status=200, bool=True)
        except Exception as e:
            return _err('PUT /admin/streaks/exam-windows/<id>', e)

    @jwt_required()
    def delete(self, window_id):
        try:
            if not can(AREA_SCORE):
                return _denied()
            n = (call_proc_one('sp_streak_exam_window_delete', window_id) or {}).get('deleted', 0)
            db.session.commit()
            if not n:
                return jsonify(response={'message': 'Not found.'}, status=404, bool=False)
            log_audit('streak_exam_window_deleted', 'streak_exam_windows', window_id, get_jwt_identity(), {})
            return jsonify(response={'message': 'Deleted.'}, status=200, bool=True)
        except Exception as e:
            return _err('DELETE /admin/streaks/exam-windows/<id>', e)


@ns.route('/streaks/overview')
class AdminStreakOverview(Resource):
    @jwt_required()
    def get(self):
        try:
            if not can(AREA_SCORE):
                return _denied()
            row = call_proc_one('sp_streak_admin_overview') or {}
            return jsonify(response={k: int(v or 0) for k, v in row.items()}, status=200, bool=True)
        except Exception as e:
            return _err('GET /admin/streaks/overview', e)
