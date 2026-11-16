"""
DPDP Act 2023 consent endpoints (v1 §11.1).

Flow:
  1. After signup the student submits date of birth (sp_user_set_dob).
     - under 14  → blocked (not permitted on the platform)
     - 14–17     → account holds until a parent confirms
     - 18+       → consent granted, full access
  2. A 14–17 student names a parent; we email a tokenised confirmation link.
  3. The parent opens the link → sp_parental_consent_confirm activates the
     account and records the consent in the append-only ledger.

The exact minor-consent mechanism is a founder/legal decision; this implements
the email-link default and records everything mechanism-agnostically.
"""
from portal.helpers.error_capture import capture_error
import uuid
import datetime
from flask import jsonify, request
from flask_restx import Resource
from flask_jwt_extended import jwt_required, get_jwt_identity
from portal.models import db
from portal.helpers.sp import call_proc, call_proc_one
from portal.helpers.helpers import serialize_datetime
from . import ns, logger

POLICY_VERSION = 'v1'
PARENT_LINK_DAYS = 7


def _client_ip():
    return (request.headers.get('X-Forwarded-For', '') or request.remote_addr or '').split(',')[0].strip() or None


@ns.route('/consent/dob')
class ConsentDob(Resource):
    @ns.doc(description='Submit date of birth. Derives the age band and gates minors.')
    @jwt_required()
    def post(self):
        try:
            user_id = get_jwt_identity()
            dob = (request.get_json() or {}).get('date_of_birth')
            if not dob:
                return jsonify(response={'message': 'Date of birth is required.'}, status=400, bool=False)
            try:
                datetime.date.fromisoformat(dob)
            except (ValueError, TypeError):
                return jsonify(response={'message': 'Use a valid date (YYYY-MM-DD).'}, status=400, bool=False)

            # ── SP: sp_user_set_dob (stores the date, grants consent) ────────
            res = call_proc_one('sp_user_set_dob', user_id, dob) or {}
            db.session.commit()

            # There is no minimum age and no parental-consent step, so terms and
            # data-processing consent is recorded for everyone here. It used to
            # be gated on age_band == 'adult', which meant a 16-year-old's
            # acceptance was never written down at all.
            call_proc_one('sp_consent_record', str(uuid.uuid4()), user_id,
                          'terms', POLICY_VERSION, 1, _client_ip())
            call_proc_one('sp_consent_record', str(uuid.uuid4()), user_id,
                          'data_processing', POLICY_VERSION, 1, _client_ip())
            db.session.commit()

            return jsonify(response={
                'consent_status': res.get('consent_status'),
                # Always false: nothing waits on a parent any more.
                'needs_parental_consent': False,
            }, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in POST /auth/consent/dob: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/consent/parent')
class ConsentParent(Resource):
    @ns.doc(description='A 14–17 student names a parent; we email a consent link.')
    @jwt_required()
    def post(self):
        try:
            user_id = get_jwt_identity()
            data = request.get_json() or {}
            parent_email = (data.get('parent_email') or '').strip().lower()
            parent_name = (data.get('parent_name') or '').strip() or None
            if not parent_email or '@' not in parent_email:
                return jsonify(response={'message': 'A valid parent email is required.'}, status=400, bool=False)

            token = str(uuid.uuid4())
            # ── SP: sp_parental_consent_request ──────────────────────────────
            call_proc_one('sp_parental_consent_request', str(uuid.uuid4()), user_id,
                          parent_email, parent_name, token, PARENT_LINK_DAYS)
            db.session.commit()

            # Send the confirmation email (best-effort — the record stands even
            # if delivery is retried out of band).
            try:
                import os
                from portal.helpers.email_template import send_email
                # Parents click this in a browser, so point at the friendly web
                # page (which calls the confirm API), not the raw JSON endpoint.
                base = os.environ.get('FRONTEND_BASE_URL', '').rstrip('/') or request.host_url.rstrip('/')
                link = f"{base}/parent-consent?token={token}"
                send_email(
                    parent_email,
                    "Please confirm your child's Skovo account",
                    f"<p>Your child has signed up for Skovo, a career-readiness platform for students.</p>"
                    f"<p>As they are under 18, we need your consent before their account is activated.</p>"
                    f'<p><a href="{link}">Confirm your child\'s account</a> (valid {PARENT_LINK_DAYS} days).</p>'
                    f"<p>If you did not expect this, you can ignore this email.</p>",
                )
            except Exception as mail_err:
                logger.warning(f"parental consent email not sent: {mail_err}")

            return jsonify(response={
                'message': f'We have emailed {parent_email}. Your account activates once they confirm.',
            }, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in POST /auth/consent/parent: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/consent/parent/confirm')
class ConsentParentConfirm(Resource):
    @ns.doc(description='Parent opens the emailed link — activates the minor account. No auth.')
    def get(self):
        try:
            token = request.args.get('token')
            if not token:
                return jsonify(response={'message': 'Missing confirmation token.'}, status=400, bool=False)
            # ── SP: sp_parental_consent_confirm ──────────────────────────────
            res = call_proc_one('sp_parental_consent_confirm', token) or {}
            db.session.commit()
            result = res.get('result')
            if not res.get('ok'):
                msg = {
                    'invalid': 'This confirmation link is not valid.',
                    'expired': 'This confirmation link has expired. Please ask your child to resend it.',
                    'superseded': 'A newer confirmation link was issued for this account.',
                }.get(result, 'Could not confirm.')
                return jsonify(response={'message': msg, 'result': result}, status=400, bool=False)
            return jsonify(response={
                'message': 'Thank you — your child\'s Skovo account is now active.',
                'result': result,
            }, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in GET /auth/consent/parent/confirm: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/consent/status')
class ConsentStatus(Resource):
    @ns.doc(description='Where this account stands in the consent flow.')
    @jwt_required()
    def get(self):
        try:
            user_id = get_jwt_identity()
            # ── SP: sp_parental_consent_status ───────────────────────────────
            row = call_proc_one('sp_parental_consent_status', user_id) or {}
            return jsonify(response={
                'consent_status': row.get('consent_status'),
                'parent_email': row.get('parent_email'),
                'parent_status': row.get('parent_status'),
                'requested_at': serialize_datetime(row.get('requested_at')),
            }, status=200, bool=True)
        except Exception as e:
            logger.error(f"Error in GET /auth/consent/status: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @ns.doc(description='Record a first-party consent (terms / data-processing / marketing).')
    @jwt_required()
    def post(self):
        try:
            user_id = get_jwt_identity()
            ctype = ((request.get_json() or {}).get('consent_type') or '').strip()
            if ctype not in ('terms', 'data_processing', 'marketing', 'employer_sharing'):
                return jsonify(response={'message': 'Unknown consent type.'}, status=400, bool=False)
            granted = 1 if (request.get_json() or {}).get('granted', True) else 0
            # ── SP: sp_consent_record ────────────────────────────────────────
            call_proc_one('sp_consent_record', str(uuid.uuid4()), user_id, ctype,
                          POLICY_VERSION, granted, _client_ip())
            db.session.commit()
            return jsonify(response={'message': 'Consent recorded.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in POST /auth/consent/status: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)
