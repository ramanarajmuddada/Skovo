"""Admin — stages (feature-updates.md §2).

GET  /stages                      list students' stages (search, group, status, paging)
GET  /stages/settings             legacy boost + auto-promotion settings
PUT  /stages/settings             change them (all off by default)
GET  /stages/<user_id>            one student's timeline
POST /stages/<user_id>/rollback   undo a wrong promotion (reason required)
"""
from portal.helpers.error_capture import capture_error
import re
from flask import jsonify, request
from flask_restx import Resource
from flask_jwt_extended import jwt_required, get_jwt_identity
from portal.models import db
from portal.helpers.sp import call_proc, call_proc_one
from portal.helpers.admin_auth import can, AREA_SCORE
from portal.helpers.audit import log_audit
from portal.helpers import stages
from . import ns, logger


def _int(v, default=None):
    try:
        return int(v) if v not in (None, '', 'null') else default
    except (ValueError, TypeError):
        return default


def _denied():
    return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)


def _err(where, e):
    logger.error(f"{where}: {e}")
    return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)},
                   status=500, bool=False)


def _settings_dict(r):
    r = r or {}
    return {
        'legacy_boost_percent': int(r.get('legacy_boost_percent') or 0),
        'legacy_boost_max': int(r.get('legacy_boost_max') or 0),
        'auto_promote_enabled': bool(r.get('auto_promote_enabled')),
        'auto_promote_on': r.get('auto_promote_on') or '07-01',
    }


@ns.route('/stages')
class AdminStageList(Resource):
    @jwt_required()
    def get(self):
        try:
            if not can(AREA_SCORE):
                return _denied()
            a = request.args
            page = max(1, _int(a.get('page'), 1))
            per = max(1, min(100, _int(a.get('per_page'), 25)))
            search = (a.get('search') or '').strip() or None
            group = (a.get('stage_group') or '').strip() or None
            status = (a.get('status') or '').strip() or None
            total = (call_proc_one('sp_stage_admin_count', search, group, status) or {}).get('total', 0)
            rows = call_proc('sp_stage_admin_list', search, group, status, per, (page - 1) * per) or []
            items = []
            for r in rows:
                e = stages.timeline_entry(r)
                e.update({'user_id': r.get('user_id'), 'full_name': r.get('full_name'),
                          'email': r.get('email'), 'close_reason': r.get('close_reason'),
                          # Undo needs an earlier, closed stage to return to.
                          'can_roll_back': r.get('status') == 'active' and int(r.get('closed_stages') or 0) > 0})
                items.append(e)
            return jsonify(response={'stages': items, 'total': total, 'page': page, 'per_page': per,
                                     'groups': stages.group_labels()},
                           status=200, bool=True)
        except Exception as e:
            return _err('GET /admin/stages', e)


@ns.route('/stages/groups')
class AdminStageGroups(Resource):
    """The stage list the filters offer, from master_stage_group (Admin > Masters),
    so no screen keeps its own copy."""
    @jwt_required()
    def get(self):
        try:
            if not can(AREA_SCORE):
                return _denied()
            rows = call_proc('sp_master_list', 'stage_group', 1) or []
            groups = [{'value': r['value'], 'label': r['label']} for r in rows if r.get('value')]
            return jsonify(response={'groups': groups}, status=200, bool=True)
        except Exception as e:
            return _err('GET /admin/stages/groups', e)


@ns.route('/stages/settings')
class AdminStageSettings(Resource):
    @jwt_required()
    def get(self):
        try:
            if not can(AREA_SCORE):
                return _denied()
            return jsonify(response={'settings': _settings_dict(call_proc_one('sp_stage_settings_get'))},
                           status=200, bool=True)
        except Exception as e:
            return _err('GET /admin/stages/settings', e)

    @jwt_required()
    def put(self):
        try:
            if not can(AREA_SCORE):
                return _denied()
            d = request.get_json() or {}
            pct = _int(d.get('legacy_boost_percent'))
            mx = _int(d.get('legacy_boost_max'))
            for name, v in (('Boost %', pct), ('Boost maximum', mx)):
                if v is not None and not (0 <= v <= 100):
                    return jsonify(response={'message': f'{name} must be 0–100.'}, status=400, bool=False)
            on = d.get('auto_promote_on')
            if on is not None and not re.fullmatch(r'(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])', str(on)):
                return jsonify(response={'message': 'Auto-promotion date must be MM-DD, e.g. 07-01.'},
                               status=400, bool=False)
            auto = d.get('auto_promote_enabled')
            auto = None if auto is None else (1 if auto in (True, 1, '1', 'true') else 0)
            admin_id = get_jwt_identity()
            before = _settings_dict(call_proc_one('sp_stage_settings_get'))
            row = call_proc_one('sp_stage_settings_set', pct, mx, auto, on, admin_id)
            db.session.commit()
            after = _settings_dict(row)
            log_audit('stage_settings_updated', 'readiness_rules', None, admin_id,
                      {'before': before, 'after': after})
            return jsonify(response={'settings': after, 'message': 'Stage settings saved.'},
                           status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            return _err('PUT /admin/stages/settings', e)


@ns.route('/stages/<string:user_id>')
class AdminStudentStages(Resource):
    @jwt_required()
    def get(self, user_id):
        try:
            if not can(AREA_SCORE):
                return _denied()
            return jsonify(response={'timeline': [stages.timeline_entry(s) for s in stages.history(user_id)]},
                           status=200, bool=True)
        except Exception as e:
            return _err('GET /admin/stages/<user>', e)


@ns.route('/stages/<string:user_id>/rollback')
class AdminStageRollback(Resource):
    @jwt_required()
    def post(self, user_id):
        try:
            if not can(AREA_SCORE):
                return _denied()
            reason = ((request.get_json() or {}).get('reason') or '').strip()
            if not reason:
                return jsonify(response={'message': 'A reason is required.'}, status=400, bool=False)
            admin_id = get_jwt_identity()
            res = call_proc_one('sp_stage_rollback', user_id, admin_id, reason[:255]) or {}
            if not res.get('ok'):
                return jsonify(response={'message': 'This student has no earlier stage to go back to.'},
                               status=409, bool=False)
            stages.after_rollback(user_id, res.get('stage_id'))
            call_proc_one('sp_score_read', user_id)
            db.session.commit()
            log_audit('stage_rolled_back', 'student_stages', res.get('rolled_back_stage_id'), admin_id,
                      {'user_id': user_id, 'reopened': res.get('stage_id'), 'reason': reason})
            return jsonify(response={'message': 'Stage rolled back. The earlier stage and its score are active again.',
                                     'timeline': [stages.timeline_entry(s) for s in stages.history(user_id)]},
                           status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            return _err('POST /admin/stages/<user>/rollback', e)
