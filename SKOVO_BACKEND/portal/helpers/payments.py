"""Payment helpers (refunds), on Cashfree.

Replaces the Razorpay implementation. Two things went with it:

  * `route_transfer` — a Razorpay Route scaffold for splitting payments to
    achievers at capture time. It was never called from anywhere. SKOVO settles
    manually from its own account via payout_requests, so an automated split
    was not just unused but the wrong model; it is not reimplemented here.

  * The silent no-op on missing credentials. Returning False when the gateway
    is unconfigured let a booking be marked refunded in the database while no
    money moved, and nothing downstream could tell the difference. Missing
    credentials now raise.
"""
import logging

from portal.helpers.cashfree import (
    refund as cashfree_refund,
    get_order as cashfree_get_order,
    CashfreeError,
    CashfreeNotConfigured,
)

logger = logging.getLogger("skovo")


def refund_payment(order_no: str, amount: float = None, refund_id: str = None,
                   note: str = None):
    """Refund a Cashfree order. Returns (ok: bool, info).

    Note the argument change from the Razorpay version: Cashfree refunds are
    issued against the **order**, not the payment id. Callers hold
    `payment_orders.order_no`, which is what to pass.

    `refund_id` is the idempotency key — reuse it when retrying the same refund
    and Cashfree will not pay out twice. Callers that omit it get one derived
    from the order, which is correct for the common case of one full refund per
    order but wrong for repeated partials, so pass your own for those.
    """
    if not order_no:
        return False, 'no order_no'

    rid = refund_id or f'rf-{order_no}'

    try:
        if amount is None:
            # Cashfree needs an explicit amount; ask it what was charged rather
            # than assuming the caller's figure matches what actually settled.
            order = cashfree_get_order(order_no)
            amount = order.get('order_amount')
            if amount is None:
                return False, 'could not determine order amount'

        result = cashfree_refund(order_no, rid, amount, note=note)
        logger.info("Cashfree refund %s issued for order %s (%s)", rid, order_no, amount)
        return True, result

    except CashfreeNotConfigured as e:
        # Loud on purpose. The old code returned False here, which let a booking
        # be marked refunded while no money moved.
        logger.error("Refund attempted with Cashfree unconfigured: %s", e)
        raise

    except CashfreeError as e:
        logger.error("Cashfree refund failed for order %s: %s (status=%s)",
                     order_no, e, e.status)
        return False, str(e)
