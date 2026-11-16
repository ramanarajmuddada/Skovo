"""Admin — daily engagement content and switches (feature-updates.md §7).

Every feature starts OFF and every reward at 0. Admin sets it up once; the
system runs it daily.

GET/PUT          /engagement/settings
GET/POST         /engagement/<resource>            resource: goal-levels, quests,
PUT/DELETE       /engagement/<resource>/<id>         challenges, achievements, templates,
                                                      tournaments
GET/POST         /engagement/question-sets/<owner_id>/questions     speed lists: speed-all, speed-<stage group>
PUT/DELETE       /engagement/question-sets/<owner_id>/questions/<qid>
POST             /engagement/tournaments/<id>/close
GET              /engagement/tournaments/<id>/board
"""
from portal.helpers.error_capture import capture_error
import json
import re
import uuid
from flask import jsonify, request
from flask_restx import Resource
from flask_jwt_extended import jwt_required, get_jwt_identity
from sqlalchemy import text
from portal.models import db
from portal.helpers.sp import call_proc, call_proc_one
from portal.helpers.admin_auth import can, AREA_SCORE, AREA_CONTENT
from portal.helpers.audit import log_audit
from portal.helpers import quiz as Q
from . import ns, logger

SETTINGS_INT = ('quests_per_day', 'speed_seconds', 'speed_questions', 'winback_boost_hours',
                'club_extra_freeze_days')
SETTINGS_BOOL = ('daily_goal_enabled', 'quests_enabled', 'challenge_enabled', 'mistakes_enabled',
                 'friends_enabled', 'speed_enabled',
                 'achievements_enabled', 'winback_enabled', 'winback_free_freeze', 'offline_enabled',
                 'perfect_week_enabled')
SETTINGS_TEXT = ('mistake_days', 'winback_days')

# resource -> (table, key column, generated key?, {field: type}, permission area)
#   types: str, int, bool, json, date, float
RESOURCES = {
    'goal-levels': ('goal_levels', 'level_key', False,
                    {'label': 'str', 'tasks_per_day': 'int', 'sort_order': 'int', 'is_active': 'bool'}, AREA_SCORE),
    'quests': ('quests', 'id', True,
               {'label': 'str', 'kind': 'str', 'action_key': 'str', 'target': 'int',
                'min_percent': 'int', 'difficulty': 'str', 'segment_stage': 'str',
                'is_active': 'bool'}, AREA_SCORE),
    'challenges': ('monthly_challenges', 'month', False,
                   {'label': 'str', 'target_quests': 'int', 'badge_label': 'str', 'is_active': 'bool'},
                   AREA_SCORE),
    'achievements': ('achievements', 'ach_key', False,
                     {'label': 'str', 'metric': 'str', 'tiers_json': 'json',
                      'is_active': 'bool', 'sort_order': 'int'}, AREA_SCORE),
    'templates': ('message_templates', 'tpl_key', False,
                  {'lang': 'str', 'title': 'str', 'body': 'str'}, AREA_CONTENT),
    'tournaments': ('tournaments', 'id', True,
                    {'label': 'str', 'tier': 'int', 'starts_on': 'date', 'ends_on': 'date', 'status': 'str'},
                    AREA_SCORE),
}
REQUIRED = {
    'goal-levels': ('label', 'tasks_per_day'), 'quests': ('label', 'kind', 'target'),
    'challenges': ('label', 'target_quests'),
    'achievements': ('label', 'metric', 'tiers_json'),
    'templates': ('lang', 'title', 'body'),
    'tournaments': ('label', 'tier', 'starts_on', 'ends_on'),
}
ENUMS = {
    ('quests', 'kind'): ('action', 'any'), ('quests', 'difficulty'): ('easy', 'medium', 'hard'),
    ('tournaments', 'status'): ('open', 'closed'),
    ('templates', 'lang'): ('en',),   # v1 is English only
    ('achievements', 'metric'): ('quizzes_submitted', 'answers_solved', 'streak_best',
                                 'quests_done', 'buddy_best', 'group_best'),
}


def _denied():
    return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)


def _err(where, e):
    db.session.rollback()
    logger.error(f"{where}: {e}")
    return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)},
                   status=500, bool=False)


def _no(msg, code=400):
    return jsonify(response={'message': msg}, status=code, bool=False)


def _ser(row):
    out = {}
    for k, v in row.items():
        if hasattr(v, 'isoformat'):
            v = v.isoformat()
        elif isinstance(v, (bytes, bytearray)):
            v = v.decode()
        elif v.__class__.__name__ == 'Decimal':
            v = float(v)
        if k.endswith('_json') and isinstance(v, str):
            try:
                v = json.loads(v)
            except ValueError:
                pass
        out[k] = v
    return out


def _coerce(res, field, kind, v):
    import datetime
    if v is None or v == '':
        return None, None
    try:
        if kind == 'int':
            v = int(v)
            if v < 0 or v > 1_000_000:
                return None, f'{field} is out of range.'
        elif kind == 'float':
            v = float(v)
        elif kind == 'bool':
            v = 1 if v in (True, 1, '1', 'true') else 0
        elif kind == 'json':
            if isinstance(v, str):
                json.loads(v)
            else:
                v = json.dumps(v, ensure_ascii=False)
        elif kind == 'date':
            v = datetime.date.fromisoformat(str(v)[:10])
        else:
            v = str(v).strip()[:1000]
    except (TypeError, ValueError):
        return None, f'{field} is not valid.'
    allowed = ENUMS.get((res, field))
    if allowed and v not in allowed:
        return None, f"{field} must be one of: {', '.join(allowed)}."
    return v, None


def _clean(res, d, partial):
    table, key, gen, fields, _area = RESOURCES[res]
    vals = {}
    for f, kind in fields.items():
        if f in d:
            v, err = _coerce(res, f, kind, d.get(f))
            if err:
                return None, err
            vals[f] = v
    if not partial:
        missing = [f for f in REQUIRED.get(res, ()) if vals.get(f) in (None, '')]
        if missing:
            return None, f"Required: {', '.join(missing)}."
    if res == 'achievements' and vals.get('tiers_json'):
        tiers = json.loads(vals['tiers_json'])
        if not isinstance(tiers, list) or not tiers or any('tier' not in t or 'target' not in t for t in tiers):
            return None, 'Tiers must be a list of {tier, target}.'
    return vals, None


def _check(res):
    return can(RESOURCES[res][4])


@ns.route('/engagement/settings')
class AdminEngagementSettings(Resource):
    @jwt_required()
    def get(self):
        try:
            if not can(AREA_SCORE):
                return _denied()
            return jsonify(response={'settings': _ser(call_proc_one('sp_eng_settings_get') or {})},
                           status=200, bool=True)
        except Exception as e:
            return _err('GET /admin/engagement/settings', e)

    @jwt_required()
    def put(self):
        try:
            if not can(AREA_SCORE):
                return _denied()
            d = request.get_json() or {}
            sets, params = [], {}
            for k in SETTINGS_BOOL:
                if k in d:
                    sets.append(f"{k} = :{k}")
                    params[k] = 1 if d[k] in (True, 1, '1', 'true') else 0
            for k in SETTINGS_INT:
                if k in d:
                    try:
                        v = int(d[k])
                    except (TypeError, ValueError):
                        return _no(f'{k} must be a number.')
                    if not (0 <= v <= 10000):
                        return _no(f'{k} is out of range.')
                    sets.append(f"{k} = :{k}")
                    params[k] = v
            for k in SETTINGS_TEXT:
                if k in d:
                    parts = [p.strip() for p in str(d[k]).split(',') if p.strip()]
                    if not parts or not all(p.isdigit() and 0 < int(p) <= 365 for p in parts):
                        return _no(f'{k} must be days like 1,3,7.')
                    sets.append(f"{k} = :{k}")
                    params[k] = ','.join(parts)
            if not sets:
                return _no('Nothing to change.')
            admin = get_jwt_identity()
            before = _ser(call_proc_one('sp_eng_settings_get') or {})
            params['admin'] = admin
            db.session.execute(text(f"UPDATE engagement_settings SET {', '.join(sets)}, updated_by = :admin WHERE id = 1"),
                               params)
            db.session.commit()
            after = _ser(call_proc_one('sp_eng_settings_get') or {})
            log_audit('engagement_settings_updated', 'engagement_settings', '1', admin, {'before': before, 'after': after})
            return jsonify(response={'settings': after, 'message': 'Saved.'}, status=200, bool=True)
        except Exception as e:
            return _err('PUT /admin/engagement/settings', e)


@ns.route('/engagement/<string:res>')
class AdminEngagementList(Resource):
    @jwt_required()
    def get(self, res):
        try:
            if res not in RESOURCES:
                return _no('Unknown resource.', 404)
            if not _check(res):
                return _denied()
            table, key = RESOURCES[res][0], RESOURCES[res][1]
            rows = db.session.execute(text(f"SELECT * FROM `{table}` LIMIT 1000")).mappings().all()
            items = [_ser(dict(r)) for r in rows]
            if res == 'quests':   # easy → medium → hard, then by label
                rank = {'easy': 0, 'medium': 1, 'hard': 2}
                items.sort(key=lambda q: (rank.get(q.get('difficulty'), 3), q.get('label') or ''))
            return jsonify(response={'items': items}, status=200, bool=True)
        except Exception as e:
            return _err(f'GET /admin/engagement/{res}', e)

    @jwt_required()
    def post(self, res):
        try:
            if res not in RESOURCES:
                return _no('Unknown resource.', 404)
            if not _check(res):
                return _denied()
            table, key, gen, _f, _a = RESOURCES[res]
            d = request.get_json() or {}
            vals, err = _clean(res, d, partial=False)
            if err:
                return _no(err)
            if gen:
                kv = str(uuid.uuid4())
            else:
                kv = str(d.get(key) or '').strip()
                if not kv or len(kv) > 40:
                    return _no(f'{key} is required (up to 40 characters).')
                if res == 'challenges' and not (len(kv) == 7 and kv[4] == '-'):
                    return _no('Month must be YYYY-MM.')
            vals[key] = kv
            if 'created_by' in self._cols(table):
                vals['created_by'] = get_jwt_identity()
            cols = ', '.join(f'`{c}`' for c in vals)
            ph = ', '.join(f':{c}' for c in vals)
            db.session.execute(text(f"INSERT INTO `{table}` ({cols}) VALUES ({ph})"), vals)
            db.session.commit()
            log_audit(f'engagement_{res}_created', table, kv, get_jwt_identity(), {k: str(v) for k, v in vals.items()})
            row = db.session.execute(text(f"SELECT * FROM `{table}` WHERE `{key}` = :k"), {'k': kv}).mappings().first()
            return jsonify(response={'item': _ser(dict(row))}, status=201, bool=True)
        except Exception as e:
            if 'Duplicate' in str(e):
                db.session.rollback()
                return _no('That already exists.', 409)
            return _err(f'POST /admin/engagement/{res}', e)

    @staticmethod
    def _cols(table):
        return {r[0] for r in db.session.execute(text(
            "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t"),
            {'t': table}).all()}


@ns.route('/engagement/<string:res>/<string:item_id>')
class AdminEngagementItem(Resource):
    @jwt_required()
    def put(self, res, item_id):
        try:
            if res not in RESOURCES:
                return _no('Unknown resource.', 404)
            if not _check(res):
                return _denied()
            table, key = RESOURCES[res][0], RESOURCES[res][1]
            vals, err = _clean(res, request.get_json() or {}, partial=True)
            if err:
                return _no(err)
            if not vals:
                return _no('Nothing to change.')
            where = f"`{key}` = :_k"
            params = {**vals, '_k': item_id}
            if res == 'templates':                     # templates are keyed by (key, lang)
                where += " AND lang = :_lang"
                params['_lang'] = request.args.get('lang') or vals.get('lang') or 'en'
            sets = ', '.join(f'`{c}` = :{c}' for c in vals)
            n = db.session.execute(text(f"UPDATE `{table}` SET {sets} WHERE {where}"), params).rowcount
            if not n and res == 'templates':
                vals.update({'tpl_key': item_id, 'lang': params['_lang']})
                cols = ', '.join(f'`{c}`' for c in vals)
                db.session.execute(text(f"INSERT INTO message_templates ({cols}) VALUES "
                                        f"({', '.join(':' + c for c in vals)})"), vals)
                n = 1
            db.session.commit()
            if not n:
                return _no('Not found.', 404)
            log_audit(f'engagement_{res}_updated', table, item_id, get_jwt_identity(), {k: str(v) for k, v in vals.items()})
            row = db.session.execute(text(f"SELECT * FROM `{table}` WHERE `{key}` = :k LIMIT 1"), {'k': item_id}).mappings().first()
            return jsonify(response={'item': _ser(dict(row)) if row else None}, status=200, bool=True)
        except Exception as e:
            return _err(f'PUT /admin/engagement/{res}', e)

    @jwt_required()
    def delete(self, res, item_id):
        try:
            if res not in RESOURCES:
                return _no('Unknown resource.', 404)
            if not _check(res):
                return _denied()
            table, key = RESOURCES[res][0], RESOURCES[res][1]
            where, params = f"`{key}` = :k", {'k': item_id}
            if res == 'templates':                     # keyed by (key, lang): never drop the other language
                where += " AND lang = :l"
                params['l'] = request.args.get('lang') or 'en'
            n = db.session.execute(text(f"DELETE FROM `{table}` WHERE {where}"), params).rowcount
            db.session.commit()
            if not n:
                return _no('Not found.', 404)
            log_audit(f'engagement_{res}_deleted', table, item_id, get_jwt_identity(), {})
            return jsonify(response={'message': 'Deleted.'}, status=200, bool=True)
        except Exception as e:
            return _err(f'DELETE /admin/engagement/{res}', e)


_SPEED_OWNER = re.compile(r'^speed-[A-Za-z0-9_]{1,30}$')


def _owner_ok(owner_id):
    """Speed question lists: speed-all, or speed-<stage group>."""
    return bool(_SPEED_OWNER.match(owner_id or ''))


@ns.route('/engagement/question-sets/<string:owner_id>/questions')
class AdminSetQuestions(Resource):
    @jwt_required()
    def get(self, owner_id):
        try:
            if not can(AREA_CONTENT):
                return _denied()
            if not _owner_ok(owner_id):
                return _no('Unknown question list.', 404)
            return jsonify(response={'questions': [Q.achiever_question(q) for q in
                                                   call_proc('sp_task_questions_list', owner_id) or []]},
                           status=200, bool=True)
        except Exception as e:
            return _err('GET question set', e)

    @jwt_required()
    def post(self, owner_id):
        try:
            if not can(AREA_CONTENT):
                return _denied()
            if not _owner_ok(owner_id):
                return _no('Unknown question list.', 404)
            clean, verr = Q.validate_question(request.get_json() or {})
            if verr:
                return _no(verr)
            n = len(call_proc('sp_task_questions_list', owner_id) or [])
            row = call_proc_one('sp_task_question_upsert', str(uuid.uuid4()), owner_id, n + 1,
                                *Q.question_args(clean), None, get_jwt_identity())
            db.session.commit()
            return jsonify(response={'question': Q.achiever_question(row)}, status=201, bool=True)
        except Exception as e:
            return _err('POST question set', e)


@ns.route('/engagement/question-sets/<string:owner_id>/questions/<string:qid>')
class AdminSetQuestion(Resource):
    @jwt_required()
    def put(self, owner_id, qid):
        try:
            if not can(AREA_CONTENT):
                return _denied()
            existing = next((q for q in call_proc('sp_task_questions_list', owner_id) or [] if q['id'] == qid), None)
            if not existing:
                return _no('Question not found.', 404)
            clean, verr = Q.validate_question(request.get_json() or {})
            if verr:
                return _no(verr)
            row = call_proc_one('sp_task_question_upsert', qid, owner_id, existing.get('position'),
                                *Q.question_args(clean), None, get_jwt_identity())
            db.session.commit()
            return jsonify(response={'question': Q.achiever_question(row)}, status=200, bool=True)
        except Exception as e:
            return _err('PUT question set', e)

    @jwt_required()
    def delete(self, owner_id, qid):
        try:
            if not can(AREA_CONTENT):
                return _denied()
            n = (call_proc_one('sp_task_question_delete', qid, owner_id) or {}).get('deleted', 0)
            db.session.commit()
            return jsonify(response={'message': 'Removed.' if n else 'Not found.'}, status=200 if n else 404, bool=bool(n))
        except Exception as e:
            return _err('DELETE question set', e)


@ns.route('/engagement/tournaments/<string:tid>/board')
class AdminTournamentBoard(Resource):
    @jwt_required()
    def get(self, tid):
        try:
            if not can(AREA_SCORE):
                return _denied()
            from portal.helpers import leaderboard as lb
            b = lb.tournament_board(tid, None, 200)
            return jsonify(response={'tournament': b}, status=200 if b else 404, bool=bool(b))
        except Exception as e:
            return _err('GET tournament board', e)


@ns.route('/engagement/tournaments/<string:tid>/close')
class AdminTournamentClose(Resource):
    @jwt_required()
    def post(self, tid):
        try:
            if not can(AREA_SCORE):
                return _denied()
            from portal.helpers import leaderboard as lb
            admin = get_jwt_identity()
            res = lb.close_tournament(tid, admin, int((request.get_json() or {}).get('top_n') or 10))
            if res.get('error'):
                return _no('This tournament is not open.', 409)
            db.session.commit()
            log_audit('tournament_closed', 'tournaments', tid, admin, res)
            return jsonify(response={'message': f"Hall of Fame written: {res['added']} winners.", **res},
                           status=200, bool=True)
        except Exception as e:
            return _err('POST tournament close', e)
