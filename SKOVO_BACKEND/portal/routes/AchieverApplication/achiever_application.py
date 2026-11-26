"""
Achiever application — the screen that did not exist.

Before this, an achiever signed up with name / email / designation / company /
LinkedIn / bio and an admin approved them from exactly that. There was nothing
to review: the AIR 847 someone claimed was a `bio` text field.

This module is the evidence path. The achiever uploads documents, accepts the
three agreements, and submits; the admin then reviews something real.

SP-only, like the rest of the backend:
    sp_achiever_trust_get           current tier + what it allows
    sp_achiever_document_add        attach evidence
    sp_achiever_documents_list      what has been attached
    sp_achiever_document_delete     remove a still-pending upload
    sp_achiever_agreement_record    append-only agreement ledger
    sp_achiever_agreements_list     what has been accepted
    sp_achiever_application_submit  validates the dossier, moves to 'submitted'
    sp_achiever_trust_events_list   the achiever's own tier history
"""
from portal.helpers.error_capture import capture_error
from portal.helpers.helpers import serialize_datetime
import uuid

from flask import jsonify, request
from flask_restx import Resource
from flask_jwt_extended import jwt_required, get_jwt_identity, get_jwt

from portal.models import db
from portal.helpers.sp import call_proc, call_proc_one
from portal.routes.AchieverApplication.achiever_lifecycle import guidelines_for
from portal.helpers import trust as T
from . import ns, logger


def _achiever_only():
    """None when the caller is an achiever, else a 403 response.

    The achiever JWT still carries role 'mentor' from before the rename; every
    other achiever route checks the same string, so this matches rather than
    inventing a second convention.
    """
    if get_jwt().get('role') != 'mentor':
        return jsonify(response={'message': 'Achiever access only.'}, status=403, bool=False)
    return None


def _required_types_missing(achiever_id):
    """The required doc_types this achiever has nothing usable for.

    Same rule the status payload and sp_achiever_application_submit use: a type
    counts as covered by any document that is not rejected.
    """
    docs = call_proc('sp_achiever_documents_list', achiever_id) or []
    have = {d.get('doc_type') for d in docs if (d.get('status') or '') != 'rejected'}
    return [dt.get('value') for dt in T.doc_types()
            if dt.get('is_required') and dt.get('value') not in have]


def _unqueue_if_incomplete(achiever_id):
    """Send a submitted application back to draft once it no longer qualifies.

    Deleting a document while submitted is deliberate -- see the achiever screen:
    someone who spots a blurry ID while waiting should be able to replace it
    rather than wait to be rejected for it. What was missing is the other half of
    that: the application stayed 'submitted' with the document gone, so it sat in
    the admin queue with nothing to review, while the achiever's screen still
    read "Your application is in the queue. We will email you when there is a
    decision." The Submit button is hidden once submitted, so there was no way
    back either -- the only exit was an admin rejecting them for a document they
    had every intention of replacing.

    Returning it to 'draft' restores both automatically: 'draft' is one of the
    states can_submit allows, and the screen shows the builder again with the
    missing item named.

    Only fires when a REQUIRED type is left uncovered. Deleting a spare
    supporting document does not evict a complete application from the queue.

    Written here rather than in sp_achiever_document_delete: the SP is the
    ownership check for one row, and this is a decision about the application
    around it.
    """
    if _required_types_missing(achiever_id):
        row = call_proc_one('sp_achievers_get', achiever_id) or {}
        if (row.get('application_status') or '') == 'submitted':
            db.session.execute(
                db.text("UPDATE achievers "
                        "   SET application_status = 'draft', "
                        "       application_submitted_at = NULL, "
                        "       updated_at = UTC_TIMESTAMP(), "
                        "       updated_by = :aid "
                        " WHERE id = :aid AND application_status = 'submitted'"),
                {'aid': achiever_id},
            )
            db.session.commit()
            logger.info(
                "Achiever %s deleted a required document while submitted — "
                "application returned to draft.", achiever_id)
            return True
    return False


def _doc_dict(d):
    return {
        'id': d.get('id'),
        'doc_type': d.get('doc_type'),
        'file_url': d.get('file_url'),
        'original_name': d.get('original_name'),
        'claim': d.get('claim'),
        'status': d.get('status'),
        'review_note': d.get('review_note'),
        'reviewed_at': serialize_datetime(d['reviewed_at']) if d.get('reviewed_at') else None,
        'created_at': serialize_datetime(d['created_at']) if d.get('created_at') else None,
    }


def _status_payload(achiever_id):
    """Everything the application screen renders, in one response."""
    # The achiever's own row plus what their lifecycle state permits. This read
    # sp_achiever_trust_get before, which joined the tier table — so once tiers
    # stopped being maintained the whole screen reported level 0 and no
    # capabilities, to an achiever who might well be active.
    t = call_proc_one('sp_achievers_get', achiever_id) or {}
    caps = T.lifecycle_caps(achiever_id) or {}
    docs = call_proc('sp_achiever_documents_list', achiever_id) or []
    agreements = call_proc('sp_achiever_agreements_list', achiever_id) or []

    signed = {a.get('agreement_type') for a in agreements if a.get('granted')}

    # The document types are master data (master_achiever_doc_type, registered
    # in master_registry), so the dropdown grows from Admin > Masters rather
    # than a redeploy. Labels travel with the options — the screen no longer
    # carries its own copy of them to drift out of step.
    types = T.doc_types()

    # ── SP: sp_achiever_document_coverage — counts by CATEGORY, from the same
    # master data sp_achiever_application_submit validates against, so the
    # checklist and the refusal can never disagree. ──────────────────────────
    cov = call_proc_one('sp_achiever_document_coverage', achiever_id) or {}

    # Agreements are master data too — same reason as the document types. Each
    # row carries the text that was accepted and its version, so the ledger can
    # answer "what did they agree to", which it could not when the wording lived
    # only in a React constant.
    # ── SP: sp_achiever_agreement_status ──────────────────────────────────────
    agreement_rows = T.agreement_status(achiever_id)

    # ── SP: sp_achiever_verification_progress — the completion score and its
    # four parts, computed alongside the rule that gates submit so the number
    # on screen and the refusal can never disagree. ──────────────────────────
    progress = call_proc_one('sp_achiever_verification_progress', achiever_id) or {}

    # Mirrors sp_achiever_application_submit exactly: every document type
    # flagged is_required in master data, satisfied by anything not rejected.
    # It used to check category coverage -- one identity, one credential -- which
    # meant a government ID alone satisfied the gate while the screen still asked
    # for a selfie.
    uploaded_types = {d.get('doc_type') for d in docs
                      if (d.get('status') or '') != 'rejected'}
    required_types = [dt for dt in types if dt.get('is_required')]

    missing = ['document:%s' % dt.get('value')
               for dt in required_types if dt.get('value') not in uploaded_types]

    # Anything a reviewer has asked for on top of the standard set. Listed with
    # the same 'document:' prefix so one rule covers both on the screen.
    # ── SP: sp_achiever_doc_requests_list ────────────────────────────────────
    doc_requests = call_proc('sp_achiever_doc_requests_list', achiever_id) or []
    for r in doc_requests:
        if not r.get('fulfilled'):
            missing.append('document:%s' % r.get('doc_type'))
    # LinkedIn is the one profile field a reviewer can check independently, so an
    # application without it cannot be reviewed properly. This is where presence
    # is enforced -- the profile PUT only validates the field when it is sent,
    # because targeted writes like the avatar upload post nothing else.
    if not (t.get('linkedin_url') or '').strip():
        missing.append('linkedin_url')
    for a in agreement_rows:
        if a.get('is_required') and not a.get('accepted'):
            missing.append(f"agreement:{a.get('value')}")

    return {
        'state': t.get('state') or 'pending',
        'state_reason': t.get('state_reason'),
        # Same copy the lifecycle endpoint serves, so the screen that asks for
        # documents and the screen that explains why never drift apart. Server
        # side on purpose: the wording changes without a frontend deploy.
        'guidelines': guidelines_for(t.get('state') or 'pending'),
        'application_status': t.get('application_status'),
        'rejection_reason': t.get('rejection_reason'),
        'submitted_at': (serialize_datetime(t['application_submitted_at'])
                         if t.get('application_submitted_at') else None),
        'capabilities': {
            'can_be_listed': bool(caps.get('can_be_listed')),
            'can_take_bookings': bool(caps.get('can_take_bookings')),
            'can_charge': bool(caps.get('can_charge')),
            'can_publish_content': bool(caps.get('can_publish_content')),
        },
        'session_rate': float(t.get('session_rate') or 0),
        'bgv': {
            'status': t.get('bgv_status'),
            'cleared_at': serialize_datetime(t['bgv_cleared_at']) if t.get('bgv_cleared_at') else None,
            'expires_at': serialize_datetime(t['bgv_expires_at']) if t.get('bgv_expires_at') else None,
        },
        'documents': [_doc_dict(d) for d in docs],
        'agreements_signed': sorted(signed),
        # Full objects: the text that was accepted, its version, when, and
        # whether the wording has moved on since. The screen renders the
        # checklist from this instead of a local label map.
        'agreements': [{
            'value': a.get('value'),
            'label': a.get('label'),
            'body': a.get('body'),
            'body_url': a.get('body_url'),
            'is_required': bool(a.get('is_required')),
            'accepted': bool(a.get('accepted')),
            'accepted_version': a.get('accepted_version'),
            'current_version': a.get('current_version'),
            'accepted_at': (serialize_datetime(a['accepted_at']) if a.get('accepted_at') else None),
            'stale': bool(a.get('stale')),
        } for a in agreement_rows],
        # Kept for any client still reading the old shape.
        'required_agreements': [a.get('value') for a in agreement_rows if a.get('is_required')],
        'progress': {
            'percent_complete': int(progress.get('percent_complete') or 0),
            'identity_done': bool(progress.get('identity_done')),
            'credential_done': bool(progress.get('credential_done')),
            'agreements_done': bool(progress.get('agreements_done')),
            'bgv_done': bool(progress.get('bgv_done')),
            'agreements_accepted': int(progress.get('agreements_accepted') or 0),
            'agreements_required': int(progress.get('agreements_required') or 0),
            'identity_docs': int(progress.get('identity_docs') or 0),
            'credential_docs': int(progress.get('credential_docs') or 0),
        },
        # Full objects, not bare codes: value + label + category, so the client
        # renders and groups the dropdown without hardcoding anything.
        'doc_types': [{
            'value': t.get('value'),
            'label': t.get('label'),
            'category': t.get('category'),
            'help_text': t.get('help_text'),
            'is_required': bool(t.get('is_required')),
        } for t in types],
        # Already in sort_order from master data, which is the order the screen
        # asks for them in: government ID, then selfie, then achievement proof.
        # Shown above the standard list: an admin asked for these by hand, and
        # the note says why.
        'document_requests': [{
            'doc_type': r.get('doc_type'),
            'label': r.get('label'),
            'help_text': r.get('help_text'),
            'note': r.get('note'),
            'done': bool(r.get('fulfilled')),
        } for r in doc_requests],
        'required_documents': [{
            'value': dt.get('value'),
            'label': dt.get('label'),
            'help_text': dt.get('help_text'),
            'done': dt.get('value') in uploaded_types,
        } for dt in required_types],
        # Kept for any client still reading the old shape.
        'accepted_doc_types': [t.get('value') for t in types],
        'missing': missing,
        'can_submit': not missing and t.get('application_status') in ('draft', 'rejected'),
    }


@ns.route('/status')
class ApplicationStatus(Resource):
    @ns.doc(description="Achiever: current tier, capabilities, evidence and what is still missing.")
    @jwt_required()
    def get(self):
        try:
            err = _achiever_only()
            if err:
                return err
            return jsonify(response=_status_payload(get_jwt_identity()), status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id},
                           status=500, bool=False)


@ns.route('/documents')
class ApplicationDocuments(Resource):
    @ns.doc(description="Achiever: attach an evidence document already uploaded via /upload/.")
    @jwt_required()
    def post(self):
        try:
            err = _achiever_only()
            if err:
                return err
            achiever_id = get_jwt_identity()
            data = request.get_json() or {}

            doc_type = (data.get('doc_type') or '').strip().lower()
            file_url = (data.get('file_url') or '').strip()

            # Validated against master data, and it distinguishes a typo from a
            # type an admin has retired — those deserve different messages.
            ok, reason = T.doc_type_ok(doc_type)
            if not ok:
                allowed = ', '.join(t['value'] for t in T.doc_types())
                return jsonify(response={
                    'message': ("That document type is no longer accepted. "
                                "Please pick another." if reason == 'retired'
                                else f"doc_type must be one of: {allowed}"),
                    'reason': reason,
                }, status=400, bool=False)
            if not file_url:
                return jsonify(response={'message': 'file_url is required. Upload the file first via /upload/.'},
                               status=400, bool=False)

            # ── SP: sp_achiever_document_add — also flips a previously rejected
            # application back to 'draft', so re-uploading is a way forward
            # rather than a dead end. ────────────────────────────────────────
            row = call_proc_one(
                'sp_achiever_document_add',
                str(uuid.uuid4()), achiever_id, doc_type, file_url,
                (data.get('original_name') or '')[:255] or None,
                (data.get('claim') or '')[:255] or None,
            )
            db.session.commit()
            logger.info(f"Achiever {achiever_id} attached {doc_type} evidence")
            return jsonify(response={'document': _doc_dict(row or {})}, status=201, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id},
                           status=500, bool=False)


@ns.route('/documents/<string:doc_id>')
class ApplicationDocument(Resource):
    @ns.doc(description="Achiever: remove a still-pending document of their own.")
    @jwt_required()
    def delete(self, doc_id):
        try:
            err = _achiever_only()
            if err:
                return err
            # Ownership lives in the SP's WHERE clause — a reviewed document
            # cannot be deleted, and no achiever can touch another's evidence.
            achiever_id = get_jwt_identity()
            res = call_proc_one('sp_achiever_document_delete', doc_id, achiever_id) or {}
            db.session.commit()
            if not res.get('deleted'):
                return jsonify(response={'message': 'Document not found, or already reviewed.'},
                               status=404, bool=False)

            unqueued = _unqueue_if_incomplete(achiever_id)
            return jsonify(response={
                'message': ('Document removed. Your application has left the review queue — '
                            'upload a replacement and submit it again.'
                            if unqueued else 'Document removed.'),
                'returned_to_draft': unqueued,
            }, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id},
                           status=500, bool=False)


@ns.route('/agreements')
class ApplicationAgreements(Resource):
    @ns.doc(description="Achiever: accept the code of conduct, commission and cancellation policy.")
    @jwt_required()
    def post(self):
        try:
            err = _achiever_only()
            if err:
                return err
            achiever_id = get_jwt_identity()
            data = request.get_json() or {}
            accepted = data.get('accept') or []
            if isinstance(accepted, str):
                accepted = [accepted]

            if not accepted:
                return jsonify(response={'message': 'Nothing to accept.'}, status=400, bool=False)

            # Validated against master data, and each type resolves its OWN
            # current version — consent is pinned to the exact wording the
            # achiever was shown, not to one global constant that silently
            # covers three separate documents.
            resolved = []
            for a_type in accepted:
                ok, reason, version = T.agreement_type_ok(a_type)
                if not ok:
                    return jsonify(response={
                        'message': ('That agreement is no longer in use.'
                                    if reason == 'retired'
                                    else f'Unknown agreement: {a_type}'),
                        'reason': reason,
                    }, status=400, bool=False)
                resolved.append((a_type, version))

            # Same evidentiary shape as the student consent ledger: what was
            # agreed, which policy version, from which IP, append-only.
            ip = (request.headers.get('X-Forwarded-For') or request.remote_addr or '')[:64]
            for a_type, version in resolved:
                # ── SP: sp_achiever_agreement_record ─────────────────────────
                call_proc_one('sp_achiever_agreement_record',
                              str(uuid.uuid4()), achiever_id, a_type,
                              version, 1, ip)
            db.session.commit()
            logger.info(f"Achiever {achiever_id} accepted: "
                        + ', '.join(f'{t}@{v}' for t, v in resolved))
            return jsonify(response={
                'accepted': [t for t, _ in resolved],
                'versions': {t: v for t, v in resolved},
            }, status=201, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id},
                           status=500, bool=False)


@ns.route('/submit')
class ApplicationSubmit(Resource):
    @ns.doc(description="Achiever: submit the application for admin review.")
    @jwt_required()
    def post(self):
        try:
            err = _achiever_only()
            if err:
                return err
            achiever_id = get_jwt_identity()

            # ── SP: sp_achiever_application_submit — the completeness rules
            # (one identity doc, one credential doc, all three agreements) are
            # enforced in the procedure so a direct API call cannot land an
            # empty dossier in the admin queue. ──────────────────────────────
            res = call_proc_one('sp_achiever_application_submit', achiever_id) or {}
            db.session.commit()

            if not res.get('ok'):
                reason = res.get('reason')
                return jsonify(response={
                    'message': {
                        'not_found': 'Achiever not found.',
                        'already_submitted': 'Your application is already under review.',
                        'already_approved': 'Your application has already been approved.',
                        'required_document_missing': (
                            'Some required documents are still missing. '
                            'The verification screen shows which.'),
                        # Kept: an older client may still see these.
                        'identity_document_required': 'Add a government ID before submitting.',
                        'credential_document_required': (
                            'Add proof of your achievement — a rank card, degree, '
                            'or offer letter — before submitting.'),
                        'agreements_required': (
                            'Accept the code of conduct, commission and cancellation '
                            'policy before submitting.'),
                    }.get(reason, 'Your application is not ready to submit.'),
                    'reason': reason,
                }, status=400, bool=False)

            logger.info(f"Achiever {achiever_id} submitted application for review")
            # CRM: achiever 'Submitted' pipeline stage — same bridge the
            # 'Applied' event already uses at registration.
            try:
                from portal.helpers.analytics import track_event
                track_event('achiever_application_submitted', entity_type='achiever',
                            entity_id=achiever_id, req=request)
            except Exception:
                pass

            return jsonify(response={
                'message': "Application submitted. We'll review it and email you.",
                'application_status': 'submitted',
            }, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id},
                           status=500, bool=False)


@ns.route('/history')
class ApplicationHistory(Resource):
    @ns.doc(description="Achiever: their own tier history — every promotion, demotion and reason.")
    @jwt_required()
    def get(self):
        try:
            err = _achiever_only()
            if err:
                return err
            rows = call_proc('sp_achiever_trust_events_list', get_jwt_identity(), 50) or []
            return jsonify(response={'events': [{
                'from_level': r.get('from_level'),
                'to_level': r.get('to_level'),
                'action': r.get('action'),
                'reason': r.get('reason'),
                'created_at': serialize_datetime(r['created_at']) if r.get('created_at') else None,
            } for r in rows]}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id},
                           status=500, bool=False)
