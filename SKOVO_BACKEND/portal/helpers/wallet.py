"""SKOVO Wallet and refund effects (feature-updates.md §15; SKOVO-refunds-wallet-v1.xlsx).

Two balances:
    refund money  never expires; can go back to the original payment source
                  within the admin window (send-to-bank request)
    bonus credit  expires (admin months); spent first, earliest expiry first;
                  capped per purchase (admin %)
Closed wallet: spend only on SKOVO; no cash-out, no transfers.

Everything is OFF (wallet_settings.enabled = 0) and every bonus % is 0 until
admin sets them. All money moves are rows in wallet_ledger (append-only); the
balance is the sum. A per-student row in `wallets` is locked FOR UPDATE around
every spend so two taps cannot both pass the balance check.
"""
import datetime
import json
import logging
import uuid
from decimal import Decimal, ROUND_HALF_UP

from sqlalchemy import text

from portal.models import db
from portal.helpers.sp import call_proc_one

logger = logging.getLogger("skovo")
D0 = Decimal('0.00')


def _d(v):
    return Decimal(str(v or 0)).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)


def _one(sql, **p):
    r = db.session.execute(text(sql), p).mappings().first()
    return dict(r) if r else None


def _rows(sql, **p):
    return [dict(r) for r in db.session.execute(text(sql), p).mappings().all()]


def settings():
    db.session.execute(text("INSERT IGNORE INTO wallet_settings (id) VALUES (1)"))
    return _one("SELECT * FROM wallet_settings WHERE id = 1") or {}


def enabled():
    # v1: the wallet is always on -- every refund lands in it. The old
    # wallet_settings.enabled switch is no longer read.
    return True


def _lock(user_id):
    db.session.execute(text("INSERT IGNORE INTO wallets (user_id) VALUES (:u)"), {'u': user_id})
    db.session.execute(text("SELECT user_id FROM wallets WHERE user_id = :u FOR UPDATE"), {'u': user_id})


def _ledger(user_id, kind, type_, amount, ref, order_id=None, refund_id=None, expires_at=None,
            reason=None, actor_id=None):
    res = db.session.execute(text(
        "INSERT IGNORE INTO wallet_ledger (user_id, kind, type, amount, order_id, refund_id, expires_at, reason, "
        "actor_id, ref) VALUES (:u, :k, :t, :a, :o, :r, :e, :rs, :ac, :ref)"),
        {'u': user_id, 'k': kind, 't': type_, 'a': _d(amount), 'o': order_id, 'r': refund_id, 'e': expires_at,
         'rs': (reason or '')[:255] or None, 'ac': actor_id, 'ref': str(ref)[:100]})
    return res.rowcount > 0


# ── balances ─────────────────────────────────────────────────────────────────

def balances(user_id):
    refund = _d((_one("SELECT IFNULL(SUM(amount), 0) AS s FROM wallet_ledger WHERE user_id = :u AND kind = 'refund'",
                      u=user_id) or {}).get('s'))
    lots = _rows("SELECT remaining, expires_at FROM wallet_bonus_lots WHERE user_id = :u AND remaining > 0 "
                 "AND expires_at > UTC_TIMESTAMP() ORDER BY expires_at", u=user_id)
    bonus = sum((_d(l['remaining']) for l in lots), D0)
    return {'refund_money': float(refund), 'bonus_credit': float(bonus), 'total': float(refund + bonus),
            'bonus_expires_next': lots[0]['expires_at'].isoformat() + 'Z' if lots else None,
            'bonus_expiring_amount': float(_d(lots[0]['remaining'])) if lots else 0.0}


def history(user_id, limit=100):
    return [{'type': r['type'], 'kind': r['kind'], 'amount': float(r['amount']), 'reason': r['reason'],
             'order_id': r['order_id'], 'expires_at': r['expires_at'].isoformat() + 'Z' if r['expires_at'] else None,
             'at': r['created_at'].isoformat() + 'Z'}
            for r in _rows("SELECT * FROM wallet_ledger WHERE user_id = :u ORDER BY id DESC LIMIT :n", u=user_id, n=limit)]


# ── credits ──────────────────────────────────────────────────────────────────

def credit_refund(user_id, amount, ref, order_id=None, refund_id=None, reason=None, actor_id=None):
    if _d(amount) <= 0:
        return False
    _lock(user_id)
    return _ledger(user_id, 'refund', 'refund_credit', amount, ref, order_id, refund_id, None, reason, actor_id)


def credit_bonus(user_id, amount, ref, expires_at=None, reason=None, actor_id=None, type_='bonus_credit'):
    amount = _d(amount)
    if amount <= 0:
        return False
    if expires_at is None:
        months = int(settings().get('bonus_expiry_months') or 6)
        expires_at = datetime.datetime.utcnow() + datetime.timedelta(days=30 * months)
    if expires_at <= datetime.datetime.utcnow():
        return False                                   # already expired: not restored
    _lock(user_id)
    if not _ledger(user_id, 'bonus', type_, amount, ref, None, None, expires_at, reason, actor_id):
        return False
    db.session.execute(text(
        "INSERT INTO wallet_bonus_lots (id, user_id, amount, remaining, expires_at, source_ref) "
        "VALUES (:i, :u, :a, :a, :e, :r)"),
        {'i': str(uuid.uuid4()), 'u': user_id, 'a': amount, 'e': expires_at, 'r': str(ref)[:100]})
    return True


def goodwill(user_id, amount, kind, reason, admin_id):
    ref = f'goodwill-{uuid.uuid4().hex[:12]}'
    if kind == 'bonus':
        return credit_bonus(user_id, amount, ref, reason=reason, actor_id=admin_id, type_='goodwill')
    _lock(user_id)
    return _ledger(user_id, 'refund', 'goodwill', amount, ref, reason=reason, actor_id=admin_id)


# ── spending at checkout ─────────────────────────────────────────────────────

def usable_on(kind):
    s = settings()
    return kind in [x.strip() for x in str(s.get('usable_on') or '').split(',')]


def covers(user_id, price, kind):
    """True when the wallet alone can pay `price` (same rules as apply_to_order,
    nothing written). Then no gateway is used, so no mobile number is needed."""
    price = _d(price)
    if price <= 0 or not usable_on(kind):
        return False
    cap = price * _d(int(settings().get('bonus_cap_pct') or 0)) / Decimal(100)
    bonus = sum((_d(l['remaining']) for l in _rows(
        "SELECT remaining FROM wallet_bonus_lots WHERE user_id = :u AND remaining > 0 AND expires_at > UTC_TIMESTAMP()",
        u=user_id)), D0)
    refund = _d((_one("SELECT IFNULL(SUM(amount), 0) AS s FROM wallet_ledger WHERE user_id = :u AND kind = 'refund'",
                      u=user_id) or {}).get('s'))
    return min(bonus, cap) + max(D0, refund) >= price


def apply_to_order(order_id, user_id, price, kind, use_wallet):
    """Take what the wallet can pay of `price` (bonus first, capped; then refund
    money). Writes payment_orders.wallet_* and gateway_amount. -> remainder to pay.

    The order's gross stays the full price, so achiever earnings and refunds are
    computed on what the purchase was worth, not on how it was paid.
    """
    price = _d(price)
    if not use_wallet or price <= 0 or not usable_on(kind):
        db.session.execute(text("UPDATE payment_orders SET gateway_amount = :g WHERE id = :o"),
                           {'g': price, 'o': order_id})
        return float(price)
    s = settings()
    _lock(user_id)
    cap = price * _d(int(s.get('bonus_cap_pct') or 0)) / Decimal(100)
    bonus_used, lots_used = D0, []
    for lot in _rows("SELECT id, remaining, expires_at FROM wallet_bonus_lots WHERE user_id = :u AND remaining > 0 "
                     "AND expires_at > UTC_TIMESTAMP() ORDER BY expires_at FOR UPDATE", u=user_id):
        take = min(_d(lot['remaining']), cap - bonus_used)
        if take <= 0:
            break
        lots_used.append((lot, take))
        bonus_used += take
    refund_bal = _d((_one("SELECT IFNULL(SUM(amount), 0) AS s FROM wallet_ledger WHERE user_id = :u AND kind = 'refund'",
                          u=user_id) or {}).get('s'))
    refund_used = max(D0, min(refund_bal, price - bonus_used))
    for lot, take in lots_used:
        db.session.execute(text("UPDATE wallet_bonus_lots SET remaining = remaining - :t WHERE id = :i"),
                           {'t': take, 'i': lot['id']})
        _ledger(user_id, 'bonus', 'spend', -take, f"{order_id}:{lot['id']}", order_id, expires_at=lot['expires_at'],
                reason=f'{kind} purchase')
    if refund_used > 0:
        _ledger(user_id, 'refund', 'spend', -refund_used, order_id, order_id, reason=f'{kind} purchase')
    remainder = price - bonus_used - refund_used
    db.session.execute(text(
        "UPDATE payment_orders SET wallet_amount = :w, wallet_bonus_used = :b, wallet_refund_used = :r, "
        "gateway_amount = :g WHERE id = :o"),
        {'w': bonus_used + refund_used, 'b': bonus_used, 'r': refund_used, 'g': remainder, 'o': order_id})
    return float(remainder)


def complete_wallet_order(order_id, kind):
    """The wallet paid everything: mark paid exactly as the webhook would and
    run the same activation. Returns the mark-paid outcome."""
    ref = f'wallet-{order_id[:8]}'
    if kind == 'cohort':
        res = call_proc_one('sp_payment_cohort_mark_paid', order_id, 'wallet', ref)
    else:
        res = call_proc_one('sp_payment_order_mark_paid', order_id, 'wallet', ref, None)
    outcome = (res or {}).get('result')
    if kind == 'cohort' and outcome == 'paid':
        from portal.helpers.booking_alert import alert_cohort_booking
        alert_cohort_booking(order_id=order_id)
    if kind == 'session' and outcome == 'paid':
        from portal.helpers.booking_alert import alert_new_booking
        alert_new_booking(order_id=order_id)
    if kind == 'subscription' and outcome in ('paid', 'already_paid'):
        from portal.routes.Subscription.subscription import activate_paid_subscription
        activate_paid_subscription(order_id)
    return outcome


def _restore_wallet_part(order, amount, ref_suffix):
    """Give back up to `amount` of what the wallet paid on this order, to the
    same balance types; restored bonus keeps its original expiry."""
    uid = order['student_id']
    left = _d(amount)
    done = D0
    # refund money first back, then bonus (so restorable money is never lost to expiry)
    refund_paid = -_d((_one("SELECT IFNULL(SUM(amount), 0) AS s FROM wallet_ledger WHERE order_id = :o AND kind = 'refund' "
                            "AND type IN ('spend', 'restore')", o=order['id']) or {}).get('s'))
    take = min(left, max(D0, refund_paid))
    if take > 0:
        _lock(uid)
        _ledger(uid, 'refund', 'restore', take, f"{order['id']}:{ref_suffix}", order['id'], reason='returned to wallet')
        left -= take
        done += take
    if left > 0:
        for sp in _rows("SELECT amount, expires_at, ref FROM wallet_ledger WHERE order_id = :o AND kind = 'bonus' "
                        "AND type = 'spend' ORDER BY expires_at DESC", o=order['id']):
            restored = -_d((_one("SELECT IFNULL(SUM(amount), 0) AS s FROM wallet_ledger WHERE user_id = :u AND kind = 'bonus' "
                                 "AND type = 'restore' AND ref LIKE :r", u=uid, r=f"{sp['ref']}:%") or {}).get('s'))
            avail = -_d(sp['amount']) + restored
            give = min(left, max(D0, avail))
            if give <= 0:
                continue
            if credit_bonus(uid, give, f"{sp['ref']}:{ref_suffix}", expires_at=sp['expires_at'],
                            reason='bonus returned', type_='restore'):
                done += give
            left -= give
            if left <= 0:
                break
    return float(done)


def restore_failed_orders():
    """Job: orders that failed / expired after the wallet paid part of them get
    the wallet part back once."""
    n = 0
    for o in _rows("SELECT * FROM payment_orders WHERE wallet_amount > 0 AND wallet_restored = 0 "
                   "AND status IN ('failed', 'expired', 'cancelled') LIMIT 500"):
        _restore_wallet_part(o, o['wallet_amount'], 'failed')
        db.session.execute(text("UPDATE payment_orders SET wallet_restored = 1 WHERE id = :i"), {'i': o['id']})
        n += 1
    return n


def expire_bonus():
    """Job: expired bonus lots stop counting; a ledger row records it."""
    n = 0
    for lot in _rows("SELECT * FROM wallet_bonus_lots WHERE remaining > 0 AND expires_at <= UTC_TIMESTAMP() LIMIT 1000"):
        _ledger(lot['user_id'], 'bonus', 'expire', -_d(lot['remaining']), f"expire-{lot['id']}",
                expires_at=lot['expires_at'], reason='bonus credit expired')
        db.session.execute(text("UPDATE wallet_bonus_lots SET remaining = 0 WHERE id = :i"), {'i': lot['id']})
        n += 1
    return n


def expiry_reminders(days=(30, 7)):
    from portal.helpers.notifications import notify_user
    sent = 0
    for d in days:
        for r in _rows("SELECT user_id, SUM(remaining) AS amt, MIN(expires_at) AS e FROM wallet_bonus_lots "
                       "WHERE remaining > 0 AND DATE(expires_at) = DATE(DATE_ADD(UTC_TIMESTAMP(), INTERVAL :d DAY)) "
                       "GROUP BY user_id", d=d):
            notify_user(r['user_id'], f"₹{float(r['amt']):.0f} bonus expires in {d} days",
                        'Use your SKOVO Wallet bonus before it expires.', type='payment', reference_type='wallet')
            sent += 1
    return sent


# ── refund effects (points, perks, notes, alerts) ────────────────────────────

_PAY_METRICS = {'cohort': ('cohorts_enrolled',), 'subscription': ('pro_subscription',), 'session': ()}


def reverse_payment_points(order, amount):
    """Take back the readiness points this purchase earned; activity points
    stay. One reversal per order (direct credit 'refund_reversal').
    full mode: all of the purchase's points; proportional: by refunded share."""
    uid, kind = order['student_id'], order['kind']
    metrics = _PAY_METRICS.get(kind) or ()
    if not metrics:
        return 0.0
    from sqlalchemy import bindparam
    rules = [r[0] for r in db.session.execute(text(
        "SELECT event_type FROM score_event_rules WHERE metric_key IN :m"
    ).bindparams(bindparam('m', expanding=True)), {'m': list(metrics)}).all()]
    if not rules:
        return 0.0
    q_sum = text("SELECT IFNULL(SUM(points), 0) FROM score_events WHERE user_id = :u AND event_type IN :r"
                 ).bindparams(bindparam('r', expanding=True))
    q_last = text("SELECT points FROM score_events WHERE user_id = :u AND event_type IN :r ORDER BY seq DESC LIMIT 1"
                  ).bindparams(bindparam('r', expanding=True))
    if kind == 'subscription':
        pts = _d(db.session.execute(q_sum, {'u': uid, 'r': rules}).scalar())
    else:   # the latest award of the enrolment rules = this purchase's tier
        pts = _d(db.session.execute(q_last, {'u': uid, 'r': rules}).scalar())
    already = -_d((_one("SELECT IFNULL(SUM(points), 0) AS s FROM score_events WHERE user_id = :u "
                        "AND event_type = 'refund_reversal' AND ref_id LIKE :r", u=uid, r=f"order-{order['id']}%") or {}).get('s'))
    if settings().get('reverse_mode') == 'proportional' and _d(order.get('gross')) > 0:
        target = (pts * _d(amount) / _d(order['gross'])).quantize(Decimal('0.01'))
    else:
        target = pts
    take = target - already
    if take <= 0:
        return 0.0
    db.session.execute(text(
        "INSERT INTO score_events (id, user_id, event_type, points, ref_id, meta) VALUES (UUID(), :u, 'refund_reversal', "
        ":p, :r, :m)"),
        {'u': uid, 'p': -take, 'r': f"order-{order['id']}-{uuid.uuid4().hex[:6]}",
         'm': f'points from refunded {kind} purchase'})
    from portal.helpers import score
    score.recalc(uid)
    return float(take)


def remove_pro(order, status='refunded'):
    db.session.execute(text(
        "UPDATE subscriptions SET status = :s, expires_at = UTC_TIMESTAMP(), updated_at = UTC_TIMESTAMP() "
        "WHERE payment_order_id = :n AND status IN ('active', 'disputed')"), {'s': status, 'n': order['order_no']})


def credit_note(refund_id, order, amount, destination):
    prefix = settings().get('credit_note_prefix') or 'SKV-CN'
    if _one("SELECT 1 AS ok FROM credit_notes WHERE refund_id = :r", r=refund_id):
        return None
    seq = int((_one("SELECT COUNT(*) AS n FROM credit_notes") or {}).get('n') or 0) + 1
    number = f"{prefix}-{datetime.datetime.utcnow():%Y%m}-{seq:06d}"
    db.session.execute(text(
        "INSERT INTO credit_notes (id, number, refund_id, order_id, user_id, amount, destination) "
        "VALUES (:i, :n, :r, :o, :u, :a, :d)"),
        {'i': str(uuid.uuid4()), 'n': number, 'r': refund_id, 'o': order['id'], 'u': order.get('student_id'),
         'a': _d(amount), 'd': destination})
    db.session.execute(text("UPDATE refunds SET credit_note_no = :n WHERE id = :r"), {'n': number, 'r': refund_id})
    return number


def alert(kind, ref, message):
    db.session.execute(text(
        "INSERT IGNORE INTO admin_alerts (id, kind, ref, message) VALUES (:i, :k, :r, :m)"),
        {'i': str(uuid.uuid4()), 'k': kind, 'r': str(ref)[:100], 'm': message[:500]})


def abuse_check(user_id):
    # v1: refund alerts are off (admin removed the setting); refunds are instant.
    return
    s = settings()
    n = int((_one("SELECT COUNT(*) AS n FROM refunds r JOIN payment_orders o ON o.id = r.order_id "
                  "WHERE o.student_id = :u AND r.status = 'succeeded' AND r.created_at >= "
                  "DATE_SUB(UTC_TIMESTAMP(), INTERVAL :d DAY)", u=user_id, d=int(s.get('abuse_days') or 30)) or {}).get('n') or 0)
    if int(s.get('abuse_refunds') or 0) and n >= int(s['abuse_refunds']):
        alert('refund_abuse', f"{user_id}-{datetime.date.today():%Y%m%d}",
              f"Student {user_id} has {n} refunds in {s.get('abuse_days')} days.")


def after_refund(refund_id, order, amount, destination, bonus=0.0):
    """Everything that follows money moving back, for every refund path."""
    try:
        reverse_payment_points(order, amount)
        if order['kind'] == 'subscription' and _d(amount) >= _d(order.get('gross')) - _d(order.get('refunded_amount')):
            remove_pro(order)
        credit_note(refund_id, order, amount, destination)
        abuse_check(order['student_id'])
        from portal.helpers.notifications import notify_user
        # A missed class already tells the student why and how much; a second
        # "added to your wallet" for the same refund is noise.
        from portal.models import db as _db
        from sqlalchemy import text as _text
        case = _db.session.execute(_text("SELECT case_key FROM refunds WHERE id = :i"), {'i': refund_id}).scalar()
        if case == 'achiever_no_show':
            return
        if destination == 'wallet':
            # Exact amount, never rounded (Rs 2.50 stays 2.50); no bonus in v1.
            msg = f"₹{float(amount):,.2f}".replace('.00', '') + " added to your SKOVO Wallet."
        else:
            msg = f"Refund of ₹{float(amount):.0f} started. It reaches your account in 5–7 days."
        notify_user(order['student_id'], 'Refund', msg, type='payment', reference_type='refund', reference_id=refund_id)
    except Exception as e:                                   # noqa: BLE001
        logger.error(f"wallet.after_refund({refund_id}) failed: {e}")


def bonus_pct(case_key):
    s = settings()
    if case_key in ('achiever_cancel', 'admin_cancel', 'achiever_no_show', 'reschedule_rejected'):
        return _d(s.get('bonus_staff_cancel_pct'))
    if case_key in ('student_cancel', 'pro_refund'):
        return _d(s.get('bonus_student_cancel_pct'))
    return D0                         # duplicate, failed order, seat taken, goodwill: no bonus


# ── send to bank ─────────────────────────────────────────────────────────────

def request_payout(user_id, amount):
    """Refund money back to its original source, within the admin window. One
    request per source order; admin approves.

    v1: switched off. Wallet money is spent on SKOVO only (another cohort,
    session or Pro); it is never sent back to a bank."""
    return None, 'Wallet money can be used for another booking on SKOVO. It cannot be sent to a bank.'
    s = settings()  # noqa: kept for when send-to-bank returns
    amount = _d(amount)
    bal = _d(balances(user_id)['refund_money'])
    if amount <= 0 or amount > bal:
        return None, 'Amount is more than your refund money.'
    days = int(s.get('send_to_bank_days') or 0)
    src = _one("SELECT order_id, SUM(amount) AS amt, MAX(created_at) AS at FROM wallet_ledger "
               "WHERE user_id = :u AND kind = 'refund' AND type = 'refund_credit' AND order_id IS NOT NULL "
               "AND created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL :d DAY) GROUP BY order_id "
               "ORDER BY at DESC LIMIT 1", u=user_id, d=days)
    if not src:
        return None, f'Refund money can go back to your bank only within {days} days of the refund.'
    if amount > _d(src['amt']):
        return None, f"You can send up to ₹{float(src['amt']):.0f} from your latest refund."
    if _one("SELECT 1 AS ok FROM wallet_payout_requests WHERE user_id = :u AND status = 'pending'", u=user_id):
        return None, 'You already have a pending request.'
    rid = str(uuid.uuid4())
    db.session.execute(text("INSERT INTO wallet_payout_requests (id, user_id, amount, source_order_id) "
                            "VALUES (:i, :u, :a, :o)"), {'i': rid, 'u': user_id, 'a': amount, 'o': src['order_id']})
    return rid, None


def decide_payout(request_id, approve, admin_id, note=None):
    from portal.helpers.refunds import gateway_refund_only
    r = _one("SELECT * FROM wallet_payout_requests WHERE id = :i AND status = 'pending' FOR UPDATE", i=request_id)
    if not r:
        return False, 'Request not found or already decided.'
    if not approve:
        db.session.execute(text("UPDATE wallet_payout_requests SET status = 'rejected', decided_by = :a, "
                                "decided_at = UTC_TIMESTAMP(), note = :n WHERE id = :i"),
                           {'a': admin_id, 'n': note, 'i': request_id})
        return True, 'Rejected.'
    if _d(balances(r['user_id'])['refund_money']) < _d(r['amount']):
        return False, 'Not enough refund money left in the wallet.'
    ok, info = gateway_refund_only(r['source_order_id'], float(r['amount']), 'wallet send-to-bank', admin_id,
                                   refund_key=f"wp-{request_id[:24]}")
    if not ok:
        return False, f'Gateway refund failed: {info}'
    _lock(r['user_id'])
    _ledger(r['user_id'], 'refund', 'bank_payout', -_d(r['amount']), request_id, r['source_order_id'],
            reason='sent back to original payment method', actor_id=admin_id)
    db.session.execute(text("UPDATE wallet_payout_requests SET status = 'approved', decided_by = :a, "
                            "decided_at = UTC_TIMESTAMP(), note = :n WHERE id = :i"),
                       {'a': admin_id, 'n': note, 'i': request_id})
    return True, 'Sent to the original payment method.'


def choice_preview(amount, case_key, order_id=None):
    """What the cancel screen shows: the wallet option and its bonus."""
    if not enabled() or not amount or float(amount) <= 0:
        return {'wallet_available': False}
    gateway = float(amount)
    if order_id:
        o = _one("SELECT wallet_amount FROM payment_orders WHERE id = :o", o=order_id) or {}
        from portal.helpers.refunds import _wallet_returned
        gateway = max(0.0, float(amount) - max(0.0, float(o.get('wallet_amount') or 0) - _wallet_returned(order_id)))
    bonus = round(gateway * float(bonus_pct(case_key)) / 100, 2)
    return {'wallet_available': True, 'wallet_amount': round(float(amount) + bonus, 2), 'wallet_bonus': bonus,
            'original_amount': float(amount), 'original_days': '5–7 days'}
