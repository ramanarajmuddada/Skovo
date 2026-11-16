"""Daily engagement — student API (feature-updates.md §7).

GET  /engagement/today                         home: goal, quests, challenge, boost, mistakes due
PUT  /engagement/goal                          {level_key}
GET  /engagement/mistakes                      questions due today
POST /engagement/mistakes/<qid>/answer         {answer}
POST /engagement/speed/start
POST /engagement/speed/submit                  {token, answers}
GET  /engagement/achievements
POST /engagement/follow/<user_id>      DELETE same
GET  /engagement/following
GET  /engagement/feed
POST /engagement/feed/<id>/cheer
GET  /engagement/friends-board                 followed classmates, this week
GET  /engagement/widget                        lock-screen widget payload
GET  /engagement/offline-pack/<task_id>        offline quiz (no timer) to submit later
"""
from portal.helpers.error_capture import capture_error
import datetime
import json
import uuid
from flask import jsonify, request
from flask_restx import Resource
from flask_jwt_extended import jwt_required, get_jwt_identity
from sqlalchemy import text, bindparam
from portal.models import db
from portal.helpers.sp import call_proc, call_proc_one
from portal.helpers.storage import browser_url
from portal.helpers import engagement as E
from portal.helpers import speed as P
from . import ns, logger


def _err(where, e):
    db.session.rollback()
    logger.error(f"{where}: {e}")
    return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)},
                   status=500, bool=False)


def _no(msg, code=400):
    return jsonify(response={'message': msg}, status=code, bool=False)


def _ok(data, code=200):
    return jsonify(response=data, status=code, bool=True)


@ns.route('/today')
class Today(Resource):
    @jwt_required()
    def get(self):
        try:
            me = get_jwt_identity()
            s = E.settings()
            from portal.helpers import streaks
            st = streaks.summary(me, days=7)
            db.session.commit()
            mistakes = len(E.mistakes_due(me, limit=50)) if s.get('mistakes_enabled') else 0
            return _ok({
                'goal': E.goal_status(me) if s.get('daily_goal_enabled') else None,
                'quests': E.quests_today(me) if s.get('quests_enabled') else None,
                'challenge': E.challenge_status(me),
                'boost': E.active_boost(me),
                'mistakes_due': mistakes,
                'streak': {k: st[k] for k in ('enabled', 'lifetime_current', 'stage_current', 'kept_today',
                                              'at_risk', 'freezes_held', 'freezes_on', 'exam_window')},
                'features': {k: bool(s.get(k)) for k in ('daily_goal_enabled', 'quests_enabled', 'mistakes_enabled',
                                                          'friends_enabled',
                                                          'speed_enabled', 'achievements_enabled', 'offline_enabled')},
            })
        except Exception as e:
            return _err('GET /engagement/today', e)


@ns.route('/goal')
class Goal(Resource):
    @jwt_required()
    def put(self):
        try:
            key = (request.get_json() or {}).get('level_key') or ''
            if not E.set_goal(get_jwt_identity(), key):
                return _no('Pick one of the goal levels.')
            db.session.commit()
            return _ok(E.goal_status(get_jwt_identity()))
        except Exception as e:
            return _err('PUT /engagement/goal', e)


@ns.route('/mistakes')
class Mistakes(Resource):
    @jwt_required()
    def get(self):
        try:
            if not E.settings().get('mistakes_enabled'):
                return _ok({'enabled': False, 'questions': []})
            return _ok({'enabled': True, 'questions': E.mistakes_due(get_jwt_identity())})
        except Exception as e:
            return _err('GET /engagement/mistakes', e)


@ns.route('/mistakes/<string:qid>/answer')
class MistakeAnswer(Resource):
    @jwt_required()
    def post(self, qid):
        try:
            res = E.answer_mistake(get_jwt_identity(), qid, (request.get_json() or {}).get('answer'))
            if res is None:
                return _no('Question not found.', 404)
            db.session.commit()
            return _ok(res)
        except Exception as e:
            return _err('POST mistake answer', e)


@ns.route('/speed/start')
class SpeedStart(Resource):
    @jwt_required()
    def post(self):
        try:
            data, err = P.speed_start(get_jwt_identity())
            return _no(err, 409) if err else _ok(data, 201)
        except Exception as e:
            return _err('POST speed start', e)


@ns.route('/speed/submit')
class SpeedSubmit(Resource):
    @jwt_required()
    def post(self):
        try:
            d = request.get_json() or {}
            data, err = P.speed_submit(get_jwt_identity(), d.get('token') or '', d.get('answers') or {})
            if err:
                return _no(err, 409)
            db.session.commit()
            return _ok(data)
        except Exception as e:
            return _err('POST speed submit', e)


@ns.route('/achievements')
class Achievements(Resource):
    @jwt_required()
    def get(self):
        try:
            if not E.settings().get('achievements_enabled'):
                return _ok({'enabled': False, 'achievements': []})
            return _ok({'enabled': True, 'achievements': E.achievements_status(get_jwt_identity())})
        except Exception as e:
            return _err('GET /engagement/achievements', e)


@ns.route('/follow/<string:user_id>')
class Follow(Resource):
    @jwt_required()
    def post(self, user_id):
        try:
            me = get_jwt_identity()
            if not E.settings().get('friends_enabled'):
                return _no('Friends are not switched on yet.', 409)
            if user_id == me or not E._one("SELECT id FROM users WHERE id = :u AND deleted_at IS NULL", u=user_id):
                return _no('Student not found.', 404)
            E.follow(me, user_id, True)
            db.session.commit()
            return _ok({'following': True})
        except Exception as e:
            return _err('POST follow', e)

    @jwt_required()
    def delete(self, user_id):
        try:
            E.follow(get_jwt_identity(), user_id, False)
            db.session.commit()
            return _ok({'following': False})
        except Exception as e:
            return _err('DELETE follow', e)


@ns.route('/following')
class Following(Resource):
    @jwt_required()
    def get(self):
        try:
            me = get_jwt_identity()
            rows = E._rows("SELECT u.id, u.full_name, u.avatar_url, "
                           "EXISTS(SELECT 1 FROM follows b WHERE b.follower_id = u.id AND b.followee_id = :u) AS follows_back "
                           "FROM follows f JOIN users u ON u.id = f.followee_id WHERE f.follower_id = :u "
                           "ORDER BY u.full_name", u=me)
            return _ok({'following': [{'user_id': r['id'], 'name': r['full_name'],
                                       'photo': browser_url(r['avatar_url']) if r.get('avatar_url') else None,
                                       'follows_back': bool(r['follows_back'])} for r in rows]})
        except Exception as e:
            return _err('GET following', e)


@ns.route('/feed')
class Feed(Resource):
    @jwt_required()
    def get(self):
        try:
            rows = E.feed(get_jwt_identity())
            return _ok({'items': [{'id': r['id'], 'user_id': r['user_id'], 'name': r['full_name'],
                                   'photo': browser_url(r['avatar_url']) if r.get('avatar_url') else None,
                                   'kind': r['kind'], 'text': r['text'], 'cheers': int(r['cheers']),
                                   'cheered': bool(r['cheered']), 'at': r['created_at'].isoformat() + 'Z'}
                                  for r in rows]})
        except Exception as e:
            return _err('GET feed', e)


@ns.route('/feed/<string:feed_id>/cheer')
class Cheer(Resource):
    @jwt_required()
    def post(self, feed_id):
        try:
            if not E.cheer(get_jwt_identity(), feed_id):
                return _no('Not found.', 404)
            db.session.commit()
            return _ok({'cheered': True})
        except Exception as e:
            return _err('POST cheer', e)


@ns.route('/friends-board')
class FriendsBoard(Resource):
    @jwt_required()
    def get(self):
        try:
            me = get_jwt_identity()
            from portal.helpers import leaderboard as lb
            stage = call_proc_one('sp_stage_get_active', me) or {}
            ids = E.following_ids(me) + [me]
            wk = lb.week_start()
            rows = db.session.execute(text(
                "SELECT st.user_id, u.full_name, u.avatar_url, lp.alias, IFNULL(lp.hide_photo, 0) AS hide_photo, "
                "IFNULL((SELECT SUM(le.points) FROM lb_events le WHERE le.user_id = st.user_id AND le.stage_id = st.id "
                "AND le.day >= :wk), 0) AS points, IFNULL(cs.stage_current, 0) AS stage_streak "
                "FROM student_stages st JOIN users u ON u.id = st.user_id "
                "LEFT JOIN lb_profiles lp ON lp.user_id = st.user_id "
                "LEFT JOIN career_streaks cs ON cs.user_id = st.user_id "
                "WHERE st.status = 'active' AND st.stage_group = :g AND IFNULL(st.sub_year, '') = :y "
                "AND IFNULL(lp.removed, 0) = 0 AND st.user_id IN :ids"
            ).bindparams(bindparam('ids', expanding=True)),
                {'wk': wk, 'g': stage.get('stage_group') or '', 'y': stage.get('sub_year') or '', 'ids': ids}
            ).mappings().all()
            s = lb.settings()
            out = sorted([{'user_id': r['user_id'], 'name': lb.display_name(r, s.get('name_format') or 'full'),
                           'photo': None if (r['hide_photo'] or not s.get('photos', 1) or not r['avatar_url'])
                           else browser_url(r['avatar_url']),
                           'points': float(r['points']), 'stage_streak': int(r['stage_streak']),
                           'is_me': r['user_id'] == me} for r in rows], key=lambda x: -x['points'])
            for i, r in enumerate(out, 1):
                r['rank'] = i
            return _ok({'rows': out, 'week_start': wk.isoformat()})
        except Exception as e:
            return _err('GET friends board', e)


@ns.route('/widget')
class Widget(Resource):
    @jwt_required()
    def get(self):
        try:
            me = get_jwt_identity()
            from portal.helpers import streaks
            st = streaks.summary(me, days=1)
            db.session.commit()
            g = E.goal_status(me) if E.settings().get('daily_goal_enabled') else None
            return _ok({'streak': st['lifetime_current'], 'kept_today': st['kept_today'], 'at_risk': st['at_risk'],
                        'goal_done': g['done_today'] if g else None,
                        'goal_need': (g['goal'] or {}).get('tasks_per_day') if g else None})
        except Exception as e:
            return _err('GET widget', e)


@ns.route('/offline-pack/<string:task_id>')
class OfflinePack(Resource):
    @jwt_required()
    def get(self, task_id):
        """An attempt with no deadline, to take offline and submit later through
        POST /tasks/<id>/quiz/<attempt>/submit. Only quizzes admin marked
        offline-allowed and without a time limit."""
        try:
            me = get_jwt_identity()
            if not E.settings().get('offline_enabled'):
                return _no('Offline packs are not switched on.', 409)
            from portal.routes.Tasks.quiz import _load
            from portal.helpers import quiz as Q
            task, _c, err = _load(task_id, me)
            if err:
                return err
            if not task.get('offline_allowed') or task.get('time_limit_minutes'):
                return _no('This quiz cannot be downloaded.', 409)
            questions = call_proc('sp_task_questions_list', task_id) or []
            attempts = call_proc('sp_quiz_attempts_for', task_id, me) or []
            open_one = next((a for a in attempts if a['status'] == 'in_progress'), None)
            if not open_one:
                if len(attempts) >= int(task.get('max_attempts') or 1):
                    return _no('You have used all your attempts for this quiz.', 409)
                qids, order = Q.build_attempt(questions, bool(task.get('shuffle', 1)), task.get('pool_size'))
                open_one = call_proc_one('sp_quiz_attempt_create', str(uuid.uuid4()), task_id, me, len(attempts) + 1,
                                         json.dumps(qids), json.dumps(order), None)
                db.session.commit()
            by = {q['id']: q for q in questions}
            order = json.loads(open_one['option_order_json'] or '{}') if isinstance(open_one.get('option_order_json'), str) \
                else (open_one.get('option_order_json') or {})
            ids = json.loads(open_one['question_ids_json']) if isinstance(open_one['question_ids_json'], str) \
                else open_one['question_ids_json']
            return _ok({'attempt_id': open_one['id'], 'task_id': task_id, 'title': task.get('title'),
                        'questions': [Q.student_view(by[i], order) for i in ids if i in by],
                        'downloaded_at': datetime.datetime.utcnow().isoformat() + 'Z'})
        except Exception as e:
            return _err('GET offline pack', e)
