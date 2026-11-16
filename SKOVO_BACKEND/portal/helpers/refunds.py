"""Gateway-first refunds, with the SKOVO Wallet as a second destination.

Cancel used to mark the row refunded and then ask Cashfree, logging failure.
This module is the order `reconcile._refund` already had: money moves, then
the ledger. Unique refund_key per attempt so a 50% cancel plus goodwill are
two Cashfree refunds, not a reused `rf-{order_no}`.

Version 1 (feature-updates.md §15):
  * destination 'wallet' (instant, optional admin bonus) or 'original' (Cashfree)
  * the part of an order the wallet paid always goes back to the wallet first
  * after any successful refund: payment points reversed, Pro removed, GST
    credit note, abuse check, notification (helpers/wallet.after_refund)
  * a failed gateway refund is retried by a job (retries / next_retry_at)
"""
import datetime
import logging
import uuid

from sqlalchemy import text

logger = logging.getLogger('skovo.refunds')

RETRY_GAPS_HOURS = (1, 6, 24)


def lookup_order(order_id):
    """Return (id, order_no, gross, status, refunded_amount) or None."""
    from portal.models import db
    row = db.session.execute(text(
        "SELECT id, order_no, gross, status, IFNULL(refunded_amount, 0) "
        "  FROM payment_orders WHERE id = :i"
    ), {'i': order_id}).fetchone()
    if not row:
        row = db.session.execute(text(
            "SELECT id, order_no, gross, status, IFNULL(refunded_amount, 0) "
            "  FROM payment_orders WHERE order_no = :n"
        ), {'n': order_id}).fetchone()
    return row


def _order(oid):
    from portal.models import db
    r = db.session.execute(text("SELECT * FROM payment_orders WHERE id = :i"), {'i': oid}).mappings().first()
    return dict(r) if r else None


def _wallet_returned(oid):
    from portal.models import db
    return float(db.session.execute(text(
        "SELECT IFNULL(SUM(wallet_part), 0) FROM refunds WHERE order_id = :o AND status = 'succeeded'"),
        {'o': oid}).scalar() or 0)


def gateway_refund_only(order_id, amount, reason, actor_id=None, refund_key=None):
    """A Cashfree refund with no wallet logic and no side effects (used for
    wallet send-to-bank, whose money already left the order's books)."""
    from portal.models import db
    from portal.helpers.payments import refund_payment
    row = lookup_order(order_id)
    if not row:
        return False, 'order not found'
    oid, order_no = row[0], row[1]
    key = refund_key or f"rf-{str(order_no)[:20]}-{uuid.uuid4().hex[:8]}"
    db.session.execute(text(
        "INSERT IGNORE INTO refunds (id, refund_key, order_id, order_no, amount, status, reason, actor_id, case_key) "
        "VALUES (:i, :k, :o, :n, :a, 'pending', :r, :u, 'send_to_bank')"),
        {'i': str(uuid.uuid4()), 'k': key, 'o': oid, 'n': order_no, 'a': amount, 'r': reason, 'u': actor_id})
    db.session.commit()
    try:
        ok, info = refund_payment(order_no, amount, refund_id=key, note=reason or '')
    except Exception as e:                                   # noqa: BLE001
        ok, info = False, str(e)
    db.session.execute(text("UPDATE refunds SET status = :s, reason = IF(:s = 'failed', :r, reason) WHERE refund_key = :k"),
                       {'s': 'succeeded' if ok else 'failed', 'r': str(info)[:500], 'k': key})
    db.session.commit()
    return ok, info


def issue_refund(order_id, amount, reason, actor_id=None, refund_key=None,
                 destination='original', case_key=None, reason_code=None, reason_text=None):
    """Refund `amount` of an order (default: everything still refundable).

    destination 'original': the wallet-paid part returns to the wallet, the rest
    goes to Cashfree first and our records change only on success.
    destination 'wallet':   everything returns to the wallet now, plus the admin
    bonus % for this case on the part that was paid by card / UPI.

    Returns (ok: bool, info). Booking rows are the caller's job after this.
    """
    from portal.models import db
    from portal.helpers.sp import call_proc_one
    from portal.helpers.payments import refund_payment
    from portal.helpers import wallet

    row = lookup_order(order_id)
    if not row:
        return False, 'order not found'

    oid, order_no, gross, status, already = row
    if status not in ('paid', 'settled'):
        return False, 'order not refundable'

    amt = float(amount if amount is not None else (float(gross or 0) - float(already or 0)))
    if amt <= 0:
        return True, 'nothing to refund'
    if amt > float(gross or 0) - float(already or 0) + 0.005:
        return False, 'refund is more than what is left on the order'
    # v1: every refund goes straight to the student's SKOVO wallet -- no
    # "wallet or bank" choice, and no refund bonus. The student can still ask
    # for wallet refund money to go back to their bank (send-to-bank request).
    destination = 'wallet'

    order = _order(oid)
    wallet_left = max(0.0, float(order.get('wallet_amount') or 0) - _wallet_returned(oid))
    wallet_part = round(min(amt, wallet_left), 2)
    gateway_part = round(amt - wallet_part, 2)

    key = refund_key or f"rf-{str(order_no)[:20]}-{uuid.uuid4().hex[:8]}"

    existing = db.session.execute(text(
        "SELECT id, status FROM refunds WHERE refund_key = :k"
    ), {'k': key}).fetchone()
    if existing and existing[1] == 'succeeded':
        return True, 'already refunded'

    refund_id = existing[0] if existing else str(uuid.uuid4())
    if not existing:
        db.session.execute(text("""
            INSERT INTO refunds
                (id, refund_key, order_id, order_no, amount, status, reason, actor_id,
                 destination, case_key, reason_code, reason_text, wallet_part)
            VALUES (:i, :k, :o, :n, :a, 'pending', :r, :u, :d, :c, :rc, :rt, :wp)
        """), {
            'i': refund_id, 'k': key, 'o': oid, 'n': order_no, 'a': amt, 'r': reason, 'u': actor_id,
            'd': destination, 'c': case_key, 'rc': reason_code, 'rt': (reason_text or '')[:500] or None,
            'wp': wallet_part,
        })
        db.session.commit()

    bonus = 0.0
    info = 'refunded to wallet'
    if destination == 'wallet':
        if wallet_part:
            wallet._restore_wallet_part(order, wallet_part, f'refund-{refund_id[:8]}')
        if gateway_part:
            wallet.credit_refund(order['student_id'], gateway_part, f'refund-{refund_id}', oid, refund_id,
                                 reason or 'refund')
            # No refund bonus in v1: the wallet gets exactly what was paid.
    else:
        if gateway_part > 0:
            try:
                ok, info = refund_payment(order_no, gateway_part, refund_id=key, note=reason or '')
            except Exception as e:
                logger.error("refund gateway error for %s: %s", order_no, e)
                ok, info = False, str(e)
            if not ok:
                logger.error("REFUND FAILED for %s (%s) — %s", order_no, gateway_part, info)
                db.session.execute(text(
                    "UPDATE refunds SET status = 'failed', reason = :r, retries = retries + 1, "
                    "next_retry_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL :h HOUR) WHERE refund_key = :k"
                ), {'r': str(info)[:500], 'k': key, 'h': RETRY_GAPS_HOURS[0]})
                db.session.commit()
                return False, info
        if wallet_part:
            wallet._restore_wallet_part(order, wallet_part, f'refund-{refund_id[:8]}')

    call_proc_one('sp_payment_order_refund', oid, amt, reason, actor_id)
    gw_id, arn = None, None
    if isinstance(info, dict):
        gw_id = info.get('cf_refund_id') or info.get('refund_id')
        arn = info.get('refund_arn') or info.get('arn')
    db.session.execute(text(
        "UPDATE refunds SET status = 'succeeded', gateway_refund_id = :g, arn = IFNULL(:arn, arn), "
        "bonus_amount = :b, next_retry_at = NULL WHERE refund_key = :k"
    ), {'g': gw_id, 'arn': arn, 'b': bonus, 'k': key})
    db.session.commit()
    wallet.after_refund(refund_id, _order(oid), amt, destination, bonus)
    db.session.commit()
    logger.info("refunded %s amount=%s key=%s destination=%s", order_no, amt, key, destination)
    return True, info


def retry_failed(max_retries=None):
    """Job: retry failed gateway refunds on the backoff schedule; after the last
    try, alert admin and offer the student wallet credit."""
    from portal.models import db
    from portal.helpers import wallet
    from portal.helpers.notifications import notify_user
    max_retries = max_retries or int(wallet.settings().get('refund_retry_max') or 3)
    rows = db.session.execute(text(
        "SELECT r.*, o.student_id FROM refunds r JOIN payment_orders o ON o.id = r.order_id "
        "WHERE r.status = 'failed' AND r.destination = 'original' AND r.case_key <> 'send_to_bank' "
        "AND r.next_retry_at IS NOT NULL AND r.next_retry_at <= UTC_TIMESTAMP() LIMIT 100")).mappings().all()
    done = 0
    for r in rows:
        ok, _info = issue_refund(r['order_id'], float(r['amount']), r['reason'], r['actor_id'],
                                 refund_key=r['refund_key'], destination='original', case_key=r['case_key'])
        if ok:
            done += 1
            continue
        tries = int(r['retries'] or 0) + 1
        if tries >= max_retries:
            db.session.execute(text("UPDATE refunds SET next_retry_at = NULL WHERE refund_key = :k"),
                               {'k': r['refund_key']})
            wallet.alert('refund_failed', r['refund_key'], f"Refund {r['refund_key']} failed {tries} times.")
            if wallet.enabled():
                notify_user(r['student_id'], 'Refund delayed',
                            'We could not send your refund to your bank. You can take it as SKOVO Wallet credit instantly.',
                            type='payment', reference_type='refund', reference_id=r['id'])
        else:
            gap = RETRY_GAPS_HOURS[min(tries, len(RETRY_GAPS_HOURS) - 1)]
            db.session.execute(text("UPDATE refunds SET next_retry_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL :h HOUR) "
                                    "WHERE refund_key = :k"), {'h': gap, 'k': r['refund_key']})
        db.session.commit()
    return done


def move_failed_to_wallet(refund_row_id, user_id):
    """Student chose wallet credit for a refund the bank could not take."""
    from portal.models import db
    from portal.helpers import wallet
    r = db.session.execute(text(
        "SELECT r.*, o.student_id FROM refunds r JOIN payment_orders o ON o.id = r.order_id "
        "WHERE r.id = :i AND r.status = 'failed'"), {'i': refund_row_id}).mappings().first()
    if not r or r['student_id'] != user_id:
        return False, 'Refund not found.'
    if not wallet.enabled():
        return False, 'The wallet is not available.'
    db.session.execute(text("UPDATE refunds SET status = 'cancelled', next_retry_at = NULL WHERE id = :i"),
                       {'i': refund_row_id})
    db.session.commit()
    return issue_refund(r['order_id'], float(r['amount']), r['reason'], user_id,
                        refund_key=f"{r['refund_key'][:30]}-w", destination='wallet', case_key=r['case_key'],
                        reason_code=r.get('reason_code'))


def sla_alerts():
    """Job: bank refunds not credited within the admin SLA days."""
    from portal.models import db
    from portal.helpers import wallet
    days = int(wallet.settings().get('refund_sla_days') or 0)
    if days <= 0:
        return 0
    rows = db.session.execute(text(
        "SELECT r.id, r.refund_key, o.student_id FROM refunds r JOIN payment_orders o ON o.id = r.order_id "
        "WHERE r.destination = 'original' AND r.status = 'pending' "
        "AND r.created_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL :d DAY)"), {'d': days}).mappings().all()
    from portal.helpers.notifications import notify_user
    for r in rows:
        wallet.alert('refund_sla', r['refund_key'], f"Refund {r['refund_key']} not credited after {days} days.")
        notify_user(r['student_id'], 'We are checking your refund',
                    'Your refund is taking longer than usual. Our team is following up.',
                    type='payment', reference_type='refund', reference_id=r['id'])
    db.session.commit()
    return len(rows)


REASON_CODES = ('timing_clash', 'achiever_issue', 'not_as_expected', 'changed_mind', 'other')


def choice_from(req_json):
    """(destination, reason_code, reason_text) from a cancel request body.
    Old clients send nothing: destination 'original', exactly as before."""
    d = req_json or {}
    dest = d.get('refund_to') if d.get('refund_to') in ('wallet', 'original') else 'original'
    code = d.get('reason_code') if d.get('reason_code') in REASON_CODES else None
    return dest, code, (d.get('reason_text') or '').strip()[:500] or None


def prorata_amount(enrollment_id, quoted):
    """Cohorts with pro-rata on: refund only sessions not yet held, once the
    cohort has started. Returns (amount, used_prorata)."""
    from portal.models import db
    from portal.helpers import wallet
    r = db.session.execute(text(
        "SELECT ce.amount_paid, c.id AS cohort_id, IFNULL(c.prorata_refund, 0) AS prorata "
        "FROM cohort_enrollments ce JOIN cohorts c ON c.id = ce.cohort_id WHERE ce.id = :e"),
        {'e': enrollment_id}).mappings().first()
    if not r or not r['prorata']:
        return quoted, False
    total, held = db.session.execute(text(
        "SELECT COUNT(*), SUM(session_date <= UTC_TIMESTAMP()) FROM cohort_sessions "
        "WHERE cohort_id = :c AND deleted_at IS NULL"), {'c': r['cohort_id']}).first()
    total, held = int(total or 0), int(held or 0)
    if total < 2 or held < 1 or held >= total:
        return quoted, False
    keep = int(wallet.settings().get('prorata_min_keep_pct') or 0)
    amt = round(float(r['amount_paid'] or 0) * (total - held) / total * (100 - keep) / 100, 2)
    return max(quoted, amt), amt > quoted


def pro_cancel_quote(user_id):
    """Cancel Skovo Pro any time: refund the unused days, to the wallet.

    Every day counts and today counts as used: a 30-day plan cancelled on its
    4th day refunds 26/30 of the price. Exact, never rounded (only to the
    paisa). Seats and courses taken free with Pro during this subscription are
    taken off at their price, so Pro cannot be bought, used for a paid seat
    and cancelled for nearly all of it back. No cancellation fee: the student
    gets the whole unused part. Returns None without an active web-bought Pro.
    """
    import math
    from decimal import Decimal
    from portal.models import db
    from portal.helpers import wallet
    sub = db.session.execute(text(
        "SELECT s.id, s.plan, s.amount, s.started_at, s.expires_at, s.payment_order_id, "
        "       o.id AS order_id, o.order_no, o.gross, IFNULL(o.refunded_amount, 0) AS refunded "
        "  FROM subscriptions s JOIN payment_orders o ON o.order_no = s.payment_order_id "
        " WHERE s.user_id = :u AND s.status = 'active' AND o.kind = 'subscription' "
        "   AND o.status IN ('paid', 'settled') "
        " ORDER BY s.started_at DESC LIMIT 1"), {'u': user_id}).mappings().first()
    if not sub or not sub['started_at'] or not sub['expires_at']:
        return None
    now = datetime.datetime.utcnow()
    total = max(1, round((sub['expires_at'] - sub['started_at']).total_seconds() / 86400))
    used = min(total, max(1, math.floor((now - sub['started_at']).total_seconds() / 86400) + 1))
    unused = total - used
    paid = Decimal(str(sub['gross'] or 0)) - Decimal(str(sub['refunded'] or 0))
    unused_value = paid * unused / total
    fee_pct = Decimal(0)   # v1: no cancellation fee
    fee = Decimal(0)
    perks = db.session.execute(text(
        "SELECT IFNULL(SUM(c.price), 0) FROM cohort_enrollments e JOIN cohorts c ON c.id = e.cohort_id "
        " WHERE e.user_id = :u AND e.coupon_code = 'SKOVO_PRO' AND e.payment_status = 'free' "
        "   AND e.enrolled_at >= :s"), {'u': user_id, 's': sub['started_at']}).scalar() or 0
    perks = Decimal(str(perks)) + Decimal(str(db.session.execute(text(
        "SELECT IFNULL(SUM(ac.price), 0) FROM course_enrollments e JOIN achiever_courses ac ON ac.id = e.course_id "
        " WHERE e.user_id = :u AND e.coupon_code = 'SKOVO_PRO' AND e.enrolled_at >= :s"),
        {'u': user_id, 's': sub['started_at']}).scalar() or 0))
    refund = max(Decimal('0'), unused_value - fee - perks).quantize(Decimal('0.01'))
    return {
        'order_id': sub['order_id'], 'order_no': sub['order_no'], 'plan': sub['plan'],
        'paid': float(paid), 'total_days': total, 'used_days': used, 'unused_days': unused,
        'unused_value': float(unused_value.quantize(Decimal('0.01'))),
        'fee_pct': float(fee_pct), 'fee': float(fee.quantize(Decimal('0.01'))),
        'perks_used': float(perks.quantize(Decimal('0.01'))), 'refund': float(refund),
        'expires_at': sub['expires_at'],
    }


def inr(amount):
    """Rupees exactly as paid, never rounded: 10 -> Rs 10, 2.5 -> Rs 2.50."""
    v = float(amount or 0)
    return f"₹{v:,.0f}" if v == int(v) else f"₹{v:,.2f}"


def refund_text(refund):
    """The line a student sees before confirming a cancel."""
    if float(refund or 0) <= 0:
        return 'No refund this close to the class. You will still be un-enrolled.'
    return f"{inr(refund)} goes back to your SKOVO Wallet instantly."


RULE_SETS = {'cohort': 'floor', 'session': 'session'}


def student_rules(kind):
    """Admin's cancellation rules for students, most notice first:
    [{'min_hours': 24.0, 'pct': 100.0}, ...]. 1-on-1 uses the cohort rules
    until admin saves its own."""
    from portal.helpers.sp import call_proc
    rows = call_proc('sp_refund_rules_get', RULE_SETS.get(kind, 'floor')) or []
    if not rows and kind == 'session':
        rows = call_proc('sp_refund_rules_get', 'floor') or []
    return [{'min_hours': float(r['min_hours']), 'pct': float(r['refund_pct'])} for r in rows]
