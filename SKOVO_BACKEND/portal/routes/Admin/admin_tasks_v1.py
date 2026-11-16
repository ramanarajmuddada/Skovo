"""Admin — task settings (feature-updates.md §5).

GET/PUT /task-settings   late policy (full / none) and appeal window (days)

late_policy 'full' pays a late quiz like an on-time one; 'none' pays nothing
for late work (the submission still counts for the streak and is recorded).
Points for each task type are the score rules task_approved_<type>,
quiz_submitted, quiz_passed and quiz_perfect, edited in Score rules.
"""
from portal.helpers.error_capture import capture_error
from flask import jsonify, request
from flask_restx import Resource
from flask_jwt_extended import jwt_required, get_jwt_identity
from portal.models import db
from portal.helpers.sp import call_proc_one
from portal.helpers.admin_auth import can, AREA_SCORE
from portal.helpers.audit import log_audit
from . import ns, logger

LATE = ('full', 'none')


def _d(r):
    r = r or {}
    return {'late_policy': r.get('late_policy') or 'full', 'appeal_days': int(r.get('appeal_days') or 0)}


@ns.route('/task-settings')
class AdminTaskSettings(Resource):
    @jwt_required()
    def get(self):
        try:
            if not can(AREA_SCORE):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
            return jsonify(response={'settings': _d(call_proc_one('sp_task_settings_get'))}, status=200, bool=True)
        except Exception as e:
            logger.error(f"GET /admin/task-settings: {e}")
            return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)},
                           status=500, bool=False)

    @jwt_required()
    def put(self):
        try:
            if not can(AREA_SCORE):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
            d = request.get_json() or {}
            late = d.get('late_policy')
            if late is not None and late not in LATE:
                return jsonify(response={'message': 'Late policy must be full or none.'}, status=400, bool=False)
            try:
                days = int(d['appeal_days']) if d.get('appeal_days') not in (None, '') else None
            except (TypeError, ValueError):
                return jsonify(response={'message': 'Appeal window must be a number of days.'}, status=400, bool=False)
            if days is not None and not (0 <= days <= 90):
                return jsonify(response={'message': 'Appeal window must be 0–90 days.'}, status=400, bool=False)
            admin = get_jwt_identity()
            before = _d(call_proc_one('sp_task_settings_get'))
            row = call_proc_one('sp_task_settings_set', late, days, admin)
            db.session.commit()
            log_audit('task_settings_updated', 'task_settings', '1', admin, {'before': before, 'after': _d(row)})
            return jsonify(response={'settings': _d(row), 'message': 'Saved.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"PUT /admin/task-settings: {e}")
            return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)},
                           status=500, bool=False)


@ns.route('/offline-quizzes')
class AdminOfflineQuizzes(Resource):
    """Which cohort quizzes students may download and take offline (§7 item 14).
    Only auto-checked quizzes with no time limit qualify; all start off."""

    @jwt_required()
    def get(self):
        try:
            if not can(AREA_SCORE):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
            from sqlalchemy import text
            q = (request.args.get('q') or '').strip()
            rows = db.session.execute(text(
                "SELECT t.id, t.title, t.offline_allowed, c.title AS cohort_title, "
                "(SELECT COUNT(*) FROM task_questions tq WHERE tq.task_id = t.id AND tq.deleted_at IS NULL) AS questions "
                "FROM cohort_tasks t LEFT JOIN cohorts c ON c.id = t.cohort_id "
                "WHERE t.deleted_at IS NULL AND t.grading_mode = 'auto' AND COALESCE(t.time_limit_minutes, 0) = 0 "
                "AND (:q = '' OR t.title LIKE :like OR c.title LIKE :like) "
                "ORDER BY t.offline_allowed DESC, t.created_at DESC LIMIT 200"),
                {'q': q, 'like': f'%{q}%'}).mappings().all()
            return jsonify(response={'quizzes': [{
                'id': r['id'], 'title': r['title'], 'cohort_title': r['cohort_title'],
                'questions': int(r['questions'] or 0), 'offline_allowed': bool(r['offline_allowed']),
            } for r in rows]}, status=200, bool=True)
        except Exception as e:
            logger.error(f"GET /admin/offline-quizzes: {e}")
            return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)},
                           status=500, bool=False)


@ns.route('/offline-quizzes/<string:task_id>')
class AdminOfflineQuiz(Resource):
    @jwt_required()
    def put(self, task_id):
        try:
            if not can(AREA_SCORE):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
            from sqlalchemy import text
            on = 1 if (request.get_json() or {}).get('offline_allowed') in (True, 1, '1', 'true') else 0
            res = db.session.execute(text(
                "UPDATE cohort_tasks SET offline_allowed = :on WHERE id = :i AND deleted_at IS NULL "
                "AND grading_mode = 'auto' AND COALESCE(time_limit_minutes, 0) = 0"), {'on': on, 'i': task_id})
            if not res.rowcount:
                db.session.rollback()
                return jsonify(response={'message': 'Only auto-checked quizzes without a time limit can be offline.'},
                               status=409, bool=False)
            db.session.commit()
            log_audit('task_offline_set', 'cohort_task', task_id, get_jwt_identity(), {'offline_allowed': bool(on)})
            return jsonify(response={'offline_allowed': bool(on), 'message': 'Saved.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"PUT /admin/offline-quizzes: {e}")
            return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)},
                           status=500, bool=False)
