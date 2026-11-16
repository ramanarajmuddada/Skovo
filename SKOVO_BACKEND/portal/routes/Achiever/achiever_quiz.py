"""Achiever — quiz builder, question bank, results, review queue (feature-updates.md §5).

Achievers own content: questions, answers, marks inside a quiz, timer, attempts,
rubric. They never set readiness / streak / leaderboard points -- those are
admin score rules (quiz_submitted, quiz_passed, task_approved_<type> ...).

GET/POST       /achievers/portal/tasks/<id>/questions
PUT/DELETE     /achievers/portal/tasks/<id>/questions/<qid>
POST           /achievers/portal/tasks/<id>/questions/reorder      {ids: [...]}
POST           /achievers/portal/tasks/<id>/questions/from-bank    {ids: [...]}
GET/PUT        /achievers/portal/tasks/<id>/settings               quiz / rubric settings
GET            /achievers/portal/tasks/<id>/results                average, missing, hardest question
GET/POST       /achievers/portal/question-bank
PUT/DELETE     /achievers/portal/question-bank/<qid>
GET            /achievers/portal/review-queue?state=queued|appealed|all
POST           /achievers/portal/submissions/bulk-approve          {ids, mentor_score}
"""
from portal.helpers.error_capture import capture_error
import json
import uuid
from flask import jsonify, request
from flask_restx import Resource
from flask_jwt_extended import jwt_required, get_jwt, get_jwt_identity
from portal.models import db
from portal.helpers.sp import call_proc, call_proc_one
from portal.helpers import quiz as Q
from portal.helpers import task_review
from portal.routes.Achiever.achiever import _achievers_ns as ns, _load_owned_task, _load_owned_submission
from portal.routes.Achiever import logger

REVIEW_AFTER = ('deadline', 'submit', 'never')
GRADING = ('auto', 'manual')


def _only_achiever():
    if get_jwt().get('role') != 'mentor':
        return jsonify(response={'message': 'Achiever access only.'}, status=403, bool=False)
    return None


def _err(where, e):
    db.session.rollback()
    logger.error(f"{where}: {e}")
    return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)},
                   status=500, bool=False)


def _int(v, default=None):
    try:
        return int(v) if v not in (None, '', 'null') else default
    except (ValueError, TypeError):
        return default


def _settings_dict(t):
    rub = t.get('rubric_json')
    if isinstance(rub, str):
        try:
            rub = json.loads(rub)
        except ValueError:
            rub = None
    return {
        'session_id': t.get('session_id'), 'rubric': rub or [],
        'time_limit_minutes': t.get('time_limit_minutes'), 'max_attempts': int(t.get('max_attempts') or 1),
        'shuffle': bool(t.get('shuffle', 1)), 'negative_marks': float(t.get('negative_marks') or 0),
        'review_after': t.get('review_after') or 'deadline', 'grading_mode': t.get('grading_mode') or 'manual',
        'pass_percent': t.get('pass_percent'), 'pool_size': t.get('pool_size'),
    }


def _task_full(task_id):
    """cohort_tasks row with the V1 columns (sp_cohort_tasks_get predates them)."""
    from sqlalchemy import text
    r = db.session.execute(text("SELECT * FROM cohort_tasks WHERE id = :i"), {'i': task_id}).mappings().first()
    return dict(r) if r else {}


@ns.route('/portal/tasks/<string:task_id>/questions')
class TaskQuestions(Resource):
    @jwt_required()
    def get(self, task_id):
        try:
            denied = _only_achiever()
            if denied:
                return denied
            task, _c, err = _load_owned_task(task_id, get_jwt_identity())
            if err:
                return err
            qs = call_proc('sp_task_questions_list', task_id) or []
            return jsonify(response={'questions': [Q.achiever_question(q) for q in qs],
                                     'total_marks': sum(float(q.get('marks') or 1) for q in qs)},
                           status=200, bool=True)
        except Exception as e:
            return _err('GET task questions', e)

    @jwt_required()
    def post(self, task_id):
        try:
            denied = _only_achiever()
            if denied:
                return denied
            me = get_jwt_identity()
            task, _c, err = _load_owned_task(task_id, me)
            if err:
                return err
            d = request.get_json() or {}
            clean, verr = Q.validate_question(d)
            if verr:
                return jsonify(response={'message': verr}, status=400, bool=False)
            count = len(call_proc('sp_task_questions_list', task_id) or [])
            if count >= 200:
                return jsonify(response={'message': 'A quiz can have at most 200 questions.'}, status=400, bool=False)
            qid = str(uuid.uuid4())
            row = call_proc_one('sp_task_question_upsert', qid, task_id, count + 1, *Q.question_args(clean), None, me)
            if d.get('save_to_bank'):
                call_proc_one('sp_question_bank_upsert', str(uuid.uuid4()), me, *Q.question_args(clean))
            db.session.commit()
            return jsonify(response={'question': Q.achiever_question(row)}, status=201, bool=True)
        except Exception as e:
            return _err('POST task question', e)


@ns.route('/portal/tasks/<string:task_id>/questions/<string:qid>')
class TaskQuestion(Resource):
    @jwt_required()
    def put(self, task_id, qid):
        try:
            denied = _only_achiever()
            if denied:
                return denied
            me = get_jwt_identity()
            task, _c, err = _load_owned_task(task_id, me)
            if err:
                return err
            existing = next((q for q in call_proc('sp_task_questions_list', task_id) or [] if q['id'] == qid), None)
            if not existing:
                return jsonify(response={'message': 'Question not found.'}, status=404, bool=False)
            clean, verr = Q.validate_question(request.get_json() or {})
            if verr:
                return jsonify(response={'message': verr}, status=400, bool=False)
            row = call_proc_one('sp_task_question_upsert', qid, task_id, existing.get('position'),
                                *Q.question_args(clean), existing.get('bank_id'), me)
            db.session.commit()
            return jsonify(response={'question': Q.achiever_question(row)}, status=200, bool=True)
        except Exception as e:
            return _err('PUT task question', e)

    @jwt_required()
    def delete(self, task_id, qid):
        try:
            denied = _only_achiever()
            if denied:
                return denied
            task, _c, err = _load_owned_task(task_id, get_jwt_identity())
            if err:
                return err
            n = (call_proc_one('sp_task_question_delete', qid, task_id) or {}).get('deleted', 0)
            db.session.commit()
            if not n:
                return jsonify(response={'message': 'Question not found.'}, status=404, bool=False)
            return jsonify(response={'message': 'Question removed.'}, status=200, bool=True)
        except Exception as e:
            return _err('DELETE task question', e)


@ns.route('/portal/tasks/<string:task_id>/questions/reorder')
class TaskQuestionsReorder(Resource):
    @jwt_required()
    def post(self, task_id):
        try:
            denied = _only_achiever()
            if denied:
                return denied
            task, _c, err = _load_owned_task(task_id, get_jwt_identity())
            if err:
                return err
            ids = (request.get_json() or {}).get('ids') or []
            if not isinstance(ids, list):
                return jsonify(response={'message': 'Send ids as a list.'}, status=400, bool=False)
            for pos, qid in enumerate(ids, 1):
                call_proc_one('sp_task_question_reorder', str(qid), task_id, pos)
            db.session.commit()
            return jsonify(response={'message': 'Order saved.'}, status=200, bool=True)
        except Exception as e:
            return _err('POST reorder questions', e)


@ns.route('/portal/tasks/<string:task_id>/questions/from-bank')
class TaskQuestionsFromBank(Resource):
    @jwt_required()
    def post(self, task_id):
        try:
            denied = _only_achiever()
            if denied:
                return denied
            me = get_jwt_identity()
            task, _c, err = _load_owned_task(task_id, me)
            if err:
                return err
            ids = (request.get_json() or {}).get('ids') or []
            count = len(call_proc('sp_task_questions_list', task_id) or [])
            added = 0
            for bid in ids[:200]:
                b = call_proc_one('sp_question_bank_get', str(bid), me)
                if not b:
                    continue
                count += 1
                call_proc_one('sp_task_question_upsert', str(uuid.uuid4()), task_id, count,
                              b['question_type'], b['text'], b['options_json'], b['correct_answer'],
                              b['accepted_json'], b['tolerance'], b['marks'], b['explanation'],
                              b['lang'], b['topic'], b['id'], me)
                added += 1
            db.session.commit()
            return jsonify(response={'message': f'{added} question(s) added from your bank.', 'added': added},
                           status=200, bool=True)
        except Exception as e:
            return _err('POST questions from bank', e)


@ns.route('/portal/tasks/<string:task_id>/settings')
class TaskQuizSettings(Resource):
    @jwt_required()
    def get(self, task_id):
        try:
            denied = _only_achiever()
            if denied:
                return denied
            task, cohort, err = _load_owned_task(task_id, get_jwt_identity())
            if err:
                return err
            sessions = call_proc('sp_cohort_sessions_list', cohort['id']) if cohort else []
            return jsonify(response={'settings': _settings_dict(_task_full(task_id)),
                                     'sessions': [{'id': s.get('id'), 'title': s.get('title')} for s in sessions or []]},
                           status=200, bool=True)
        except Exception as e:
            return _err('GET task settings', e)

    @jwt_required()
    def put(self, task_id):
        try:
            denied = _only_achiever()
            if denied:
                return denied
            me = get_jwt_identity()
            task, _c, err = _load_owned_task(task_id, me)
            if err:
                return err
            cur = _settings_dict(_task_full(task_id))
            d = {**cur, **(request.get_json() or {})}
            limit, attempts = _int(d.get('time_limit_minutes'), 0), _int(d.get('max_attempts'), 1)
            pass_pct, pool = _int(d.get('pass_percent')), _int(d.get('pool_size'), 0)
            try:
                negative = float(d.get('negative_marks') or 0)
            except (TypeError, ValueError):
                return jsonify(response={'message': 'Negative marks must be a number.'}, status=400, bool=False)
            if not (0 <= (limit or 0) <= 600):
                return jsonify(response={'message': 'Time limit must be 0–600 minutes (0 = no limit).'}, status=400, bool=False)
            if not (1 <= attempts <= 10):
                return jsonify(response={'message': 'Attempts must be 1–10.'}, status=400, bool=False)
            if pass_pct is not None and not (0 <= pass_pct <= 100):
                return jsonify(response={'message': 'Pass % must be 0–100.'}, status=400, bool=False)
            if not (0 <= negative <= 10):
                return jsonify(response={'message': 'Negative marks must be 0–10.'}, status=400, bool=False)
            if d.get('review_after') not in REVIEW_AFTER or d.get('grading_mode') not in GRADING:
                return jsonify(response={'message': 'Invalid review or grading option.'}, status=400, bool=False)
            rubric = d.get('rubric') or []
            if not isinstance(rubric, list) or len(rubric) > 10:
                return jsonify(response={'message': 'A rubric has up to 10 lines.'}, status=400, bool=False)
            clean_rubric = []
            for line in rubric:
                label = str((line or {}).get('label') or '').strip()[:120]
                mx = _int((line or {}).get('max'))
                if not label or not mx or not (1 <= mx <= 100):
                    return jsonify(response={'message': 'Every rubric line needs a name and a max score (1–100).'},
                                   status=400, bool=False)
                clean_rubric.append({'label': label, 'max': mx})
            row = call_proc_one('sp_task_quiz_settings_set', task_id, d.get('session_id') or '',
                                json.dumps(clean_rubric) if clean_rubric else None, limit, attempts,
                                1 if d.get('shuffle') in (True, 1, '1', 'true') else 0, negative,
                                d.get('review_after'), d.get('grading_mode'), pass_pct, pool, me)
            db.session.commit()
            return jsonify(response={'settings': _settings_dict(row or {}), 'message': 'Saved.'},
                           status=200, bool=True)
        except Exception as e:
            return _err('PUT task settings', e)


@ns.route('/portal/tasks/<string:task_id>/results')
class TaskResults(Resource):
    @jwt_required()
    def get(self, task_id):
        try:
            denied = _only_achiever()
            if denied:
                return denied
            task, _c, err = _load_owned_task(task_id, get_jwt_identity())
            if err:
                return err
            questions = {q['id']: q for q in call_proc('sp_task_questions_list', task_id) or []}
            results = call_proc('sp_task_results', task_id) or []
            enrolled = call_proc('sp_task_enrolled_students', task_id) or []
            done = {r['user_id'] for r in results}
            per_q = {qid: {'correct': 0, 'answered': 0} for qid in questions}
            rows = []
            for r in results:
                answers = r.get('answers_json')
                answers = json.loads(answers) if isinstance(answers, str) else (answers or {})
                for qid, q in questions.items():
                    ok = Q.is_correct(q, answers.get(qid))
                    if ok is not None:
                        per_q[qid]['answered'] += 1
                        per_q[qid]['correct'] += 1 if ok else 0
                flags = r.get('flags_json')
                flags = json.loads(flags) if isinstance(flags, str) else (flags or {})
                rows.append({'user_id': r['user_id'], 'name': r['full_name'], 'score': float(r['score'] or 0),
                             'total': float(r['total'] or 0), 'percent': float(r['percent'] or 0),
                             'tab_switches': int(r.get('tab_switches') or 0), 'late': bool(r.get('is_late')),
                             'flags': flags})
            hardest = sorted(
                [{'question_id': qid, 'text': questions[qid].get('text'),
                  'correct_percent': round(v['correct'] * 100 / v['answered'], 1) if v['answered'] else None}
                 for qid, v in per_q.items()],
                key=lambda x: (x['correct_percent'] is None, x['correct_percent'] if x['correct_percent'] is not None else 0))
            avg = round(sum(r['percent'] for r in rows) / len(rows), 1) if rows else None
            return jsonify(response={
                'submitted': len(rows), 'enrolled': len(enrolled), 'average_percent': avg,
                'not_submitted': [{'user_id': e['user_id'], 'name': e['full_name']} for e in enrolled
                                  if e['user_id'] not in done],
                'students': sorted(rows, key=lambda x: -x['percent']),
                'questions': hardest,
            }, status=200, bool=True)
        except Exception as e:
            return _err('GET task results', e)


@ns.route('/portal/question-bank')
class QuestionBank(Resource):
    @jwt_required()
    def get(self):
        try:
            denied = _only_achiever()
            if denied:
                return denied
            a = request.args
            page = max(1, _int(a.get('page'), 1))
            rows = call_proc('sp_question_bank_list', get_jwt_identity(), a.get('topic') or None,
                             a.get('search') or None, 50, (page - 1) * 50) or []
            return jsonify(response={'questions': [Q.achiever_question(q) for q in rows]}, status=200, bool=True)
        except Exception as e:
            return _err('GET question bank', e)

    @jwt_required()
    def post(self):
        try:
            denied = _only_achiever()
            if denied:
                return denied
            clean, verr = Q.validate_question(request.get_json() or {})
            if verr:
                return jsonify(response={'message': verr}, status=400, bool=False)
            row = call_proc_one('sp_question_bank_upsert', str(uuid.uuid4()), get_jwt_identity(),
                                *Q.question_args(clean))
            db.session.commit()
            return jsonify(response={'question': Q.achiever_question(row)}, status=201, bool=True)
        except Exception as e:
            return _err('POST question bank', e)


@ns.route('/portal/question-bank/<string:qid>')
class QuestionBankItem(Resource):
    @jwt_required()
    def put(self, qid):
        try:
            denied = _only_achiever()
            if denied:
                return denied
            me = get_jwt_identity()
            if not call_proc_one('sp_question_bank_get', qid, me):
                return jsonify(response={'message': 'Question not found.'}, status=404, bool=False)
            clean, verr = Q.validate_question(request.get_json() or {})
            if verr:
                return jsonify(response={'message': verr}, status=400, bool=False)
            row = call_proc_one('sp_question_bank_upsert', qid, me, *Q.question_args(clean))
            db.session.commit()
            return jsonify(response={'question': Q.achiever_question(row)}, status=200, bool=True)
        except Exception as e:
            return _err('PUT question bank', e)

    @jwt_required()
    def delete(self, qid):
        try:
            denied = _only_achiever()
            if denied:
                return denied
            n = (call_proc_one('sp_question_bank_delete', qid, get_jwt_identity()) or {}).get('deleted', 0)
            db.session.commit()
            if not n:
                return jsonify(response={'message': 'Question not found.'}, status=404, bool=False)
            return jsonify(response={'message': 'Removed from your bank.'}, status=200, bool=True)
        except Exception as e:
            return _err('DELETE question bank', e)


@ns.route('/portal/review-queue')
class ReviewQueue(Resource):
    @jwt_required()
    def get(self):
        try:
            denied = _only_achiever()
            if denied:
                return denied
            state = request.args.get('state') or 'queued'
            if state not in ('queued', 'appealed', 'all'):
                state = 'queued'
            page = max(1, _int(request.args.get('page'), 1))
            rows = call_proc('sp_review_queue', get_jwt_identity(), state, 50, (page - 1) * 50) or []
            out = []
            for r in rows:
                rub = r.get('rubric_json')
                rub = json.loads(rub) if isinstance(rub, str) else (rub or [])
                scores = r.get('rubric_scores_json')
                scores = json.loads(scores) if isinstance(scores, str) else (scores or {})
                out.append({
                    'id': r['id'], 'task_id': r['task_id'], 'task_title': r['task_title'],
                    'task_type': r.get('task_type'), 'cohort_title': r.get('cohort_title'),
                    'student_name': r.get('student_name'), 'status': r.get('status'),
                    'review_state': r.get('review_state'), 'evidence_url': r.get('evidence_url'),
                    'evidence_text': r.get('evidence_text'), 'mentor_score': r.get('mentor_score'),
                    'mentor_notes': r.get('mentor_notes'), 'rubric': rub, 'rubric_scores': scores,
                    'appeal_text': r.get('appeal_text'), 'late': bool(r.get('is_late')),
                    'submitted_at': r['submitted_at'].isoformat() if r.get('submitted_at') else None,
                    'due_date': r['due_date'].isoformat() if r.get('due_date') else None,
                })
            return jsonify(response={'items': out, 'state': state, 'max_score': task_review.MAX_SCORE},
                           status=200, bool=True)
        except Exception as e:
            return _err('GET review queue', e)


@ns.route('/portal/submissions/bulk-approve')
class BulkApprove(Resource):
    @jwt_required()
    def post(self):
        try:
            denied = _only_achiever()
            if denied:
                return denied
            me = get_jwt_identity()
            d = request.get_json() or {}
            ids = d.get('ids') or []
            score = task_review.clamp_score(d.get('mentor_score'), None)
            if score is None:
                return jsonify(response={'message': f'Give a score out of {task_review.MAX_SCORE}.'}, status=400, bool=False)
            if not isinstance(ids, list) or not ids or len(ids) > 200:
                return jsonify(response={'message': 'Choose 1–200 submissions.'}, status=400, bool=False)
            done = 0
            for sid in ids:
                sub, task, err = _load_owned_submission(str(sid), me)
                if err or sub.get('status') == 'approved':
                    continue
                task_review.apply_review(sub, task, 'approved', score, sub.get('mentor_notes'), me)
                call_proc_one('sp_submission_review_extra', sub['id'], None, 'reviewed')
                db.session.commit()
                done += 1
            return jsonify(response={'message': f'{done} submission(s) approved.', 'approved': done},
                           status=200, bool=True)
        except Exception as e:
            return _err('POST bulk approve', e)
