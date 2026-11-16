"""Readiness Score Playbook v2.1 -- student API.

GET  /readiness/v21/score/current        current Journey Card, pillars, monthly limit, Index, next 3 actions
GET  /readiness/v21/score/history        readiness events for one card (?card_id=)
GET  /readiness/v21/actions              points list for the current card
POST /readiness/v21/evidence             proof for a check (points only on approval)
POST /readiness/v21/results              result card / marks memo / offer letter for a card
GET  /readiness/v21/verifications        my check requests and their feedback
GET  /readiness/v21/streak/current       day streak, SP lifetime + weekly, multiplier, level, calendar
POST /readiness/v21/streak/open          called after 30 s in the app, once a day
POST /readiness/v21/streak/pause         spend a pause token (21 days)
GET  /readiness/v21/weekly-plan          this week's 3 actions
GET  /readiness/v21/leaderboard          ?board=weekly|city|streak|readiness&card=&city=
"""
from portal.helpers.error_capture import capture_error
from flask import jsonify, request
from flask_restx import Resource
from flask_jwt_extended import jwt_required, get_jwt_identity
from portal.models import db
from portal.helpers.sp import call_proc, call_proc_one
from portal.helpers import readiness_v21 as rv
from portal.helpers import streak_points as spx
from . import ns, logger

MESSAGES = {
    'no_card': 'Your Journey Card is not set up yet. Complete your education details first.',
    'not_on_card': 'That action does not count on your current card.',
    'app_checked': 'This one is checked inside the app, so there is nothing to upload.',
}


def _ok(data, status=200):
    return jsonify(response=data, status=status, bool=True)


def _bad(msg, status=400):
    return jsonify(response={'message': msg}, status=status, bool=False)


def _err(where, e):
    db.session.rollback()
    logger.error(f"{where}: {e}")
    return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)},
                   status=500, bool=False)


@ns.route('/v21/score/current')
class V21ScoreCurrent(Resource):
    @jwt_required()
    def get(self):
        try:
            data = rv.current(get_jwt_identity())
            db.session.commit()
            return _ok(data)
        except Exception as e:
            return _err('GET /readiness/v21/score/current', e)


@ns.route('/v21/score/history')
class V21ScoreHistory(Resource):
    @jwt_required()
    def get(self):
        try:
            me = get_jwt_identity()
            card_id = request.args.get('card_id')
            card = call_proc_one('sp_rv_card_get', card_id) if card_id else rv.active_card(me)
            if not card or card.get('user_id') != me:
                return _ok({'events': []})
            return _ok({'card': rv.card_view(card), 'events': rv.history(card['id'])})
        except Exception as e:
            return _err('GET /readiness/v21/score/history', e)


@ns.route('/v21/actions')
class V21Actions(Resource):
    @jwt_required()
    def get(self):
        try:
            card = rv.active_card(get_jwt_identity())
            if not card:
                return _ok({'actions': []})
            rows = call_proc('sp_rv_actions_list', card['card_type'], 1) or []
            return _ok({'card_type': card['card_type'], 'actions': [
                {'action_key': a['action_key'], 'label': a['label'], 'evidence': a.get('evidence'),
                 'pillar': a['pillar'], 'points': int(a['points']),
                 'bonus_points': a.get('bonus_points'), 'limit_type': a['limit_type'],
                 'limit_value': a.get('limit_value'), 'checked_by': a['checked_by']} for a in rows]})
        except Exception as e:
            return _err('GET /readiness/v21/actions', e)


@ns.route('/v21/evidence')
class V21Evidence(Resource):
    @jwt_required()
    def post(self):
        try:
            me = get_jwt_identity()
            d = request.get_json() or {}
            key = (d.get('action_key') or '').strip()
            if not key or not (d.get('document_id') or d.get('url')):
                return _bad('Choose what you did and attach a document or a link.')
            res = rv.submit_evidence(me, key, doc_id=d.get('document_id'), url=(d.get('url') or '')[:500] or None,
                                     note=(d.get('note') or '')[:500] or None,
                                     idempotency_key=d.get('idempotency_key'))
            if res['result'] != 'queued':
                return _bad(MESSAGES.get(res['result'], 'Could not submit.'), 409)
            if d.get('document_id'):
                spx.award(me, 'document_upload', ref_id=d['document_id'])
            db.session.commit()
            return _ok({'message': 'Sent for checking. Points are added once it is approved.',
                        'request_id': res['request']['id']}, 201)
        except Exception as e:
            return _err('POST /readiness/v21/evidence', e)


@ns.route('/v21/results')
class V21Results(Resource):
    @jwt_required()
    def post(self):
        try:
            me = get_jwt_identity()
            d = request.get_json() or {}
            card_id = d.get('card_id') or (rv.active_card(me) or {}).get('id')
            past = d.get('past_card_type')
            if past:                                          # joined later: an earlier stage's result
                card = rv.add_past_result_card(me, past)
                card_id = (card or {}).get('id')
            if not card_id or not (d.get('document_id') or d.get('url')):
                return _bad('Attach your result card or marks memo.')
            res = rv.submit_result(me, card_id, doc_id=d.get('document_id'), url=d.get('url'),
                                   raw_grade=d.get('grade'), board=d.get('board'))
            if res['result'] != 'queued':
                return _bad(MESSAGES.get(res['result'], 'Could not submit.'), 409)
            db.session.commit()
            return _ok({'message': 'Result sent to the verification desk.', 'request_id': res['request']['id']}, 201)
        except Exception as e:
            return _err('POST /readiness/v21/results', e)


@ns.route('/v21/verifications')
class V21Verifications(Resource):
    @jwt_required()
    def get(self):
        try:
            rows = call_proc('sp_rv_verif_for_user', get_jwt_identity(), 50) or []
            return _ok({'requests': [{**r, 'created_at': r['created_at'].isoformat() if r.get('created_at') else None,
                                      'decided_at': r['decided_at'].isoformat() if r.get('decided_at') else None}
                                     for r in rows]})
        except Exception as e:
            return _err('GET /readiness/v21/verifications', e)


@ns.route('/v21/streak/current')
class V21StreakCurrent(Resource):
    @jwt_required()
    def get(self):
        try:
            data = spx.state(get_jwt_identity())
            db.session.commit()
            return _ok(data)
        except Exception as e:
            return _err('GET /readiness/v21/streak/current', e)


@ns.route('/v21/streak/open')
class V21StreakOpen(Resource):
    @jwt_required()
    def post(self):
        try:
            if not rv.enabled():
                return _ok({'result': 'off'})
            d = request.get_json(silent=True) or {}
            data = spx.open_app(get_jwt_identity(), d.get('seconds'))
            db.session.commit()
            return _ok(data)
        except Exception as e:
            return _err('POST /readiness/v21/streak/open', e)


@ns.route('/v21/streak/pause')
class V21StreakPause(Resource):
    @jwt_required()
    def post(self):
        try:
            res = spx.use_pause_token(get_jwt_identity())
            if res['result'] != 'paused':
                return _bad('No pause tokens left this year.', 409)
            db.session.commit()
            return _ok({**res, 'message': 'Streak paused.'})
        except Exception as e:
            return _err('POST /readiness/v21/streak/pause', e)


@ns.route('/v21/weekly-plan')
class V21WeeklyPlan(Resource):
    @jwt_required()
    def get(self):
        try:
            data = spx.weekly_plan(get_jwt_identity())
            db.session.commit()
            return _ok(data)
        except Exception as e:
            return _err('GET /readiness/v21/weekly-plan', e)


@ns.route('/v21/leaderboard')
class V21Leaderboard(Resource):
    @jwt_required()
    def get(self):
        try:
            me = get_jwt_identity()
            board = request.args.get('board', 'weekly')
            card = request.args.get('card') or (rv.active_card(me) or {}).get('card_type')
            city = request.args.get('city') or None
            if board == 'city' and not city:
                city = (call_proc_one('sp_profile_get_by_user', me) or {}).get('city')
            data = spx.leaderboard(me, board, card, city)
            if data is None:
                return _bad('Unknown board.')
            return _ok(data)
        except Exception as e:
            return _err('GET /readiness/v21/leaderboard', e)
