"""Order status, and the reconciler behind it.

The browser cannot be trusted to report a payment. Under Razorpay the client
posted back a signature and the server verified it, which meant a student who
closed the tab at the wrong moment had paid with nothing recorded. Cashfree's
webhook is authoritative instead, and this endpoint is what the client polls
while waiting for it.

The webhook and the redirect race: the student is usually back before Cashfree
has called us. So a status read for an unresolved order asks Cashfree directly
rather than reporting a stale 'created' — which the UI would otherwise show as
failure to someone whose money has already left their account.
"""
from flask import jsonify
from flask_restx import Resource
from flask_jwt_extended import jwt_required, get_jwt_identity
from sqlalchemy import text

from portal.models import db
from portal.helpers.error_capture import capture_error
from portal.helpers.helpers import serialize_datetime
from portal.helpers.sp import call_proc, call_proc_one
from . import ns, logger

# Statuses that cannot change without a further payment event, so there is
# nothing to reconcile.
TERMINAL = ('paid', 'settled', 'refunded', 'failed', 'expired')


@ns.route('/orders/<string:order_id>')
class PaymentOrderStatus(Resource):

    @jwt_required()
    def get(self, order_id):
        """Current status of one order, reconciled against Cashfree if pending."""
        user_id = get_jwt_identity()
        try:
            row = db.session.execute(text(
                "SELECT id, order_no, kind, status, gross, currency, student_id, "
                "       ref_id, slot_id, expires_at "
                "  FROM payment_orders WHERE id = :i"
            ), {'i': order_id}).fetchone()

            if not row:
                return jsonify(response={'message': 'Order not found'}, status=404, bool=False)

            # An order belongs to the student who opened it. Without this check
            # any signed-in user could enumerate other people's payments.
            if str(row[6]) != str(user_id):
                logger.warning("Order %s requested by non-owner %s", order_id, user_id)
                return jsonify(response={'message': 'Order not found'}, status=404, bool=False)

            status = row[3]

            if status not in TERMINAL:
                status = _reconcile(order_id, row[1], row[2]) or status

            return jsonify(response={
                'order_id':   row[0],
                'order_no':   row[1],
                'kind':       row[2],
                'status':     status,
                'amount':     float(row[4]) if row[4] is not None else None,
                'currency':   row[5],
                'expires_at': serialize_datetime(row[9]) if row[9] else None,
            }, status=200, bool=True)

        except Exception as e:
            db.session.rollback()
            logger.error("Order status failed for %s: %s", order_id, e)
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal error', 'error_id': error_id},
                           status=500, bool=False)


def _reconcile(order_id, order_no, kind):
    """Ask Cashfree what really happened, and apply it if the webhook has not.

    This is the safety net for a webhook that was never delivered — a deploy
    mid-flight, a network partition, a bad response. Without it an order sits
    'created' forever while the student's money is gone.

    Applies through the same procedures the webhook uses, so a webhook arriving
    afterwards is a no-op rather than a double-apply.
    """
    from portal.helpers.cashfree import get_order, CashfreeError, CashfreeNotConfigured

    try:
        remote = get_order(order_no)
    except CashfreeNotConfigured:
        # Nothing to reconcile against; report what we have.
        return None
    except CashfreeError as e:
        logger.warning("Reconcile: could not read order %s from Cashfree: %s", order_no, e)
        return None

    remote_status = (remote or {}).get('order_status')

    if remote_status == 'PAID':
        logger.info("Reconcile: order %s is PAID at Cashfree; applying", order_no)
        if kind == 'cohort':
            call_proc_one('sp_payment_cohort_mark_paid', order_id, 'cashfree', None)
        else:
            call_proc_one('sp_payment_order_mark_paid', order_id, 'cashfree',
                          None, None)
        db.session.commit()
        if kind == 'cohort':
            from portal.helpers.booking_alert import alert_cohort_booking
            alert_cohort_booking(order_id=order_id)
        if kind == 'session':
            from portal.helpers.booking_alert import alert_new_booking
            alert_new_booking(order_id=order_id)
        if kind == 'subscription':
            from portal.routes.Subscription.subscription import activate_paid_subscription
            activate_paid_subscription(order_id)
        return 'paid'

    if remote_status in ('EXPIRED', 'TERMINATED'):
        db.session.execute(text(
            "UPDATE payment_orders SET status = 'failed', "
            "failure_reason = :r, updated_at = UTC_TIMESTAMP() "
            "WHERE id = :i AND status IN ('created','pending')"
        ), {'r': f'cashfree:{remote_status}', 'i': order_id})
        db.session.commit()
        return 'failed'

    # ACTIVE — the student has not finished paying. Leave the hold alone;
    # expire_payment_holds owns that decision.
    return None


# ── Student: their own payment history ────────────────────────────────────────
# Scoped by the JWT identity inside SQL, not filtered in Python afterwards. The
# older money screens (Billing /invoices) pull 50,000 rows and filter here,
# which is invisible on an empty dev database and becomes the slowest request
# on the platform with real volume.
@ns.route('/history')
class PaymentHistory(Resource):

    @jwt_required()
    def get(self):
        """Every order this student placed, newest first, with refund state."""
        user_id = get_jwt_identity()
        try:
            from flask import request
            try:
                limit = min(int(request.args.get('limit', 50)), 200)
                offset = max(int(request.args.get('offset', 0)), 0)
            except (TypeError, ValueError):
                limit, offset = 50, 0

            rows = call_proc('sp_payment_history_student', user_id, limit, offset)
            summary = call_proc_one('sp_payment_history_summary', user_id)

            def money(v):
                return float(v) if v is not None else 0.0

            orders = [{
                'id':             r.get('id'),
                'order_no':       r.get('order_no'),
                'kind':           r.get('kind'),
                'status':         r.get('status'),
                'label':          r.get('label'),
                'currency':       r.get('currency') or 'INR',
                'amount':         money(r.get('amount_paid')),
                'discount':       money(r.get('discount')),
                'list_price':     money(r.get('list_price')),
                'coupon_code':    r.get('coupon_code'),
                'refunded_amount': money(r.get('refunded_amount')),
                # Only ever a reason the student can act on. failure_reason also
                # carries refund notes, so it is surfaced for both.
                'reason':         r.get('failure_reason'),
                'achiever_name':  r.get('achiever_name'),
                'paid_at':        serialize_datetime(r.get('paid_at')) if r.get('paid_at') else None,
                'created_at':     serialize_datetime(r.get('created_at')) if r.get('created_at') else None,
                'ref_id':         r.get('ref_id'),
            } for r in rows]

            return jsonify(response={
                'orders': orders,
                'summary': {
                    'orders':         int(summary.get('orders') or 0),
                    'total_paid':     money(summary.get('total_paid')),
                    'total_refunded': money(summary.get('total_refunded')),
                    'pending':        int(summary.get('pending') or 0),
                    'failed':         int(summary.get('failed') or 0),
                } if summary else None,
                'has_more': len(orders) == limit,
            }, status=200, bool=True)
        except Exception as e:
            error_id = capture_error(e)
            logger.error(f"payment history failed for {user_id}: {e}")
            return jsonify(response={'message': 'Could not load your payments.',
                                     'error_id': error_id}, status=500, bool=False)
