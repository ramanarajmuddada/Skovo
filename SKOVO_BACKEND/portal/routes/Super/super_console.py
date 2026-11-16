"""Super-admin console: the business, and who is allowed to administer it.

Four things only — approve admins, see the money, read the audit, and look at
operations read-only. Deliberately not a smaller copy of the admin console: if
both showed the same numbers one of them would be redundant, which is the flaw
in the existing super-admin screens that mirror admin.

There is no endpoint here that creates an account. Everyone self-registers;
approval is the only action anyone takes on someone else's account.
"""
from flask import jsonify, request
from flask_restx import Resource
from flask_jwt_extended import jwt_required, get_jwt_identity
from sqlalchemy import text

from portal.models import db
from portal.helpers.sp import call_proc, call_proc_one
from portal.helpers.helpers import serialize_datetime
from portal.helpers.error_capture import capture_error
from . import ns, logger


def _guard():
    """Super-admin only."""
    actor = get_jwt_identity()
    row = db.session.execute(text(
        "SELECT 1 FROM super_admins WHERE id = :i"
    ), {'i': actor}).fetchone()
    if not row:
        return None, jsonify(response={'message': 'Super-admin access required.'},
                             status=403, bool=False)
    return actor, None


def _pct_change(now, before):
    """Growth as a percentage, or None when there is no baseline.

    Returning 0 for "no previous month" would read as flat when it is actually
    unknown, and a first month always looks like failure.
    """
    now, before = float(now or 0), float(before or 0)
    if before == 0:
        return None
    return round((now - before) / before * 100, 1)


@ns.route('/business-dashboard')
class BusinessDashboard(Resource):

    @jwt_required()
    def get(self):
        """Revenue, liability, growth and unit economics. One round trip."""
        _, err = _guard()
        if err:
            return err
        try:
            # ── SP: sp_super_dashboard ──────────────────────────────────────
            d = call_proc_one('sp_super_dashboard') or {}

            def f(k):
                return float(d.get(k) or 0)

            students_total  = int(d.get('students_total') or 0)
            students_paying = int(d.get('students_paying') or 0)

            return jsonify(response={
                'revenue': {
                    'month': f('revenue_month'),
                    'prev_month': f('revenue_prev_month'),
                    'growth_pct': _pct_change(d.get('revenue_month'), d.get('revenue_prev_month')),
                    'platform_cut': f('platform_cut_month'),
                    'all_time': f('revenue_all_time'),
                    # The share the platform actually keeps. Worth showing
                    # separately from the configured rate: coupons and refunds
                    # mean the two are not the same number.
                    'take_rate_pct': round(
                        f('platform_cut_month') / f('revenue_month') * 100, 1
                    ) if f('revenue_month') else None,
                },

                'liability': {
                    # Money in the platform's bank that belongs to achievers.
                    # Revenue that ignores this flatters the business.
                    'outstanding': f('outstanding_liability'),
                    'paid_out_month': f('paid_out_month'),
                    'payouts_pending': f('payouts_pending_amount'),
                },

                'growth': {
                    'students_total': students_total,
                    'students_month': int(d.get('students_month') or 0),
                    'students_growth_pct': _pct_change(
                        d.get('students_month'), d.get('students_prev_month')),
                    'students_paying': students_paying,
                    'conversion_pct': round(students_paying / students_total * 100, 1)
                                      if students_total else 0.0,
                    'sessions_month': int(d.get('sessions_month') or 0),
                    'sessions_growth_pct': _pct_change(
                        d.get('sessions_month'), d.get('sessions_prev_month')),
                    'achievers': {
                        'active': int(d.get('achievers_active') or 0),
                        'probation': int(d.get('achievers_probation') or 0),
                        'pending': int(d.get('achievers_pending') or 0),
                        'suspended': int(d.get('achievers_suspended') or 0),
                    },
                },

                'unit_economics': {
                    'avg_order_value': f('avg_order_value'),
                    'revenue_per_paying_student': round(
                        f('revenue_all_time') / students_paying, 2) if students_paying else 0.0,
                    'revenue_per_active_achiever': round(
                        f('revenue_all_time') / int(d.get('achievers_active') or 0), 2
                    ) if int(d.get('achievers_active') or 0) else 0.0,
                    'repeat_rate_pct': f('repeat_rate_pct'),
                    'refund_rate_pct': f('refund_rate_pct'),
                },

                'governance': {
                    'admins_active': int(d.get('admins_active') or 0),
                    'admins_pending': int(d.get('admins_pending') or 0),
                    'admins_suspended': int(d.get('admins_suspended') or 0),
                    'commission_pct': round(f('commission_rate') * 100, 2),
                },
            }, status=200, bool=True)

        except Exception as e:
            logger.error(f"business dashboard failed: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id},
                           status=500, bool=False)


# Distinct from /admins, which super_admins.py registers as the plain directory.
# Both were mounted on the same rule with the same class name, so whichever
# imported second was shadowed — the approvals screen read `items` from a
# response that only had `admins`, and showed "Nobody waiting" while somebody
# was in fact waiting.
@ns.route('/admins/queue')
class SuperAdminQueue(Resource):

    @jwt_required()
    def get(self):
        """Every admin, pending first. There is no POST — nobody creates anyone."""
        _, err = _guard()
        if err:
            return err
        try:
            state = (request.args.get('state') or '').strip() or None
            # ── SP: sp_admin_approval_queue ─────────────────────────────────
            rows = call_proc('sp_admin_approval_queue', state) or []
            return jsonify(response={'items': [{
                'admin_id': r.get('id'),
                'full_name': r.get('full_name'),
                'email': r.get('email'),
                'state': r.get('state'),
                'state_reason': r.get('state_reason'),
                'registered_at': serialize_datetime(r['created_at']) if r.get('created_at') else None,
                'decided_at': serialize_datetime(r['state_changed_at']) if r.get('state_changed_at') else None,
                # Both come back from sp_admin_approval_queue already and were
                # being thrown away. `event_count` is the tell that an account
                # has been suspended before — the thing worth knowing before
                # approving it.
                'event_count': int(r.get('event_count') or 0),
            } for r in rows]}, status=200, bool=True)
        except Exception as e:
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id},
                           status=500, bool=False)


@ns.route('/admins/<string:admin_id>/state')
class SuperAdminState(Resource):

    @jwt_required()
    def post(self, admin_id):
        """Approve, reject or suspend an admin. The only action on an account."""
        actor, err = _guard()
        if err:
            return err

        data = request.get_json() or {}
        decision = (data.get('decision') or '').strip().lower()
        reason = (data.get('reason') or '').strip()

        mapping = {'approve': 'active', 'reject': 'pending', 'suspend': 'suspended'}
        if decision not in mapping:
            return jsonify(response={'message': 'decision must be approve, reject or suspend.'},
                           status=400, bool=False)
        if not reason:
            # The admin reads this. "Rejected" with no explanation produces an
            # email to you asking why, every time.
            return jsonify(response={'message': 'A reason is required.'},
                           status=400, bool=False)

        # An admin removing their own access would lock the console, and a
        # super-admin acting on their own admin row is almost always a mistake.
        if admin_id == actor:
            return jsonify(response={'message': 'You cannot change your own access.'},
                           status=400, bool=False)

        try:
            # ── SP: sp_admin_set_state ──────────────────────────────────────
            row = call_proc_one('sp_admin_set_state', admin_id, mapping[decision],
                                reason, actor, 'super_admin')
            db.session.commit()
            logger.info(f"admin {admin_id}: {row.get('from_state')} -> {mapping[decision]} by {actor}")
            return jsonify(response={
                'message': {'approve': 'Admin approved.',
                            'reject': 'Admin sent back to pending.',
                            'suspend': 'Admin suspended.'}[decision],
                'state': mapping[decision],
            }, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            msg = str(e)
            if 'ADMIN_NOT_FOUND' in msg:
                return jsonify(response={'message': 'Admin not found.'}, status=404, bool=False)
            logger.error(f"admin state change failed for {admin_id}: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id},
                           status=500, bool=False)


@ns.route('/audit')
class SuperAudit(Resource):

    @jwt_required()
    def get(self):
        """Who did what, across achievers, admins, payouts and commission."""
        _, err = _guard()
        if err:
            return err
        try:
            limit = int(request.args.get('limit') or 100)
            # ── SP: sp_super_audit_feed ─────────────────────────────────────
            rows = call_proc('sp_super_audit_feed', limit) or []
            return jsonify(response={'events': [{
                'area': r.get('area'),
                'action': r.get('action'),
                'target': r.get('target'),
                'reason': r.get('reason'),
                'actor_role': r.get('actor_role'),
                'at': serialize_datetime(r['created_at']) if r.get('created_at') else None,
            } for r in rows]}, status=200, bool=True)
        except Exception as e:
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id},
                           status=500, bool=False)


@ns.route('/admins/<string:admin_id>/history')
class SuperAdminHistory(Resource):

    @jwt_required()
    def get(self, admin_id):
        """Every access decision made about one admin, newest first."""
        _, err = _guard()
        if err:
            return err
        try:
            # ── SP: sp_admin_state_history ──────────────────────────────────
            rows = call_proc('sp_admin_state_history', admin_id) or []
            return jsonify(response={'events': [{
                'id': r.get('id'),
                'from_state': r.get('from_state'),
                'to_state': r.get('to_state'),
                'reason': r.get('reason'),
                'actor_role': r.get('actor_role'),
                'actor_name': r.get('actor_name'),
                'at': serialize_datetime(r['created_at']) if r.get('created_at') else None,
            } for r in rows]}, status=200, bool=True)
        except Exception as e:
            error_id = capture_error(e)
            logger.error(f"admin history failed for {admin_id}: {e}")
            return jsonify(response={'message': 'Could not load the history for this account.',
                                     'error_id': error_id}, status=500, bool=False)
