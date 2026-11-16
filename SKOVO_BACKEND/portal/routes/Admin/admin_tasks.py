from portal.helpers.error_capture import capture_error
import json
import types
import uuid
from flask import jsonify
from flask_restx import Resource, reqparse
from flask_jwt_extended import jwt_required, get_jwt, get_jwt_identity
from portal.models import db
from portal.helpers.sp import call_proc, call_proc_one
from portal.helpers.helpers import (score_from_assessment_steps, parse_local_to_utc,
                                    serialize_datetime)
from portal.helpers import field_limits as FL
from portal.helpers import task_review
from . import ns, logger
from portal.helpers.admin_auth import can, AREA_CONTENT


def _int(v, default=None):
    try:
        return int(v) if v not in (None, '', 'null') else default
    except (ValueError, TypeError):
        return default

list_parser = reqparse.RequestParser()
list_parser.add_argument('page',      type=int, location='args', default=1)
list_parser.add_argument('per_page',  type=int, location='args', default=25)
list_parser.add_argument('cohort_id', type=str, location='args', required=False)

create_parser = reqparse.RequestParser()
create_parser.add_argument('cohort_id',      type=str, location='json', required=True)
create_parser.add_argument('title',          type=str, location='json', required=True)
create_parser.add_argument('description',    type=str, location='json', required=False)
create_parser.add_argument('task_type',      type=str, location='json', required=False)
create_parser.add_argument('submission_type',type=str, location='json', required=False)
create_parser.add_argument('difficulty_level',type=str,location='json', required=False)
create_parser.add_argument('attachment_url', type=str, location='json', required=False)
create_parser.add_argument('task_status',    type=str, location='json', required=False, default='active')
create_parser.add_argument('due_date',       type=str, location='json', required=False)
create_parser.add_argument('score_weight',   type=str, location='json', required=False, default='0')

update_parser = reqparse.RequestParser()
update_parser.add_argument('title',          type=str, location='json', required=False)
update_parser.add_argument('description',    type=str, location='json', required=False)
update_parser.add_argument('task_type',      type=str, location='json', required=False)
update_parser.add_argument('submission_type',type=str, location='json', required=False)
update_parser.add_argument('difficulty_level',type=str,location='json', required=False)
update_parser.add_argument('attachment_url', type=str, location='json', required=False)
update_parser.add_argument('task_status',    type=str, location='json', required=False)
update_parser.add_argument('due_date',       type=str, location='json', required=False)
update_parser.add_argument('score_weight',   type=str, location='json', required=False)

score_parser = reqparse.RequestParser()
score_parser.add_argument('status',       type=str, location='json', required=True)   # approved | rejected | reviewed
score_parser.add_argument('mentor_score', type=str, location='json', required=False)  # 0-10
score_parser.add_argument('mentor_notes', type=str, location='json', required=False)


@ns.route('/tasks')
class AdminTaskList(Resource):
    @ns.doc(description='Admin: list all tasks for the institution with submission counts.')
    @jwt_required()
    def get(self):
        try:
            claims = get_jwt()
            if not can(AREA_CONTENT):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)

            args = list_parser.parse_args()

            # ── SP: sp_cohort_tasks_list — no cohort_id filter on the generic
            # CRUD proc, so pull a bounded batch and filter here. ────────────
            rows = call_proc('sp_cohort_tasks_list', 20000, 0)
            rows = [t for t in rows if not t.get('deleted_at')]
            if args.get('cohort_id'):
                rows = [t for t in rows if t.get('cohort_id') == args['cohort_id']]
            rows.sort(key=lambda t: t.get('created_at') or '', reverse=True)

            total = len(rows)
            per_page = args['per_page']
            page = args['page']
            pages = (total + per_page - 1) // per_page if per_page else 1
            start = (page - 1) * per_page
            page_rows = rows[start:start + per_page]

            all_cohorts = call_proc('sp_cohorts_list', 5000, 0)
            cohort_map = {c['id']: c['title'] for c in all_cohorts}

            # Shared with the achiever portal so a task cannot report a
            # different "needs review" count on the two screens that both act
            # on it.
            sub_total, sub_pending = task_review.counts_by_task(
                {t.get('id') for t in page_rows})

            result = []
            for task in page_rows:
                due_date = task.get('due_date')
                created_at = task.get('created_at')
                result.append({
                    'id':               task.get('id'),
                    'cohort_id':        task.get('cohort_id'),
                    'cohort_title':     cohort_map.get(task.get('cohort_id'), ''),
                    'title':            task.get('title'),
                    'description':      task.get('description'),
                    'task_type':        task.get('task_type'),
                    'submission_type':  task.get('submission_type'),
                    'difficulty_level': task.get('difficulty_level'),
                    'attachment_url':   task.get('attachment_url'),
                    'task_status':      task.get('task_status') or 'active',
                    'due_date':         serialize_datetime(due_date),
                    'score_weight':     task.get('score_weight'),
                    'submission_count': sub_total.get(task.get('id'), 0),
                    'pending_count':    sub_pending.get(task.get('id'), 0),
                    'created_at':       serialize_datetime(created_at),
                })

            return jsonify(
                response={'tasks': result},
                pagination={
                    'total': total,
                    'pages': pages,
                    'page': page,
                },
                status=200,
                bool=True,
            )

        except Exception as e:
            logger.error(f"Error in GET /admin/tasks: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @ns.doc(description='Admin: create a new task for a cohort.')
    @jwt_required()
    def post(self):
        try:
            claims = get_jwt()
            if not can(AREA_CONTENT):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)

            args = create_parser.parse_args(strict=False)

            # ── SP: sp_cohorts_get + sp_cohort_tasks_create ───────────────────
            cohort = call_proc_one('sp_cohorts_get', args['cohort_id'])
            if not cohort:
                return jsonify(response={'message': 'Cohort not found.'}, status=404, bool=False)

            due_date = None
            if args.get('due_date'):
                try:
                    due_date = parse_local_to_utc(args['due_date'])
                except ValueError:
                    return jsonify(response={'message': 'Invalid due_date format. Use ISO 8601.'}, status=400, bool=False)

            admin_id = get_jwt_identity()
            task_id = str(uuid.uuid4())
            call_proc_one(
                'sp_cohort_tasks_create',
                task_id, args['cohort_id'], args['title'], args.get('description'), args.get('task_type'),
                args.get('submission_type'), args.get('difficulty_level'), args.get('attachment_url'),
                args.get('task_status'), due_date, _int(args.get('score_weight'), 0),
                admin_id, admin_id, None,
            )
            db.session.commit()

            return jsonify(response={'message': 'Task created.', 'task_id': task_id}, status=200, bool=True)

        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in POST /admin/tasks: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

@ns.route('/tasks/<string:task_id>')
class AdminTaskDetail(Resource):
    @ns.doc(description='Admin: update a task.')
    @jwt_required()
    def put(self, task_id):
        try:
            claims = get_jwt()
            if not can(AREA_CONTENT):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)

            # ── SP: sp_cohort_tasks_get + _update (full replace) ───────────────
            task = call_proc_one('sp_cohort_tasks_get', task_id)
            if not task or task.get('deleted_at'):
                return jsonify(response={'message': 'Task not found.'}, status=404, bool=False)

            args = update_parser.parse_args(strict=False)

            def val(key):
                return args[key] if args.get(key) is not None else task.get(key)

            due_date = task.get('due_date')
            if args.get('due_date') is not None:
                try:
                    due_date = parse_local_to_utc(args['due_date'])
                except ValueError:
                    return jsonify(response={'message': 'Invalid due_date format.'}, status=400, bool=False)

            score_weight = _int(args['score_weight'], task.get('score_weight')) if args.get('score_weight') is not None else task.get('score_weight')

            admin_id = get_jwt_identity()
            call_proc_one(
                'sp_cohort_tasks_update',
                task_id, task.get('cohort_id'), val('title'), val('description'), val('task_type'),
                val('submission_type'), val('difficulty_level'), val('attachment_url'),
                val('task_status'), due_date, score_weight,
                task.get('created_by'), admin_id, task.get('deleted_at'),
            )
            db.session.commit()
            return jsonify(response={'message': 'Task updated.'}, status=200, bool=True)

        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in PUT /admin/tasks/{task_id}: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @ns.doc(description='Admin: soft-delete a task.')
    @jwt_required()
    def delete(self, task_id):
        try:
            claims = get_jwt()
            if not can(AREA_CONTENT):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)

            # ── SP: sp_cohort_tasks_get + _delete (soft delete) ───────────────
            task = call_proc_one('sp_cohort_tasks_get', task_id)
            if not task or task.get('deleted_at'):
                return jsonify(response={'message': 'Task not found.'}, status=404, bool=False)

            call_proc('sp_cohort_tasks_delete', task_id)
            db.session.commit()
            return jsonify(response={'message': 'Task deleted.'}, status=200, bool=True)

        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in DELETE /admin/tasks/{task_id}: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

@ns.route('/tasks/<string:task_id>/submissions')
class AdminTaskSubmissions(Resource):
    @ns.doc(description='Admin: list all submissions for a task with student info.')
    @jwt_required()
    def get(self, task_id):
        try:
            claims = get_jwt()
            if not can(AREA_CONTENT):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)

            # ── SP: sp_cohort_tasks_get, sp_task_submissions_list, sp_users_list ─
            task = call_proc_one('sp_cohort_tasks_get', task_id)
            if not task:
                return jsonify(response={'message': 'Task not found.'}, status=404, bool=False)

            # helpers.task_review owns the listing, so this panel and the
            # achiever's review drawer show the same rows. It also replaced the
            # 50k-row sp_users_list scan this used to do purely to attach a
            # name, and the `s['user_id'] in users_by_id` filter that silently
            # dropped any submission whose student row the scan had missed —
            # which is how an admin could see "1 pending" on the task row and
            # "no submissions yet" inside it.
            result = task_review.list_for_task(task_id)

            return jsonify(
                response={
                    'submissions': result,
                    # The panel titles itself from the task it opened on, but a
                    # deep link or a refresh has no row to read that off.
                    'task': {
                        'id': task.get('id'),
                        'title': task.get('title'),
                        'score_weight': task.get('score_weight'),
                    },
                },
                status=200, bool=True,
            )

        except Exception as e:
            logger.error(f"Error in GET /admin/tasks/{task_id}/submissions: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

@ns.route('/submissions/<string:submission_id>')
class AdminSubmissionScore(Resource):
    @ns.doc(description='Admin: score/approve/reject a task submission. Triggers readiness update on approval.')
    @jwt_required()
    def patch(self, submission_id):
        try:
            claims = get_jwt()
            if not can(AREA_CONTENT):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)

            args = score_parser.parse_args(strict=False)
            if args['status'] not in task_review.REVIEW_STATES:
                return jsonify(
                    response={'message': f"status must be one of: {', '.join(task_review.REVIEW_STATES)}"},
                    status=400, bool=False
                )

            # ── SP: sp_task_submissions_get ──────────────────────────────────
            sub = call_proc_one('sp_task_submissions_get', submission_id)
            if not sub:
                return jsonify(response={'message': 'Submission not found.'}, status=404, bool=False)

            mentor_score = task_review.clamp_score(args.get('mentor_score'), sub.get('mentor_score'))
            mentor_notes = args['mentor_notes'] if args.get('mentor_notes') is not None else sub.get('mentor_notes')
            verr = FL.check(mentor_notes, 'Feedback', task_review.NOTES_MAX)
            if verr:
                return jsonify(response={'message': verr}, status=400, bool=False)

            task = call_proc_one('sp_cohort_tasks_get', sub.get('task_id'))

            # The write, the readiness award and the student's notification all
            # live in helpers.task_review, so an admin verdict and an achiever
            # verdict do exactly the same thing to the row.
            task_review.apply_review(sub, task, args['status'], mentor_score,
                                     mentor_notes, get_jwt_identity())

            return jsonify(response={'message': f"Submission {args['status']}.",
                                     'status': args['status']},
                           status=200, bool=True)

        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in PATCH /admin/submissions/{submission_id}: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)
