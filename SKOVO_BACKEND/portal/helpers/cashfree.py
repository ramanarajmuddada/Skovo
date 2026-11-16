"""
Cashfree Payment Gateway client.

SKOVO runs an aggregator model: the student pays SKOVO, the money settles into
SKOVO's own bank account, and achievers are paid their share later. So this
deliberately uses only the plain Payment Gateway — no Easy Split, no vendor
onboarding, no per-achiever KYC. The split lives in `ledger_entries`, not at
the gateway.

Credentials come from the environment and are never defaulted:

    CASHFREE_APP_ID
    CASHFREE_SECRET_KEY
    CASHFREE_WEBHOOK_SECRET
    CASHFREE_ENV           sandbox | production

Nothing here writes to the database. The caller opens the order (which reserves
the seat and snapshots the commission rate) and only then asks this module for a
payment session — so a gateway failure leaves a releasable hold rather than an
untracked payment.
"""
import os
import json
import time
import base64
import hmac
import hashlib
import logging

import requests

logger = logging.getLogger('skovo.cashfree')

# Cashfree pins behaviour to a dated API version. Kept here as a named constant
# because bumping it changes response shapes — it is a deliberate upgrade, not a
# value to tweak casually.
API_VERSION = '2023-08-01'

_BASES = {
    'sandbox':    'https://sandbox.cashfree.com/pg',
    'production': 'https://api.cashfree.com/pg',
}

# Payouts (achiever bank/UPI credit) is a different host and API version from
# the payment gateway. Same client id/secret on most accounts; override with
# CASHFREE_PAYOUT_CLIENT_ID / CASHFREE_PAYOUT_CLIENT_SECRET when they differ.
PAYOUT_API_VERSION = '2024-01-01'
_PAYOUT_BASES = {
    'sandbox':    'https://sandbox.cashfree.com/payout',
    'production': 'https://api.cashfree.com/payout',
}

# A webhook older than this is refused even with a valid signature: a captured
# request replayed days later must not re-confirm an order.
WEBHOOK_MAX_AGE_SECONDS = 300

TIMEOUT = 30


class CashfreeError(RuntimeError):
    """Any failure talking to Cashfree. Carries the HTTP status when there is one."""

    def __init__(self, message, status=None, body=None):
        super().__init__(message)
        self.status = status
        self.body = body


class CashfreeNotConfigured(CashfreeError):
    """Credentials are absent. Raised rather than silently degrading.

    A checkout that cannot reach the gateway must fail loudly at the point of
    sale; a half-configured payment path that appears to work is how money goes
    missing without anyone noticing.
    """


def _env():
    mode = (os.environ.get('CASHFREE_ENV') or 'sandbox').strip().lower()
    if mode not in _BASES:
        raise CashfreeNotConfigured(
            f"CASHFREE_ENV must be sandbox or production, got {mode!r}")
    return mode


def _creds():
    """The keys for whichever environment CASHFREE_ENV names.

    Sandbox and production keys are different pairs, and a sandbox key sent to
    the live endpoint fails in ways that read like a code bug. Looking up
    CASHFREE_APP_ID_SANDBOX / _PRODUCTION first means both pairs can sit in .env
    at once and switching environments is one line -- rather than swapping keys
    in and out of a single variable, which is how the wrong pair ends up live.

    The plain CASHFREE_APP_ID / CASHFREE_SECRET_KEY still work and are used when
    no environment-specific pair is set, so existing deployments are unaffected.
    """
    mode = _env().upper()
    app_id = (os.environ.get(f'CASHFREE_APP_ID_{mode}', '').strip()
              or os.environ.get('CASHFREE_APP_ID', '').strip())
    secret = (os.environ.get(f'CASHFREE_SECRET_KEY_{mode}', '').strip()
              or os.environ.get('CASHFREE_SECRET_KEY', '').strip())
    if not app_id or not secret:
        raise CashfreeNotConfigured(
            f'No Cashfree credentials for {mode.lower()}: set '
            f'CASHFREE_APP_ID_{mode} and CASHFREE_SECRET_KEY_{mode} '
            f'(or CASHFREE_APP_ID / CASHFREE_SECRET_KEY)')
    return app_id, secret


def is_configured():
    """True when a payment could actually be attempted.

    For callers that need to choose a provider or show a maintenance notice —
    never to fall back to a different gateway silently.
    """
    try:
        _creds()
        _env()
        return True
    except CashfreeNotConfigured:
        return False


def _headers():
    app_id, secret = _creds()
    return {
        'x-client-id': app_id,
        'x-client-secret': secret,
        'x-api-version': API_VERSION,
        'Content-Type': 'application/json',
    }


def _request(method, path, payload=None):
    base = _BASES[_env()]
    url = f'{base}{path}'
    try:
        r = requests.request(method, url, headers=_headers(),
                             json=payload, timeout=TIMEOUT)
    except requests.RequestException as exc:
        raise CashfreeError(f'Cashfree unreachable: {exc}') from exc

    if r.status_code >= 400:
        # Log the status and a truncated body; the body can echo customer detail.
        logger.error('Cashfree %s %s -> %s %s', method, path, r.status_code, r.text[:300])
        raise CashfreeError(f'Cashfree {method} {path} failed',
                            status=r.status_code, body=r.text[:500])
    try:
        return r.json()
    except ValueError as exc:
        raise CashfreeError('Cashfree returned a non-JSON body',
                            status=r.status_code, body=r.text[:500]) from exc


def create_order(order_no, amount, currency, customer, return_url, notify_url,
                 note=None):
    """Open a Cashfree order and return its payment_session_id.

    `order_no` is SKOVO's own order number, not the internal UUID — it is what
    appears on the customer's statement and in Cashfree's dashboard, so support
    can match a complaint to a row without a lookup table.

    `customer` needs id, phone, email and name. **Phone is mandatory at
    Cashfree's end**, which is why checkout collects it: SKOVO accounts can be
    created with an email alone, so it cannot be assumed present on the user.
    """
    phone = (customer or {}).get('phone')
    if not phone:
        raise CashfreeError(
            'customer_phone is required by Cashfree and was not supplied')

    payload = {
        'order_id': str(order_no),
        'order_amount': float(amount),
        'order_currency': currency,
        'customer_details': {
            'customer_id': str(customer['id']),
            'customer_phone': str(phone),
            'customer_email': customer.get('email') or '',
            'customer_name': customer.get('name') or '',
        },
        'order_meta': {
            'return_url': return_url,
            'notify_url': notify_url,
        },
    }
    if note:
        payload['order_note'] = note[:200]

    data = _request('POST', '/orders', payload)
    session_id = data.get('payment_session_id')
    if not session_id:
        raise CashfreeError('Cashfree order created without a payment_session_id',
                            body=json.dumps(data)[:500])
    return {
        'payment_session_id': session_id,
        'cf_order_id': data.get('cf_order_id'),
        'order_status': data.get('order_status'),
    }


def get_order(order_no):
    """Authoritative order state, straight from Cashfree.

    Used by the reconciler for orders stuck in 'created'/'pending': a webhook
    that never arrives is indistinguishable from a payment that never happened
    until someone asks the gateway.
    """
    return _request('GET', f'/orders/{order_no}')


def refund(order_no, refund_id, amount, note=None):
    """Refund against an order. `refund_id` must be unique and is the caller's
    idempotency key — retrying with the same id will not double-refund."""
    payload = {
        'refund_amount': float(amount),
        'refund_id': str(refund_id),
    }
    if note:
        payload['refund_note'] = note[:200]
    return _request('POST', f'/orders/{order_no}/refunds', payload)


def _webhook_secret_candidates(kind):
    """Signing secrets to try, most specific first.

    Cashfree does not issue a separate webhook secret — deliveries are signed
    with the client secret of the product that sent them. Payments come from
    the PG pair; **Payouts transfers are signed with the payout pair**, which
    `_payout_creds` already treats as separately configurable. Verifying a
    TRANSFER_* delivery against the PG secret returns a clean 400, so the money
    moves and the request sits on `processing` forever with no webhook to
    release it.

    The payout list still falls back to the payment pair, because most accounts
    use one pair for both and those deployments must keep working untouched.
    """
    mode = _env().upper()

    payment = [
        os.environ.get(f'CASHFREE_WEBHOOK_SECRET_{mode}', '').strip(),
        os.environ.get('CASHFREE_WEBHOOK_SECRET', '').strip(),
        os.environ.get(f'CASHFREE_SECRET_KEY_{mode}', '').strip(),
        os.environ.get('CASHFREE_SECRET_KEY', '').strip(),
    ]
    if kind != 'payout':
        return [c for c in payment if c]

    payout = [
        os.environ.get(f'CASHFREE_PAYOUT_CLIENT_SECRET_{mode}', '').strip(),
        os.environ.get('CASHFREE_PAYOUT_CLIENT_SECRET', '').strip(),
    ]
    # De-duplicated so a shared pair is not hashed twice per delivery.
    seen, ordered = set(), []
    for c in payout + payment:
        if c and c not in seen:
            seen.add(c)
            ordered.append(c)
    return ordered


def verify_webhook_signature(raw_body, signature, timestamp, kind='payment'):
    """Verify a Cashfree webhook. Returns True only for a signature we computed.

    Cashfree signs `timestamp + raw_body`, base64 of an HMAC-SHA256 — not the
    body alone, and not hex. Both differences are easy to get wrong and both
    fail closed, so this is where a broken integration usually shows up.

    The body must be the **raw bytes** as received: re-serialising parsed JSON
    changes key order and whitespace and produces a different digest.

    `kind='payout'` adds the Payouts client secret to the candidates — see
    `_webhook_secret_candidates`. Every candidate is a secret SKOVO owns, so
    trying more than one is not a downgrade: a forger still has to hold one.
    """
    candidates = _webhook_secret_candidates(kind)
    if not candidates:
        raise CashfreeNotConfigured(
            'Neither CASHFREE_WEBHOOK_SECRET nor CASHFREE_SECRET_KEY is set')

    # A URL here means the endpoint was pasted into the secret field — an easy
    # mix-up, and one that fails as an unexplained signature mismatch on every
    # delivery. Say what actually happened instead.
    usable = [c for c in candidates if not c.startswith(('http://', 'https://'))]
    if not usable:
        raise CashfreeNotConfigured(
            'CASHFREE_WEBHOOK_SECRET looks like a URL. The endpoint URL goes in '
            'the Cashfree dashboard; this field takes the signing secret '
            '(your client secret).')

    if not signature or not timestamp:
        return False

    # Reject stale deliveries even when the signature is valid — a captured
    # request replayed later must not re-confirm an order.
    try:
        age = abs(time.time() - float(timestamp))
    except (TypeError, ValueError):
        return False
    if age > WEBHOOK_MAX_AGE_SECONDS:
        logger.warning('Cashfree webhook rejected: timestamp %ss old', int(age))
        return False

    if isinstance(raw_body, str):
        raw_body = raw_body.encode('utf-8')

    signed = f'{timestamp}'.encode('utf-8') + raw_body

    matched = False
    for secret in usable:
        digest = hmac.new(secret.encode('utf-8'), signed, hashlib.sha256).digest()
        expected = base64.b64encode(digest).decode('utf-8')
        # compare_digest on every candidate rather than breaking early, so the
        # time taken does not say which secret matched.
        if hmac.compare_digest(expected, signature):
            matched = True
    return matched


def _payout_creds():
    """Payout keys, falling back to the payment-gateway pair.

    Cashfree often issues one pair for both products. Separate payout keys
    exist so a PG-only sandbox cannot be mistaken for a funded payouts account.
    """
    mode = _env().upper()
    app_id = (os.environ.get(f'CASHFREE_PAYOUT_CLIENT_ID_{mode}', '').strip()
              or os.environ.get('CASHFREE_PAYOUT_CLIENT_ID', '').strip()
              or os.environ.get(f'CASHFREE_APP_ID_{mode}', '').strip()
              or os.environ.get('CASHFREE_APP_ID', '').strip())
    secret = (os.environ.get(f'CASHFREE_PAYOUT_CLIENT_SECRET_{mode}', '').strip()
              or os.environ.get('CASHFREE_PAYOUT_CLIENT_SECRET', '').strip()
              or os.environ.get(f'CASHFREE_SECRET_KEY_{mode}', '').strip()
              or os.environ.get('CASHFREE_SECRET_KEY', '').strip())
    if not app_id or not secret:
        raise CashfreeNotConfigured(
            'No Cashfree Payouts credentials: set CASHFREE_PAYOUT_CLIENT_ID '
            'and CASHFREE_PAYOUT_CLIENT_SECRET (or the payment-gateway pair)')
    return app_id, secret


def _payout_headers():
    app_id, secret = _payout_creds()
    return {
        'x-client-id': app_id,
        'x-client-secret': secret,
        'x-api-version': PAYOUT_API_VERSION,
        'Content-Type': 'application/json',
    }


def _payout_request(method, path, payload=None, params=None):
    base = _PAYOUT_BASES[_env()]
    url = f'{base}{path}'
    try:
        r = requests.request(method, url, headers=_payout_headers(),
                             json=payload, params=params, timeout=TIMEOUT)
    except requests.RequestException as exc:
        raise CashfreeError(f'Cashfree Payouts unreachable: {exc}') from exc

    if r.status_code >= 400:
        logger.error('Cashfree payouts %s %s -> %s %s',
                     method, path, r.status_code, r.text[:300])
        raise CashfreeError(f'Cashfree Payouts {method} {path} failed',
                            status=r.status_code, body=r.text[:500])
    try:
        return r.json()
    except ValueError as exc:
        raise CashfreeError('Cashfree Payouts returned a non-JSON body',
                            status=r.status_code, body=r.text[:500]) from exc


def create_payout_transfer(transfer_id, amount, *, method, beneficiary_name,
                           account_number=None, ifsc=None, upi=None):
    """Send achiever earnings to a bank account or UPI. Async by default.

    Does not mark anything paid. The caller waits for TRANSFER_SUCCESS (or an
    immediate SUCCESS in the response) and the UTR before touching the ledger.
    """
    instrument = {}
    if (method or '').lower() == 'upi':
        transfer_mode = 'upi'
        if not upi:
            raise CashfreeError('UPI payout is missing a VPA')
        instrument['vpa'] = upi
    else:
        transfer_mode = 'imps'
        if not account_number or not ifsc:
            raise CashfreeError('Bank payout is missing account number or IFSC')
        instrument['bank_account_number'] = str(account_number)
        instrument['bank_ifsc'] = str(ifsc).upper()

    payload = {
        'transfer_id': str(transfer_id),
        'transfer_amount': float(amount),
        'transfer_currency': 'INR',
        'transfer_mode': transfer_mode,
        'beneficiary_details': {
            'beneficiary_name': beneficiary_name,
            'beneficiary_instrument_details': instrument,
        },
    }
    fundsource = (os.environ.get('CASHFREE_PAYOUT_FUNDSOURCE_ID') or '').strip()
    if fundsource:
        payload['fundsource_id'] = fundsource

    return _payout_request('POST', '/transfers', payload)


def get_payout_transfer(transfer_id):
    """Authoritative transfer state from Cashfree, used if a webhook is late."""
    return _payout_request('GET', '/transfers', params={'transfer_id': transfer_id})
