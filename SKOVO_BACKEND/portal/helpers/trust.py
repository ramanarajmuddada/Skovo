"""
Achiever trust tiers — the capability layer every guard reads.

`achievers.is_verified` used to be one boolean asserting two unrelated things:
"this person is who they claim" AND "this person is safe alone with a
14-year-old". Those are different checks at wildly different costs, and
collapsing them forced a bad trade — verify slowly and starve supply, or verify
fast and carry child-safety risk.

The ladder replaces it:

    L0 applied      email OTP only. Not listed, cannot create anything.
    L1 identity     govt ID + selfie + phone. Listed; FREE cohorts only.
    L2 credential   achievement proof validated. May charge money.
    L3 bgv_cleared  criminal + employment check. May teach 14-17 students.
    L4 featured     founder promotion. Raised ceiling, homepage placement.

Capability is not config in a tier table any more. It follows the achiever's
lifecycle state — pending, probation, active, suspended, banned — and
sp_achiever_capabilities derives it in one place.

Usage in a route:

    from portal.helpers import trust as T
    err = T.require_state(achiever_id, 'can_charge',
                          'Charging opens once an admin reviews your demos.')
    if err:
        return err          # a ready-made 403 response

What remains here besides that: document types, agreements, booking
eligibility, rate clamping and the public badge.
"""
import logging

from flask import jsonify

from portal.helpers.sp import call_proc, call_proc_one

logger = logging.getLogger("skovo")

# The tier ladder that used to live here is gone. Capability follows the
# achiever's lifecycle state — see lifecycle_caps() at the foot of this module
# and sp_achiever_capabilities. What remains above and below is document types
# and agreements, which were never tier concepts.

def doc_types(active_only=True):
    """The evidence dropdown — master data, not a constant.

    Lives in `master_achiever_doc_type`, registered in `master_registry`, so
    Admin > Masters manages it like the other 123 dropdowns. Each row carries a
    `category` (identity | credential | supporting) and that is what the submit
    rule keys on, which is why this needs its own table rather than a row in a
    shared one.

    Returns [] on failure rather than raising: a dropdown that cannot load
    should not take the whole application screen down with it.
    """
    try:
        return call_proc('sp_achiever_doc_types_list', 1 if active_only else 0) or []
    except Exception as e:
        logger.error(f"doc type list failed: {e}")
        return []


def doc_type_ok(value):
    """(ok, reason) for a submitted doc_type. Distinguishes an unknown value
    from one an admin has retired, so the message can differ."""
    if not value:
        return False, 'unknown'
    try:
        row = call_proc_one('sp_achiever_doc_type_check', value) or {}
    except Exception as e:
        logger.error(f"doc type check failed for {value!r}: {e}")
        # Fail closed — an unvalidated document type must not reach the queue.
        return False, 'unknown'
    return bool(row.get('ok')), row.get('reason') or 'unknown'

def _fill_policy_tokens(s, achiever_id=None):
    """Substitute the commission tokens in agreement text.

    The label used to read "SKOVO retains 30%" as literal text while
    PLATFORM_FEE_RATIO lived in helpers.py. Change the commission and the
    sentence an achiever legally accepted would still say 30%. The master row
    carries `{commission_pct}` / `{achiever_pct}` instead, filled here from the
    single source of truth — now `commission_rules`, so a rate change is
    reflected in what the next achiever is asked to accept.

    Passing achiever_id resolves their own rate; without it the global rule
    applies. This deliberately raises when no rule resolves: rendering an
    agreement with a guessed percentage would put a number in front of someone
    to sign that the platform does not actually intend to honour.
    """
    if not s:
        return s
    from portal.helpers.helpers import resolve_commission_rate
    pct = round(resolve_commission_rate(achiever_id=achiever_id) * 100)
    return (s.replace('{commission_pct}', str(pct))
             .replace('{achiever_pct}', str(100 - pct)))


def agreement_types(required_only=False, achiever_id=None):
    """The agreements an achiever must accept — master data, not a constant.

    Lives in `master_achiever_agreement`, registered in `master_registry`, so
    Admin > Masters edits them. Each row carries the TEXT that was accepted and
    its version, which is what makes the consent ledger evidentiary: before
    this, `policy_version = 'v1'` pointed at nothing.
    """
    try:
        rows = call_proc('sp_achiever_agreement_types_list',
                         1 if required_only else 0) or []
    except Exception as e:
        logger.error(f"agreement type list failed: {e}")
        return []
    for r in rows:
        # achiever_id is optional here on purpose: this list is also rendered
        # before anyone is signed in, where there is no achiever to resolve and
        # the global rule is the honest answer. When a caller does know who is
        # asking, it must say so — otherwise a negotiated rate is invisible.
        r['label'] = _fill_policy_tokens(r.get('label'), achiever_id)
        r['body'] = _fill_policy_tokens(r.get('body'), achiever_id)
    return rows


def agreement_type_ok(value):
    """(ok, reason, version) for a submitted agreement type.

    Returns the CURRENT version so the route records consent against the exact
    wording the achiever was shown, rather than a global constant.
    """
    if not value:
        return False, 'unknown', None
    try:
        row = call_proc_one('sp_achiever_agreement_type_check', value) or {}
    except Exception as e:
        logger.error(f"agreement type check failed for {value!r}: {e}")
        return False, 'unknown', None
    return bool(row.get('ok')), row.get('reason') or 'unknown', row.get('version')


def agreement_status(achiever_id):
    """Every required agreement with whether this achiever accepted it, which
    version they signed, and whether the wording has moved on since."""
    try:
        rows = call_proc('sp_achiever_agreement_status', achiever_id) or []
    except Exception as e:
        logger.error(f"agreement status failed for {achiever_id}: {e}")
        return []
    for r in rows:
        # THIS achiever's rate, not the platform default.
        #
        # `_fill_policy_tokens` has taken `achiever_id` since it was written and
        # its own docstring says why — "passing achiever_id resolves their own
        # rate; without it the global rule applies" — but every call site passed
        # nothing. So an achiever on a negotiated rate was shown, and asked to
        # accept, the global percentage: the agreement recording what they
        # signed misstated the one number in it that matters. commission_rules
        # is scoped achiever-over-global precisely so a negotiated rate is data;
        # dropping the id here threw that away at the last step.
        r['label'] = _fill_policy_tokens(r.get('label'), achiever_id)
        r['body'] = _fill_policy_tokens(r.get('body'), achiever_id)
    return rows

# How long a background check stays valid before the nightly job demotes it.
BGV_VALID_MONTHS = 12


# get_trust, has_capability and require_capability are gone with the tiers.
# They read sp_achiever_trust_get, which joined achiever_trust_rules on
# trust_level — a column nothing maintains any more, so every achiever resolved
# to level 0 and every capability to false. Use require_state() below.


def clamp_rate(achiever_id, requested, trust=None):   # noqa: ARG001 - trust kept for callers
    """Hold a session rate to what the achiever's state allows.

    Rewritten off the tier table. It used to read max_session_rate from
    achiever_trust_rules joined on trust_level, and once tiers stopped being
    maintained every achiever looked like tier 0 — so an approved, active
    achiever setting a price would have been silently clamped to zero.

    There is no ceiling any more. An admin sets the rate when they move someone
    to active, having read that person's demo reviews; a number a human already
    approved does not need a second, blunter limit on top.

    Returns (rate, note). `note` is None when the rate went through untouched,
    otherwise an explanation the caller shows — silently rewriting someone's
    price is how you get a support ticket.
    """
    try:
        rate = float(requested or 0)
    except (TypeError, ValueError):
        return 0.0, 'Rate must be a number.'
    if rate <= 0:
        return 0.0, None

    caps = lifecycle_caps(achiever_id)
    if not caps:
        return 0.0, 'We could not verify your account status, so your rate was left at 0.'
    if not caps.get('can_charge'):
        return 0.0, ('Paid sessions open after an admin reviews your demo sessions. '
                     'Your rate has been kept at 0 for now.')
    return rate, None



def booking_eligibility(achiever_id, student_id):
    """Can this student book this achiever? -> (ok: bool, reason: str, state: str)

    Delegates to sp_achiever_booking_eligibility so the DPDP age-band rule, the
    parental-consent rule and the lifecycle state are evaluated together in one
    place — three separate Python checks would drift apart the first time one
    of them changed.

    The third value used to be a trust tier and is now the lifecycle state.
    Both call sites discard it; it is returned for logging.
    """
    try:
        row = call_proc_one('sp_achiever_booking_eligibility', achiever_id, student_id) or {}
    except Exception as e:
        logger.error(f"booking eligibility failed a={achiever_id} s={student_id}: {e}")
        # Fail closed. An eligibility check that errors must not become a yes.
        return False, 'eligibility_check_failed', ''
    return bool(row.get('ok')), row.get('reason') or 'unknown', row.get('state') or ''


# Reason code -> what the student is told. Kept out of SQL so the wording can
# change without a migration.
BOOKING_DENIED = {
    'not_found': 'Achiever not found.',
    'inactive': 'This achiever is not currently available.',
    'unverified': 'This achiever is not yet available for bookings.',
    'student_under_14': 'SKOVO accounts are available from age 14.',
    'parental_consent_pending': (
        'We need a parent or guardian to confirm your account before you can '
        'book a session. Check the email we sent them.'),
    # A probation achiever runs free demo sessions only.
    'achiever_cannot_charge': 'This achiever is running free demo sessions right now.',
    'eligibility_check_failed': 'We could not verify this booking. Please try again.',
}


def booking_denied_message(reason):
    return BOOKING_DENIED.get(reason, 'This booking is not available.')


def public_badge(row):
    """What a student sees on an achiever card.

    Deliberately coarse. It read trust_level before, so once tiers stopped being
    maintained every achiever resolved to level 0 and the badge silently
    disappeared from every card on the platform.

    Now it says the two things a student actually benefits from knowing: that a
    human reviewed this person's documents and demo sessions (`active`), and
    separately that a background check came back clear. Probation deliberately
    earns no badge — those achievers are running free demos precisely because
    nobody has vouched for them yet.
    """
    if (row.get('bgv_status') or '') == 'clear':
        return 'background_verified'
    if (row.get('state') or '') == 'active':
        return 'verified'
    return None


# ── Lifecycle capabilities ───────────────────────────────────────────────────
# These replace the tier guards above. Capability now follows the achiever's
# state — pending / probation / active / suspended / banned — which is the
# model the platform actually runs on. The tier table decided this before, and
# two systems answering the same question is how an achiever ends up able to
# charge while still on probation.

def lifecycle_caps(achiever_id):
    """The achiever's state and what it permits, or None when not found."""
    if not achiever_id:
        return None
    try:
        return call_proc_one('sp_achiever_capabilities', achiever_id)
    except Exception as e:
        logger.error(f"capability lookup failed for {achiever_id}: {e}")
        return None


def require_state(achiever_id, capability, message):
    """None when permitted, else a ready-to-return 403 body.

    Fails closed: a lookup that errors is a refusal, never an allow.
    """
    from flask import jsonify
    caps = lifecycle_caps(achiever_id)
    if not caps:
        return jsonify(response={'message': 'We could not verify your account status.'},
                       status=403, bool=False)
    if not caps.get(capability):
        return jsonify(response={'message': message, 'state': caps.get('state')},
                       status=403, bool=False)
    return None


def require_screen(achiever_id, screen, message=None):
    """None when this achiever's state unlocks `screen`, else a 403 body.

    SCREENS is described as the single source for what a state may do
    (AC01-012), but it only ever gated the *sidebar*. The brief is explicit
    that a hidden sidebar item is not access control, and several endpoints
    behind a locked screen had nothing but a `role == 'mentor'` check:

      * coupons  -- `active` only in SCREENS, yet a pending, suspended or
        banned achiever could mint discount codes through the API. Coupons are
        money: sp_student_coupon_validate applies them at checkout.
      * availability -- not in the suspended or banned screen set, yet those
        achievers could keep publishing bookable slots. Staying bookable is
        the one thing a suspension is supposed to stop.

    Fails closed, like require_state: a lookup that errors is a refusal.

    Imported lazily because achiever_lifecycle imports this module.
    """
    from flask import jsonify
    from portal.routes.AchieverApplication.achiever_lifecycle import SCREENS

    caps = lifecycle_caps(achiever_id)
    if not caps:
        return jsonify(response={'message': 'We could not verify your account status.'},
                       status=403, bool=False)
    state = caps.get('state')
    # An unknown state gets the most restrictive set, not a free pass.
    if screen not in SCREENS.get(state, SCREENS['pending']):
        return jsonify(
            response={'message': message or 'Your account does not have access to this yet.',
                      'state': state},
            status=403, bool=False)
    return None
