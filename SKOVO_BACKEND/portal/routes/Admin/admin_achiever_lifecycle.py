"""Admin control of the achiever lifecycle.

Replaces the tier dropdown. There is deliberately no endpoint that sets a
"level": an admin approves *evidence*, and capability follows from the state
machine. The previous design let a level be typed directly, which is how an
achiever ended up listed and charging with no documents on file at all.

    PENDING -> PROBATION -> ACTIVE -> SUSPENDED -> BANNED
                              ^__________|         (terminal)
"""
import datetime

import uuid

from flask import jsonify, request
from flask_restx import Resource
from flask_jwt_extended import jwt_required, get_jwt_identity
from sqlalchemy import text

from portal.models import db
from portal.helpers.sp import call_proc, call_proc_one
from portal.helpers.helpers import serialize_datetime
from portal.helpers import trust as T
from portal.helpers.error_capture import capture_error
from portal.helpers import achiever_demo as D
from portal.helpers.achiever_notify import (tell_achiever, achiever_url,
                                            PORTAL_PATH)
from . import ns, logger

# Per-cohort seat allocation. The floor is 1 because a zero-seat achiever is
# just a suspended one, and there are proper states for that. The ceiling is a
# sanity bound on a typed number, not a product rule -- master_cohort_seats
# offers 25/30/50/75/100/200 as the everyday choices.
MIN_COHORT_SEATS = 1
MAX_COHORT_SEATS = 1000


def _parse_seats(raw, required):
    """(seats, error_message). `None` seats means "leave uncapped"."""
    if raw is None or raw == '':
        if required:
            return None, 'A seat allocation is required when approving.'
        return None, None
    try:
        seats = int(raw)
    except (TypeError, ValueError):
        return None, 'cohort_seats must be a whole number.'
    if not (MIN_COHORT_SEATS <= seats <= MAX_COHORT_SEATS):
        return None, f'Seats must be between {MIN_COHORT_SEATS} and {MAX_COHORT_SEATS}.'
    return seats, None


# Floor for a new probation. Extra demos add to the person, not this constant.
DEMOS_REQUIRED = D.DEFAULT_REQUIRED

# Offered in the UI; an admin may also pass an explicit date. Indefinite is
# suspended_until = NULL, which the nightly lift job deliberately never touches.
SUSPENSION_PRESETS = {'1m': 30, '4m': 120, '6m': 180, 'indefinite': None}


def _guard():
    """Admin or super-admin only."""
    actor = get_jwt_identity()
    row = db.session.execute(text(
        "SELECT 'admin' FROM admins WHERE id = :i "
        "UNION SELECT 'super_admin' FROM super_admins WHERE id = :i"
    ), {'i': actor}).fetchone()
    if not row:
        return None, jsonify(response={'message': 'Admin access required.'},
                             status=403, bool=False)
    return actor, None


def _doc_label(doc_type):
    """Master data's label for a document type, falling back to the raw value.

    The fallback matters: a type removed from master data after someone uploaded
    against it still has to render as something, and "govt id" beats a blank.
    """
    if not doc_type:
        return None
    for t in (T.doc_types() or []):
        if t.get('value') == doc_type:
            return t.get('label') or doc_type
    return str(doc_type).replace('_', ' ')


def _actor_name(actor_id):
    """The admin's name for an id, or None.

    Best effort by design: an actor who has since been deleted, or a state set
    by the scheduler rather than a person, must not take the dossier down with
    it. The overnight suspension lift writes no actor at all, which is why the
    caller has to cope with None anyway.
    """
    if not actor_id:
        return None
    try:
        row = db.session.execute(text(
            "SELECT full_name FROM admins WHERE id = :i"), {'i': actor_id}).first()
        return row[0] if row else None
    except Exception:
        return None


def _notify_state_change(achiever_id, from_state, to_state, reason, until):
    """Tell the achiever what just happened to their account.

    Only the transitions they would notice. A pending -> probation move made by
    the approve route is announced there, with the seat cap and demo target in
    it; repeating it here would send two emails for one decision.
    """
    when = (f" until {until.strftime('%d %b %Y, %H:%M')}" if until else "")

    if to_state == 'suspended':
        tail = ("It reinstates automatically when the period ends — you do not "
                "need to do anything." if until else
                "There is no end date on this one. It stays until an admin lifts it.")
        tell_achiever(
            achiever_id, 'Your SKOVO account is suspended',
            f'An admin has suspended your account{when}.\n\n'
            f'Reason given: {reason}\n\n{tail}',
            type='system')

    elif to_state == 'banned':
        tell_achiever(
            achiever_id, 'Your SKOVO account has been closed',
            f'An admin has closed your account.\n\nReason given: {reason}\n\n'
            'Earnings you have already been credited remain yours to claim. '
            'If you believe this is wrong, reply to this email.',
            type='system')

    elif from_state == 'suspended':
        tell_achiever(
            achiever_id, 'Your suspension has been lifted',
            f'An admin has lifted the suspension on your account.\n\n'
            f'Reason given: {reason}\n\nYou are back to {to_state}.',
            type='system')


def _state_change(achiever_id, to_state, reason, until=None):
    actor, err = _guard()
    if err:
        return err
    if not (reason or '').strip():
        # Every transition is explained. An achiever asking "why" six months
        # later deserves an answer, and an unexplained suspension is one the
        # admin cannot defend either.
        return jsonify(response={'message': 'A reason is required.'},
                       status=400, bool=False)
    try:
        # ── SP: sp_achiever_set_state ────────────────────────────────────────
        row = call_proc_one('sp_achiever_set_state', achiever_id, to_state,
                            reason.strip(), until, actor, 'admin')
        db.session.commit()
        if to_state == 'active':
            try:
                from portal.helpers.referral_rewards import on_achiever_active
                on_achiever_active(achiever_id)
            except Exception as pay_err:
                logger.error(f"referral pay after active failed for {achiever_id}: {pay_err}")
        logger.info(f"achiever {achiever_id}: {row.get('from_state')} -> {to_state} by {actor}")
        # After the commit, never before: the decision stands whether or not
        # the achiever can be reached, and tell_achiever never raises.
        _notify_state_change(achiever_id, row.get('from_state'), to_state,
                             reason.strip(), until)
        return jsonify(response={
            'message': f'Achiever moved to {to_state}.',
            'from_state': row.get('from_state'),
            'to_state': to_state,
        }, status=200, bool=True)
    except Exception as e:
        db.session.rollback()
        msg = str(e)
        for code, text_msg, http in (
            ('BANNED_IS_TERMINAL', 'This achiever is banned. Banning cannot be undone here.', 409),
            ('ACHIEVER_NOT_FOUND', 'Achiever not found.', 404),
            ('INVALID_STATE', 'Unknown state.', 400),
        ):
            if code in msg:
                return jsonify(response={'message': text_msg}, status=http, bool=False)
        logger.error(f"state change failed for {achiever_id}: {e}")
        error_id = capture_error(e)
        return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id},
                       status=500, bool=False)


@ns.route('/achiever-lifecycle/queue')
class LifecycleQueue(Resource):

    @jwt_required()
    def get(self):
        """Everyone waiting on an admin, newest first.

        Two queues in one: applications with documents to review, and
        probations whose three demos are done.
        """
        _, err = _guard()
        if err:
            return err
        try:
            rows = db.session.execute(text("""
                SELECT a.id, a.full_name, a.email, a.state, a.designation, a.company,
                       a.demo_sessions_done, a.demo_submitted_at, a.created_at,
                       IFNULL(a.demo_sessions_required, 3) AS demos_required,
                       (SELECT COUNT(*) FROM achiever_documents d
                         WHERE d.achiever_id = a.id AND d.status = 'pending')  AS docs_pending,
                       (SELECT COUNT(*) FROM achiever_documents d
                         WHERE d.achiever_id = a.id
                           AND d.status IN ('accepted','approved'))            AS docs_ok,
                       (SELECT COUNT(*) FROM master_achiever_doc_type t
                         WHERE t.is_required = 1 AND t.is_active = 1
                           AND NOT EXISTS (
                                 SELECT 1 FROM achiever_documents d
                                  WHERE d.achiever_id = a.id
                                    AND d.doc_type = t.value COLLATE utf8mb4_unicode_ci
                                    AND d.status IN ('accepted','approved')
                               )) AS docs_missing_required,
                       -- Appended, not slotted in beside the other identity
                       -- columns: the result is read positionally, so inserting
                       -- a column in the middle silently renumbers every field
                       -- after it. The photo the achiever uploaded, falling back
                       -- to the one an admin typed in on the Achievers screen.
                       IFNULL(a.profile_image_url, a.avatar_url) AS photo,
                       -- Also appended. Carried on the row so the approve
                       -- dialog can open on the cap this achiever already has
                       -- instead of an empty box: someone coming back through
                       -- the queue after an unban keeps their allocation, and
                       -- re-typing it is how it gets changed by accident.
                       a.cohort_seat_allocation AS cohort_seats
                  FROM achievers a
                 -- Decided achievers are included when asked for. The queue
                 -- used to end at 'probation', so the moment someone was
                 -- approved their documents, background check and demo reviews
                 -- became unreachable -- the record you most want to re-read is
                 -- the one you just made a decision on.
                 WHERE (:all_states = 1 OR a.state IN ('pending', 'probation'))
                 ORDER BY (a.state IN ('pending','probation')) DESC,
                          (a.state = 'probation' AND a.demo_submitted_at IS NOT NULL) DESC,
                          a.created_at
                 LIMIT 200
            """), {'all_states': 1 if request.args.get('scope') == 'all' else 0}).fetchall()

            return jsonify(response={'items': [{
                'achiever_id': r[0], 'full_name': r[1], 'email': r[2], 'state': r[3],
                'designation': r[4], 'company': r[5],
                'demos_done': r[6], 'demos_required': r[9],
                'awaiting_decision': bool(r[3] == 'probation' and r[7]),
                'documents_pending': r[10], 'documents_accepted': r[11],
                'documents_missing_required': r[12],
                'profile_image_url': r[13],
                'cohort_seat_allocation': r[14],
                'applied_at': serialize_datetime(r[8]) if r[8] else None,
            } for r in rows]}, status=200, bool=True)
        except Exception as e:
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id},
                           status=500, bool=False)


@ns.route('/achiever-lifecycle/<string:achiever_id>/approve-application')
class ApproveApplication(Resource):

    @jwt_required()
    def post(self, achiever_id):
        """PENDING -> PROBATION. Refuses unless every required document is accepted.

        Approving also sets how many seats each of this achiever's cohorts may
        hold. It is decided here, at the first gate, rather than at the
        probation gate beside the commission rate: achievers run free demo
        cohorts *during* probation, so waiting would leave those uncapped.
        """
        actor, err = _guard()
        if err:
            return err

        data = request.get_json(silent=True) or {}
        # The KEY must be present; its value may be null.
        #
        # required=True rejected a null, which made 'unlimited' unreachable at
        # approval: the field was mandatory and unlimited is the absence of a
        # number, so an admin could only approve with a cap and then remove it
        # afterwards. Requiring the key keeps the forcing function -- nobody is
        # approved without the question being answered -- while letting the
        # answer be 'no cap'. Same shape the cohort-seats edit route uses.
        if 'cohort_seats' not in data:
            return jsonify(response={
                'message': 'Decide the seat allocation before approving: a number, or unlimited.',
            }, status=400, bool=False)
        seats, seat_err = _parse_seats(data.get('cohort_seats'), required=False)
        if seat_err:
            return jsonify(response={'message': seat_err}, status=400, bool=False)

        # Only an application the achiever actually sent. Approving a draft
        # skipped their own "I'm done" step and left Applied on empty forever.
        row = call_proc_one('sp_achievers_get', achiever_id) or {}
        if (row.get('application_status') or 'draft') == 'draft':
            return jsonify(response={
                'message': 'The achiever has not submitted the application yet. Approve it once they click Submit for review.',
            }, status=409, bool=False)

        try:
            # ── SP: sp_achiever_approve_application ──────────────────────────
            call_proc_one('sp_achiever_approve_application', achiever_id, actor, seats)
            db.session.commit()
            # Read back rather than assume. The SP keeps a target an admin set
            # by hand and only falls back to the default when there isn't one,
            # so reporting D.DEFAULT_REQUIRED here would tell the screen 3 while
            # the account says 1 - exactly the disagreement this path had.
            demos = db.session.execute(
                text("SELECT demo_sessions_required FROM achievers WHERE id = :i"),
                {'i': achiever_id}).scalar() or D.DEFAULT_REQUIRED
            # The one email an applicant is actually waiting for. It carries the
            # two numbers that decide what they do next, because "you have been
            # approved" without the demo target sends them straight back to the
            # portal to find out what approval means.
            tell_achiever(
                achiever_id, 'Your SKOVO application has been approved',
                'An admin has reviewed your documents and approved your application.\n\n'
                f'You are now on probation. Run {demos} free demo '
                f'session{"" if demos == 1 else "s"} and an admin will review them '
                'before you can charge for your time.\n\n'
                + (f'Each cohort you create is capped at {seats} student'
                   f'{"" if seats == 1 else "s"}.' if seats
                   else 'Your cohorts are uncapped.'),
                button_url=achiever_url(PORTAL_PATH),
                button_label='Open your portal', type='system')
            return jsonify(response={
                'message': ((f'Application approved with {seats} seats per cohort. '
                             if seats else 'Application approved with unlimited seats. ')
                            + 'They can now run free demo sessions.'),
                'demos_required': demos,
                'cohort_seat_allocation': seats,
            }, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            msg = str(e)
            if 'DOCUMENTS_INCOMPLETE' in msg:
                return jsonify(response={
                    'message': 'Cannot approve — some required documents are not accepted yet.',
                }, status=409, bool=False)
            if 'NOT_PENDING' in msg:
                return jsonify(response={'message': 'This achiever is not awaiting application review.'},
                               status=409, bool=False)
            if 'ACHIEVER_NOT_FOUND' in msg:
                return jsonify(response={'message': 'Achiever not found.'}, status=404, bool=False)
            logger.error(f"approve application failed for {achiever_id}: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id},
                           status=500, bool=False)


@ns.route('/achiever-lifecycle/<string:achiever_id>/cohort-seats')
class CohortSeatAllocation(Resource):

    @jwt_required()
    def post(self, achiever_id):
        """Change the per-cohort seat allocation after approval.

        Deliberately not folded into the approve route: the achiever who fills
        every cohort is precisely the one worth giving more room to, and that
        should not mean sending them back through the review queue.

        Existing cohorts are left alone. Their seat counts were agreed with the
        students who already enrolled, and silently widening or -- worse --
        narrowing a cohort someone has paid into is not a change an admin
        should be able to make by editing a number on a different screen.
        """
        actor, err = _guard()
        if err:
            return err

        data = request.get_json(silent=True) or {}
        if 'cohort_seats' not in data:
            return jsonify(response={'message': 'cohort_seats is required.'},
                           status=400, bool=False)

        # required=False: an explicit null clears the cap back to unlimited,
        # which is a real choice. A missing key is caught above instead.
        seats, seat_err = _parse_seats(data.get('cohort_seats'), required=False)
        if seat_err:
            return jsonify(response={'message': seat_err}, status=400, bool=False)

        try:
            # ── SP: sp_achiever_set_cohort_seats ─────────────────────────────
            call_proc_one('sp_achiever_set_cohort_seats', achiever_id, seats, actor)
            db.session.commit()
            return jsonify(response={
                'message': (f'New cohorts will have {seats} seats.' if seats
                            else 'New cohorts will be uncapped.'),
                'cohort_seat_allocation': seats,
            }, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            msg = str(e)
            if 'ACHIEVER_NOT_FOUND' in msg:
                return jsonify(response={'message': 'Achiever not found.'},
                               status=404, bool=False)
            if 'SEATS_MUST_BE_POSITIVE' in msg:
                return jsonify(response={'message': 'Seats must be at least 1.'},
                               status=400, bool=False)
            logger.error(f"cohort seat allocation failed for {achiever_id}: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id},
                           status=500, bool=False)


@ns.route('/achiever-lifecycle/<string:achiever_id>/probation')
class ProbationReview(Resource):

    @jwt_required()
    def get(self, achiever_id):
        """The three demo sessions and what each student said about them."""
        _, err = _guard()
        if err:
            return err
        try:
            payload = D.review_payload(achiever_id)
            return jsonify(response=payload, status=200, bool=True)
        except Exception as e:
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id},
                           status=500, bool=False)

    @jwt_required()
    def post(self, achiever_id):
        """The probation verdict: approve, extend, or reject.

        Approving also sets the session rate — achievers do not price
        themselves, so activating without a rate would leave them live and
        unbookable.
        """
        actor, err = _guard()
        if err:
            return err
        data = request.get_json() or {}
        decision = (data.get('decision') or '').strip().lower()
        reason = (data.get('reason') or '').strip()

        if decision not in ('approve', 'extend', 'reject', 'set_demos'):
            return jsonify(response={
                'message': "decision must be approve, extend, reject or set_demos.",
            }, status=400, bool=False)
        if not reason:
            return jsonify(response={'message': 'A reason is required.'}, status=400, bool=False)

        try:
            if decision == 'approve':
                row = db.session.execute(text(
                    "SELECT IFNULL(demo_sessions_done, 0), "
                    "       IFNULL(demo_sessions_required, 3) FROM achievers WHERE id = :i"
                ), {'i': achiever_id}).fetchone()
                done = int(row[0] or 0) if row else 0
                needed = int(row[1] or D.DEFAULT_REQUIRED) if row else D.DEFAULT_REQUIRED
                if done < needed:
                    return jsonify(response={
                        'message': (f'{done} of {needed} demo sessions are done. '
                                    'Approve once they are complete, or ask for more.'),
                        'demos_done': done,
                        'demos_required': needed,
                    }, status=409, bool=False)

                # Commission, not a session price. What varies between achievers is
                # the platform's share -- negotiated per person and versioned in
                # commission_rules, so an order priced last month can still be
                # explained by the rule that was live then.
                percent = data.get('commission_percent')
                if percent is None:
                    return jsonify(response={
                        'message': 'A commission percentage is required when approving.',
                    }, status=400, bool=False)
                try:
                    percent = float(percent)
                except (TypeError, ValueError):
                    return jsonify(response={'message': 'commission_percent must be a number.'},
                                   status=400, bool=False)
                if not (0 <= percent <= 100):
                    return jsonify(response={'message': 'Commission must be between 0 and 100.'},
                                   status=400, bool=False)

                # ── SP: sp_commission_set_for_achiever — closes the old rule and
                # opens a new one, same procedure the commission panel uses. ────
                call_proc_one('sp_commission_set_for_achiever', achiever_id,
                              round(percent / 100.0, 4),
                              f'Set on approval out of probation: {reason}'[:255],
                              get_jwt_identity())
                db.session.commit()
                tell_achiever(
                    achiever_id, 'You are now a verified SKOVO achiever',
                    'An admin has reviewed your demo sessions and approved you out '
                    'of probation.\n\nYou can now take paid sessions and create paid '
                    f'cohorts. SKOVO keeps {percent}% of each one.\n\n'
                    f'Reason given: {reason}',
                    button_url=achiever_url(PORTAL_PATH),
                    button_label='Open your portal', type='system')
                return _state_change(achiever_id, 'active', reason)

            if decision == 'set_demos':
                # Set the target, rather than add to it — and send them back to
                # demos from wherever they are.
                #
                # Two gaps this closes, both of which had no answer at all:
                #
                #   1. `extend` only ever computed needed_now + extra, so a demo
                #      target could go up and never down. An achiever sitting on
                #      13 because someone pressed "ask for more" four times had
                #      no way back to 3.
                #   2. `extend` never wrote `state`, and its control was
                #      probation-only. So an ACTIVE achiever whose reviews had
                #      gone bad after ten cohorts could not be put back on demo
                #      classes by any route. Calling extend on them would have
                #      raised the target and left them active and still
                #      charging, which is worse than refusing.
                #
                # Deliberately NOT a cascade. Suspension already exists for
                # "stop everything now" and carries the refund logic. This is
                # "prove yourself again": probation removes `can_charge`, so no
                # NEW paid cohort or booking can be created, while the cohorts
                # and confirmed sessions students have already paid for run to
                # completion. Reviewers punish the achiever, not the students.
                target = data.get('demos_required')
                try:
                    target = int(target)
                except (TypeError, ValueError):
                    target = None
                if target is None or target < 1:
                    return jsonify(response={
                        'message': 'Say how many demos they need — a whole number, at least 1.',
                    }, status=400, bool=False)

                # One procedure, not an UPDATE here and a state change there.
                # Split across two statements the demote can half-apply: the
                # target lands, the transition fails, and the achiever is left
                # active with a target nobody asked for.
                # -- SP: sp_achiever_set_demo_target -------------------------
                try:
                    row = call_proc_one('sp_achiever_set_demo_target', achiever_id,
                                        target, reason[:255], actor) or {}
                except Exception as e:
                    msg = str(e)
                    if 'ACHIEVER_NOT_FOUND' in msg:
                        return jsonify(response={'message': 'Achiever not found.'},
                                       status=404, bool=False)
                    if 'ACHIEVER_BANNED' in msg:
                        return jsonify(response={
                            'message': 'This achiever is banned. Lift the ban first.',
                        }, status=400, bool=False)
                    raise
                db.session.commit()

                was_state = row.get('from_state')
                done_now = int(row.get('demos_done') or 0)
                logger.info("achiever %s demo target set to %s (was %s)",
                            achiever_id, target, was_state)
                tell_achiever(
                    achiever_id,
                    ('You have been asked to run demo sessions again'
                     if was_state != 'probation' else 'Your demo target has changed'),
                    f'An admin has set your demo target to {target} completed '
                    f'session{"" if target == 1 else "s"}. You have {done_now} so far.\n\n'
                    f'Reason given: {reason}',
                    # No email for a number moving on a screen they are already
                    # watching; the bell is the right weight for this one.
                    email=(was_state != 'probation'),
                    button_url=achiever_url(PORTAL_PATH),
                    button_label='Open your portal', type='system')
                return jsonify(response={
                    'message': (f'Sent back to demos - they need {target} completed '
                                f'sessions ({done_now} done so far).'
                                if was_state != 'probation' else
                                f'They now need {target} completed demo sessions '
                                f'({done_now} done so far).'),
                    'state': 'probation',
                    'demos_done': done_now,
                    'demos_required': target,
                }, status=200, bool=True)

            if decision == 'extend':
                extra = data.get('extra_demos')
                try:
                    extra = int(extra)
                except (TypeError, ValueError):
                    extra = None
                # Any positive number. EXTRA_ALLOWED restricted this to 1, 2 or 3 and
                # MAX_REQUIRED capped the total at 12; both are gone. How many demos a
                # particular achiever should run is a judgement about that person, made
                # by the admin who has read their reviews - not a constant in a file.
                if extra is None or extra < 1:
                    return jsonify(response={
                        'message': 'Say how many more demos — a whole number, at least 1.',
                    }, status=400, bool=False)

                current = db.session.execute(text(
                    "SELECT IFNULL(demo_sessions_required, 3), IFNULL(demo_sessions_done, 0) "
                    "  FROM achievers WHERE id = :i"
                ), {'i': achiever_id}).fetchone()
                needed_now = int(current[0] or D.DEFAULT_REQUIRED) if current else D.DEFAULT_REQUIRED
                done_now = int(current[1] or 0) if current else 0
                needed_next = needed_now + extra
                # No ceiling. MAX_REQUIRED used to cap the target at 12, which meant an
                # admin who wanted more had no way to say so - the request was refused
                # with a number nobody had chosen. How many demos a particular achiever
                # should run is a judgement about that person, and the admin making it
                # is the one who has read their reviews.

                # Stay in probation. Raising the target and clearing the
                # submission stamp puts them back in collecting, not ready.
                db.session.execute(text(
                    "UPDATE achievers SET demo_sessions_required = :n, "
                    "demo_submitted_at = NULL, state_reason = :r, "
                    "updated_at = UTC_TIMESTAMP() WHERE id = :i"
                ), {'n': needed_next, 'r': reason, 'i': achiever_id})
                db.session.commit()
                tell_achiever(
                    achiever_id, 'An admin has asked for more demo sessions',
                    f'Your demo target has gone from {needed_now} to {needed_next} '
                    f'completed sessions. You have {done_now} so far.\n\n'
                    f'Reason given: {reason}',
                    button_url=achiever_url(PORTAL_PATH),
                    button_label='Open your portal', type='system')
                return jsonify(response={
                    'message': (f'Asked for {extra} more. They now need {needed_next} '
                                f'completed demos ({done_now} done so far).'),
                    'state': 'probation',
                    'demos_done': done_now,
                    'demos_required': needed_next,
                    'extra_demos': extra,
                }, status=200, bool=True)

            tell_achiever(
                achiever_id, 'Your probation review did not pass',
                'An admin has reviewed your demo sessions and sent your account '
                f'back for review.\n\nReason given: {reason}',
                button_label='View your application', type='system')
            return _state_change(achiever_id, 'pending', reason)

        except Exception as e:
            db.session.rollback()
            logger.error(f"probation decision failed for {achiever_id}: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id},
                           status=500, bool=False)


@ns.route('/achiever-lifecycle/<string:achiever_id>/suspend')
class SuspendAchiever(Resource):

    @jwt_required()
    def post(self, achiever_id):
        """Suspend for a fixed period, or indefinitely.

        A dated suspension lifts itself. That is what makes admins willing to
        use one — without the auto-lift every suspension becomes something
        someone must remember, so in practice they reach for a permanent ban or
        do nothing at all.
        """
        data = request.get_json() or {}
        preset = (data.get('period') or 'indefinite').strip().lower()
        reason = (data.get('reason') or '').strip()

        if preset not in SUSPENSION_PRESETS and not data.get('until'):
            return jsonify(response={
                'message': "period must be one of 1m, 4m, 6m, indefinite — or pass an explicit 'until' date.",
            }, status=400, bool=False)

        until = None
        if data.get('until'):
            try:
                until = datetime.datetime.fromisoformat(str(data['until']).replace('Z', ''))
            except ValueError:
                return jsonify(response={'message': "'until' must be an ISO date."},
                               status=400, bool=False)
        else:
            days = SUSPENSION_PRESETS.get(preset)
            if days:
                until = datetime.datetime.utcnow() + datetime.timedelta(days=days)

        return _state_change(achiever_id, 'suspended', reason, until)


@ns.route('/achiever-lifecycle/<string:achiever_id>/reinstate')
class ReinstateAchiever(Resource):

    @jwt_required()
    def post(self, achiever_id):
        """Lift a suspension early, back to the state they were suspended from.
        
        NOT unconditionally 'active'. That is the same mistake the nightly lift
        job made: a probation achiever reinstated straight to active skips the
        demo review and the commission, which is the whole of what probation is
        for. achiever_state_events carries where they came from, so the manual
        lift and the automatic one now agree.
        
        Falls back to 'pending' when the record cannot say, for the reason it
        does there too: a wrongly demoted achiever is one click to restore, a
        wrongly promoted one is an unvetted person taking students' money.
        """
        data = request.get_json() or {}
        prior = db.session.execute(text(
            "SELECT from_state FROM achiever_state_events "
            " WHERE achiever_id = :i AND to_state = 'suspended' "
            "   AND from_state IN ('pending', 'probation', 'active') "
            " ORDER BY created_at DESC LIMIT 1"
        ), {'i': achiever_id}).scalar()
        return _state_change(achiever_id, prior or 'pending',
                             (data.get('reason') or 'Reinstated by admin').strip())


@ns.route('/achiever-lifecycle/<string:achiever_id>/ban')
class BanAchiever(Resource):

    @jwt_required()
    def post(self, achiever_id):
        """Permanent, and irreversible through the ordinary state machine.

        Earnings already accrued remain claimable. That money is owed for work
        already delivered and sitting in the platform's account only because
        SKOVO is the aggregator — withholding it because of a ban is a dispute
        the platform would lose.
        """
        data = request.get_json() or {}
        reason = (data.get('reason') or '').strip()
        if not reason:
            return jsonify(response={'message': 'A reason is required to ban an achiever.'},
                           status=400, bool=False)
        return _state_change(achiever_id, 'banned', reason)


@ns.route('/achiever-lifecycle/<string:achiever_id>/unban')
class UnbanAchiever(Resource):

    @jwt_required()
    def post(self, achiever_id):
        """Lift a ban. BANNED -> whatever they were before the ban.

        Its own route and its own procedure, because sp_achiever_set_state
        refuses to leave 'banned' -- deliberately, so no ordinary state change
        can undo a ban by accident. Undoing one has to be asked for by name.

        Lifting a ban is a reversal, so it puts them back where the ban found
        them: an achiever banned mid-probation returns to probation, one banned
        while active returns to active. This used to land everyone on 'pending',
        which quietly cost them their place -- the second approval that then had
        to happen was also what reset their demo target. The prior state is read
        from the ban's own event row, not guessed. Only a ban with no recorded
        history falls back to review.
        """
        actor, err = _guard()
        if err:
            return err

        data = request.get_json() or {}
        reason = (data.get('reason') or '').strip()
        if not reason:
            return jsonify(response={'message': 'A reason is required to lift a ban.'},
                           status=400, bool=False)

        try:
            # ── SP: sp_achiever_unban ────────────────────────────────────────
            row = call_proc_one('sp_achiever_unban', achiever_id, reason, actor, 'admin') or {}
            db.session.commit()
            restored = row.get('to_state') or 'pending'
            logger.info(f"achiever {achiever_id}: banned -> {restored} (unban) by {actor}")
            if restored == 'active':
                # Same as _state_change: an achiever friend who is active again
                # may complete a referral that was waiting on approval.
                try:
                    from portal.helpers.referral_rewards import on_achiever_active
                    on_achiever_active(achiever_id)
                except Exception as pay_err:
                    logger.error(f"referral pay after unban failed for {achiever_id}: {pay_err}")
            tell_achiever(
                achiever_id, 'Your SKOVO account has been reopened',
                'An admin has lifted the closure on your account.\n\n'
                f'Reason given: {reason}\n\n'
                + ('You are back on probation, where you were before.'
                   if restored == 'probation' else
                   'You are active again and can take students.'
                   if restored == 'active' else
                   'Your application is back in the review queue.')
                + ' Your documents and agreements are as you left them.',
                type='system')
            # The message names the state they actually landed in. Saying
            # 'pending' unconditionally was wrong the moment the procedure
            # started restoring the prior one.
            wording = {
                'pending':   'Ban lifted. They are back in the review queue as pending.',
                'probation': 'Ban lifted. They are back on probation, where the ban found them.',
                'active':    'Ban lifted. They are active again and can take students.',
                'suspended': 'Ban lifted. They return to the suspension that was in place before it.',
            }
            return jsonify(response={
                'message': wording.get(restored,
                                       f'Ban lifted. They are back to {restored}.'),
                'from_state': row.get('from_state'),
                'to_state': restored,
            }, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            msg = str(e)
            if 'NOT_BANNED' in msg:
                return jsonify(response={'message': 'This achiever is not banned.'},
                               status=409, bool=False)
            if 'ACHIEVER_NOT_FOUND' in msg:
                return jsonify(response={'message': 'Achiever not found.'},
                               status=404, bool=False)
            logger.error(f"unban failed for {achiever_id}: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id},
                           status=500, bool=False)


@ns.route('/achiever-lifecycle/<string:achiever_id>/dossier')
class AchieverDossier(Resource):

    @jwt_required()
    def get(self, achiever_id):
        """Everything needed to decide on an application, in one call.

        Approval refuses until every required document is accepted, so the
        admin needs to see and act on the documents before the Approve button
        can do anything. Fetching them separately from the queue keeps the
        queue cheap — most rows are never opened.
        """
        _, err = _guard()
        if err:
            return err
        try:
            # ── SP: sp_achievers_get + sp_achiever_documents_list ────────────
            a = call_proc_one('sp_achievers_get', achiever_id)
            if not a:
                return jsonify(response={'message': 'Achiever not found.'}, status=404, bool=False)

            docs = call_proc('sp_achiever_documents_list', achiever_id) or []
            # Same query the approval guard runs, so the screen and the guard
            # cannot disagree about whether this application is ready.
            # ── SP: sp_achiever_missing_documents ────────────────────────────
            missing = call_proc('sp_achiever_missing_documents', achiever_id) or []
            # What a reviewer has asked this achiever for beyond the standard
            # set. An outstanding ask blocks approval too -- having requested
            # something and then approved without it makes the request theatre.
            # ── SP: sp_achiever_doc_requests_list ────────────────────────────
            requests = call_proc('sp_achiever_doc_requests_list', achiever_id) or []
            unfulfilled = [r for r in requests if not r.get('fulfilled')]

            return jsonify(response={
                'achiever': {
                    'id': a.get('id'),
                    'full_name': a.get('full_name'),
                    # What the achiever typed, for the reviewer to match with the ID.
                    **_identity_claims(a.get('id')),
                    'email': a.get('email'),
                    'state': a.get('state'),
                    'state_reason': a.get('state_reason'),
                    # NULL means indefinite, and the case file has to be able to
                    # say which kind of suspension this is: a dated one lifts
                    # itself overnight, an indefinite one waits for an admin
                    # forever. Without this field both render as 'Suspended'.
                    'suspended_until': (serialize_datetime(a['suspended_until'])
                                        if a.get('suspended_until') else None),
                    # Where a ban lift would put them. Read from the ban's own
                    # event row, the same place sp_achiever_unban reads it, so
                    # the dialog can name the state instead of the admin having
                    # to perform the action to find out. Only asked for while
                    # banned; NULL for everyone else.
                    'pre_ban_state': (db.session.execute(text(
                        "SELECT from_state FROM achiever_state_events "
                        " WHERE achiever_id = :i AND to_state = 'banned' "
                        "   AND from_state <> 'banned' "
                        " ORDER BY created_at DESC, id DESC LIMIT 1"),
                        {'i': achiever_id}).scalar()
                        if a.get('state') == 'banned' else None),
                    'designation': a.get('designation'),
                    'company': a.get('company'),
                    # The reviewer's job is to check the documents against what
                    # the profile claims, and none of the claims were being sent.
                    # LinkedIn especially: it is required of every achiever
                    # precisely because it is the one field an admin can verify
                    # independently, and it was not on the screen that verifies.
                    'linkedin_url': a.get('linkedin_url'),
                    'bio': a.get('bio'),
                    'phone': a.get('phone'),
                    'profile_image_url': a.get('profile_image_url') or a.get('avatar_url'),
                    'registered_at': (serialize_datetime(a['created_at'])
                                      if a.get('created_at') else None),
                    # The two dates the detail view had no way to show.
                    #
                    # `application_status` on its own reads as a contradiction
                    # once someone is past pending: an achiever on probation
                    # still says "submitted", because approving the application
                    # moves `state` and leaves that column alone. A date says
                    # the same fact without arguing with the badge beside it.
                    'application_submitted_at': (
                        serialize_datetime(a['application_submitted_at'])
                        if a.get('application_submitted_at') else None),
                    # When the current state was set, and by whom. The reason
                    # was already shown; an unattributed, undated sentence is the
                    # half of an audit trail that cannot answer "who decided it".
                    'state_changed_at': (serialize_datetime(a['state_changed_at'])
                                         if a.get('state_changed_at') else None),
                    'state_changed_by': _actor_name(a.get('state_changed_by')),
                    # NULL is a real answer, not a missing one: an achiever
                    # approved weeks ago who has never opened the portal is a
                    # different problem from one who has gone quiet, and the two
                    # are indistinguishable without this.
                    'last_login_at': (serialize_datetime(a['last_login_at'])
                                      if a.get('last_login_at') else None),
                    'bgv_status': a.get('bgv_status'),
                    'bgv_ref': a.get('bgv_ref'),
                    # The lifecycle numbers. sp_achievers_get is SELECT *, so
                    # these were always on the row and simply never mapped out.
                    # The Achievers detail view needs them to show the same
                    # record this screen does, without a second round trip.
                    'demos_done': a.get('demo_sessions_done') or 0,
                    'demos_required': a.get('demo_sessions_required') or 3,
                    'cohort_seat_allocation': a.get('cohort_seat_allocation'),
                    # The other three status columns. The review screens read
                    # only `state`, so an admin could not see that a background
                    # check was never closed or that the account itself was
                    # switched off — four independent fields, one of them shown.
                    'application_status': a.get('application_status'),
                    'account_status': a.get('status'),
                    # Payout details, read-only here: the achiever enters these
                    # themselves on their Earnings screen, beside the payout
                    # request. Admin reads, achiever writes.
                    'payout_account_name': a.get('payout_account_name'),
                    'payout_account_number': a.get('payout_account_number'),
                    'payout_ifsc': a.get('payout_ifsc'),
                    'payout_upi': a.get('payout_upi'),
                },
                'documents': [{
                    'id': d.get('id'),
                    'doc_type': d.get('doc_type'),
                    'file_url': d.get('file_url'),
                    'original_name': d.get('original_name'),
                    'claim': d.get('claim'),
                    'status': d.get('status'),
                    'review_note': d.get('review_note'),
                    # The label master data holds for this type, resolved here so
                    # every screen says the same words. Without it a client is
                    # left rendering the raw column value -- "achievement_proof"
                    # -- which is the database's name for the thing, not the
                    # platform's.
                    'label': _doc_label(d.get('doc_type')),
                    'uploaded_at': serialize_datetime(d['created_at']) if d.get('created_at') else None,
                    # When a reviewer decided, as distinct from when it arrived.
                    # With two documents of one type -- a rejection and the
                    # replacement -- the upload dates alone cannot say which
                    # decision came first.
                    'reviewed_at': (serialize_datetime(d['reviewed_at'])
                                    if d.get('reviewed_at') else None),
                } for d in docs],
                # What still blocks approval, named. "Approve is greyed out" with
                # no reason is the thing an admin escalates.
                # The picker the reviewer chooses from when asking for
                # something. Master data, so it matches what the achiever's own
                # upload screen offers -- asking for a type they cannot select
                # would be a slot they can never fill.
                'doc_types': [{
                    'value': t.get('value'),
                    'label': t.get('label'),
                    'category': t.get('category'),
                } for t in (T.doc_types() or [])],
                'document_requests': [{
                    'id': r.get('id'),
                    'doc_type': r.get('doc_type'),
                    'label': r.get('label'),
                    'note': r.get('note'),
                    'fulfilled': bool(r.get('fulfilled')),
                    'requested_at': (serialize_datetime(r['created_at'])
                                     if r.get('created_at') else None),
                } for r in requests],
                'missing_required': [{'value': m.get('value'), 'label': m.get('label')}
                                     for m in missing],
                # Only once the achiever has clicked Submit for review.
                'submitted': (a.get('application_status') or 'draft') != 'draft',
                'can_approve': (len(missing) == 0 and len(unfulfilled) == 0
                                and (a.get('application_status') or 'draft') != 'draft'),
                # What this achiever agreed to, and which version of it.
                #
                # The achiever's own screen has shown "Accepted 21 Sept 2026
                # . policy v1" against each agreement since the ledger was
                # built, and stores the version, timestamp and IP for exactly
                # the moment somebody disputes what they signed up to. No
                # admin screen read any of it. The one person who needs to
                # answer "did they accept the commission terms, and which
                # ones" could not see the answer the database already had.
                # ── SP: sp_achiever_agreement_status ────────────────────
                'agreements': [{
                    'value': g.get('value'),
                    'label': g.get('label'),
                    'is_required': bool(g.get('is_required')),
                    'accepted': bool(g.get('accepted')),
                    'accepted_version': g.get('accepted_version'),
                    'current_version': g.get('current_version'),
                    'stale': bool(g.get('stale')),
                    'accepted_at': (serialize_datetime(g['accepted_at'])
                                    if g.get('accepted_at') else None),
                } for g in (T.agreement_status(achiever_id) or [])],
                # Every state this achiever has been in, newest first.
                #
                # The panel showed `state_reason`, one column overwritten on each
                # change, so an achiever suspended three times displayed only the
                # third reason -- and the pattern, which is the thing worth
                # acting on, was the part you could not see.
                #
                # Served with the dossier rather than behind its own request: it
                # is at most 100 short rows for one achiever, and a tab that has
                # to fetch before it can render is a tab that flashes empty.
                # ── SP: sp_achiever_state_history ────────────────────────────
                'state_history': [{
                    'id': h.get('id'),
                    'from_state': h.get('from_state'),
                    'to_state': h.get('to_state'),
                    'reason': h.get('reason'),
                    'actor_name': h.get('actor_name'),
                    'actor_role': h.get('actor_role'),
                    'suspended_until': (serialize_datetime(h['suspended_until'])
                                        if h.get('suspended_until') else None),
                    'at': (serialize_datetime(h['created_at'])
                           if h.get('created_at') else None),
                } for h in (call_proc('sp_achiever_state_history', achiever_id) or [])],
            }, status=200, bool=True)
        except Exception as e:
            error_id = capture_error(e)
            logger.error(f"dossier failed for {achiever_id}: {e}")
            return jsonify(response={'message': 'Could not load this application.',
                                     'error_id': error_id}, status=500, bool=False)


@ns.route('/achiever-lifecycle/<string:achiever_id>/document-requests')
class AchieverDocumentRequests(Resource):
    """Ask an achiever for a document that is not part of the standard set.

    Accept and Reject both need the document to already be there. This is how a
    reviewer asks for one that is not -- an employment proof behind a job title,
    a second ID, a clearer copy of something -- without rejecting the whole
    application or approving on evidence they are not satisfied with.
    """

    @jwt_required()
    def post(self, achiever_id):
        actor, err = _guard()
        if err:
            return err
        try:
            data = request.get_json() or {}
            doc_type = (data.get('doc_type') or '').strip().lower()
            note = (data.get('note') or '').strip()

            if not doc_type:
                return jsonify(response={'message': 'Pick which document you need.'},
                               status=400, bool=False)
            # The note is what the achiever reads to know what to send, so it is
            # required for the same reason a rejection reason is.
            if not note:
                return jsonify(response={'message': 'Say what you need and why.'},
                               status=400, bool=False)

            # ── SP: sp_achiever_doc_request_add ──────────────────────────────
            res = call_proc_one('sp_achiever_doc_request_add',
                                str(uuid.uuid4()), achiever_id, doc_type, note, actor) or {}
            db.session.commit()

            if not res.get('ok'):
                reason = res.get('reason')
                return jsonify(response={
                    'message': {
                        'unknown_doc_type': 'That document type is not one we accept.',
                        'already_requested': 'You have already asked for that document.',
                    }.get(reason, 'Could not record that request.'),
                    'reason': reason,
                }, status=409, bool=False)

            logger.info(f"Admin {actor} requested {doc_type} from achiever {achiever_id}")
            label = next((t.get('label') for t in (T.doc_types() or [])
                          if t.get('value') == doc_type), doc_type.replace('_', ' '))
            tell_achiever(
                achiever_id, 'SKOVO needs another document from you',
                f'A reviewer has asked you to upload: {label}.\n\n'
                f'What they said: {note}\n\n'
                'Your application stays where it is until this arrives.',
                button_label='Upload it now', type='system')
            return jsonify(response={'message': 'Requested. The achiever can see it now.'},
                           status=201, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id},
                           status=500, bool=False)


@ns.route('/achiever-lifecycle/<string:achiever_id>/document-requests/<string:request_id>')
class AchieverDocumentRequestItem(Resource):
    @jwt_required()
    def delete(self, achiever_id, request_id):
        """Withdraw a request. Cancelled, not deleted -- the achiever may have
        already seen it, and it should be answerable why it went away."""
        _, err = _guard()
        if err:
            return err
        try:
            # ── SP: sp_achiever_doc_request_cancel ───────────────────────────
            res = call_proc_one('sp_achiever_doc_request_cancel', request_id) or {}
            db.session.commit()
            if not res.get('cancelled'):
                return jsonify(response={'message': 'That request is not open.'},
                               status=404, bool=False)
            return jsonify(response={'message': 'Request withdrawn.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id},
                           status=500, bool=False)



def _identity_claims(achiever_id):
    """Date of birth and gender as the achiever entered them (never shown to students)."""
    try:
        r = db.session.execute(text(
            "SELECT a.date_of_birth, a.gender, g.label FROM achievers a"
            " LEFT JOIN master_gender g ON g.value = a.gender WHERE a.id = :i"), {'i': achiever_id}).fetchone()
        return {'date_of_birth': r[0].isoformat() if r and r[0] else None,
                'gender': (r[2] or r[1]) if r else None}
    except Exception:
        return {'date_of_birth': None, 'gender': None}
