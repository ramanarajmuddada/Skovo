"""Recover payments the webhook never confirmed.

The webhook is the normal confirmation path, and the order-status endpoint
reconciles on demand — but only while somebody is looking at the page. A
student who pays and immediately closes the tab, or loses signal on the train,
leaves an order sitting in 'created' with their money already captured.

Nothing else in the system notices. Worse, expire_payment_holds runs every
minute and frees the slot purely on a timer, without ever asking the gateway
whether the money arrived — so the seat goes back on sale while the student is
out of pocket.

This module is the safety net. For every stale order it asks Cashfree what
actually happened:

    PAID, slot still ours      -> apply it; the student gets their booking
    PAID, slot gone to someone -> refund; we cannot deliver what they paid for
    not paid                   -> mark failed and stop re-checking

It is deliberately idempotent: applying goes through the same procedures the
webhook uses, so a webhook arriving later is a no-op rather than a double-book.
"""
import logging
import uuid

from sqlalchemy import text

logger = logging.getLogger('skovo.reconcile')

# How long after the hold lapses before we go asking. Short enough that a
# stranded student is helped quickly, long enough that a merely slow webhook
# gets to win the race on its own.
GRACE_MINUTES = 2

# Orders older than this are somebody's manual problem, not a job's.
LOOKBACK_DAYS = 7

# Cap the batch: each row costs an HTTPS round trip to Cashfree.
BATCH = 50


def reconcile_stuck_orders():
    """Returns (applied, refunded, closed). Safe to call repeatedly."""
    from portal.models import db
    from portal.helpers.sp import call_proc_one
    from portal.helpers.cashfree import (
        get_order, CashfreeError, CashfreeNotConfigured, is_configured,
    )

    if not is_configured():
        return 0, 0, 0

    rows = db.session.execute(text("""
        SELECT id, order_no, kind, slot_id, gross
          FROM payment_orders
         WHERE status IN ('created', 'pending', 'expired')
           AND expires_at IS NOT NULL
           AND expires_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL :grace MINUTE)
           AND created_at  > DATE_SUB(UTC_TIMESTAMP(), INTERVAL :days DAY)
         ORDER BY created_at
         LIMIT :lim
    """), {'grace': GRACE_MINUTES, 'days': LOOKBACK_DAYS, 'lim': BATCH}).fetchall()

    applied = refunded = closed = 0

    for order_id, order_no, kind, slot_id, gross in rows:
        try:
            remote = get_order(order_no) or {}
        except CashfreeNotConfigured:
            return applied, refunded, closed
        except CashfreeError as e:
            # Transient gateway trouble — leave the row for the next run rather
            # than closing an order we could not actually check.
            logger.warning("cannot read %s from gateway: %s", order_no, e)
            continue

        status = remote.get('order_status')

        if status != 'PAID':
            # ACTIVE means they simply never finished paying. Past its deadline
            # it is not going to complete, so stop re-checking it every cycle.
            if status in ('EXPIRED', 'TERMINATED', 'ACTIVE'):
                db.session.execute(text(
                    "UPDATE payment_orders SET status = 'failed', "
                    "failure_reason = :r, updated_at = UTC_TIMESTAMP() "
                    "WHERE id = :i AND status IN ('created','pending','expired')"
                ), {'r': 'reconciled:%s' % status, 'i': order_id})
                db.session.commit()
                closed += 1
            continue

        # Paid. Can we still deliver what they bought?
        deliverable = True
        if slot_id:
            slot_state = db.session.execute(text(
                "SELECT status FROM achiever_slots WHERE id = :s"
            ), {'s': slot_id}).scalar()
            # 'blocked' is still ours — it is this order's own hold.
            deliverable = slot_state in ('available', 'blocked')

        if deliverable:
            try:
                if kind == 'cohort':
                    call_proc_one('sp_payment_cohort_mark_paid', order_id, 'cashfree', None)
                else:
                    call_proc_one('sp_payment_order_mark_paid', order_id, 'cashfree',
                                  None, None)
                db.session.commit()
                applied += 1
                logger.info("recovered paid order %s (%s)", order_no, kind)
                if kind == 'cohort':
                    from portal.helpers.booking_alert import alert_cohort_booking
                    alert_cohort_booking(order_id=order_id)
            except Exception as e:
                db.session.rollback()
                logger.error("could not apply paid order %s: %s", order_no, e)
        else:
            refunded += _refund(order_id, order_no, gross)

    if applied or refunded or closed:
        logger.info("reconcile: %d recovered, %d refunded, %d closed",
                    applied, refunded, closed)
    return applied, refunded, closed


def _refund(order_id, order_no, gross):
    """Give the money back when the seat went to someone else mid-payment.

    Returns 1 on success, 0 otherwise. A failure here is logged loudly rather
    than retried blindly: a refund that keeps failing needs a human, and
    hammering the gateway would not help.
    """
    from portal.helpers.refunds import issue_refund

    ok, info = issue_refund(
        order_id, gross, 'auto-refund: seat taken before payment confirmed',
        refund_key='rf-%s-st' % str(order_no)[:24],
        case_key='seat_taken',
    )
    return 1 if ok else 0
