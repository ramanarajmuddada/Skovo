"""Chargebacks — bank disputes on a payment (feature-updates.md §15).

    created / open : order disputed -> Pro locked ('disputed'), admin alerted
    won            : lock lifted, Pro back if it was active
    lost           : treated as a full refund for points and perks (the bank
                     already returned the money, so no wallet credit and no
                     gateway refund); achiever earnings follow the refund record
"""
import logging
import uuid

from sqlalchemy import text

from portal.models import db

logger = logging.getLogger("skovo")


def _status(event_type, dispute):
    st = str((dispute or {}).get('dispute_status') or (dispute or {}).get('status') or '').upper()
    ev = str(event_type or '').upper()
    if 'WON' in st or st in ('DISPUTE_MERCHANT_WON', 'MERCHANT_WON', 'CLOSED_IN_FAVOR_OF_MERCHANT'):
        return 'won'
    if 'LOST' in st or st in ('DISPUTE_CUSTOMER_WON', 'CUSTOMER_WON', 'CLOSED_IN_FAVOR_OF_CUSTOMER'):
        return 'lost'
    if 'CLOSED' in ev and not st:
        return 'won'
    return 'open'


def apply_dispute(order_id, dispute, event_type):
    from portal.helpers import wallet
    order = db.session.execute(text("SELECT * FROM payment_orders WHERE id = :i"), {'i': order_id}).mappings().first()
    if not order:
        return None
    order = dict(order)
    dispute = dispute or {}
    did = str(dispute.get('dispute_id') or dispute.get('cf_dispute_id') or f"{order_id}-dispute")[:80]
    status = _status(event_type, dispute)
    db.session.execute(text(
        "INSERT INTO chargebacks (id, order_id, user_id, dispute_id, status, amount) VALUES (:i, :o, :u, :d, :s, :a) "
        "ON DUPLICATE KEY UPDATE status = :s, closed_at = IF(:s IN ('won','lost'), UTC_TIMESTAMP(), closed_at)"),
        {'i': str(uuid.uuid4()), 'o': order_id, 'u': order.get('student_id'), 'd': did, 's': status,
         'a': dispute.get('dispute_amount') or dispute.get('amount') or order.get('gross')})

    if status == 'open':
        if order['kind'] == 'subscription':
            db.session.execute(text("UPDATE subscriptions SET status = 'disputed' WHERE payment_order_id = :n "
                                    "AND status = 'active'"), {'n': order['order_no']})
        wallet.alert('chargeback', did, f"Chargeback opened on order {order['order_no']} (₹{order.get('gross')}).")
    elif status == 'won':
        if order['kind'] == 'subscription':
            db.session.execute(text("UPDATE subscriptions SET status = 'active' WHERE payment_order_id = :n "
                                    "AND status = 'disputed' AND (expires_at IS NULL OR expires_at > UTC_TIMESTAMP())"),
                               {'n': order['order_no']})
    else:   # lost: the bank refunded the customer
        refund_id = str(uuid.uuid4())
        left = float(order.get('gross') or 0) - float(order.get('refunded_amount') or 0)
        if left > 0:
            db.session.execute(text(
                "INSERT IGNORE INTO refunds (id, refund_key, order_id, order_no, amount, status, reason, destination, case_key) "
                "VALUES (:i, :k, :o, :n, :a, 'succeeded', 'chargeback lost', 'original', 'chargeback')"),
                {'i': refund_id, 'k': f"cb-{did}"[:60], 'o': order_id, 'n': order['order_no'], 'a': left})
            from portal.helpers.sp import call_proc_one
            call_proc_one('sp_payment_order_refund', order_id, left, 'chargeback lost', None)
            wallet.reverse_payment_points(order, left)
            if order['kind'] == 'subscription':
                wallet.remove_pro(order, status='refunded')
            wallet.credit_note(refund_id, order, left, 'original')
        wallet.alert('chargeback_lost', did, f"Chargeback lost on order {order['order_no']}.")
    return status
