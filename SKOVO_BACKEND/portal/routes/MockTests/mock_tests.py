"""
Mock Tests — student practice exams
Admin: POST/PUT/DELETE /admin/mock-tests
Student: GET /mock-tests, POST /mock-tests/:id/attempt
"""
from portal.helpers.error_capture import capture_error
from portal.helpers.helpers import serialize_datetime
import uuid, json, datetime
from flask import jsonify, request
from flask_restx import Resource, reqparse
from flask_jwt_extended import jwt_required, get_jwt_identity
from portal.models import db
from portal.helpers.decorators import require_role
from portal.helpers.sp import call_proc, call_proc_one
from . import ns, logger


def _as_json(v, default=None):
    if isinstance(v, str):
        try:
            return json.loads(v)
        except Exception:
            return default
    return v if v is not None else default

# ── Admin: manage mock tests ──────────────────────────────────────────────────

from portal.api import api as _api
_admin_ns = _api.namespace('skovo-platform-panel-admin', description='Admin Panel')


@_admin_ns.route('/mock-tests')
class AdminMockTestList(Resource):
    @require_role('admin', 'super_admin')
    def get(self):
        try:
            # ── SP: sp_mock_tests_list ───────────────────────────────────────────
            tests = call_proc('sp_mock_tests_list', 5000, 0, 0)
            tests.sort(key=lambda t: t.get('created_at') or '', reverse=True)
            return jsonify(response={'tests': [_test_dict_sp(t) for t in tests]}, status=200, bool=True)
        except Exception as e:
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @require_role('admin', 'super_admin')
    def post(self):
        try:
            data = request.get_json() or {}
            if not data.get('title'):
                return jsonify(response={'message': 'Title is required.'}, status=400, bool=False)
            # ── SP: sp_mock_tests_create ─────────────────────────────────────────
            t = call_proc_one(
                'sp_mock_tests_create',
                str(uuid.uuid4()), data['title'].strip(), data.get('exam_type'), data.get('description'),
                int(data.get('duration_minutes') or 60), int(data.get('total_marks') or 100),
                int(data.get('pass_marks') or 40), data.get('difficulty', 'medium'), 1, None, None,
            )
            db.session.commit()
            return jsonify(response={'message': 'Mock test created.', 'test_id': t['id']}, status=201, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@_admin_ns.route('/mock-tests/<string:test_id>')
class AdminMockTestDetail(Resource):
    @require_role('admin', 'super_admin')
    def put(self, test_id):
        try:
            # ── SP: sp_mock_tests_get + _update (full replace) ──────────────────
            t = call_proc_one('sp_mock_tests_get', test_id)
            if not t:
                return jsonify(response={'message': 'Test not found.'}, status=404, bool=False)
            data = request.get_json() or {}
            call_proc_one(
                'sp_mock_tests_update',
                test_id,
                data['title'] if 'title' in data else t.get('title'),
                data['exam_type'] if 'exam_type' in data else t.get('exam_type'),
                data['description'] if 'description' in data else t.get('description'),
                int(data['duration_minutes']) if data.get('duration_minutes') is not None else t.get('duration_minutes'),
                int(data['total_marks']) if data.get('total_marks') is not None else t.get('total_marks'),
                int(data['pass_marks']) if data.get('pass_marks') is not None else t.get('pass_marks'),
                data['difficulty'] if 'difficulty' in data else t.get('difficulty'),
                (1 if data['is_active'] else 0) if 'is_active' in data else t.get('is_active'),
                t.get('created_by'), None,
            )
            db.session.commit()
            return jsonify(response={'message': 'Updated.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @require_role('admin', 'super_admin')
    def patch(self, test_id):
        # Lightweight toggle used by the admin UI's Enable/Disable switch.
        try:
            # ── SP: sp_mock_tests_get + _update (full replace) ──────────────────
            t = call_proc_one('sp_mock_tests_get', test_id)
            if not t:
                return jsonify(response={'message': 'Test not found.'}, status=404, bool=False)
            data = request.get_json() or {}
            new_active = bool(data['is_active']) if 'is_active' in data else (not t.get('is_active'))
            call_proc_one(
                'sp_mock_tests_update',
                test_id, t.get('title'), t.get('exam_type'), t.get('description'),
                t.get('duration_minutes'), t.get('total_marks'), t.get('pass_marks'),
                t.get('difficulty'), 1 if new_active else 0, t.get('created_by'), None,
            )
            db.session.commit()
            return jsonify(response={'message': f"Test {'enabled' if new_active else 'disabled'}.", 'is_active': new_active}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @require_role('admin', 'super_admin')
    def delete(self, test_id):
        try:
            # ── SP: sp_mock_tests_get + _update (soft delete via full replace) ──
            t = call_proc_one('sp_mock_tests_get', test_id)
            if not t:
                return jsonify(response={'message': 'Test not found.'}, status=404, bool=False)
            call_proc_one(
                'sp_mock_tests_update',
                test_id, t.get('title'), t.get('exam_type'), t.get('description'),
                t.get('duration_minutes'), t.get('total_marks'), t.get('pass_marks'),
                t.get('difficulty'), 0, t.get('created_by'), None,
            )
            db.session.commit()
            return jsonify(response={'message': 'Deleted.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@_admin_ns.route('/mock-tests/<string:test_id>/questions')
class AdminMockTestQuestions(Resource):
    @require_role('admin', 'super_admin')
    def get(self, test_id):
        try:
            # ── SP: sp_exam_questions_list — no by-mock-test-id filter on the
            # generic CRUD proc, so pull a bounded batch and filter here. ──────
            all_qs = call_proc('sp_exam_questions_list', 50000, 0)
            qs = [q for q in all_qs if q.get('mock_test_id') == test_id]
            qs.sort(key=lambda q: q.get('sort_order') or 0)
            return jsonify(response={'questions': [_q_dict(q) for q in qs]}, status=200, bool=True)
        except Exception as e:
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @require_role('admin', 'super_admin')
    def post(self, test_id):
        try:
            # ── SP: sp_mock_tests_get, sp_exam_questions_create ─────────────────
            t = call_proc_one('sp_mock_tests_get', test_id)
            if not t:
                return jsonify(response={'message': 'Test not found.'}, status=404, bool=False)
            data = request.get_json() or {}
            if not data.get('question_text'):
                return jsonify(response={'message': 'question_text is required.'}, status=400, bool=False)
            q = call_proc_one(
                'sp_exam_questions_create',
                str(uuid.uuid4()), test_id, data['question_text'], data.get('question_type', 'mcq'),
                json.dumps(data.get('options')) if data.get('options') is not None else None,
                data.get('correct_answer'), data.get('explanation'),
                int(data.get('marks') or 1), int(data.get('sort_order') or 0),
            )
            db.session.commit()
            return jsonify(response={'message': 'Question added.', 'question_id': q['id']}, status=201, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@_admin_ns.route('/mock-tests/<string:test_id>/questions/<string:q_id>')
class AdminMockTestQuestionDetail(Resource):
    @require_role('admin', 'super_admin')
    def put(self, test_id, q_id):
        try:
            # ── SP: sp_exam_questions_get + _update (full replace) ──────────────
            q = call_proc_one('sp_exam_questions_get', q_id)
            if not q or q.get('mock_test_id') != test_id:
                return jsonify(response={'message': 'Question not found.'}, status=404, bool=False)
            data = request.get_json() or {}
            options = json.dumps(data['options']) if 'options' in data else q.get('options')
            call_proc_one(
                'sp_exam_questions_update',
                q_id, test_id,
                data['question_text'] if 'question_text' in data else q.get('question_text'),
                data['question_type'] if 'question_type' in data else q.get('question_type'),
                options,
                data['correct_answer'] if 'correct_answer' in data else q.get('correct_answer'),
                data['explanation'] if 'explanation' in data else q.get('explanation'),
                int(data['marks']) if 'marks' in data else q.get('marks'),
                int(data['sort_order']) if 'sort_order' in data else q.get('sort_order'),
            )
            db.session.commit()
            return jsonify(response={'message': 'Updated.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @require_role('admin', 'super_admin')
    def delete(self, test_id, q_id):
        try:
            # ── SP: sp_exam_questions_get + _delete ──────────────────────────────
            q = call_proc_one('sp_exam_questions_get', q_id)
            if not q or q.get('mock_test_id') != test_id:
                return jsonify(response={'message': 'Question not found.'}, status=404, bool=False)
            call_proc('sp_exam_questions_delete', q_id)
            db.session.commit()
            return jsonify(response={'message': 'Deleted.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


# ── Student: take tests ───────────────────────────────────────────────────────

def _test_dict_sp(t):
    return {
        'id': t['id'], 'title': t.get('title'), 'exam_type': t.get('exam_type'),
        'description': t.get('description'), 'duration_minutes': t.get('duration_minutes'),
        'total_marks': t.get('total_marks'), 'pass_marks': t.get('pass_marks'),
        'difficulty': t.get('difficulty'), 'is_active': bool(t.get('is_active')),
        'created_at': serialize_datetime(t['created_at']) if t.get('created_at') else None,
    }


@ns.route('/')
class MockTestList(Resource):
    @jwt_required()
    def get(self):
        try:
            user_id = get_jwt_identity()
            # ── SP: sp_mock_tests_list, sp_test_attempts_list — no by-user-id
            # filter on the generic CRUD proc, so pull a bounded batch and
            # aggregate per test in Python. ──────────────────────────────────
            tests = call_proc('sp_mock_tests_list', 5000, 0, 1)
            tests.sort(key=lambda t: t.get('created_at') or '', reverse=True)
            all_attempts = call_proc('sp_test_attempts_list', 50000, 0)
            my_attempts = [a for a in all_attempts if a.get('user_id') == user_id]

            result = []
            for t in tests:
                test_attempts = [a for a in my_attempts if a.get('mock_test_id') == t['id']]
                completed = [a for a in test_attempts if a.get('status') == 'completed']
                best = max(completed, key=lambda a: a.get('percentage') or 0, default=None)
                result.append({**_test_dict_sp(t), 'attempts_count': len(test_attempts),
                                'best_score': best.get('percentage') if best else None})
            return jsonify(response={'tests': result, 'total': len(result)}, status=200, bool=True)
        except Exception as e:
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/<string:test_id>/start')
class MockTestStart(Resource):
    @jwt_required()
    def post(self, test_id):
        try:
            user_id = get_jwt_identity()
            # ── SP: sp_mock_tests_get, sp_exam_questions_list, sp_test_attempts_create ─
            t = call_proc_one('sp_mock_tests_get', test_id)
            if not t or not t.get('is_active'):
                return jsonify(response={'message': 'Test not found.'}, status=404, bool=False)

            all_questions = call_proc('sp_exam_questions_list', 50000, 0)
            qs = [q for q in all_questions if q.get('mock_test_id') == test_id]
            qs.sort(key=lambda q: q.get('sort_order') or 0)

            attempt = call_proc_one(
                'sp_test_attempts_create',
                None, test_id, user_id, None, None, t.get('total_marks'), None, None, None,
                'in_progress', datetime.datetime.utcnow(), None,
            )
            db.session.commit()

            # Return questions without correct_answer
            questions = [{
                'id': q['id'], 'question_text': q.get('question_text'),
                'question_type': q.get('question_type'), 'options': q.get('options'),
                'marks': q.get('marks'), 'sort_order': q.get('sort_order'),
            } for q in qs]
            return jsonify(response={
                'attempt_id': attempt['id'], 'test_id': t['id'], 'title': t.get('title'),
                'duration_minutes': t.get('duration_minutes'), 'total_marks': t.get('total_marks'),
                'questions': questions,
            }, status=201, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/attempts/<string:attempt_id>/submit')
class MockTestSubmit(Resource):
    @jwt_required()
    def post(self, attempt_id):
        try:
            user_id = get_jwt_identity()
            # ── SP: sp_test_attempts_get ─────────────────────────────────────────
            attempt = call_proc_one('sp_test_attempts_get', attempt_id)
            if not attempt or attempt.get('user_id') != user_id or attempt.get('status') != 'in_progress':
                return jsonify(response={'message': 'Attempt not found.'}, status=404, bool=False)
            data = request.get_json() or {}
            answers = data.get('answers', {})

            # Auto-grade
            # ── SP: sp_exam_questions_list — no by-mock-test-id filter on the
            # generic CRUD proc, so pull a bounded batch and filter here. ──────
            all_questions = call_proc('sp_exam_questions_list', 50000, 0)
            qs = [q for q in all_questions if q.get('mock_test_id') == attempt.get('mock_test_id')]
            # One grader for mock tests and cohort quizzes (helpers/quiz.py):
            # MCQ by option key or option text, true/false, typed answers
            # (case- and Telugu-safe). Unanswered questions score nothing.
            from portal.helpers import quiz as Q
            score = 0
            for q in qs:
                if str(q['id']) not in answers:
                    continue
                qtype = q.get('question_type', 'mcq')
                item = {'id': str(q['id']), 'question_type': 'fill_blank' if qtype == 'text' else qtype,
                        'options_json': q.get('options'), 'correct_answer': q.get('correct_answer'),
                        'marks': q.get('marks')}
                if Q.is_correct(item, answers[str(q['id'])]):
                    score += q.get('marks') or 0

            # ── SP: sp_mock_tests_get, sp_test_attempts_update (full replace) ────
            t = call_proc_one('sp_mock_tests_get', attempt.get('mock_test_id'))
            total_marks = t.get('total_marks')
            percentage = round((score / total_marks * 100), 1) if total_marks else 0
            passed = score >= (t.get('pass_marks') or 0)
            completed_at = datetime.datetime.utcnow()
            time_taken_minutes = attempt.get('time_taken_minutes')
            started_at = attempt.get('started_at')
            if started_at:
                time_taken_minutes = (completed_at - started_at).seconds // 60

            call_proc_one(
                'sp_test_attempts_update',
                attempt_id, attempt.get('mock_test_id'), user_id, json.dumps(answers),
                score, total_marks, percentage, int(passed), time_taken_minutes,
                'completed', started_at, completed_at,
            )
            db.session.commit()

            # Career streak: a finished mock test counts (§3), if switched on.
            from portal.helpers import engagement
            engagement.track(user_id, 'mock_test_submitted')
            db.session.commit()
            return jsonify(response={
                'score': score, 'total_marks': total_marks,
                'percentage': percentage, 'passed': passed,
            }, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/my-attempts')
class MyAttempts(Resource):
    @jwt_required()
    def get(self):
        try:
            user_id = get_jwt_identity()
            # ── SP: sp_test_attempts_list, sp_mock_tests_list — no by-user-id
            # filter on the generic CRUD proc, so pull bounded batches and
            # join in Python. ────────────────────────────────────────────────
            all_attempts = call_proc('sp_test_attempts_list', 50000, 0)
            attempts = [a for a in all_attempts if a.get('user_id') == user_id]
            attempts.sort(key=lambda a: a.get('created_at') or '', reverse=True)

            tests_by_id = {t['id']: t for t in call_proc('sp_mock_tests_list', 5000, 0, 0)}

            result = []
            for a in attempts:
                t = tests_by_id.get(a.get('mock_test_id'))
                result.append({
                    'id': a['id'], 'test_title': t.get('title') if t else None,
                    'exam_type': t.get('exam_type') if t else None,
                    'score': a.get('score'), 'total_marks': a.get('total_marks'), 'percentage': a.get('percentage'),
                    'passed': bool(a.get('passed')) if a.get('passed') is not None else None,
                    'status': a.get('status'),
                    'completed_at': serialize_datetime(a['completed_at']) if a.get('completed_at') else None,
                })
            return jsonify(response={'attempts': result, 'total': len(result)}, status=200, bool=True)
        except Exception as e:
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


def _q_dict(q):
    return {
        'id': q['id'], 'mock_test_id': q.get('mock_test_id'),
        'question_text': q.get('question_text'), 'question_type': q.get('question_type'),
        'options': _as_json(q.get('options')), 'correct_answer': q.get('correct_answer'),
        'explanation': q.get('explanation'), 'marks': q.get('marks'), 'sort_order': q.get('sort_order'),
    }
