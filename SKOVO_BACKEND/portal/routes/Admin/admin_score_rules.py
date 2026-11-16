"""
Admin — Score Engine configuration.

Point values, per-type caps and which actions score at all, plus the decay and
pause-token settings. Everything here is read live by the engine, so retuning
the score never needs a deploy.
"""
import datetime as _dt  # module; `datetime` below is the class
from portal.helpers.error_capture import capture_error
import re
import uuid
from datetime import datetime
from sqlalchemy import text
from flask import jsonify, request
from flask_restx import Resource
from flask_jwt_extended import jwt_required, get_jwt
from portal.models import db
from portal.helpers.sp import call_proc, call_proc_one
from portal.helpers.helpers import serialize_datetime
from . import ns, logger
from portal.helpers.admin_auth import can, AREA_SCORE


def _int(v, default=None):
    try:
        return int(v) if v not in (None, '', 'null') else default
    except (ValueError, TypeError):
        return default


CAP_TYPES = ('none', 'once', 'lifetime', 'daily', 'weekly', 'monthly', 'per_item')

# Rows whose points are set somewhere else, so this screen neither lists nor
# edits them. admin_task: per task, below. referral_bonus: per Refer & Earn
# reward (Admin -> Referrals). Its points field here would do nothing, and
# switching it off would silently wipe every referral point already given,
# because sp_score_recalc only sums events whose rule is active.
MANAGED_ELSEWHERE = ('admin_task', 'referral_bonus')


def _rule_dict(r):
    pts = r.get('points')
    return {
        'event_type': r.get('event_type'),
        'label': r.get('label'),
        'points': float(pts) if pts is not None else None,
        'cap_type': r.get('cap_type'),
        'cap_value': r.get('cap_value'),
        'is_active': bool(r.get('is_active')),
        # A rule with metric_key set is evaluated from recorded facts; one
        # without it is a classic code-fired key. Both live in this list.
        'metric_key': r.get('metric_key'),
        'metric_filter': r.get('metric_filter'),
        'rule_test': r.get('rule_test'),
        'threshold': r.get('threshold'),
        'backfilled': r.get('since_at') is None,
        # Shape and its extras. A screen that only knows 'simple' can ignore
        # every one of these and still be correct.
        'shape': r.get('shape') or 'simple',
        'require_count': r.get('require_count'),
        'tier_points': r.get('tier_points'),
        'streak_days': r.get('streak_days'),
        'expires_days': r.get('expires_days'),
        'until_at': serialize_datetime(r['until_at']) if r.get('until_at') else None,
        'segment_education': r.get('segment_education'),
        'segment_degree': r.get('segment_degree'),
        'segment_state': r.get('segment_state'),
    }


TESTS = ('each', 'reaches', 'every', 'becomes_active', 'tiered', 'streak')

# 'simple' is one metric with one test. The other two read their metrics from
# score_rule_conditions instead, and have no metric_key of their own.
SHAPES = ('simple', 'all_of', 'any_of')


def _metric_event_key(metric, mfilter, test, threshold):
    """A stable key derived from the rule itself.

    The admin never types an event key any more -- that was the failure mode
    where a typo produced a row that looked wired and never paid. Deriving it
    also means the same rule saved twice is the same row, not a duplicate.
    """
    parts = ['m', metric]
    if mfilter:
        parts.append(mfilter)
    parts.append({'becomes_active': 'active', 'reaches': 'r',
                  'every': 'e', 'each': 'each'}.get(test, test))
    if threshold:
        parts.append(str(threshold))
    key = re.sub(r'[^a-z0-9_]+', '_', '_'.join(parts).lower()).strip('_')
    return key[:50]


def _metrics_list():
    rows = call_proc('sp_master_list', 'score_metric', 1) or []
    by_value = {r.get('value'): r for r in rows}
    full = db.session.execute(text(
        "SELECT value, label, description, filter_key, filter_label, "
        "filter_values, tests FROM score_metrics WHERE is_active = 1 "
        "ORDER BY sort_order, label")).mappings().all()
    # Tests every metric can take (master_score_rule_test.any_metric), sent
    # apart from 'tests' so an empty 'tests' still means "no restriction".
    extra = [r.get('value') for r in (call_proc('sp_score_rule_tests_any') or []) if r.get('value')]
    out = []
    for r in full:
        out.append({
            'value': r['value'],
            'label': r['label'],
            'description': r['description'],
            'filter_key': r['filter_key'],
            'filter_label': r['filter_label'],
            'filter_values': [v for v in (r['filter_values'] or '').split(',') if v],
            'tests': [t for t in (r['tests'] or '').split(',') if t],
            'extra_tests': extra,
        })
    return out or [{'value': v.get('value'), 'label': v.get('label')} for v in by_value.values()]


def _require_admin():
    """This module lives in the 'score' area — see portal/helpers/admin_auth."""
    return can(AREA_SCORE)


def _default_label(meta, mfilter, test, threshold):
    """A readable name, so the student's score screen reads like a sentence."""
    base = meta['label']
    if mfilter:
        base = '%s (%s)' % (base, mfilter)
    if test == 'reaches':
        return ('Reach %s - %s' % (threshold, base))[:160]
    if test == 'every':
        return ('Every %s - %s' % (threshold, base))[:160]
    return base[:160]


@ns.route('/score-rules')
class AdminScoreRules(Resource):
    @ns.doc(description='Admin: list score event rules with the decay/pause config.')
    @jwt_required()
    def get(self):
        try:
            if not _require_admin():
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
            # ── SP: sp_score_rules_list (0 = include inactive) ───────────────
            rows = [r for r in (call_proc('sp_score_rules_list', 0) or [])
                    if r.get('event_type') not in MANAGED_ELSEWHERE]
            # ── SP: sp_readiness_rules_list ──────────────────────────────────
            cfg = (call_proc('sp_readiness_rules_list', 1, 0) or [{}])[0]
            return jsonify(response={
                'rules': [_rule_dict(r) for r in rows],
                'metrics': _metrics_list(),
                'config': {
                    'decay_grace_days': cfg.get('decay_grace_days'),
                    'decay_per_day': cfg.get('decay_per_day'),
                    'pause_tokens_per_year': cfg.get('pause_tokens_per_year'),
                    'pause_days': cfg.get('pause_days'),
                    'opportunity_unlock_score': cfg.get('opportunity_unlock_score'),
                },
            }, status=200, bool=True)
        except Exception as e:
            logger.error(f"Error in GET /admin/score-rules: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @ns.doc(description='Admin: update one score event rule (points, cap, active).')
    @jwt_required()
    def put(self):
        try:
            if not _require_admin():
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
            data = request.get_json() or {}
            event_type = (data.get('event_type') or '').strip()
            if not event_type:
                return jsonify(response={'message': 'event_type is required.'}, status=400, bool=False)
            if event_type in MANAGED_ELSEWHERE:
                return jsonify(response={
                    'message': 'Referral points are set per reward in Admin → Referrals.'
                    if event_type == 'referral_bonus' else 'Task points are set per task.',
                }, status=400, bool=False)

            # Points are fractional — the spec has several +0.5 signals.
            try:
                points = float(data['points']) if data.get('points') not in (None, '') else None
            except (ValueError, TypeError):
                return jsonify(response={'message': 'Points must be a number.'}, status=400, bool=False)
            if points is not None and points < 0:
                return jsonify(response={'message': 'Points cannot be negative.'}, status=400, bool=False)

            cap_type = (data.get('cap_type') or '').strip() or None
            if cap_type and cap_type not in CAP_TYPES:
                return jsonify(response={
                    'message': f"cap_type must be one of: {', '.join(CAP_TYPES)}."
                }, status=400, bool=False)

            cap_value = _int(data.get('cap_value'))
            if cap_type in ('once', 'lifetime', 'daily', 'weekly', 'monthly', 'per_item') \
                    and cap_value is not None and cap_value < 1:
                return jsonify(response={'message': 'Cap value must be at least 1.'},
                               status=400, bool=False)

            # ── SP: sp_score_rule_update ─────────────────────────────────────
            call_proc('sp_score_rules_bump')
            row = call_proc_one('sp_score_rule_update', event_type,
                                (data.get('label') or None), points,
                                cap_type, cap_value,
                                (1 if data.get('is_active', True) else 0))
            db.session.commit()
            if not row:
                return jsonify(response={'message': 'Unknown event type.'}, status=404, bool=False)
            return jsonify(response={'message': 'Rule updated.', 'rule': _rule_dict(row)},
                           status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in PUT /admin/score-rules: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


def _delta_to_reach(user_id, target):
    """Points to add so the shown score becomes `target`.

    The shown score is FLOOR(base - decay) clamped to 0..100, so `target -
    score` is wrong whenever the clamp is hiding something: 130 base points
    show as 100, and "set to 80" as -20 left base at 110, still showing 100.
    Work from the unclamped value instead. Rebuild first so a stale stored
    score cannot skew it. ceil() lands inside [target, target + 1), which
    FLOOR shows as exactly target, when base has half points."""
    import math
    row = call_proc_one('sp_score_recalc', user_id) or {}
    if int(row.get('score') or 0) == target:
        return 0
    raw = float(row.get('base_points') or 0) - float(row.get('decay_points') or 0)
    return int(math.ceil(target - raw))


@ns.route('/score-rules/rule')
class AdminScoreRuleCreate(Resource):
    """Create or replace one scoring action.

    A rule is only half of a scoring action: the other half is a call to
    award() somewhere in the product. Adding a row here with an event_type
    nothing fires gives a rule that can never pay, so the screen says so rather
    than letting it look wired.
    """

    @jwt_required()
    def post(self):
        try:
            if not _require_admin():
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
            data = request.get_json() or {}
            event_type = (data.get('event_type') or '').strip().lower()
            label = (data.get('label') or '').strip()
            if not re.fullmatch(r'[a-z][a-z0-9_]{2,49}', event_type or ''):
                return jsonify(response={
                    'message': 'Event key: lowercase letters, numbers and underscores, 3-50 characters.',
                }, status=400, bool=False)
            if not label or len(label) > 160:
                return jsonify(response={'message': 'Name it, up to 160 characters.'}, status=400, bool=False)
            points = data.get('points')
            try:
                points = float(points)
            except (TypeError, ValueError):
                return jsonify(response={'message': 'Points must be a number.'}, status=400, bool=False)
            if not (0 <= points <= 100):
                return jsonify(response={'message': 'Points must be from 0 to 100.'}, status=400, bool=False)
            cap_type = (data.get('cap_type') or 'none').strip()
            cap_value = _int(data.get('cap_value'))
            is_active = 1 if data.get('is_active', True) else 0

            row = call_proc_one('sp_score_event_rule_upsert', event_type, label,
                                points, cap_type, cap_value, is_active) or {}
            db.session.commit()
            return jsonify(response={'message': 'Scoring action saved.', 'rule': row}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"POST /admin/score-rules/rule: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/score-rules/rule/<string:event_type>')
class AdminScoreRuleDelete(Resource):
    @jwt_required()
    def delete(self, event_type):
        try:
            if not _require_admin():
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
            call_proc_one('sp_score_event_rule_delete', event_type)
            db.session.commit()
            return jsonify(response={'message': 'Scoring action removed.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            if 'RULE_IN_USE' in str(e):
                # Removing it would stop its past events counting and drop every
                # affected student's score with nothing to explain it.
                return jsonify(response={
                    'message': 'This action has already awarded points. Switch it off instead — '
                               'deleting it would lower the scores of everyone who earned from it.',
                }, status=409, bool=False)
            logger.error(f"DELETE /admin/score-rules/rule/{event_type}: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/score-rules/adjust')
class AdminScoreAdjust(Resource):
    @ns.doc(description='Admin: manually adjust a student score. Reason is mandatory and audited.')
    @jwt_required()
    def post(self):
        try:
            if not _require_admin():
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
            data = request.get_json() or {}
            user_id = (data.get('user_id') or '').strip()
            reason = (data.get('reason') or '').strip()
            delta = _int(data.get('delta'))
            target = _int(data.get('target'))
            if target is not None:
                if not (0 <= target <= 100):
                    return jsonify(response={'message': 'The score must be from 0 to 100.'}, status=400, bool=False)
                if not user_id:
                    return jsonify(response={'message': 'Choose a student and how the score should change.'},
                                   status=400, bool=False)
                delta = _delta_to_reach(user_id, target)
                if delta == 0:
                    db.session.rollback()
                    return jsonify(response={'message': 'That student is already at this score.',
                                             'score': target},
                                   status=200, bool=True)

            if not user_id or delta is None:
                return jsonify(response={'message': 'Choose a student and how the score should change.'},
                               status=400, bool=False)
            # The spec requires an audit trail; a blank reason defeats it.
            if not reason:
                return jsonify(response={'message': 'A reason is required for every score adjustment.'},
                               status=400, bool=False)

            admin_id = get_jwt().get('sub') or get_jwt().get('identity')
            import uuid
            # ── SP: sp_score_adjust (writes score_adjustments + a ledger event) ─
            call_proc_one('sp_score_adjust', str(uuid.uuid4()), user_id, admin_id, delta, reason)
            row = call_proc_one('sp_score_recalc', user_id) or {}
            db.session.commit()
            return jsonify(response={
                'message': f'Score adjusted by {delta:+d}.',
                'score': row.get('score'), 'level': row.get('level'),
            }, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in POST /admin/score-rules/adjust: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @ns.doc(description='Admin: the manual-adjustment audit log.')
    @jwt_required()
    def get(self):
        try:
            if not _require_admin():
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
            user_id = request.args.get('user_id') or None
            paging = {}
            if request.args.get('page'):
                # Paged, inside an IST date range (?from=&to=, YYYY-MM-DD).
                def _d(raw):
                    try:
                        return _dt.date.fromisoformat((raw or '').strip())
                    except (TypeError, ValueError):
                        return None
                d_from, d_to = _d(request.args.get('from')), _d(request.args.get('to'))
                if d_from and d_to and d_from > d_to:
                    d_from, d_to = d_to, d_from
                page = max(1, _int(request.args.get('page'), 1))
                per = min(100, max(1, _int(request.args.get('per_page'), 20)))
                # ── SP: sp_score_adjustments_page ───────────────────────────
                rows = call_proc('sp_score_adjustments_page', user_id, d_from, d_to,
                                 per, (page - 1) * per) or []
                total = int(rows[0]['total_rows']) if rows else 0
                paging = {'total': total, 'page': page, 'per_page': per,
                          'pages': max(1, (total + per - 1) // per)}
            else:
                limit = min(200, max(1, int(request.args.get('limit', 50) or 50)))
                # ── SP: sp_score_adjustments_list ────────────────────────────
                rows = call_proc('sp_score_adjustments_list', user_id, limit) or []
            return jsonify(response={**paging, 'adjustments': [{
                'id': a.get('id'), 'user_id': a.get('user_id'), 'admin_id': a.get('admin_id'),
                'delta': a.get('delta'), 'reason': a.get('reason'),
                # Names, so the screen can say who rather than printing a uuid.
                # A deleted student leaves these null, which the client shows as
                # "Deleted student" -- the adjustment itself still happened.
                'student_name': a.get('student_name'),
                'student_email': a.get('student_email'),
                'admin_name': a.get('admin_name'),
                'created_at': serialize_datetime(a.get('created_at')),
            } for a in rows]}, status=200, bool=True)
        except Exception as e:
            logger.error(f"Error in GET /admin/score-rules/adjust: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/score-rules/run-decay')
class AdminScoreDecay(Resource):
    @ns.doc(description='Admin: run the daily decay sweep now (also runs on the scheduler).')
    @jwt_required()
    def post(self):
        try:
            if not _require_admin():
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
            # ── SP: sp_score_decay_run ───────────────────────────────────────
            res = call_proc_one('sp_score_decay_run') or {}
            db.session.commit()
            return jsonify(response={'message': 'Decay sweep complete.', 'decayed': res.get('decayed', 0)},
                           status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in POST /admin/score-rules/run-decay: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


def _task_out(row):
    created = row.get('created_at')
    return {
        'id': row.get('id'),
        'label': row.get('label'),
        'points': float(row.get('points') or 0),
        'scope': row.get('scope') or 'all',
        'batch_id': row.get('batch_id'),
        'state': row.get('state'),
        'target_degrees': [x for x in (row.get('target_degrees') or '').split(',') if x],
        'target_branches': [x for x in (row.get('target_branches') or '').split(',') if x],
        'target_streams': [x for x in (row.get('target_streams') or '').split(',') if x],
        'action_route': row.get('action_route'),
        'claimed_count': int(row.get('claimed_count') or 0),
        'user_id': row.get('user_id'),
        'education_category': row.get('education_category'),
        'degree_type': row.get('degree_type'),
        'same_as_id': row.get('same_as_id'),
        'status': row.get('status') or ('active' if row.get('is_active') else 'expired'),
        'student_name': row.get('student_name'),
        'student_email': row.get('student_email'),
        'is_active': (row.get('status') or 'active') == 'active',
        'paid_count': int(row.get('paid_count') or 0),
        'created_at': serialize_datetime(created) if created else None,
    }


# One task can add this much at most. The Readiness score tops out at 100 and
# sets the student's level, so a single task should not be able to max it.
MAX_TASK_POINTS = 20


@ns.route('/score-rules/tasks')
class AdminScoreTasks(Resource):
    @jwt_required()
    def get(self):
        try:
            if not _require_admin():
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
            rows = call_proc('sp_score_task_list') or []
            return jsonify(response={'tasks': [_task_out(r) for r in rows]}, status=200, bool=True)
        except Exception as e:
            logger.error(f"Error in GET /admin/score-rules/tasks: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @jwt_required()
    def post(self):
        """Create or edit a task. Editing keeps who it belongs to and does not
        rewrite points already written on a student's ledger."""
        try:
            if not _require_admin():
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
            data = request.get_json() or {}
            label = (data.get('label') or '').strip()
            if not label or len(label) > 160:
                return jsonify(response={'message': 'Name the task, up to 160 characters.'}, status=400, bool=False)
            points = _int(data.get('points'))
            if points is None or not (1 <= points <= MAX_TASK_POINTS):
                return jsonify(response={'message': f'Points must be from 1 to {MAX_TASK_POINTS}.'},
                               status=400, bool=False)
            scope = (data.get('scope') or 'all').strip()
            if scope not in ('all', 'batch', 'student'):
                return jsonify(response={'message': 'Choose everyone, a batch, or one student.'}, status=400, bool=False)
            user_id = (data.get('user_id') or '').strip() or None
            klass = (data.get('education_category') or '').strip() or None
            degree = (data.get('degree_type') or '').strip() or None
            same_as = (data.get('same_as_id') or '').strip() or None
            status = (data.get('status') or 'active').strip()
            if status not in ('active', 'expired', 'draft'):
                return jsonify(response={'message': 'A task is active or expired.'}, status=400, bool=False)
            task_id = (data.get('id') or '').strip() or None
            if task_id:
                # An edit keeps the stored scope and student; the procedure
                # ignores both. Validate against what is stored, not the body.
                stored = next((t for t in (call_proc('sp_score_task_list') or [])
                               if t.get('id') == task_id), None)
                if not stored:
                    return jsonify(response={'message': 'That task no longer exists.'}, status=404, bool=False)
                scope = stored.get('scope') or 'all'
                user_id = stored.get('user_id')
            if scope == 'student' and not user_id:
                return jsonify(response={'message': 'Pick the student this task is for.'}, status=400, bool=False)
            # On an edit too: a batch with neither set would show to every
            # student and could never be marked done for any of them.
            if scope == 'batch' and not klass and not degree:
                return jsonify(response={'message': 'Pick a stage or a degree for this batch.'}, status=400, bool=False)
            if same_as and same_as == task_id:
                return jsonify(response={'message': 'A task cannot be a repeat of itself.'}, status=400, bool=False)
            import uuid
            task_id = task_id or str(uuid.uuid4())
            admin_id = get_jwt().get('sub') or get_jwt().get('identity')
            row = call_proc_one(
                'sp_score_task_upsert', task_id, label, points, scope, user_id,
                klass, degree, same_as, status, admin_id,
            ) or {}
            db.session.commit()
            return jsonify(response={'message': 'Task saved.', 'task': _task_out(row)}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in POST /admin/score-rules/tasks: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/score-rules/tasks/complete')
class AdminScoreTaskComplete(Resource):
    @jwt_required()
    def post(self):
        try:
            if not _require_admin():
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
            data = request.get_json() or {}
            task_id = (data.get('task_id') or '').strip()
            user_id = (data.get('user_id') or '').strip()
            if not task_id or not user_id:
                return jsonify(response={'message': 'Choose the task and the student.'}, status=400, bool=False)
            import uuid
            res = call_proc_one('sp_score_task_complete', str(uuid.uuid4()), task_id, user_id) or {}
            result = res.get('result')
            if result == 'done':
                score = call_proc_one('sp_score_recalc', user_id) or {}
                db.session.commit()
                return jsonify(response={
                    'message': f"Marked done. {int(res.get('points') or 0)} points added.",
                    'score': score.get('score'),
                }, status=200, bool=True)
            db.session.rollback()
            if result == 'repeat':
                db.session.rollback()
                return jsonify(response={
                    'message': 'Already completed on the earlier task. No extra points.',
                    'completed': True,
                }, status=200, bool=True)
            messages = {
                'already': 'This student already received the points for this task.',
                'expired': 'This task is expired, so it pays nothing.',
                'off': 'This task is expired, so it pays nothing.',
                'wrong': 'This task belongs to a different student.',
                'nomatch': 'This student is not in that batch.',
                'unknown': 'That task or student was not found.',
            }
            return jsonify(response={'message': messages.get(result, 'Could not mark this task done.')},
                           status=400, bool=False)
        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in POST /admin/score-rules/tasks/complete: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/score-rules/tasks/<string:task_id>')
class AdminScoreTaskDelete(Resource):
    """Hard-delete a task. Refused once it has paid anyone — expire it instead."""

    @jwt_required()
    def delete(self, task_id):
        try:
            if not _require_admin():
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
            # ── SP: sp_score_task_delete ────────────────────────────────────
            row = call_proc_one('sp_score_task_delete', task_id) or {}
            db.session.commit()
            result = row.get('result')
            if result == 'deleted':
                return jsonify(response={'message': 'Task deleted.'}, status=200, bool=True)
            if result == 'paid':
                return jsonify(response={
                    'message': 'This task has already paid points. Switch it off instead — '
                               'deleting it would lower the scores of everyone who earned from it.',
                }, status=409, bool=False)
            return jsonify(response={'message': 'Task not found.'}, status=404, bool=False)
        except Exception as e:
            db.session.rollback()
            logger.error(f"DELETE /admin/score-rules/tasks/{task_id}: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id},
                           status=500, bool=False)


@ns.route('/score-rules/tasks/<string:task_id>/roster')
class AdminScoreTaskRoster(Resource):
    """Who this task reaches, and who has already been credited."""

    @jwt_required()
    def get(self, task_id):
        try:
            if not _require_admin():
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
            q = (request.args.get('q') or '').strip()
            state = (request.args.get('state') or 'pending').strip().lower()
            if state not in ('all', 'pending', 'done', 'submitted'):
                state = 'pending'
            try:
                limit = int(request.args.get('limit') or 100)
                offset = int(request.args.get('offset') or 0)
            except (TypeError, ValueError):
                limit, offset = 100, 0
            limit = max(1, min(limit, 500))

            # ── SP: sp_score_task_roster — two result sets, rows then total ──
            rows = call_proc('sp_score_task_roster', task_id, q, state, limit, max(0, offset))
            if rows is None:
                return jsonify(response={'message': 'That task no longer exists.'}, status=404, bool=False)
            return jsonify(response={
                'students': [{
                    'id': r.get('id'), 'full_name': r.get('full_name'), 'email': r.get('email'),
                    'education_category': r.get('education_category'),
                    'degree_type': r.get('degree_type'),
                    'done': bool(r.get('done')),
                    'done_at': serialize_datetime(r['done_at']) if r.get('done_at') else None,
                    # The student's own claim. Without this the roster cannot
                    # show a queue -- every unpaid student looks identical.
                    'submitted': bool(r.get('submitted')),
                    'submitted_at': serialize_datetime(r['submitted_at']) if r.get('submitted_at') else None,
                } for r in rows],
            }, status=200, bool=True)
        except Exception as e:
            if 'TASK_NOT_FOUND' in str(e):
                return jsonify(response={'message': 'That task no longer exists.'}, status=404, bool=False)
            logger.error(f"GET /admin/score-rules/tasks/{task_id}/roster: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/score-rules/tasks/complete-bulk')
class AdminScoreTaskCompleteBulk(Resource):
    """Credit a task to several students at once.

    Crediting one at a time meant a hundred student panels for a hundred
    students. sp_score_task_complete is idempotent per (task, student), so a
    student already credited is reported as a repeat rather than paid twice --
    which also makes re-running a partly-finished batch safe.
    """

    @jwt_required()
    def post(self):
        try:
            if not _require_admin():
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
            data = request.get_json() or {}
            task_id = (data.get('task_id') or '').strip()
            user_ids = data.get('user_ids') or []
            if not task_id or not isinstance(user_ids, list) or not user_ids:
                return jsonify(response={'message': 'Choose the task and at least one student.'},
                               status=400, bool=False)
            if len(user_ids) > 500:
                return jsonify(response={'message': 'Up to 500 students at a time.'},
                               status=400, bool=False)

            import uuid
            paid, repeat, failed = 0, 0, 0
            for uid in user_ids:
                uid = (uid or '').strip()
                if not uid:
                    continue
                try:
                    res = call_proc_one('sp_score_task_complete', str(uuid.uuid4()), task_id, uid) or {}
                    result = res.get('result')
                    if result == 'done':
                        call_proc_one('sp_score_recalc', uid)
                        paid += 1
                    elif result == 'repeat':
                        repeat += 1
                    else:
                        failed += 1
                except Exception:
                    # One bad student must not lose the whole batch.
                    failed += 1
            db.session.commit()

            bits = [f'{paid} credited']
            if repeat:
                bits.append(f'{repeat} already had it')
            if failed:
                bits.append(f'{failed} could not be credited')
            return jsonify(response={'message': ', '.join(bits) + '.',
                                     'paid': paid, 'repeat': repeat, 'failed': failed},
                           status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"POST /admin/score-rules/tasks/complete-bulk: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/score-rules/students')
class AdminScoreStudents(Resource):
    @jwt_required()
    def get(self):
        try:
            if not _require_admin():
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
            q = (request.args.get('q') or '').strip()
            if len(q) < 2:
                return jsonify(response={'students': []}, status=200, bool=True)
            rows = call_proc('sp_score_student_find', q) or []
            return jsonify(response={'students': [{
                'id': r.get('id'), 'full_name': r.get('full_name'), 'email': r.get('email'),
            } for r in rows]}, status=200, bool=True)
        except Exception as e:
            logger.error(f"Error in GET /admin/score-rules/students: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/score-rules/metric-rule')
class AdminScoreMetricRule(Resource):
    """Create or update a rule expressed over a recorded fact.

    The admin picks a metric, a test and a number. No event key is typed, and
    no SQL is accepted -- the metric name resolves to a whitelisted counter
    inside sp_score_metric_snapshot.
    """

    @jwt_required()
    def post(self):
        try:
            if not _require_admin():
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
            d = request.get_json() or {}

            metric = (d.get('metric_key') or '').strip()
            known = {m['value']: m for m in _metrics_list()}
            if metric not in known:
                return jsonify(response={'message': 'Pick a metric from the list.'},
                               status=400, bool=False)
            meta = known[metric]

            test = (d.get('rule_test') or '').strip()
            if test not in TESTS or (meta['tests'] and test not in meta['tests']):
                return jsonify(response={
                    'message': '"%s" does not support that test.' % meta['label'],
                }, status=400, bool=False)

            mfilter = (d.get('metric_filter') or '').strip() or None
            if mfilter and mfilter not in meta['filter_values']:
                return jsonify(response={'message': 'That filter is not offered for this metric.'},
                               status=400, bool=False)

            threshold = _int(d.get('threshold'))
            if test in ('reaches', 'every'):
                if threshold is None or threshold < 1:
                    return jsonify(response={'message': 'Give a number for the target.'},
                                   status=400, bool=False)
            else:
                threshold = None

            try:
                # Two decimals, matching the column. Rounding here rather than
                # letting MySQL truncate means 0.259 is stored as 0.26 and the
                # admin is shown what was actually saved.
                points = round(float(d.get('points')), 2)
            except (TypeError, ValueError):
                return jsonify(response={'message': 'Points must be a number.'},
                               status=400, bool=False)
            if not (0 <= points <= 100):
                return jsonify(response={'message': 'Points must be from 0 to 100.'},
                               status=400, bool=False)

            cap_type = (d.get('cap_type') or 'none').strip()
            if cap_type not in CAP_TYPES:
                return jsonify(response={'message': 'Unknown cap.'}, status=400, bool=False)
            cap_value = _int(d.get('cap_value'))

            label = (d.get('label') or '').strip() or _default_label(meta, mfilter, test, threshold)
            if len(label) > 160:
                return jsonify(response={'message': 'Name it, up to 160 characters.'},
                               status=400, bool=False)

            key = _metric_event_key(metric, mfilter, test, threshold)

            # Backfill is opt-in. Left off, since_at is stamped now, so the rule
            # only sees activity from this moment -- a careless save cannot move
            # every existing student at once.
            since = None if d.get('backfill') else datetime.utcnow()

            row = call_proc_one('sp_score_metric_rule_upsert', key, label, points, metric,
                                mfilter, test, threshold, cap_type, cap_value, since,
                                1 if d.get('is_active', True) else 0) or {}
            db.session.commit()

            # Pay immediately for whatever already qualifies, so the admin sees
            # the effect they were just shown in the preview.
            # Every cached score built before this rule change is stale.
            call_proc('sp_score_rules_bump')
            call_proc('sp_score_rules_run', None)
            db.session.commit()

            return jsonify(response={'message': 'Rule saved.', 'rule': _rule_dict(row)},
                           status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error("POST /admin/score-rules/metric-rule: %s" % e)
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id},
                           status=500, bool=False)


@ns.route('/score-rules/metric-rule/preview')
class AdminScoreMetricPreview(Resource):
    """What saving this rule would do. Writes nothing."""

    @jwt_required()
    def post(self):
        try:
            if not _require_admin():
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
            d = request.get_json() or {}
            metric = (d.get('metric_key') or '').strip()
            known = {m['value']: m for m in _metrics_list()}
            if metric not in known:
                return jsonify(response={'message': 'Pick a metric from the list.'},
                               status=400, bool=False)
            test = (d.get('rule_test') or '').strip()
            if test not in TESTS:
                return jsonify(response={'message': 'Pick when it should pay.'},
                               status=400, bool=False)
            threshold = _int(d.get('threshold'))
            try:
                points = round(float(d.get('points') or 0), 2)
            except (TypeError, ValueError):
                points = 0.0
            since = None if d.get('backfill') else datetime.utcnow()

            row = call_proc_one('sp_score_rule_preview', metric,
                                (d.get('metric_filter') or '').strip() or None,
                                test, threshold, points, since,
                                _int(d.get('cap_value'))) or {}
            return jsonify(response={
                'students': _int(row.get('students'), 0),
                'awards': _int(row.get('awards'), 0),
                'points': float(row.get('points') or 0),
            }, status=200, bool=True)
        except Exception as e:
            logger.error("POST /admin/score-rules/metric-rule/preview: %s" % e)
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id},
                           status=500, bool=False)


@ns.route('/score-rules/run-rules')
class AdminScoreRunRules(Resource):
    """Evaluate every metric rule now. Safe to repeat -- awards are idempotent."""

    @jwt_required()
    def post(self):
        try:
            if not _require_admin():
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
            row = call_proc_one('sp_score_rules_run', None) or {}
            db.session.commit()
            return jsonify(response={
                'message': 'Ran %d rules.' % _int(row.get('rules_run'), 0),
                'rules_run': _int(row.get('rules_run'), 0),
                'students_touched': _int(row.get('students_touched'), 0),
            }, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error("POST /admin/score-rules/run-rules: %s" % e)
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id},
                           status=500, bool=False)


def _task_routes():
    """Where a task may send a student -- a whitelist, so a task cannot point
    at a route that does not exist."""
    return {r.get('value') for r in (call_proc('sp_master_list', 'task_route', 1) or [])
            if r.get('value')}


def _batch_out(r):
    return {
        'id': r.get('id'),
        'name': r.get('name'),
        'education_category': r.get('education_category'),
        'degree_type': r.get('degree_type'),
        'include_global': bool(r.get('include_global')),
        'specificity': _int(r.get('specificity'), 0),
        'task_count': _int(r.get('task_count'), 0),
        'student_count': _int(r.get('student_count'), 0),
    }


def _batch_name(name, klass, degree, stages):
    """A batch always has a readable name, generated if the admin gave none."""
    if (name or '').strip():
        return name.strip()[:120]
    label = stages.get(klass) or klass
    bits = [label or 'Any stage', degree or 'Any degree']
    return ' \u00b7 '.join(bits)[:120]


@ns.route('/score-rules/batches')
class AdminScoreBatches(Resource):
    """Batches: an audience defined once, with many tasks hanging off it.

    Replaces the old three-card Tasks tab. "Everyone" is now a batch with
    neither filter set; one-student tasks are gone, and the rows that predate
    this still work -- see sp_score_tasks_for_student.
    """

    @jwt_required()
    def get(self):
        try:
            if not _require_admin():
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
            batches = call_proc('sp_score_batch_list') or []
            tasks = call_proc('sp_score_task_list') or []

            by_batch = {}
            legacy = []
            for t in tasks:
                bid = t.get('batch_id')
                if bid:
                    by_batch.setdefault(bid, []).append(_task_out(t))
                else:
                    legacy.append(_task_out(t))

            out = []
            for b in batches:
                d = _batch_out(b)
                d['tasks'] = by_batch.get(b.get('id'), [])
                out.append(d)

            return jsonify(response={
                'batches': out,
                # Tasks from before batches existed. Shown read-only so nothing a
                # student already has in front of them silently disappears.
                'legacy_tasks': legacy,
            }, status=200, bool=True)
        except Exception as e:
            logger.error("GET /admin/score-rules/batches: %s" % e)
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id},
                           status=500, bool=False)

    @jwt_required()
    def post(self):
        try:
            if not _require_admin():
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
            d = request.get_json() or {}
            klass = (d.get('education_category') or '').strip() or None
            degree = (d.get('degree_type') or '').strip() or None

            stages = {o['value']: o['label'] for o in (call_proc('sp_master_list', 'onboarding_category', 1) or [])
                      if o.get('value')}
            stages = {k: str(v).split('|')[0] for k, v in stages.items()}
            name = _batch_name(d.get('name'), klass, degree, stages)

            row = call_proc_one(
                'sp_score_batch_upsert',
                (d.get('id') or '').strip() or None, name, klass, degree,
                1 if d.get('include_global', True) else 0,
                get_jwt().get('sub'),
            ) or {}
            db.session.commit()
            return jsonify(response={'message': 'Batch saved.', 'batch': _batch_out(row)},
                           status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error("POST /admin/score-rules/batches: %s" % e)
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id},
                           status=500, bool=False)


@ns.route('/score-rules/batches/<string:batch_id>')
class AdminScoreBatchDelete(Resource):
    @jwt_required()
    def delete(self, batch_id):
        try:
            if not _require_admin():
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
            row = call_proc_one('sp_score_batch_delete', batch_id) or {}
            db.session.commit()
            kept = _int(row.get('tasks'), 0)
            msg = ('Batch removed.' if row.get('result') == 'deleted'
                   else 'Batch switched off. Its %d task(s) and everything they paid are kept.' % kept)
            return jsonify(response={'message': msg, 'result': row.get('result')},
                           status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error("DELETE /admin/score-rules/batches: %s" % e)
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id},
                           status=500, bool=False)


@ns.route('/score-rules/batches/<string:batch_id>/tasks')
class AdminScoreBatchTasks(Resource):
    """Add or edit a task inside a batch. The batch supplies the audience."""

    @jwt_required()
    def post(self, batch_id):
        try:
            if not _require_admin():
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
            d = request.get_json() or {}
            label = (d.get('label') or '').strip()
            if not label or len(label) > 160:
                return jsonify(response={'message': 'Name the task, up to 160 characters.'},
                               status=400, bool=False)
            # Decimal, like every other points column: the readiness sheets pay
            # 0.2 / 0.5 for small daily tasks.
            try:
                points = round(float(d.get('points')), 2)
            except (TypeError, ValueError):
                points = None
            if points is None or not (0.1 <= points <= MAX_TASK_POINTS):
                return jsonify(response={'message': 'Points must be from 0.1 to %d.' % MAX_TASK_POINTS},
                               status=400, bool=False)
            status = (d.get('status') or 'active').strip()
            if status not in ('active', 'expired', 'draft'):
                return jsonify(response={'message': 'A task is active or expired.'},
                               status=400, bool=False)

            import uuid
            task_id = (d.get('id') or '').strip() or str(uuid.uuid4())
            same_as = (d.get('same_as_id') or '').strip() or None
            if same_as and same_as == task_id:
                return jsonify(response={'message': 'A task cannot be a repeat of itself.'},
                               status=400, bool=False)

            route = (d.get('action_route') or '').strip() or None
            if route and route not in _task_routes():
                return jsonify(response={'message': 'Pick a place from the list.'},
                               status=400, bool=False)

            row = call_proc_one('sp_score_batch_task_upsert', task_id, batch_id,
                                label, points, same_as, status, route,
                                get_jwt().get('sub')) or {}
            # Course targeting is optional on the request: only a body that
            # carries it changes it, so older callers leave a task's targets alone.
            if any(k in d for k in ('state', 'target_degrees', 'target_branches', 'target_streams')):
                def _csv(v):
                    if isinstance(v, (list, tuple)):
                        v = ','.join(str(x).strip() for x in v if str(x).strip())
                    return (v or '').strip()
                call_proc_one('sp_score_task_set_targets', row.get('id') or task_id,
                              _csv(d.get('state')), _csv(d.get('target_degrees')),
                              _csv(d.get('target_branches')), _csv(d.get('target_streams')))
                row = next((t for t in (call_proc('sp_score_task_list') or [])
                            if t.get('id') == (row.get('id') or task_id)), row)
            db.session.commit()
            return jsonify(response={'message': 'Task saved.', 'task': _task_out(row)},
                           status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            msg = str(e)
            if 'BATCH_NOT_FOUND' in msg:
                return jsonify(response={'message': 'That batch no longer exists.'},
                               status=404, bool=False)
            logger.error("POST /admin/score-rules/batches/tasks: %s" % e)
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id},
                           status=500, bool=False)


@ns.route('/score-rules/task-targets')
class AdminScoreTaskTargets(Resource):
    """What a task can be aimed at: states, Inter streams, course-catalogue
    degrees and their branches -- the same masters onboarding fills the profile
    from, so a target is always something a student can actually have."""

    @jwt_required()
    def get(self):
        try:
            if not _require_admin():
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
            out = {'states': [], 'streams': [], 'degrees': [], 'branches': []}
            key = {'state': 'states', 'stream': 'streams', 'degree': 'degrees', 'branch': 'branches'}
            for r in call_proc('sp_score_task_target_options') or []:
                item = {'value': r.get('value'), 'label': r.get('label')}
                if r.get('kind') in ('degree', 'branch'):
                    item['parent'] = r.get('parent')
                out[key[r.get('kind')]].append(item)
            return jsonify(response=out, status=200, bool=True)
        except Exception as e:
            logger.error("GET /admin/score-rules/task-targets: %s" % e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)},
                           status=500, bool=False)


@ns.route('/score-rules/students/search')
class AdminScoreStudentSearch(Resource):
    """Find a student by name or email, optionally narrowed to one stage."""

    @jwt_required()
    def get(self):
        try:
            if not _require_admin():
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
            q = (request.args.get('q') or '').strip()
            category = (request.args.get('education_category') or '').strip() or None
            paging = {}
            if request.args.get('page'):
                # Paged: the picker, a page at a time, so every student is
                # reachable without knowing their name first.
                page = max(1, _int(request.args.get('page'), 1))
                per = min(100, max(1, _int(request.args.get('per_page'), 20)))
                # ── SP: sp_score_students_page ──────────────────────────────
                rows = call_proc('sp_score_students_page', q, category, per, (page - 1) * per) or []
                total = int(rows[0]['total_rows']) if rows else 0
                paging = {'total': total, 'page': page, 'per_page': per,
                          'pages': max(1, (total + per - 1) // per)}
            else:
                rows = call_proc('sp_score_students_search', q, category,
                                 _int(request.args.get('limit'), 25)) or []
            return jsonify(response={**paging, 'students': [{
                'id': r.get('id'),
                'full_name': r.get('full_name'),
                'email': r.get('email'),
                'education_category': r.get('education_category'),
                'degree_type': r.get('degree_type'),
                'score': _int(r.get('score'), 0),
                'level': r.get('level'),
            } for r in rows]}, status=200, bool=True)
        except Exception as e:
            logger.error("GET /admin/score-rules/students/search: %s" % e)
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id},
                           status=500, bool=False)


@ns.route('/score-rules/students/<string:user_id>/tasks')
class AdminScoreStudentTasks(Resource):
    """Everything one student can earn, and a task aimed only at them."""

    @jwt_required()
    def get(self, user_id):
        try:
            if not _require_admin():
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
            rows = call_proc('sp_score_student_tasks_admin', user_id) or []
            gate = call_proc_one('sp_score_student_global_ok', user_id) or {}
            return jsonify(response={
                'tasks': [{
                    'id': r.get('id'),
                    'label': r.get('label'),
                    'points': _int(r.get('points'), 0),
                    'scope': r.get('scope'),
                    'status': r.get('status'),
                    'action_route': r.get('action_route'),
                    'batch_name': r.get('batch_name'),
                    'done': bool(r.get('done')),
                    'submitted': bool(r.get('submitted')),
                } for r in rows],
                # So the screen can explain why a student is not earning from
                # Actions, instead of leaving it a silent property of a batch.
                'global_ok': bool(_int(gate.get('global_ok'), 1)),
                'deciding_batch': gate.get('deciding_batch'),
            }, status=200, bool=True)
        except Exception as e:
            logger.error("GET /admin/score-rules/students/tasks: %s" % e)
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id},
                           status=500, bool=False)

    @jwt_required()
    def post(self, user_id):
        try:
            if not _require_admin():
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
            d = request.get_json() or {}
            label = (d.get('label') or '').strip()
            if not label or len(label) > 160:
                return jsonify(response={'message': 'Name the task, up to 160 characters.'},
                               status=400, bool=False)
            points = _int(d.get('points'))
            if points is None or not (1 <= points <= MAX_TASK_POINTS):
                return jsonify(response={'message': 'Points must be from 1 to %d.' % MAX_TASK_POINTS},
                               status=400, bool=False)
            route = (d.get('action_route') or '').strip() or None
            if route and route not in _task_routes():
                return jsonify(response={'message': 'Pick a place from the list.'},
                               status=400, bool=False)
            status = (d.get('status') or 'active').strip()
            if status not in ('active', 'expired', 'draft'):
                return jsonify(response={'message': 'A task is active or expired.'},
                               status=400, bool=False)

            import uuid
            task_id = (d.get('id') or '').strip() or str(uuid.uuid4())
            row = call_proc_one('sp_score_student_task_upsert', task_id, user_id,
                                label, points, route, status, get_jwt().get('sub')) or {}
            db.session.commit()
            return jsonify(response={'message': 'Task saved.', 'task': _task_out(row)},
                           status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error("POST /admin/score-rules/students/tasks: %s" % e)
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id},
                           status=500, bool=False)


# ══ Stage 3-5: shapes, impact, bulk correction, audit ════════════════════════

def _slug_key(label, prefix):
    """A stable, readable event key from a rule's name.

    A combo has no metric to derive a key from, so the name does it. The random
    tail keeps two rules called "Getting started" apart without making the key
    unreadable in the ledger.
    """
    base = re.sub(r'[^a-z0-9]+', '_', (label or '').lower()).strip('_')[:28]
    return '%s%s_%s' % (prefix, base or 'rule', uuid.uuid4().hex[:6])


def _rule_keys():
    return {r.get('event_type') for r in (call_proc('sp_score_rules_list', 0) or [])}


def _shape_payload(d):
    """Validate the shape fields every rule can carry. Returns (values, error)."""
    shape = (d.get('shape') or 'simple').strip()
    if shape not in SHAPES:
        return None, 'Unknown rule shape.'

    tiers = (d.get('tier_points') or '').strip() or None
    if tiers:
        parts = [t.strip() for t in tiers.split(',') if t.strip()]
        try:
            vals = [round(float(t), 2) for t in parts]
        except ValueError:
            return None, 'Tier points must be numbers, like 5,3,1.'
        if not vals or len(vals) > 20:
            return None, 'Give between 1 and 20 tier values.'
        if any(v < 0 or v > 100 for v in vals):
            return None, 'Each tier must be from 0 to 100.'
        tiers = ','.join(str(v) for v in vals)

    test = (d.get('rule_test') or '').strip()
    streak = _int(d.get('streak_days'))
    if test == 'streak' and (streak is None or streak < 2):
        return None, 'A streak needs at least 2 days in a row.'
    if test == 'tiered' and not tiers:
        return None, 'A tiered rule needs its tier points, like 5,3,1.'

    expires = _int(d.get('expires_days'))
    if expires is not None and expires < 0:
        return None, 'Days before points lapse cannot be negative.'

    until = (d.get('until_at') or '').strip() or None
    if until:
        try:
            until = datetime.fromisoformat(until.replace('Z', ''))
        except ValueError:
            return None, 'The end date is not a date.'

    require = _int(d.get('require_count'))
    if shape == 'any_of' and (require is None or require < 1):
        return None, 'Say how many of the conditions have to be met.'

    return {
        'shape': shape, 'require_count': require, 'tier_points': tiers,
        'streak_days': streak, 'expires_days': expires, 'until_at': until,
        'segment_education': (d.get('segment_education') or '').strip() or None,
        'segment_degree': (d.get('segment_degree') or '').strip() or None,
        'segment_state': (d.get('segment_state') or '').strip() or None,
    }, None


@ns.route('/score-rules/shaped-rule')
class AdminScoreShapedRule(Resource):
    """Create or update a combo, streak or tiered rule.

    The simpler shapes keep using /metric-rule, which validates the metric and
    test pairing. This endpoint covers what that one cannot express -- above all
    a combo, which has no single metric of its own.
    """

    @jwt_required()
    def post(self):
        try:
            if not _require_admin():
                return jsonify(response={'message': 'Admin access required'},
                               status=403, bool=False)
            admin_id = get_jwt_identity()
            d = request.get_json() or {}

            shape_vals, err = _shape_payload(d)
            if err:
                return jsonify(response={'message': err}, status=400, bool=False)

            label = (d.get('label') or '').strip()
            if not label or len(label) > 160:
                return jsonify(response={'message': 'Name the rule, up to 160 characters.'},
                               status=400, bool=False)
            try:
                points = round(float(d.get('points')), 2)
            except (TypeError, ValueError):
                return jsonify(response={'message': 'Points must be a number.'},
                               status=400, bool=False)
            if not (0 <= points <= 100):
                return jsonify(response={'message': 'Points must be from 0 to 100.'},
                               status=400, bool=False)

            known = {m['value']: m for m in _metrics_list()}
            combo = shape_vals['shape'] in ('all_of', 'any_of')
            spec = None

            if combo:
                conds = d.get('conditions') or []
                if not isinstance(conds, list) or not conds:
                    return jsonify(response={'message': 'A combo needs at least one condition.'},
                                   status=400, bool=False)
                if len(conds) > 10:
                    return jsonify(response={'message': 'Up to 10 conditions.'},
                                   status=400, bool=False)
                parts = []
                for c in conds:
                    m = (c.get('metric_key') or '').strip()
                    if m not in known:
                        return jsonify(response={'message': 'Pick each condition from the list.'},
                                       status=400, bool=False)
                    f = (c.get('metric_filter') or '').strip()
                    if f and f not in known[m]['filter_values']:
                        return jsonify(response={
                            'message': 'That filter is not offered for %s.' % known[m]['label']},
                            status=400, bool=False)
                    # ':' and '|' separate the spec sp_score_rule_conditions_set
                    # parses, so a value holding one would split into the wrong
                    # condition rather than fail.
                    if any(ch in (m + f) for ch in (':', '|')):
                        return jsonify(response={'message': 'Bad condition value.'},
                                       status=400, bool=False)
                    t = max(1, _int(c.get('threshold'), 1) or 1)
                    parts.append('%s:%s:%d' % (m, f, t))
                spec = '|'.join(parts)
                if shape_vals['require_count'] and shape_vals['require_count'] > len(conds):
                    return jsonify(response={
                        'message': 'You asked for %d of only %d conditions.'
                                   % (shape_vals['require_count'], len(conds))},
                        status=400, bool=False)
                test = 'each'
            else:
                metric = (d.get('metric_key') or '').strip()
                if metric not in known:
                    return jsonify(response={'message': 'Pick a metric from the list.'},
                                   status=400, bool=False)
                test = (d.get('rule_test') or '').strip()
                if test not in TESTS:
                    return jsonify(response={'message': 'Unknown test.'},
                                   status=400, bool=False)

            key = (d.get('event_type') or '').strip() or _slug_key(
                label, 'c_' if combo else 's_')
            is_new = key not in _rule_keys()

            # Snapshot first, so the audit records only what actually moved.
            if not is_new:
                call_proc('sp_score_rule_snapshot_before', key)

            # Backfill is opt-in: left off, since_at is stamped now and the rule
            # only sees activity from this moment. A careless save cannot move
            # every existing student at once.
            since = None if d.get('backfill') else datetime.utcnow()

            row = call_proc_one(
                'sp_score_rule_shape_set', key, label, points,
                shape_vals['shape'], shape_vals['require_count'],
                shape_vals['tier_points'], shape_vals['streak_days'], test,
                (d.get('cap_type') or 'none'), _int(d.get('cap_value')),
                since, shape_vals['until_at'], shape_vals['expires_days'],
                shape_vals['segment_education'], shape_vals['segment_degree'],
                shape_vals['segment_state'],
                1 if d.get('is_active', True) else 0) or {}

            if combo:
                call_proc('sp_score_rule_conditions_set', key, spec)
            else:
                # shape_set leaves metric_key alone -- it has to, because a combo
                # must be able to keep it NULL.
                db.session.execute(text(
                    "UPDATE score_event_rules SET metric_key = :m, metric_filter = :f, "
                    "threshold = :t WHERE event_type = :k"),
                    {'m': d.get('metric_key'),
                     'f': (d.get('metric_filter') or '').strip() or None,
                     't': _int(d.get('threshold')), 'k': key})
            db.session.commit()

            call_proc('sp_score_rule_snapshot_after', key)
            call_proc('sp_score_rule_audit_log', key, admin_id,
                      'created' if is_new else 'updated')
            db.session.commit()

            # Pay whatever already qualifies, so the admin sees the effect the
            # preview promised them.
            # Every cached score built before this rule change is stale.
            call_proc('sp_score_rules_bump')
            call_proc('sp_score_rules_run', None)
            db.session.commit()

            fresh = call_proc_one('sp_score_rule_impact', key) or {}
            return jsonify(response={
                'message': 'Rule saved.',
                'rule': _rule_dict(row),
                'event_type': key,
                'students': int(fresh.get('students') or 0),
            }, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error("POST /admin/score-rules/shaped-rule: %s" % e)
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id},
                           status=500, bool=False)


@ns.route('/score-rules/rule/<string:event_type>/impact')
class AdminScoreRuleImpact(Resource):
    @ns.doc(description='What switching this rule off, or deleting it, would move.')
    @jwt_required()
    def get(self, event_type):
        try:
            if not _require_admin():
                return jsonify(response={'message': 'Admin access required'},
                               status=403, bool=False)
            row = call_proc_one('sp_score_rule_impact', event_type) or {}
            conds = call_proc('sp_score_rule_conditions_list', event_type) or []
            return jsonify(response={
                'rule_label': row.get('rule_label'),
                'students': int(row.get('students') or 0),
                'awards': int(row.get('awards') or 0),
                'points': float(row.get('points') or 0),
                'first_award': serialize_datetime(row['first_award'])
                               if row.get('first_award') else None,
                'last_award': serialize_datetime(row['last_award'])
                              if row.get('last_award') else None,
                'conditions': [{
                    'metric_key': c.get('metric_key'),
                    'metric_filter': c.get('metric_filter'),
                    'threshold': int(c.get('threshold') or 1),
                    'label': c.get('label'),
                } for c in conds],
            }, status=200, bool=True)
        except Exception as e:
            logger.error("GET /admin/score-rules/rule/impact: %s" % e)
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id},
                           status=500, bool=False)


@ns.route('/score-rules/awards')
class AdminScoreAwards(Resource):
    @ns.doc(description='Awards by rule, date, and whether anyone has looked.')
    @jwt_required()
    def get(self):
        try:
            if not _require_admin():
                return jsonify(response={'message': 'Admin access required'},
                               status=403, bool=False)
            page = max(1, _int(request.args.get('page'), 1) or 1)
            per = min(100, max(1, _int(request.args.get('per_page'), 30) or 30))
            rows = call_proc(
                'sp_score_awards_search',
                (request.args.get('event_type') or '').strip() or None,
                1 if request.args.get('needs_look') in ('1', 'true', 'yes') else 0,
                (request.args.get('since') or '').strip() or None,
                (request.args.get('until') or '').strip() or None,
                per, (page - 1) * per) or []
            return jsonify(response={'page': page, 'awards': [{
                'id': r.get('id'),
                'user_id': r.get('user_id'),
                'student': r.get('full_name'),
                'event_type': r.get('event_type'),
                'rule_label': r.get('rule_label'),
                'points': float(r.get('points') or 0),
                'ref_id': r.get('ref_id'),
                'occurred_at': serialize_datetime(r['occurred_at'])
                               if r.get('occurred_at') else None,
                'needs_look': bool(r.get('needs_look')),
                'checked_at': serialize_datetime(r['checked_at'])
                              if r.get('checked_at') else None,
            } for r in rows]}, status=200, bool=True)
        except Exception as e:
            logger.error("GET /admin/score-rules/awards: %s" % e)
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id},
                           status=500, bool=False)

    @ns.doc(description='Mark a page of awards as looked at.')
    @jwt_required()
    def post(self):
        try:
            if not _require_admin():
                return jsonify(response={'message': 'Admin access required'},
                               status=403, bool=False)
            ids = (request.get_json(silent=True) or {}).get('ids') or []
            # The procedure takes a comma list, so an id containing a comma
            # would silently become two.
            clean = [str(i) for i in ids if i and ',' not in str(i)][:500]
            if not clean:
                return jsonify(response={'message': 'Nothing selected.'},
                               status=400, bool=False)
            row = call_proc_one('sp_score_awards_check', ','.join(clean),
                                get_jwt_identity()) or {}
            db.session.commit()
            n = int(row.get('checked') or 0)
            return jsonify(response={'message': '%d marked as checked.' % n, 'checked': n},
                           status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error("POST /admin/score-rules/awards: %s" % e)
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id},
                           status=500, bool=False)


@ns.route('/score-rules/bulk-adjust')
class AdminScoreBulkAdjust(Resource):
    @ns.doc(description='Reverse one rule for every student it paid. Audited.')
    @jwt_required()
    def post(self):
        try:
            if not _require_admin():
                return jsonify(response={'message': 'Admin access required'},
                               status=403, bool=False)
            d = request.get_json() or {}
            event_type = (d.get('event_type') or '').strip()
            reason = (d.get('reason') or '').strip()
            if not event_type:
                return jsonify(response={'message': 'Which rule?'}, status=400, bool=False)
            if len(reason) < 5:
                return jsonify(response={
                    'message': 'Give a reason - it is recorded against every student.'},
                    status=400, bool=False)

            row = call_proc_one('sp_score_bulk_adjust', event_type,
                                (d.get('since') or '').strip() or None,
                                (d.get('until') or '').strip() or None,
                                get_jwt_identity(), reason) or {}
            db.session.commit()
            if row.get('result') != 'ok':
                return jsonify(response={'message': 'A rule and a reason are both required.'},
                               status=400, bool=False)
            n = int(row.get('students') or 0)
            return jsonify(response={'message': 'Corrected %d student(s).' % n, 'students': n},
                           status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error("POST /admin/score-rules/bulk-adjust: %s" % e)
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id},
                           status=500, bool=False)


@ns.route('/score-rules/audit')
class AdminScoreRuleAudit(Resource):
    @ns.doc(description='Who changed which rule, when, and from what to what.')
    @jwt_required()
    def get(self):
        try:
            if not _require_admin():
                return jsonify(response={'message': 'Admin access required'},
                               status=403, bool=False)
            rows = call_proc('sp_score_rule_audit_list',
                             (request.args.get('event_type') or '').strip() or None,
                             min(200, _int(request.args.get('limit'), 60) or 60)) or []
            return jsonify(response={'changes': [{
                'id': r.get('id'),
                'event_type': r.get('rule_key'),
                'rule_label': r.get('rule_label'),
                # The admin may have left since; the change still happened.
                'admin': r.get('admin_name') or 'Former admin',
                'action': r.get('action'),
                'field': r.get('field'),
                'old_value': r.get('old_value'),
                'new_value': r.get('new_value'),
                'at': serialize_datetime(r['created_at']) if r.get('created_at') else None,
            } for r in rows]}, status=200, bool=True)
        except Exception as e:
            logger.error("GET /admin/score-rules/audit: %s" % e)
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id},
                           status=500, bool=False)
