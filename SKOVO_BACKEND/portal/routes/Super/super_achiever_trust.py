"""
Super-admin: the achiever decisions an admin must not make alone.

The super-admin portal currently mirrors the admin screens rather than holding
a different KIND of power. This module is the shape it should have: not "admin
with more rows", but the small set of irreversible or conflict-of-interest
decisions that need a second pair of eyes.

Here that is exactly one promotion — L3, background-verified, the tier that
unlocks 14-17 students. The reviewer who collected an achiever's evidence
should not also be the person who clears them to sit alone with a minor, so
admin_achiever_trust.py refuses L3 and points here.

Also hosts the BGV vendor webhook, because the vendor contract and its shared
secret are super-admin-owned config.
"""
from portal.helpers.error_capture import capture_error
import datetime
import hashlib
import hmac
import os

from flask import jsonify, request
from flask_restx import Resource, reqparse
from flask_jwt_extended import jwt_required, get_jwt_identity, get_jwt

from portal.models import db
from portal.helpers.sp import call_proc, call_proc_one
from portal.helpers import trust as T
from . import ns, logger

clear_parser = reqparse.RequestParser()
clear_parser.add_argument('reason', type=str, location='json', required=False)



def _is_super(claims):
    return claims.get('super_admin') is True


def _guard():
    if not _is_super(get_jwt()):
        return jsonify(response={'message': 'Super admin access required'}, status=403, bool=False)
    return None


@ns.route('/achiever-trust/pending-bgv')
class PendingBGVApprovals(Resource):
    @ns.doc(description="Super admin: achievers whose background check cleared and await L3 sign-off.")
    @jwt_required()
    def get(self):
        try:
            err = _guard()
            if err:
                return err

            # ── SP: sp_achiever_review_queue — every approved achiever, then
            # narrowed to the ones actually waiting on this decision: cleared
            # by the vendor but still below the tier that clearance unlocks. ─
            rows = call_proc('sp_achiever_review_queue', 'approved', 500, 0) or []
            waiting = [r for r in rows
                       if r.get('bgv_status') == 'clear']

            return jsonify(response={'achievers': [{
                'id': r.get('id'),
                'full_name': r.get('full_name'),
                'email': r.get('email'),
                'designation': r.get('designation'),
                'company': r.get('company'),
                'state': r.get('state'),
                'tier_label': r.get('tier_label'),
                'bgv_status': r.get('bgv_status'),
                'doc_count': r.get('doc_count') or 0,
            } for r in waiting], 'total': len(waiting)}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id},
                           status=500, bool=False)


# ─────────────────────────────────────────────────────────────────────────────
# Removed on purpose: clear-BGV and demote.
#
# Both were duplicates of admin capabilities that already exist under
# /skovo-platform-panel-admin/achiever-trust/<id>/bgv and /tier. Vetting an
# achiever is operational work, and having it in two portals means no single
# answer to "who cleared this person".
#
# What stays here: the pending-BGV list above (read-only oversight) and the
# vendor webhook below, which is an inbound callback rather than an action the
# super admin takes.
# ─────────────────────────────────────────────────────────────────────────────


@ns.route('/achiever-trust/bgv-webhook')
class BGVWebhook(Resource):
    @ns.doc(description="BGV vendor callback. HMAC-signed; not a browser endpoint.")
    def post(self):
        """Vendor posts the result of a background check.

        Vendor-agnostic on purpose — SKOVO has not signed with a provider, and
        the body shape below (`reference`, `result`) is the common denominator
        across the Indian BGV vendors. Swapping providers should be a mapping
        change here, not a schema change.

        A clear result does NOT auto-promote to L3: it records evidence and
        surfaces the achiever on the super-admin queue. Granting the tier that
        unlocks minors stays a deliberate human act.
        """
        try:
            secret = os.environ.get('BGV_WEBHOOK_SECRET', '')
            raw = request.get_data() or b''

            # Fail closed. An unsigned webhook that writes verification state
            # would let anyone on the internet mark an achiever as cleared.
            if not secret:
                logger.error('BGV webhook received but BGV_WEBHOOK_SECRET is not set — rejected.')
                return jsonify(response={'message': 'Webhook not configured.'},
                               status=503, bool=False)

            signature = request.headers.get('X-BGV-Signature', '')
            expected = hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
            if not hmac.compare_digest(signature, expected):
                logger.warning('BGV webhook signature mismatch — rejected.')
                return jsonify(response={'message': 'Invalid signature.'}, status=401, bool=False)

            data = request.get_json(silent=True) or {}
            ref = (data.get('reference') or '').strip()
            result = (data.get('result') or '').strip().lower()
            if not ref or result not in ('clear', 'failed'):
                return jsonify(response={'message': "reference and result ('clear'|'failed') required."},
                               status=400, bool=False)

            # ── SP: sp_achiever_bgv_complete ─────────────────────────────────
            res = call_proc_one('sp_achiever_bgv_complete', ref, result,
                                T.BGV_VALID_MONTHS) or {}
            db.session.commit()

            if not res.get('ok'):
                logger.warning(f"BGV webhook for unknown reference {ref}")
                return jsonify(response={'message': 'Unknown reference.'}, status=404, bool=False)

            achiever_id = res.get('achiever_id')
            logger.info(f"BGV result '{result}' recorded for achiever {achiever_id} ref={ref}")

            # An adverse result is the one case that must not wait for a human.
            # Demoting a tier used to be the response; suspension is the
            # lifecycle equivalent — reversible, audited, and it stops bookings
            # at once. A super admin reinstates after reading the report.
            if result == 'failed':
                a = call_proc_one('sp_achievers_get', achiever_id) or {}
                if (a.get('state') or '') == 'active':
                    since = datetime.datetime.utcnow()
                    call_proc_one('sp_achiever_set_state', achiever_id, 'suspended',
                                  'Background check returned an adverse result',
                                  None, None, 'system')
                    db.session.commit()
                    from portal.routes.Admin.admin_achiever_trust import notify_cascade
                    notify_cascade(achiever_id, since, a.get('full_name') or 'your achiever')
                    logger.warning(f"Achiever {achiever_id} auto-suspended on adverse BGV")

            return jsonify(response={'message': 'Recorded.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            logger.error(f"BGV webhook error: {e}")
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id},
                           status=500, bool=False)
