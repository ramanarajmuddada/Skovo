from types import SimpleNamespace

from portal.helpers.error_capture import capture_error
from flask import jsonify
from flask_restx import Resource, reqparse
from flask_jwt_extended import jwt_required, get_jwt_identity
from portal.models import db
from sqlalchemy import text
from portal.helpers.helpers import cohort_tasks_open, effective_cohort_status, serialize_datetime
from portal.helpers.sp import call_proc, call_proc_one
from portal.helpers.links import check_openable
from portal.helpers import field_limits as FL
from . import ns, logger

submit_parser = reqparse.RequestParser()
submit_parser.add_argument('evidence_url',  type=str, location='json', required=False)
submit_parser.add_argument('evidence_text', type=str, location='json', required=False)


# A task row from sp_student_cohort_tasks_list carries the cohort columns
# cohort_tasks_open() needs, so the gate reads them straight off the row rather
# than re-fetching the cohort once per task.
def _cohort_of(row):
    return {
        'status': row.get('cohort_status'),
        'session_date': row.get('session_date'),
        'duration_minutes': row.get('duration_minutes'),
    }


def _class_label(cohort):
    """Where the class stands, for a task the student can already see.

    Derived, never read off `cohort_status`: that column is the scheduler's and
    routinely lags reality, so printing it would let the screen say "upcoming"
    next to a task the same request just decided was open.
    """
    if (cohort.get('status') or '').lower() == 'completed':
        return 'Session complete'
    eff = effective_cohort_status(SimpleNamespace(**cohort))
    return 'Session in progress' if eff == 'live' else 'Session complete'


def _task_dict(row, cohort):
    # LEFT JOIN: no submission_id means this student has not submitted yet, and
    # every other s.* column on the row is NULL rather than absent.
    sub_dict = None
    if row.get('submission_id'):
        sub_dict = {
            'id': row['submission_id'],
            'status': row.get('submission_status'),
            'evidence_url': row.get('evidence_url'),
            'evidence_text': row.get('evidence_text'),
            'mentor_score': row.get('mentor_score'),
            'mentor_notes': row.get('mentor_notes'),
            # serialize_datetime, not .isoformat(): the DB stores naive UTC, and
            # an offset-less string is what `new Date()` reads as *local* time.
            # Every date on this screen was landing 5h30m early for an IST
            # student, deadlines included.
            'submitted_at': serialize_datetime(row.get('submitted_at')),
        }
    return {
        'id': row['id'],
        'cohort_id': row.get('cohort_id'),
        'cohort_title': row.get('cohort_title'),
        'cohort_status': _class_label(cohort),
        # What kind of work this is — assignment, quiz, project, presentation.
        # The student needs to know before opening it: a quiz and a project are
        # not the same evening.
        'task_type': row.get('task_type'),
        'submission_type': row.get('submission_type'),
        'difficulty_level': row.get('difficulty_level'),
        'attachment_url': row.get('attachment_url'),
        'title': row.get('title'),
        'description': row.get('description'),
        'due_date': serialize_datetime(row.get('due_date')),
        'session_date': serialize_datetime(row.get('session_date')),
        'assigned_at': serialize_datetime(row.get('created_at')),
        'score_weight': row.get('score_weight'),
        'submission': sub_dict,
    }


def _add_v1_fields(tasks, user_id):
    """Quiz settings and review details (feature-updates.md §5) for the list.

    sp_student_cohort_tasks_list predates these columns; one extra query for
    the whole page rather than one per task.
    """
    if not tasks:
        return
    import json as _json
    from sqlalchemy import text
    ids = tuple(t['id'] for t in tasks)
    meta = {r['id']: dict(r) for r in db.session.execute(text(
        "SELECT t.id, t.grading_mode, t.time_limit_minutes, t.max_attempts, t.pass_percent, "
        "t.review_after, t.rubric_json, t.offline_allowed, "
        "(SELECT COUNT(*) FROM task_questions q WHERE q.task_id = t.id AND q.deleted_at IS NULL) AS questions "
        "FROM cohort_tasks t WHERE t.id IN :ids").bindparams(ids=ids)).mappings().all()}
    subs = {r['task_id']: dict(r) for r in db.session.execute(text(
        "SELECT task_id, auto_score, auto_total, review_state, rubric_scores_json, appeal_text, is_late "
        "FROM task_submissions WHERE user_id = :u AND task_id IN :ids").bindparams(ids=ids),
        {'u': user_id}).mappings().all()}
    for t in tasks:
        m = meta.get(t['id']) or {}
        is_quiz = (m.get('grading_mode') == 'auto' and int(m.get('questions') or 0) > 0)
        t['is_quiz'] = is_quiz
        t['quiz'] = {'questions': int(m.get('questions') or 0), 'time_limit_minutes': m.get('time_limit_minutes'),
                     'max_attempts': int(m.get('max_attempts') or 1), 'pass_percent': m.get('pass_percent'),
                     'review_after': m.get('review_after'),
                     # Finished attempts, so the screen offers Try again only when one is left.
                     'attempts_used': len([a for a in (call_proc('sp_quiz_attempts_for', t['id'], user_id) or [])
                                           if a.get('status') != 'in_progress']) if is_quiz else 0,
                     'offline_allowed': bool(m.get('offline_allowed')) and not m.get('time_limit_minutes')} if is_quiz else None
        rub = m.get('rubric_json')
        t['rubric'] = (_json.loads(rub) if isinstance(rub, str) else rub) or []
        sx = subs.get(t['id'])
        if t.get('submission') and sx:
            sc = sx.get('rubric_scores_json')
            t['submission'].update({
                'auto_score': float(sx['auto_score']) if sx.get('auto_score') is not None else None,
                'auto_total': float(sx['auto_total']) if sx.get('auto_total') is not None else None,
                'review_state': sx.get('review_state'),
                'rubric_scores': (_json.loads(sc) if isinstance(sc, str) else sc) or {},
                'appeal_text': sx.get('appeal_text'), 'late': bool(sx.get('is_late')),
            })


@ns.route('/')
class TaskList(Resource):
    @ns.doc(description=(
        'Every task set on a cohort this student is enrolled in, once that '
        "cohort's session has started. Soonest deadline first."
    ))
    @jwt_required()
    def get(self):
        try:
            user_id = get_jwt_identity()

            # ── SP: sp_student_cohort_tasks_list — one indexed join over
            # enrolments, cohorts, tasks and this student's submissions. ──────
            rows = call_proc('sp_student_cohort_tasks_list', user_id) or []
            # Class rules: a task is for the students who checked in. Absent
            # students do not get it (classes before the rules are unchanged).
            from portal.helpers import class_rules as CR
            _rules = CR.rules()
            cohorts = {}
            attended = set()
            ids = list({r.get('cohort_id') for r in rows if r.get('cohort_id')})
            if ids:
                from sqlalchemy import bindparam
                for cid, att in db.session.execute(text(
                        "SELECT cohort_id, attended FROM cohort_enrollments"
                        " WHERE user_id = :u AND cohort_id IN :ids").bindparams(bindparam('ids', expanding=True)),
                        {'u': user_id, 'ids': ids}).fetchall():
                    if att:
                        attended.add(cid)
                for c in (call_proc('sp_cohorts_list', 5000, 0) or []):
                    if c['id'] in ids:
                        cohorts[c['id']] = c
            result = [
                _task_dict(r, c) for r, c in ((r, _cohort_of(r)) for r in rows)
                if cohort_tasks_open(cohorts.get(r.get('cohort_id')) or c)
                and (not CR.follows(cohorts.get(r.get('cohort_id')) or {}, _rules) or r.get('cohort_id') in attended)
            ]
            _add_v1_fields(result, user_id)

            return jsonify(response={'tasks': result}, status=200, bool=True)

        except Exception as e:
            logger.error(f"Error in GET /tasks/: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/<string:task_id>/submit')
class TaskSubmit(Resource):
    @ns.doc(description='Submit or update evidence for a task.')
    @jwt_required()
    def post(self, task_id):
        try:
            user_id = get_jwt_identity()
            args = submit_parser.parse_args(strict=False)

            evidence_url = (args.get('evidence_url') or '').strip() or None
            evidence_text = (args.get('evidence_text') or '').strip() or None

            if not evidence_url and not evidence_text:
                return jsonify(
                    response={'message': 'Provide at least a URL or description.'},
                    status=400, bool=False
                )

            # evidence_url was stored with no validation at all, and the achiever
            # opens it from the review screen as an `<a href>` — so `javascript:`
            # here was stored XSS aimed at the one person guaranteed to click it
            # (X04-155), and a pasted bare filename was a dead link the reviewer
            # could not distinguish from a missing file (X04-154). Same rule the
            # achiever's own attachment_url has always had; only this side of the
            # task was missing it.
            verr = check_openable(evidence_url, 'Evidence link')
            if verr:
                return jsonify(response={'message': verr}, status=400, bool=False)
            # TEXT holds 65535 bytes, so a very long paste is a 500 rather than a
            # refusal. X04-149.
            verr = FL.check(evidence_text, 'Description', FL.BIO)
            if verr:
                return jsonify(response={'message': verr}, status=400, bool=False)

            # ── SP: sp_cohort_tasks_get ──────────────────────────────────────────
            task = call_proc_one('sp_cohort_tasks_get', task_id)
            if not task or task.get('deleted_at'):
                return jsonify(response={'message': 'Task not found.'}, status=404, bool=False)

            # ── SP: sp_cohort_enrollments_get_by_user_cohort — this student's
            # own row, rather than a 50k-row scan of everybody's. ─────────────
            enrollment = call_proc_one('sp_cohort_enrollments_get_by_user_cohort',
                                       user_id, task.get('cohort_id'))
            if not enrollment or enrollment.get('payment_status') not in ('paid', 'free'):
                return jsonify(response={'message': 'Not enrolled in this cohort.'}, status=403, bool=False)

            # The same gate the list applies. Without it the endpoint would still
            # accept a submission for a class that has not been taught, which is
            # exactly what a client skipping the UI would do.
            # ── SP: sp_cohorts_get ───────────────────────────────────────────
            cohort = call_proc_one('sp_cohorts_get', task.get('cohort_id'))
            if not cohort_tasks_open(cohort):
                return jsonify(
                    response={'message': 'This task opens when the class ends.'},
                    status=403, bool=False
                )
            from portal.helpers import class_rules as CR
            if CR.follows(cohort) and not enrollment.get('attended'):
                return jsonify(response={'message': 'This task is for students who attended the class.'},
                               status=403, bool=False)
            if (task.get('task_status') or 'active').lower() != 'active':
                return jsonify(response={'message': 'This task is not open for submission.'},
                               status=403, bool=False)

            # ── SP: sp_task_submission_upsert — blocks resubmission once approved,
            # otherwise inserts/updates the submission — atomically. ────────────
            result = call_proc_one('sp_task_submission_upsert', task_id, user_id, evidence_url, evidence_text)
            db.session.commit()

            if not result or not result.get('ok'):
                message = (result or {}).get('message', 'Unable to save submission.')
                return jsonify(response={'message': message}, status=400, bool=False)

            # Career streak: submitting counts (§3), if admin switched it on.
            from portal.helpers import engagement
            engagement.track(user_id, 'task_submitted')
            db.session.commit()

            return jsonify(response={'message': 'Submission saved.'}, status=200, bool=True)

        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in POST /tasks/{task_id}/submit: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)
