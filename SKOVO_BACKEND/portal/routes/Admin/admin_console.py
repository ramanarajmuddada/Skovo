"""Admin console: who am I, what can I do, and what needs me today.

`/console` is the gate. An admin awaiting approval can sign in and reach this
endpoint, and nothing else — the frontend renders a holding screen from what it
returns. Blocking the login outright would leave someone who has just applied
with no way to tell whether the request was even received.

`/dashboard` is one call. A dashboard assembled from nine endpoints renders nine
times and shows a different moment in every tile.
"""
import datetime
from flask import jsonify, request
from flask_restx import Resource
from flask_jwt_extended import jwt_required, get_jwt_identity
from sqlalchemy import text

from portal.models import db
from portal.helpers.sp import call_proc_one
from portal.helpers.error_capture import capture_error
from . import ns, logger

# Said in the admin's own language, at the moment it applies.
GUIDELINES = {
    'pending': {
        'title': 'Your account is awaiting approval',
        'summary': 'A super-admin reviews every admin account before it is '
                   'given access to the platform.',
        'steps': [
            'Your registration was received and your email is verified.',
            'A super-admin will review and approve the account.',
            'You will be able to sign in to the full console once approved.',
        ],
        'note': 'Nothing on the platform is visible to you until then — no '
                'students, achievers or payments.',
    },
    'suspended': {
        'title': 'Your admin access is suspended',
        'summary': 'You cannot act on the platform while suspended.',
        'steps': [
            'Read the reason below.',
            'Contact a super-admin if you believe this is a mistake.',
        ],
        'note': None,
    },
    'active': {
        'title': 'Console',
        'summary': 'Everything is unlocked.',
        'steps': [],
        'note': None,
    },
}


@ns.route('/console')
class AdminConsole(Resource):

    @jwt_required()
    def get(self):
        """State, capability and the holding-screen copy."""
        admin_id = get_jwt_identity()
        try:
            # ── SP: sp_admin_capabilities ────────────────────────────────────
            caps = call_proc_one('sp_admin_capabilities', admin_id)
            if not caps:
                return jsonify(response={'message': 'Admin not found.'},
                               status=404, bool=False)

            state = caps.get('state') or 'pending'
            can_operate = bool(caps.get('can_operate'))

            return jsonify(response={
                'state': state,
                'state_reason': caps.get('state_reason'),
                'can_operate': can_operate,
                'awaiting_approval': bool(caps.get('awaiting_approval')),
                # The first admin is exempt from approval — without it an empty
                # database deadlocks, since approving requires a super-admin and
                # there is none either.
                'guidelines': GUIDELINES.get(state, GUIDELINES['pending']),
            }, status=200, bool=True)

        except Exception as e:
            logger.error(f"admin console failed for {admin_id}: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id},
                           status=500, bool=False)


@ns.route('/dashboard-summary')
class AdminDashboardSummary(Resource):

    @jwt_required()
    def get(self):
        """Queues, today, and what is going wrong. One round trip."""
        admin_id = get_jwt_identity()
        try:
            caps = call_proc_one('sp_admin_capabilities', admin_id) or {}
            if not caps.get('can_operate'):
                # Refused rather than returned empty: an approved-looking
                # dashboard full of zeroes is worse than a clear "not yet".
                return jsonify(response={'message': 'Your account is not approved yet.'},
                               status=403, bool=False)

            # ── SP: sp_admin_dashboard ──────────────────────────────────────
            # ?from=&to= (YYYY-MM-DD, IST days) scope the activity numbers only.
            # Missing or malformed → None, which the SP reads as today.
            def _d(raw):
                try:
                    return datetime.date.fromisoformat((raw or '').strip())
                except (TypeError, ValueError):
                    return None
            d_from, d_to = _d(request.args.get('from')), _d(request.args.get('to'))
            if d_from and d_to and d_from > d_to:
                d_from, d_to = d_to, d_from
            d = call_proc_one('sp_admin_dashboard', d_from, d_to) or {}

            def n(k):
                # A NULL metric means "no data yet", which is 0.0 here — not a
                # crash. The previous form tested `v is None` on the *true*
                # branch and then called float(None), so an empty database took
                # the whole dashboard down on first load.
                v = d.get(k)
                if v is None:
                    return 0.0
                try:
                    return float(v)
                except (TypeError, ValueError):
                    return 0.0

            queues = [
                {'key': 'documents',  'label': 'Achievers with documents to review',
                 'count': int(d.get('docs_to_review') or 0),
                 'href': '/skovo-platform-panel-admin/achiever-review'},
                {'key': 'payouts',    'label': 'Payout requests pending',
                 'count': int(d.get('payouts_pending') or 0),
                 'amount': n('payouts_amount'),
                 'href': '/skovo-platform-panel-admin/payments?tab=payouts'},
                {'key': 'refunds',    'label': 'Refunds needing manual action',
                 'count': int(d.get('refunds_failed') or 0),
                 'href': '/skovo-platform-panel-admin/payments'},
            ]

            return jsonify(response={
                'queues': queues,
                'needs_attention': sum(q['count'] for q in queues),

                'today': {
                    'sessions': int(d.get('sessions_today') or 0),
                    'sessions_done': int(d.get('sessions_done_today') or 0),
                    'no_shows': int(d.get('no_shows_today') or 0),
                    'new_students': int(d.get('students_today') or 0),
                    'new_applications': int(d.get('applications_today') or 0),
                    'revenue': n('revenue_today'),
                },

                'health': {
                    'achievers_at_risk': int(d.get('achievers_at_risk') or 0),
                    # These two follow ?from=&to=; the other two are live.
                    'failed_payments': int(d.get('failed_payments') or 0),
                    # Should be zero. Anything else means the reconciler is not
                    # running, which is worth surfacing before someone complains.
                    'stuck_orders': int(d.get('stuck_orders') or 0),
                    'no_show_pct': n('no_show_pct'),
                },

                'totals': {
                    'achievers_active': int(d.get('achievers_active') or 0),
                    'students': int(d.get('students_total') or 0),
                },
            }, status=200, bool=True)

        except Exception as e:
            logger.error(f"admin dashboard failed: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id},
                           status=500, bool=False)


@ns.route('/sidebar-badges')
class AdminSidebarBadges(Resource):

    @jwt_required()
    def get(self):
        """Counts for the sidebar. Cheap, and polled on every page load.

        The digest email catches the admin who has not logged in for two days;
        these catch the one who is looking at the screen right now, which is
        the case that actually gets acted on.
        """
        admin_id = get_jwt_identity()
        try:
            caps = call_proc_one('sp_admin_capabilities', admin_id) or {}
            if not caps.get('can_operate'):
                return jsonify(response={'badges': {}}, status=200, bool=True)

            row = db.session.execute(text("""
                SELECT
                  (SELECT COUNT(DISTINCT d.achiever_id)
                     FROM achiever_documents d JOIN achievers a ON a.id = d.achiever_id
                    WHERE d.status = 'pending' AND a.state = 'pending')  AS achiever_review,
                  (SELECT COUNT(*) FROM payout_requests WHERE status = 'pending')   AS payouts
            """)).fetchone()

            return jsonify(response={'badges': {
                'achiever-review': int(row[0] or 0),
                'payouts': int(row[1] or 0),
            }}, status=200, bool=True)

        except Exception as e:
            logger.error(f"sidebar badges failed: {e}")
            return jsonify(response={'badges': {}}, status=200, bool=True)
