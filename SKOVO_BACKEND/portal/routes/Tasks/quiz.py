"""Student quiz flow (feature-updates.md §5).

POST /tasks/<task_id>/quiz/start                  new attempt (or resume the open one)
PUT  /tasks/<task_id>/quiz/<attempt_id>           autosave answers {answers, tab_switches}
POST /tasks/<task_id>/quiz/<attempt_id>/submit    grade, record, award admin rules
GET  /tasks/<task_id>/quiz/review                 answers + explanations when allowed
POST /tasks/submissions/<submission_id>/appeal    {text}

The timer lives on the server: an attempt past its deadline is graded with the
answers saved by then, never accepted late.
"""
from portal.helpers.error_capture import capture_error
import datetime
import json
import uuid
from flask import jsonify, request
from flask_restx import Resource
from flask_jwt_extended import jwt_required, get_jwt_identity
from portal.models import db
from portal.helpers.sp import call_proc, call_proc_one
from portal.helpers import quiz as Q
from . import ns, logger

GRACE_SECONDS = 20          # network slack on the deadline


def _err(where, e):
    db.session.rollback()
    logger.error(f"{where}: {e}")
    return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)},
                   status=500, bool=False)


def _no(msg, code=400):
    return jsonify(response={'message': msg}, status=code, bool=False)


def _task(task_id):
    from sqlalchemy import text
    r = db.session.execute(text("SELECT * FROM cohort_tasks WHERE id = :i AND deleted_at IS NULL"),
                           {'i': task_id}).mappings().first()
    return dict(r) if r else None


def _enrolled(user_id, cohort_id):
    from sqlalchemy import text
    return bool(db.session.execute(text(
        "SELECT 1 FROM cohort_enrollments WHERE user_id = :u AND cohort_id = :c "
        "AND payment_status IN ('paid', 'free') AND cancelled_at IS NULL LIMIT 1"),
        {'u': user_id, 'c': cohort_id}).first())


def _quiz_open(cohort):
    """A quiz measures what the class taught, so it opens at End session -- or
    once the booked time is over, in case the achiever forgets to end it."""
    if not cohort:
        return False
    if (cohort.get('status') or '') == 'completed':
        return True
    start = cohort.get('session_date')
    if not start:
        return False
    import datetime as _dt
    end = start + _dt.timedelta(minutes=int(cohort.get('duration_minutes') or 90))
    return _dt.datetime.utcnow() >= end


def _load(task_id, user_id):
    """(task, cohort, error) — the gate every quiz call shares."""
    task = _task(task_id)
    if not task or (task.get('grading_mode') or 'manual') != 'auto':
        return None, None, _no('Quiz not found.', 404)
    if not _enrolled(user_id, task.get('cohort_id')):
        return None, None, _no('Quiz not found.', 404)
    cohort = call_proc_one('sp_cohorts_get', task.get('cohort_id'))
    if not _quiz_open(cohort):
        return None, None, _no('This quiz opens when the class ends.', 403)
    if (task.get('task_status') or 'active').lower() != 'active':
        return None, None, _no('This quiz is closed.', 403)
    return task, cohort, None


def _loads(v, default):
    if v is None:
        return default
    if isinstance(v, (dict, list)):
        return v
    try:
        return json.loads(v)
    except ValueError:
        return default


def _paper(attempt, questions):
    by_id = {q['id']: q for q in questions}
    order = _loads(attempt.get('option_order_json'), {})
    return [Q.student_view(by_id[qid], order) for qid in _loads(attempt.get('question_ids_json'), [])
            if qid in by_id]


def _attempt_payload(task, attempt, questions):
    deadline = attempt.get('deadline_at')
    return {
        'attempt_id': attempt['id'], 'attempt_no': attempt['attempt_no'],
        'max_attempts': int(task.get('max_attempts') or 1),
        'time_limit_minutes': task.get('time_limit_minutes'),
        'deadline_at': deadline.isoformat() + 'Z' if deadline else None,
        'seconds_left': max(0, int((deadline - datetime.datetime.utcnow()).total_seconds())) if deadline else None,
        'questions': _paper(attempt, questions),
        'answers': _loads(attempt.get('answers_json'), {}),
        'negative_marks': float(task.get('negative_marks') or 0),
    }


def _expired(attempt):
    d = attempt.get('deadline_at')
    return bool(d and datetime.datetime.utcnow() > d + datetime.timedelta(seconds=GRACE_SECONDS))


@ns.route('/<string:task_id>/quiz/start')
class QuizStart(Resource):
    @jwt_required()
    def post(self, task_id):
        try:
            me = get_jwt_identity()
            task, _c, err = _load(task_id, me)
            if err:
                return err
            questions = call_proc('sp_task_questions_list', task_id) or []
            if not questions:
                return _no('This quiz has no questions yet.', 409)
            attempts = call_proc('sp_quiz_attempts_for', task_id, me) or []
            open_one = next((a for a in attempts if a['status'] == 'in_progress'), None)
            if open_one and not _expired(open_one):
                return jsonify(response=_attempt_payload(task, open_one, questions), status=200, bool=True)
            if open_one and _expired(open_one):
                _finish(task, open_one, questions, me, _loads(open_one.get('answers_json'), {}), 'expired')
                attempts = call_proc('sp_quiz_attempts_for', task_id, me) or []
            used = len(attempts)
            if used >= int(task.get('max_attempts') or 1):
                return _no('You have used all your attempts for this quiz.', 409)
            qids, order = Q.build_attempt(questions, bool(task.get('shuffle', 1)), task.get('pool_size'))
            limit = task.get('time_limit_minutes')
            deadline = (datetime.datetime.utcnow() + datetime.timedelta(minutes=int(limit))) if limit else None
            row = call_proc_one('sp_quiz_attempt_create', str(uuid.uuid4()), task_id, me, used + 1,
                                json.dumps(qids), json.dumps(order), deadline)
            db.session.commit()
            return jsonify(response=_attempt_payload(task, row, questions), status=201, bool=True)
        except Exception as e:
            return _err('POST quiz start', e)


@ns.route('/<string:task_id>/quiz/<string:attempt_id>')
class QuizSave(Resource):
    @jwt_required()
    def put(self, task_id, attempt_id):
        try:
            me = get_jwt_identity()
            attempt = call_proc_one('sp_quiz_attempt_get', attempt_id)
            if not attempt or attempt['user_id'] != me or attempt['task_id'] != task_id:
                return _no('Attempt not found.', 404)
            if attempt['status'] != 'in_progress' or _expired(attempt):
                return _no('Time is up for this attempt.', 409)
            d = request.get_json() or {}
            answers = d.get('answers')
            if answers is not None and not isinstance(answers, dict):
                return _no('Answers must be an object of {question_id: answer}.')
            allowed = set(_loads(attempt.get('question_ids_json'), []))
            if answers is not None:
                answers = {str(k): (str(v)[:500] if v is not None else None)
                           for k, v in answers.items() if str(k) in allowed}
            tabs = max(0, min(50, int(d.get('tab_switches') or 0)))
            call_proc_one('sp_quiz_attempt_save', attempt_id, me,
                          json.dumps(answers, ensure_ascii=False) if answers is not None else None, tabs)
            db.session.commit()
            return jsonify(response={'saved': True}, status=200, bool=True)
        except Exception as e:
            return _err('PUT quiz save', e)


def _finish(task, attempt, questions, user_id, answers, status):
    """Grade an attempt, write the submission, award admin rules, record the streak."""
    from portal.helpers import score, engagement
    by_id = {q['id']: q for q in questions}
    paper = [by_id[q] for q in _loads(attempt.get('question_ids_json'), []) if q in by_id]
    pts, total, _detail = Q.grade(paper, answers, float(task.get('negative_marks') or 0))
    pct = round(pts * 100 / total, 1) if total else 0.0
    call_proc_one('sp_quiz_attempt_finish', attempt['id'], json.dumps(answers, ensure_ascii=False),
                  'submitted' if status == 'submitted' else 'expired', pts, total, pct)
    late = bool(task.get('due_date') and datetime.datetime.utcnow() > task['due_date'])

    flags = {}
    if int(attempt.get('tab_switches') or 0) >= 3:
        flags['tab_switches'] = int(attempt['tab_switches'])
    others = [(r['user_id'], _loads(r['answers_json'], {})) for r in
              call_proc('sp_quiz_answer_sets', task['id'], user_id) or []]
    wrong_only = {k: v for k, v in answers.items() if k in by_id and Q.is_correct(by_id[k], v) is False}
    twins = Q.identical_pattern(wrong_only, others)
    if twins:
        flags['identical_wrong_answers_with'] = twins[:10]

    summary = f"Quiz: {pts:g}/{total:g} ({pct:g}%)"
    res = call_proc_one('sp_quiz_submission_write', task['id'], user_id, attempt['id'], pts, total,
                        summary, 1 if late else 0, json.dumps(flags) if flags else None) or {}
    db.session.commit()

    # Admin rules decide the points (all 0 / inactive by default). A late
    # submission follows the admin late policy.
    policy = (call_proc_one('sp_task_settings_get') or {}).get('late_policy') or 'full'
    if not (late and policy == 'none'):
        # Playbook v2.1: a passed MCQ cohort task is Skill evidence the app has
        # checked -- +2 on a pass, +3 at 70% (7/10) or above, once per cohort.
        from portal.helpers import readiness_v21
        if readiness_v21.enabled():
            pass_pct = task.get('pass_percent')
            if pct >= float(pass_pct if pass_pct is not None else 50):
                readiness_v21.award(user_id, 'cohort_task', task.get('cohort_id') or task['id'],
                                    mark=int(pct // 10), source='app')
                db.session.commit()
        score.award(user_id, 'quiz_submitted', ref_id=task['id'], recalc=False)
        pass_pct = task.get('pass_percent')
        if pass_pct is not None and pct >= float(pass_pct):
            score.award(user_id, 'quiz_passed', ref_id=task['id'], recalc=False)
        if total and pts >= total:
            score.award(user_id, 'quiz_perfect', ref_id=task['id'], recalc=False)
        score.recalc(user_id)
    # Wrong answers go to My Mistakes (if switched on); the action feeds the
    # daily goal, quests (some need a minimum %), streak and achievements.
    engagement.add_mistakes(user_id, [k for k in wrong_only])
    engagement.track(user_id, 'quiz_submitted', percent=pct)
    db.session.commit()
    return {'score': pts, 'total': total, 'percent': pct, 'late': late,
            'submission_id': res.get('submission_id'), 'flagged': bool(flags)}


@ns.route('/<string:task_id>/quiz/<string:attempt_id>/submit')
class QuizSubmit(Resource):
    @jwt_required()
    def post(self, task_id, attempt_id):
        try:
            me = get_jwt_identity()
            task, _c, err = _load(task_id, me)
            if err:
                return err
            attempt = call_proc_one('sp_quiz_attempt_get', attempt_id)
            if not attempt or attempt['user_id'] != me or attempt['task_id'] != task_id:
                return _no('Attempt not found.', 404)
            if attempt['status'] != 'in_progress':
                return _no('This attempt was already submitted.', 409)
            questions = call_proc('sp_task_questions_list', task_id) or []
            allowed = set(_loads(attempt.get('question_ids_json'), []))
            if _expired(attempt):
                # Time ran out: grade what was saved by the deadline, not this body.
                answers = _loads(attempt.get('answers_json'), {})
                status = 'expired'
            else:
                sent = (request.get_json() or {}).get('answers')
                answers = sent if isinstance(sent, dict) else _loads(attempt.get('answers_json'), {})
                status = 'submitted'
            answers = {str(k): (str(v)[:500] if v is not None else None)
                       for k, v in (answers or {}).items() if str(k) in allowed}
            out = _finish(task, attempt, questions, me, answers, status)
            out['can_review'] = Q.can_review(task)
            out['timed_out'] = status == 'expired'
            return jsonify(response=out, status=200, bool=True)
        except Exception as e:
            return _err('POST quiz submit', e)


@ns.route('/<string:task_id>/quiz/review')
class QuizReview(Resource):
    @jwt_required()
    def get(self, task_id):
        try:
            me = get_jwt_identity()
            task = _task(task_id)
            if not task or not _enrolled(me, task.get('cohort_id')):
                return _no('Quiz not found.', 404)
            if not Q.can_review(task):
                return _no('Answers open after the deadline.', 403)
            done = [a for a in call_proc('sp_quiz_attempts_for', task_id, me) or [] if a['status'] != 'in_progress']
            if not done:
                return _no('Submit the quiz first.', 409)
            last = done[-1]
            by_id = {q['id']: q for q in call_proc('sp_task_questions_list', task_id) or []}
            answers = _loads(last.get('answers_json'), {})
            items = [Q.review_view(by_id[qid], answers.get(qid), Q.is_correct(by_id[qid], answers.get(qid)))
                     for qid in _loads(last.get('question_ids_json'), []) if qid in by_id]
            return jsonify(response={'score': float(last.get('score') or 0), 'total': float(last.get('total') or 0),
                                     'percent': float(last.get('percent') or 0), 'questions': items},
                           status=200, bool=True)
        except Exception as e:
            return _err('GET quiz review', e)


@ns.route('/submissions/<string:submission_id>/appeal')
class Appeal(Resource):
    @jwt_required()
    def post(self, submission_id):
        try:
            me = get_jwt_identity()
            text_ = ((request.get_json() or {}).get('text') or '').strip()
            if not (10 <= len(text_) <= 1000):
                return _no('Explain your appeal in 10–1000 characters.')
            days = int((call_proc_one('sp_task_settings_get') or {}).get('appeal_days') or 0)
            res = call_proc_one('sp_submission_appeal', submission_id, me, text_, days) or {}
            db.session.commit()
            if not res.get('ok'):
                msg = {'not_reviewed': 'You can appeal once your work has been reviewed.',
                       'already_appealed': 'You have already appealed this.',
                       'window_closed': 'The appeal window has closed.'}.get(res.get('result'), 'Could not appeal.')
                return _no(msg, 409)
            sub = call_proc_one('sp_task_submissions_get', submission_id) or {}
            task = _task(sub.get('task_id')) or {}
            cohort = call_proc_one('sp_cohorts_get', task.get('cohort_id')) or {}
            if cohort.get('achiever_id'):
                from portal.helpers.notifications import notify_user
                notify_user(cohort['achiever_id'], 'New appeal', f"A student appealed the score on '{task.get('title')}'.",
                            type='system', reference_type='task_submission', reference_id=submission_id)
            return jsonify(response={'message': 'Appeal sent to your mentor.'}, status=200, bool=True)
        except Exception as e:
            return _err('POST appeal', e)
