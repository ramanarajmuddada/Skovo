"""Send an achiever payout through Cashfree. Paid only when money moved.

Admin Pay starts the transfer. The ledger flips to `paid` on TRANSFER_SUCCESS
(or an immediate SUCCESS in the create response) together with the UTR.
Marking paid without a transfer is not a path.
"""
import logging
import re

from sqlalchemy import text

from portal.helpers.sp import call_proc_one
from portal.models import db

logger = logging.getLogger('skovo')

# 'processing' is re-enterable on purpose: Admin Pay re-polls it. Cashfree is
# the only thing that knows whether that transfer landed, and a dropped webhook
# used to strand the request here with no way back — Pay said 409, Reject
# refuses a live transfer, and nothing polls on a timer.
_OPEN = ('pending', 'failed', 'processing')
_SUCCESS = {'SUCCESS', 'COMPLETED', 'PROCESSED'}
_FAILED = {'FAILED', 'REJECTED', 'REVERSED'}


def _beneficiary_name(raw):
    cleaned = re.sub(r'[^A-Za-z\s]', ' ', raw or '')
    cleaned = re.sub(r'\s+', ' ', cleaned).strip()
    return (cleaned or 'Beneficiary')[:100]


def _next_transfer_id(request_id, previous=None):
    """Cashfree transfer_id: alphanumeric, unique per attempt.

    A failed transfer cannot be retried under the same id — Cashfree returns
    the original — so each Pay after a failure gets a new suffix.
    """
    stem = 'P' + (request_id or '').replace('-', '')[:32]
    attempt = 1
    if previous and previous.startswith(stem):
        tail = previous[len(stem):]
        if tail.isdigit():
            attempt = int(tail) + 1
    return f'{stem}{attempt:02d}'[:40]


def _row(request_id):
    return db.session.execute(text(
        "SELECT * FROM payout_requests WHERE id = :i"
    ), {'i': request_id}).mappings().first()


def _unwrap(result):
    if isinstance(result, dict) and isinstance(result.get('data'), dict):
        return {**result, **result['data']}
    return result or {}


def _utr_of(result):
    transfer = (result or {}).get('transfer') or {}
    return ((result or {}).get('transfer_utr')
            or (result or {}).get('utr')
            or transfer.get('transfer_utr')
            or transfer.get('utr'))


def initiate_payout(request_id, admin_id):
    """Start — or re-check — a Cashfree transfer.

    Accepts pending, failed **and processing**. On a processing row this is a
    re-poll, not a second send: Cashfree is asked what happened to the existing
    transfer_id first, and a new transfer is only minted once it answers FAILED
    or 404. That is the recovery path for a dropped TRANSFER_* webhook, which
    otherwise strands the request — Reject refuses a live transfer by design,
    and no scheduler polls.

    Returns (ok, payload, http). Never sets status=paid unless Cashfree already
    returned a terminal SUCCESS.
    """
    from portal.helpers.cashfree import (
        create_payout_transfer, get_payout_transfer,
        CashfreeError, CashfreeNotConfigured,
    )

    row = _row(request_id)
    if not row:
        return False, {'message': 'Payout request not found.'}, 404
    if row['status'] not in _OPEN:
        return False, {'message': f"Request already {row['status']}."}, 409
    in_flight = row['status'] == 'processing'

    method = (row.get('method') or '').lower()
    bank_ok = bool(row.get('account_name') and row.get('account_number') and row.get('ifsc'))
    upi_ok = bool(row.get('upi'))
    if method == 'upi':
        if not upi_ok:
            return False, {'message': 'This request has no UPI ID.'}, 400
    elif not bank_ok:
        return False, {'message': 'This request is missing complete bank details.'}, 400

    previous = (row.get('transfer_id') or '').strip() or None
    if previous:
        try:
            existing = _unwrap(get_payout_transfer(previous))
            st = str(existing.get('status') or '').upper()
            if st in _SUCCESS:
                applied = apply_transfer_result(
                    previous, 'SUCCESS', _utr_of(existing), admin_id=admin_id)
                return True, {
                    'message': 'Payout sent.',
                    'status': 'paid',
                    'utr': _utr_of(existing),
                    **applied,
                }, 200
            if st not in _FAILED and st:
                # Still live at Cashfree — do not mint a second transfer_id.
                if not in_flight:
                    restored = call_proc_one(
                        'sp_admin_payout_mark_processing',
                        request_id, previous, admin_id) or {}
                    if restored.get('ok'):
                        db.session.commit()
                return True, {
                    'message': ('Still with the bank. Paid when it confirms (UTR).'
                                if in_flight
                                else 'Transfer started. Paid when the bank confirms (UTR).'),
                    'status': 'processing',
                    'transfer_id': previous,
                    'gateway_status': st,
                }, 200
        except CashfreeNotConfigured as e:
            logger.error('Payout %s: Cashfree Payouts not configured: %s', request_id, e)
            return False, {'message': 'Payouts are not configured. Contact support.'}, 502
        except CashfreeError as e:
            if e.status != 404:
                logger.error('Payout %s: could not poll transfer %s: %s',
                             request_id, previous, e)
                return False, {
                    'message': 'Could not check the existing transfer. Try again.',
                }, 502

    # Reaching here means no live transfer stands: either there was never one,
    # or Cashfree just told us the previous attempt FAILED or does not exist
    # (404). A row still marked `processing` has to be released before a new
    # attempt, because mark_processing only accepts pending/failed — and that
    # strictness is what stops a second transfer racing a live one.
    #
    # Safe for the crash-after-commit case too: status and transfer_id are set
    # in one atomic UPDATE, so `processing` with no transfer_id means nothing
    # was ever sent.
    if in_flight:
        call_proc_one(
            'sp_admin_payout_mark_failed', request_id,
            'previous transfer did not stand — retried by admin')
        db.session.commit()

    transfer_id = _next_transfer_id(request_id, previous)
    started = call_proc_one(
        'sp_admin_payout_mark_processing', request_id, transfer_id, admin_id) or {}
    if not started.get('ok'):
        db.session.rollback()
        return False, {'message': started.get('message') or 'Could not start payout.'}, 409
    db.session.commit()

    name = _beneficiary_name(row.get('account_name'))
    try:
        result = create_payout_transfer(
            transfer_id,
            float(row['amount']),
            method=method or ('upi' if upi_ok else 'bank'),
            beneficiary_name=name,
            account_number=row.get('account_number'),
            ifsc=row.get('ifsc'),
            upi=row.get('upi'),
        )
    except CashfreeNotConfigured as e:
        call_proc_one('sp_admin_payout_mark_failed', request_id, str(e)[:200])
        db.session.commit()
        logger.error('Payout %s: Cashfree Payouts not configured: %s', request_id, e)
        return False, {'message': 'Payouts are not configured. Contact support.'}, 502
    except CashfreeError as e:
        reason = (e.body or str(e))[:200]
        call_proc_one('sp_admin_payout_mark_failed', request_id, reason)
        db.session.commit()
        logger.error('Payout %s transfer failed: %s', request_id, e)
        return False, {'message': 'The bank transfer could not be started. Try again.'}, 502

    result = _unwrap(result)
    status = str(result.get('status') or '').upper()
    utr = _utr_of(result)
    cf_id = (result or {}).get('cf_transfer_id')
    if cf_id or utr:
        db.session.execute(text("""
            UPDATE payout_requests
               SET cf_transfer_id = COALESCE(:c, cf_transfer_id),
                   utr = COALESCE(:u, utr)
             WHERE id = :i
        """), {'c': cf_id, 'u': utr, 'i': request_id})
        db.session.commit()

    if status in _SUCCESS:
        applied = apply_transfer_result(transfer_id, 'SUCCESS', utr, admin_id=admin_id)
        return True, {
            'message': 'Payout sent.',
            'status': 'paid',
            'utr': utr,
            **applied,
        }, 200

    if status in _FAILED:
        call_proc_one('sp_admin_payout_mark_failed',
                      request_id, (result or {}).get('status_description') or status)
        db.session.commit()
        return False, {'message': 'The bank rejected this transfer.', 'status': 'failed'}, 502

    return True, {
        'message': 'Transfer started. Paid when the bank confirms (UTR).',
        'status': 'processing',
        'transfer_id': transfer_id,
    }, 200


def apply_transfer_result(transfer_id, gateway_status, utr=None, reason=None, admin_id=None):
    """Apply a Cashfree transfer webhook / poll. Idempotent."""
    status = str(gateway_status or '').upper()
    row = db.session.execute(text(
        "SELECT id, status FROM payout_requests WHERE transfer_id = :t"
    ), {'t': transfer_id}).mappings().first()
    if not row:
        logger.warning('Payout webhook: unknown transfer_id=%s', transfer_id)
        return {'applied': False, 'reason': 'unknown-transfer'}

    if row['status'] == 'paid':
        return {'applied': False, 'reason': 'already-paid'}

    if status in _SUCCESS:
        result = call_proc_one(
            'sp_admin_payout_approve', row['id'], admin_id, utr) or {}
        if not result.get('ok'):
            db.session.rollback()
            return {'applied': False, 'reason': result.get('message')}
        db.session.commit()
        return {'applied': True, 'status': 'paid', 'utr': utr}

    if status in _FAILED:
        call_proc_one(
            'sp_admin_payout_mark_failed', row['id'], (reason or status)[:200])
        db.session.commit()
        return {'applied': True, 'status': 'failed'}

    return {'applied': False, 'reason': 'non-terminal', 'gateway_status': status}
