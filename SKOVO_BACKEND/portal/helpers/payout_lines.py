"""
What one payout request is made of, oldest money first.

payout_request_lines holds a snapshot of every released earning at request
time, so a second payout would list classes the first one already paid. This
works it out instead: walk the achiever's released earnings oldest first,
skip what earlier payouts (pending, sending, paid or failed, not rejected)
already took, then fill this request. The last class may be part-used:

    Earned:  A ₹60 · B ₹50 · C ₹40      Withdraw ₹100
    Made up of:  A ₹60 (full) · B ₹40 of ₹50          → ₹10 of B stays available
    Next ₹50:    B ₹10 of ₹50 (rest) · C ₹40 (full)

Exact to the paisa (Decimal), never rounded.
"""
from decimal import Decimal

from sqlalchemy import bindparam, text

from portal.models import db

TAKEN = ('pending', 'processing', 'paid', 'failed')


def _d(v):
    return Decimal(str(v or 0))


def made_up_of(request_id):
    req = db.session.execute(text(
        "SELECT id, achiever_id, amount, created_at FROM payout_requests WHERE id = :i"),
        {'i': request_id}).mappings().first()
    if not req:
        return None
    before = _d(db.session.execute(text(
        "SELECT IFNULL(SUM(amount), 0) FROM payout_requests"
        " WHERE achiever_id = :a AND status IN :st AND id <> :i"
        "   AND (created_at < :c OR (created_at = :c AND id < :i))").bindparams(
        bindparam('st', expanding=True)),
        {'a': req['achiever_id'], 'st': list(TAKEN), 'i': req['id'], 'c': req['created_at']}).scalar())
    rows = db.session.execute(text(
        "SELECT source_type, source_id, title, amount, occurred_at FROM v_achiever_earning_lines"
        " WHERE achiever_id = :a AND is_released = 1 AND amount > 0"
        " ORDER BY occurred_at, source_id"), {'a': req['achiever_id']}).mappings().fetchall()

    skip, need, out = before, _d(req['amount']), []
    for r in rows:
        if need <= 0:
            break
        amt = _d(r['amount'])
        if skip >= amt:            # fully used by earlier payouts
            skip -= amt
            continue
        left = amt - skip          # what this class still has
        skip = Decimal(0)
        use = min(left, need)
        need -= use
        out.append({
            'source_type': r['source_type'],
            'source_id': r['source_id'],
            'title': r['title'],
            'earned': float(amt),
            'amount': float(use),
            'part': use < amt,
            'occurred_at': r['occurred_at'],
        })
    return out
