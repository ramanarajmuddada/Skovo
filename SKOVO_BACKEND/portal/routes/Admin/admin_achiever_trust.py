"""
Admin: achiever trust review — the queue that has evidence in it.

`PATCH /achievers/<id>/verify` (admin_achievers.py) still exists as a shortcut
and now delegates to sp_achiever_trust_set — verify means L2, unverify means L0
with the full cascade. These routes are the considered path, and they differ in
three ways that matter:

  1. The reviewer sees DOCUMENTS, not a self-typed bio.
  2. Approval names a TIER, so "we checked their ID" and "they may sit alone
     with a 14-year-old" stop being the same decision.
  3. Demotion CASCADES. The old flip left a suspended achiever's live cohort of
     40 students and every confirmed session running.

FOUR EYES: promotion to L3 — the tier that unlocks 14-17 students — is refused
here and lives on the super-admin route. Whoever collects the evidence must not
also be the one who clears someone to mentor minors.

Refunds and notifications are fired from Python after the SP commits, per the
house rule that side effects stay out of SQL.
"""
from portal.helpers.error_capture import capture_error
import datetime
import threading
import uuid

from flask import jsonify, request
from flask_restx import Resource, reqparse
from flask_jwt_extended import jwt_required, get_jwt_identity

from portal.models import db
from portal.helpers.sp import call_proc, call_proc_one
from portal.helpers.admin_auth import can, AREA_USERS
from portal.helpers.achiever_notify import tell_achiever
from portal.helpers import trust as T
from . import ns, logger

queue_parser = reqparse.RequestParser()
queue_parser.add_argument('status', type=str, location='args', required=False)
queue_parser.add_argument('page', type=int, location='args', required=False, default=1)
queue_parser.add_argument('per_page', type=int, location='args', required=False, default=25)

reject_parser = reqparse.RequestParser()
reject_parser.add_argument('reason', type=str, location='json', required=True)

doc_parser = reqparse.RequestParser()
doc_parser.add_argument('status', type=str, location='json', required=True)
doc_parser.add_argument('note', type=str, location='json', required=False)

bgv_parser = reqparse.RequestParser()
bgv_parser.add_argument('vendor_ref', type=str, location='json', required=False)


def _guard():
    """None when the caller may act on user/KYC records, else a 403."""
    if not can(AREA_USERS):
        return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
    return None


def _iso(v):
    return v.isoformat() if v else None


def _send_emails_async(messages):
    """Fire cascade emails off the request thread.

    Each send_email() attempt can cost up to ~15s (SendGrid HTTP timeout, then
    an SMTP fallback), so sending them inline made the admin's request scale
    with the number of affected students — six enrolments already blew a 10s
    client timeout, and an achiever with a full cohort would have hung the
    browser outright. The in-app notification is the durable record and is
    written synchronously; email is the nicety and goes here.

    send_email() reads only os.environ, so this needs no app context.
    """
    if not messages:
        return

    def _run():
        from portal.helpers.email_template import send_email
        for to, subject, html in messages:
            try:
                send_email(to, subject, html)
            except Exception as e:
                logger.warning(f"cascade email to {to} failed: {e}")

    threading.Thread(target=_run, name='trust-cascade-mail', daemon=True).start()


def notify_cascade(achiever_id, since, achiever_name):
    """Tell everyone a demotion just cancelled on, and flag the refunds owed.

    Deliberately best-effort: a notification failure must never leave the tier
    change half-applied, because the tier change is the safety-critical half.
    Returns the number of people an in-app notification was written for; the
    emails follow on a background thread.
    """
    from portal.helpers.notifications import notify_user
    from portal.helpers.email_template import simple_email_body

    try:
        rows = call_proc('sp_achiever_cascade_since', achiever_id, since) or []
    except Exception as e:
        logger.error(f"cascade lookup failed for {achiever_id}: {e}")
        return 0

    told = 0
    outbox = []
    for r in rows:
        kind = 'session' if r.get('kind') == 'session' else 'cohort'
        refunded = (r.get('payment_status') == 'refunded')
        body = (f"Your {kind} with {achiever_name} has been cancelled because "
                f"their verification status changed.")
        if refunded:
            body += " Your payment is being refunded — it reaches your account in 5-7 working days."
        try:
            notify_user(r.get('user_id'), f'{kind.title()} cancelled', body,
                        type='system', reference_type=kind, reference_id=r.get('ref_id'))
        except Exception:
            pass
        if r.get('email'):
            outbox.append((r['email'], f'SKOVO — your {kind} was cancelled',
                           simple_email_body(f'Your {kind} was cancelled', body)))
        # Refunds are money movement, not a notification concern. The
        # row is already marked 'refunded' in the DB; log the payment id so
        # finance can reconcile, and leave the API call to the payouts flow.
        if refunded and r.get('payment_id'):
            logger.warning(f"REFUND DUE payment_id={r['payment_id']} "
                           f"amount={r.get('amount')} user={r.get('user_id')} "
                           f"reason=achiever_trust_demotion achiever={achiever_id}")
        told += 1
    try:
        db.session.commit()
    except Exception:
        db.session.rollback()

    _send_emails_async(outbox)
    return told


@ns.route('/achiever-trust/queue')
class AchieverReviewQueue(Resource):
    @ns.doc(description="Admin: achiever applications awaiting review, with evidence counts.")
    @jwt_required()
    def get(self):
        try:
            err = _guard()
            if err:
                return err
            args = queue_parser.parse_args()
            page = max(1, args.get('page') or 1)
            per_page = min(100, max(1, args.get('per_page') or 25))

            # ── SP: sp_achiever_review_queue — evidence counts come back with
            # the row, so the list itself shows whether there is anything to
            # look at before the reviewer opens it. ──────────────────────────
            rows = call_proc('sp_achiever_review_queue',
                             args.get('status') or None, per_page, (page - 1) * per_page) or []
            return jsonify(response={
                'achievers': [{
                    'id': r.get('id'),
                    'full_name': r.get('full_name'),
                    'email': r.get('email'),
                    'designation': r.get('designation'),
                    'company': r.get('company'),
                    'linkedin_url': r.get('linkedin_url'),
                    'bio': r.get('bio'),
                    'state': r.get('state'),
                    'tier_label': r.get('tier_label'),
                    'application_status': r.get('application_status'),
                    'submitted_at': _iso(r.get('application_submitted_at')),
                    'rejection_reason': r.get('rejection_reason'),
                    'bgv_status': r.get('bgv_status'),
                    'bgv_expires_at': _iso(r.get('bgv_expires_at')),
                    'session_rate': float(r.get('session_rate') or 0),
                    # None, not 0: "no cap set" and "zero seats" are different
                    # answers and the screen has to be able to say which.
                    'cohort_seat_allocation': (
                        int(r['cohort_seat_allocation'])
                        if r.get('cohort_seat_allocation') is not None else None),
                    'doc_count': r.get('doc_count') or 0,
                    'doc_pending': r.get('doc_pending') or 0,
                    'agreements_signed': r.get('agreements_signed') or 0,
                } for r in rows],
                'page': page,
                'per_page': per_page,
            }, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id},
                           status=500, bool=False)


@ns.route('/achiever-trust/<string:achiever_id>')
class AchieverDossier(Resource):
    @ns.doc(description="Admin: one achiever's full dossier — claim, evidence, agreements, tier history.")
    @jwt_required()
    def get(self, achiever_id):
        try:
            err = _guard()
            if err:
                return err

            # sp_achievers_get, not the tier-joined lookup: capability comes
            # from `state` now, and the tier join returned columns that are
            # no longer maintained.
            t = call_proc_one('sp_achievers_get', achiever_id)
            if not t:
                return jsonify(response={'message': 'Achiever not found.'}, status=404, bool=False)

            docs = call_proc('sp_achiever_documents_list', achiever_id) or []
            agreements = call_proc('sp_achiever_agreements_list', achiever_id) or []
            events = call_proc('sp_achiever_trust_events_list', achiever_id, 50) or []

            return jsonify(response={
                'achiever': {
                    'id': t.get('id'),
                    'full_name': t.get('full_name'),
                    'email': t.get('email'),
                    'is_active': bool(t.get('is_active')),
                    'state': t.get('state'),
                    'tier_code': t.get('tier_code'),
                    'tier_label': t.get('tier_label'),
                    'application_status': t.get('application_status'),
                    'submitted_at': _iso(t.get('application_submitted_at')),
                    'rejection_reason': t.get('rejection_reason'),
                    'session_rate': float(t.get('session_rate') or 0),
                    'max_session_rate': float(t.get('max_session_rate') or 0),
                    'bgv_status': t.get('bgv_status'),
                    'bgv_ref': t.get('bgv_ref'),
                    'bgv_cleared_at': _iso(t.get('bgv_cleared_at')),
                    'bgv_expires_at': _iso(t.get('bgv_expires_at')),
                },
                # The evidence, next to the claim it is supposed to support.
                'documents': [{
                    'id': d.get('id'),
                    'doc_type': d.get('doc_type'),
                    'file_url': d.get('file_url'),
                    'original_name': d.get('original_name'),
                    'claim': d.get('claim'),
                    'status': d.get('status'),
                    'review_note': d.get('review_note'),
                    'reviewed_at': _iso(d.get('reviewed_at')),
                    'created_at': _iso(d.get('created_at')),
                } for d in docs],
                'agreements': [{
                    'type': a.get('agreement_type'),
                    'policy_version': a.get('policy_version'),
                    'granted': bool(a.get('granted')),
                    'created_at': _iso(a.get('created_at')),
                } for a in agreements],
                'history': [{
                    'from_level': e.get('from_level'),
                    'to_level': e.get('to_level'),
                    'action': e.get('action'),
                    'reason': e.get('reason'),
                    'actor_role': e.get('actor_role'),
                    'cascade_note': e.get('cascade_note'),
                    'created_at': _iso(e.get('created_at')),
                } for e in events],
                # Labels for the evidence list. Master data, so the reviewer
                # sees whatever Admin > Masters currently defines rather than a
                # copy frozen into the React file.
                'doc_types': [{'value': t.get('value'), 'label': t.get('label'),
                               'category': t.get('category')}
                              for t in T.doc_types(active_only=False)],
            }, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id},
                           status=500, bool=False)


# ─────────────────────────────────────────────────────────────────────────────
# Removed on purpose: PUT /achiever-trust/<id>/tier.
#
# Setting a trust tier was the old capability model. Capability now follows the
# lifecycle state — pending / probation / active / suspended / banned — set
# through /achiever-lifecycle/<id>/..., which records a reason and writes an
# audit event for every transition.
#
# What remains in this module is deliberately not tier logic: reviewing an
# uploaded document, and recording a manual background check. Approval refuses
# until every required document is accepted, so document review is a step the
# lifecycle depends on.
# ─────────────────────────────────────────────────────────────────────────────



@ns.route('/achiever-trust/<string:achiever_id>/reject')
class AchieverReject(Resource):
    @ns.doc(description="Admin: reject an application with a reason the applicant is told.")
    @jwt_required()
    def post(self, achiever_id):
        try:
            err = _guard()
            if err:
                return err
            args = reject_parser.parse_args()
            reason = (args.get('reason') or '').strip()
            if not reason:
                return jsonify(response={'message': 'A rejection reason is required.'},
                               status=400, bool=False)

            # ── SP: sp_achiever_application_reject ───────────────────────────
            row = call_proc_one('sp_achiever_application_reject',
                                achiever_id, reason, get_jwt_identity())
            db.session.commit()
            if not row:
                return jsonify(response={'message': 'Achiever not found.'}, status=404, bool=False)

            # Rejection used to be a silent is_active=0 with nothing recorded
            # and no email. Tell them, and tell them what to fix.
            try:
                from portal.helpers.email_template import send_email, simple_email_body
                if row.get('email'):
                    send_email(row['email'], 'SKOVO — your achiever application',
                               simple_email_body(
                                   'We need more from your application',
                                   f"{reason}\n\nYou can upload new documents and "
                                   f"resubmit from your achiever dashboard."))
            except Exception:
                pass

            logger.info(f"Admin rejected achiever {achiever_id}: {reason}")
            return jsonify(response={'message': 'Application rejected and applicant notified.'},
                           status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id},
                           status=500, bool=False)


@ns.route('/achiever-trust/documents/<string:doc_id>')
class AchieverDocumentReview(Resource):
    @ns.doc(description="Admin: accept or reject one evidence document.")
    @jwt_required()
    def patch(self, doc_id):
        try:
            err = _guard()
            if err:
                return err
            args = doc_parser.parse_args()
            status = (args.get('status') or '').strip().lower()
            if status not in ('accepted', 'rejected'):
                return jsonify(response={'message': "status must be 'accepted' or 'rejected'."},
                               status=400, bool=False)

            # ── SP: sp_achiever_document_review ──────────────────────────────
            row = call_proc_one('sp_achiever_document_review', doc_id, status,
                                args.get('note'), get_jwt_identity())
            db.session.commit()
            if not row:
                return jsonify(response={'message': 'Document not found.'}, status=404, bool=False)
            aid = row.get('achiever_id')
            if aid:
                label = (row.get('doc_type') or 'document').replace('_', ' ')
                note = (args.get('note') or '').strip()
                if status == 'rejected':
                    tell_achiever(
                        aid, 'A document needs to be sent again',
                        f'A reviewer could not accept your {label}.\n\n'
                        + (f'What they said: {note}\n\n' if note else '')
                        + 'Upload a replacement and your application carries on '
                          'from there.',
                        button_label='Upload a replacement', type='system')
                else:
                    tell_achiever(
                        aid, 'A document was accepted',
                        f'A reviewer has accepted your {label}. Nothing to do.',
                        email=False, type='system')
            return jsonify(response={'message': f'Document {status}.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id},
                           status=500, bool=False)


@ns.route('/achiever-trust/<string:achiever_id>/bgv')
class AchieverBGVOrder(Resource):
    @ns.doc(description="Admin: order a background check for an L2 achiever.")
    @jwt_required()
    def post(self, achiever_id):
        try:
            err = _guard()
            if err:
                return err
            args = bgv_parser.parse_args()

            # The vendor adapter is deliberately thin and swappable — SKOVO has
            # not signed with a BGV provider yet. `vendor_ref` is whatever
            # reference that provider returns; until one is wired, an operator
            # runs the check manually and pastes their reference here. The
            # webhook route below closes the loop either way.
            ref = (args.get('vendor_ref') or '').strip() or f"manual-{uuid.uuid4().hex[:12]}"

            # ── SP: sp_achiever_bgv_start — refuses below L2, because paying
            # for a background check on someone whose credential was never
            # validated spends money on an applicant who may not pass L2. ────
            res = call_proc_one('sp_achiever_bgv_start', achiever_id, ref,
                                get_jwt_identity()) or {}
            db.session.commit()

            if not res.get('ok'):
                return jsonify(response={'message': {
                    'not_found': 'Achiever not found.',
                    'credential_required': ('Verify the achievement (L2) before ordering a '
                                            'background check.'),
                }.get(res.get('reason'), 'Could not start the background check.'),
                    'reason': res.get('reason')}, status=400, bool=False)

            logger.info(f"BGV started for achiever {achiever_id} ref={ref}")
            tell_achiever(
                achiever_id, 'Your background check has started',
                'SKOVO has started a background check on your application.\n\n'
                'There is nothing for you to do. We will tell you when it comes back.',
                button_label='View your application', type='system')
            return jsonify(response={'message': 'Background check started.', 'vendor_ref': ref},
                           status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id},
                           status=500, bool=False)

    @ns.doc(description="Admin: record the result of a manual background check.")
    @jwt_required()
    def patch(self, achiever_id):
        """Close a background check that was started by hand.

        sp_achiever_bgv_complete existed but nothing called it, so an admin could
        start a check and never record what came back -- it sat at 'pending' for
        good, and the achiever's screen said "in progress with our verifier"
        indefinitely. Ours is a manual process, so the person who ran it is the
        one who closes it.
        """
        try:
            if not can(AREA_USERS):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)

            data = request.get_json() or {}
            result = (data.get('result') or '').strip().lower()
            if result not in ('clear', 'failed'):
                return jsonify(response={'message': "result must be 'clear' or 'failed'."},
                               status=400, bool=False)

            row = call_proc_one('sp_achievers_get', achiever_id) or {}
            ref = row.get('bgv_ref')
            if not ref:
                return jsonify(response={'message': 'No background check has been started for this achiever.'},
                               status=409, bool=False)

            months = data.get('valid_months')
            try:
                months = int(months) if months is not None else 12
            except (TypeError, ValueError):
                months = 12

            # ── SP: sp_achiever_bgv_complete ─────────────────────────────────
            res = call_proc_one('sp_achiever_bgv_complete', ref, result, months) or {}
            db.session.commit()

            if not res.get('ok'):
                return jsonify(response={'message': 'That check could not be closed.',
                                         'reason': res.get('reason')}, status=409, bool=False)

            logger.info(f"Admin recorded BGV '{result}' for achiever {achiever_id} (ref {ref})")
            if result == 'clear':
                tell_achiever(
                    achiever_id, 'Your background check has cleared',
                    'Your background check has come back clear. '
                    f'It is valid for {months} months.',
                    button_label='View your application', type='system')
            else:
                tell_achiever(
                    achiever_id, 'Your background check did not clear',
                    'Your background check has come back with an adverse result, so '
                    'your application cannot go forward on it as things stand.\n\n'
                    'If you believe this is wrong, reply to this email and an admin '
                    'will look at it again.',
                    button_label='View your application', type='system')
            return jsonify(response={
                'message': ('Background check recorded as clear.' if result == 'clear'
                            else 'Background check recorded as failed.'),
                'bgv_status': 'clear' if result == 'clear' else 'failed',
            }, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id},
                           status=500, bool=False)
