"""
Readiness Score Engine — student endpoints.

Exposes the ledger behind the score (what earned what, and when), what the
score currently unlocks, and the pause tokens that freeze decay while a
student is away — exams, illness, a break.
"""
from portal.helpers.error_capture import capture_error
import uuid
import re
from flask import jsonify, request
from flask_restx import Resource
from flask_jwt_extended import jwt_required, get_jwt_identity
from portal.models import db
from portal.helpers.sp import call_proc, call_proc_one
from portal.helpers.helpers import serialize_datetime
from . import ns, logger


@ns.route('/score')
class ScoreSummary(Resource):
    @ns.doc(description='Current score with its ledger breakdown and decay state.')
    @jwt_required()
    def get(self):
        try:
            user_id = get_jwt_identity()
            # ── SP: sp_score_read ────────────────────────────────────────────
            # Rebuilds only when this student's ledger or the rule config has
            # moved since the cache was built; otherwise it is a plain read.
            # Opening the screen twice used to mean two full ledger sums and
            # two writes.
            row = call_proc_one('sp_score_read', user_id) or {}
            db.session.commit()
            # ── SP: sp_score_breakdown ───────────────────────────────────────
            parts = call_proc('sp_score_breakdown', user_id) or []
            # ── SP: sp_score_pause_status ────────────────────────────────────
            pause = call_proc_one('sp_score_pause_status', user_id) or {}
            # last_event_at drives the client's "decay is coming" warning (§4.7).
            live = call_proc_one('sp_readiness_score_get', user_id) or {}

            return jsonify(response={
                'last_event_at': serialize_datetime(live.get('last_event_at')),
                'score': int(row.get('score') or 0),
                'level': row.get('level'),
                'base_points': float(row.get('base_points') or 0),
                'decay_points': int(row.get('decay_points') or 0),
                'breakdown': [{
                    'event_type': p.get('event_type'),
                    'label': p.get('label'),
                    'points_each': float(p.get('points_each') or 0),
                    'cap_type': p.get('cap_type'),
                    'cap_value': p.get('cap_value'),
                    'earned': float(p.get('earned') or 0),
                    'times': int(p.get('times') or 0),
                } for p in parts],
                'pause': {
                    'max_tokens': pause.get('max_tokens'),
                    'used_this_year': pause.get('used_this_year'),
                    'pause_days': pause.get('pause_days'),
                    # A short break is free, and the allowance runs from the
                    # student's signup date rather than January. The screen
                    # reads pause from THIS payload, not /score/pause.
                    'grace_days': pause.get('grace_days'),
                    'resets_on': serialize_datetime(pause.get('resets_on')),
                    'active_until': serialize_datetime(pause.get('active_until')),
                },
            }, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in GET /readiness/score: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/score/tasks')
class ScoreTasks(Resource):
    @ns.doc(description='Tasks Admin added that this student can earn points for.')
    @jwt_required()
    def get(self):
        try:
            user_id = get_jwt_identity()
            rows = call_proc('sp_score_tasks_for_student', user_id) or []
            return jsonify(response={'tasks': [{
                'id': r.get('id'),
                'label': r.get('label'),
                'points': int(r.get('points') or 0),
                'done': bool(r.get('done')),
                'status': r.get('status') or 'active',
                # Where the task is actually done, and whether they have
                # already told us they did it.
                'action_route': r.get('action_route'),
                # Whether the platform can settle this task by itself. The screen
                # only promises automatic points when it can.
                'auto_verified': bool(r.get('auto_verified')),
                'submitted': bool(r.get('submitted')),
                'batch_name': r.get('batch_name'),
            } for r in rows]}, status=200, bool=True)
        except Exception as e:
            logger.error(f"Error in GET /readiness/score/tasks: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/score/tasks/<string:task_id>/submit')
class ScoreTaskSubmit(Resource):
    """A student says they have done a task.

    This does NOT pay. Only an admin crediting it writes to the ledger -- a
    submission is a claim, and it puts the student at the front of the admin's
    roster instead of leaving them waiting to be noticed.
    """

    @jwt_required()
    def post(self, task_id):
        try:
            user_id = get_jwt_identity()
            body = request.get_json(silent=True) or {}
            note = (body.get('note') or '').strip()[:500] or None
            undo = 1 if body.get('undo') else 0

            # ── SP: sp_score_task_submit ────────────────────────────────────
            # Settles the claim itself when the task names something checkable,
            # and only then hands back 'auto_approved' for us to pay.
            row = call_proc_one('sp_score_task_submit', task_id, user_id, note, undo) or {}
            db.session.commit()
            result = row.get('result')
            points = 0

            if result == 'auto_approved':
                # Paid here rather than inside the procedure: a nested CALL that
                # SELECTs would push the verdict out of the first result set,
                # which is the only one call_proc_one reads.
                # ── SP: sp_score_task_complete ──────────────────────────────
                paid = call_proc_one('sp_score_task_complete',
                                     str(uuid.uuid4()), task_id, user_id) or {}
                db.session.commit()
                points = int(paid.get('points') or 0)

            msg = {
                'submitted': 'Sent to Skovo to check.',
                'withdrawn': 'Taken back.',
                'already_paid': 'You have already been given the points for this.',
                'auto_approved': (f'Checked and done — {points} points added.'
                                  if points else 'Checked and done.'),
                'auto_rejected': row.get('reason') or
                                 "We could not find this on your account yet.",
            }.get(result, 'Done.')

            return jsonify(response={'message': msg, 'result': result,
                                     'points': points},
                           status=200,
                           bool=result not in ('already_paid', 'auto_rejected'))
        except Exception as e:
            db.session.rollback()
            logger.error("POST /readiness/score/tasks/submit: %s" % e)
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id},
                           status=500, bool=False)


@ns.route('/score/events')
class ScoreEvents(Resource):
    @ns.doc(description='The append-only score ledger — every point, newest first.')
    @jwt_required()
    def get(self):
        try:
            user_id = get_jwt_identity()
            page = max(1, int(request.args.get('page', 1) or 1))
            per_page = min(100, max(1, int(request.args.get('per_page', 30) or 30)))
            # ── SP: sp_score_events_list ─────────────────────────────────────
            rows = call_proc('sp_score_events_list', user_id, per_page, (page - 1) * per_page) or []
            return jsonify(response={
                'events': [{
                    'id': e.get('id'),
                    'event_type': e.get('event_type'),
                    'label': e.get('label'),
                    'points': e.get('points'),
                    'occurred_at': serialize_datetime(e.get('occurred_at')),
                } for e in rows],
                'page': page,
            }, status=200, bool=True)
        except Exception as e:
            logger.error(f"Error in GET /readiness/score/events: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


# How each scoring signal is earned, in the student's language, and where they
# go to do it. Anything not listed is a background signal we do not ask for.
#
# `gated` marks actions that live behind the very gate the student is trying to
# reach — suggesting those would be a circular instruction ("shortlist a job to
# unlock jobs"), so they are filtered out below.
_ACTION_GUIDE = {
    'profile_completed':      ('Complete your profile', '/profile', False),
    # assessment_completed is v1-hidden — do not send students to /readiness-assessment.
    'cohort_attended':        ('Attend a cohort session', '/cohorts', False),
    'cohort_completed':       ('Finish a cohort and its task', '/cohorts', False),
    'cohort_repeat_week':     ('Attend another session this week', '/cohorts', False),
    'community_join':         ('Join a community', '/assemble', False),
    'community_post':         ('Post in a community', '/assemble', False),
    'document_uploaded':      ('Upload a document to your vault', '/document-vault', False),
    'market_redeem':          ('Redeem a Market deal', '/market', False),
    'college_saved':          ('Save a college to compare', '/colleges', False),
    'application_submitted':  ('Apply to an opportunity', '/opportunities', True),
    'opportunity_shortlisted': ('Shortlist an opportunity', '/opportunities', True),
}


# A metric rule has no entry in _ACTION_GUIDE -- its key is derived, so there is
# nothing to hardcode against. Without this map every rule an admin builds was
# silently dropped from "ways to earn points": the student could see the points
# land but was never told how to earn them.
_METRIC_ROUTE = {
    'cohorts_enrolled':       ('/cohorts', False),
    'cohorts_attended':       ('/cohorts', False),
    'cohort_tasks_approved':  ('/tasks', False),
    'pro_subscription':       ('/skovo-pro', False),
    'sessions_completed':     ('/find-mentors', False),
    'documents_uploaded':     ('/document-vault', False),
    'communities_joined':     ('/assemble', False),
    'community_posts':        ('/assemble', False),
    'colleges_saved':         ('/colleges', False),
    'applications_submitted': ('/opportunities', True),
    'referrals_completed':    ('/referrals', False),
    'reviews_written':        ('/bookings', False),
    'skills_added':           ('/profile', False),
    'goals_set':              ('/profile', False),
}


def _next_actions(user_id, nxt, limit=4):
    """The highest-value things this student can still do, biggest first.

    Headroom, not raw point value, decides the order: a rule worth 2 points with
    5 uses left is worth more to someone 40 points short than a 5-pointer they
    have already claimed.
    """
    try:
        # A batch can switch global actions off for its students. They still
        # earn from the batch's own tasks, which the screen lists separately --
        # but offering them global actions as "ways to earn" would be telling
        # them to do work that cannot pay.
        # ── SP: sp_score_student_global_ok ──────────────────────────────────
        gate = call_proc_one('sp_score_student_global_ok', user_id) or {}
        if str(gate.get('global_ok', 1)) in ('0', 'False'):
            return []

        # ── SP: sp_score_breakdown — per-rule points, caps and what is earned ─
        rows = call_proc('sp_score_breakdown', user_id) or []
    except Exception:
        return []

    gate_locked = bool(nxt)   # still working toward something
    out = []
    for r in rows:
        guide = _ACTION_GUIDE.get(r.get('event_type'))
        if guide:
            label, route, gated = guide
        elif r.get('metric_key') in _METRIC_ROUTE:
            # The admin already named it on the Score Engine, and that name is
            # written for students -- use it rather than inventing a second one.
            route, gated = _METRIC_ROUTE[r['metric_key']]
            label = (r.get('label') or '').strip() or 'Earn points'
        else:
            continue
        if gated and gate_locked:
            continue    # do not tell someone to walk through the door they are locked out of

        points = float(r.get('points_each') or 0)
        if points <= 0:
            continue    # zero-point signals are not worth a student's time

        times = int(r.get('times') or 0)
        cap_type = (r.get('cap_type') or 'none').lower()
        cap_value = r.get('cap_value')

        if cap_type in ('once', 'per_item') and cap_value is not None:
            remaining_uses = max(0, int(cap_value) - times) if cap_type == 'once' else None
        elif cap_type == 'lifetime' and cap_value is not None:
            remaining_uses = max(0, int(cap_value) - times)
        else:
            remaining_uses = None   # repeatable (daily/weekly/monthly/none)

        if remaining_uses == 0:
            continue    # already maxed — nothing left to earn here

        headroom = points * remaining_uses if remaining_uses else points
        out.append({
            'event_type': r.get('event_type'),
            'label': label,
            'route': route,
            'points_each': points,
            'remaining_uses': remaining_uses,     # null = repeatable
            'points_available': round(headroom, 1),
            'done_already': times,
            # The screens phrase the "how" from these. Without them a rule that
            # pays once when something starts was described as "Every time you
            # do it", which is the opposite of what it does.
            'rule_test': r.get('rule_test'),
            'threshold': r.get('threshold'),
        })

    out.sort(key=lambda a: a['points_available'], reverse=True)
    return out[:limit]


@ns.route('/public-gate')
class PublicReadinessGate(Resource):
    """The Opportunity Hub score, for pages with no session.

    The marketing site states the number in five places ("At score 60, the
    Opportunities Hub unlocks"). Those were literals, so moving the gate on the
    Readiness Rules screen left the public site promising the old one -- the
    exact drift `opportunity_hub_min_score()` was written to end, just on the
    one page that could not call it because it has no token.

    Deliberately unauthenticated and deliberately narrow: one public number
    that is already printed on the homepage, nothing else from the config row.
    """
    @ns.doc(description='Public: the score at which the Opportunity Hub unlocks. No session required.')
    def get(self):
        try:
            from portal.helpers.helpers import opportunity_hub_min_score
            return jsonify(response={'opportunity_unlock_score': opportunity_hub_min_score()},
                           status=200, bool=True)
        except Exception as e:
            logger.error(f"GET /readiness/public-gate: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/score/unlocks')
class ScoreUnlocks(Resource):
    @ns.doc(description='What the current score unlocks, and what is still ahead.')
    @jwt_required()
    def get(self):
        try:
            user_id = get_jwt_identity()
            # ── SP: sp_score_unlocks ─────────────────────────────────────────
            row = call_proc_one('sp_score_unlocks', user_id) or {}
            score = int(row.get('score') or 0)
            opp = int(row.get('opportunity_unlock_score') or 60)

            # The ladder is the configured levels plus the Hub gate. It used to
            # be pioneer_min and achiever_min off the rules row, which the
            # levels table replaced -- so a student wearing "Builder" was told
            # to climb to "Achiever level" at 65, a band that no longer exists.
            from portal.helpers.helpers import readiness_level_gates
            gates = [(f'level_{re.sub(r"[^a-z0-9]+", "_", label.lower()).strip("_")}',
                      f'{label} level', min_score)
                     for label, min_score in readiness_level_gates()]
            gates.append(('opportunity_hub', 'Opportunity Hub', opp))
            unlocks = [{
                'key': key,
                'label': label,
                'required': req,
                'unlocked': score >= req,
                'points_away': max(0, req - score),
            } for key, label, req in sorted(gates, key=lambda g: g[2])]

            nxt = next((u for u in unlocks if not u['unlocked']), None)
            return jsonify(response={
                'score': score,
                'unlocks': unlocks,
                'next': nxt,
                # A number and a padlock tell a student they are locked out but
                # not how to get in, and "locked forever" is what makes them
                # leave in week one. Ship the actual route to the next gate.
                'next_actions': _next_actions(user_id, nxt),
            }, status=200, bool=True)
        except Exception as e:
            logger.error(f"Error in GET /readiness/score/unlocks: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/score/pause')
class ScorePause(Resource):
    @ns.doc(description='Pause-token status — how many are left this year and whether one is running.')
    @jwt_required()
    def get(self):
        try:
            user_id = get_jwt_identity()
            # ── SP: sp_score_pause_status ────────────────────────────────────
            p = call_proc_one('sp_score_pause_status', user_id) or {}
            used = int(p.get('used_this_year') or 0)
            max_tokens = int(p.get('max_tokens') or 2)
            return jsonify(response={
                'max_tokens': max_tokens,
                'used_this_year': used,
                'remaining': max(0, max_tokens - used),
                'pause_days': p.get('pause_days'),
                # A pause is free if they are back inside the grace period, and
                # the allowance runs from their signup date, not January. The
                # screen has to be able to say both or it is guessing.
                'grace_days': p.get('grace_days'),
                'resets_on': serialize_datetime(p.get('resets_on')),
                'active_until': serialize_datetime(p.get('active_until')),
                'is_paused': bool(p.get('active_until')),
            }, status=200, bool=True)
        except Exception as e:
            logger.error(f"Error in GET /readiness/score/pause: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @ns.doc(description='Spend a pause token — freezes score decay for the configured window.')
    @jwt_required()
    def post(self):
        try:
            user_id = get_jwt_identity()
            # ── SP: sp_score_pause_start (enforces the yearly allowance) ─────
            res = call_proc_one('sp_score_pause_start', str(uuid.uuid4()), user_id) or {}
            db.session.commit()
            if not res.get('ok'):
                return jsonify(response={
                    'message': res.get('message') or 'Could not pause your score.',
                    'used_this_year': res.get('used'),
                    'max_tokens': res.get('max_tokens'),
                }, status=400, bool=False)
            return jsonify(response={
                'message': res.get('message'),
                'used_this_year': res.get('used'),
                'max_tokens': res.get('max_tokens'),
            }, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in POST /readiness/score/pause: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/score/progress')
class ScoreProgress(Resource):
    """Combos the student is partway through.

    A combo pays nothing until every condition is met, so without this the
    student sees no reason to finish one -- they would register, log in, and
    never learn that joining a cohort releases five points. The waiting line is
    most of what makes the shape work.

    Finished combos are returned too, marked `earned`, so the screen can show
    them ticked rather than making them vanish the moment they pay.
    """

    @jwt_required()
    def get(self):
        try:
            user_id = get_jwt_identity()
            # ── SP: sp_score_rule_progress ──────────────────────────────────
            rows = call_proc('sp_score_rule_progress', user_id) or []
            out = []
            for r in rows:
                steps = []
                for part in (r.get('steps') or '').split('|'):
                    if not part:
                        continue
                    flag, _, name = part.partition(':')
                    steps.append({'done': flag == '1', 'label': name or 'Step'})
                done, need = int(r.get('done') or 0), int(r.get('need') or 0)
                out.append({
                    'event_type': r.get('rule_key'),
                    'label': r.get('rule_label'),
                    'points': float(r.get('points') or 0),
                    'shape': r.get('shape'),
                    'done': done,
                    'need': need,
                    'total': int(r.get('total') or 0),
                    'earned': bool(r.get('earned')),
                    'steps': steps,
                })
            # Closest to finishing first, and anything already earned last --
            # the list is a to-do, not a history.
            out.sort(key=lambda g: (g['earned'], -(g['done'] / (g['need'] or 1))))
            return jsonify(response={'goals': out}, status=200, bool=True)
        except Exception as e:
            logger.error("GET /readiness/score/progress: %s" % e)
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id},
                           status=500, bool=False)
