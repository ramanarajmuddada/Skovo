"""Input checks for achiever-created coupons, before the stored procedure.

WHY THIS EXISTS
    `value` had no upper bound at any layer. The form input was `min={1}` with
    no `max`, the route did `_f(d.get('value')) or 0`, and
    `sp_achiever_coupon_create` does `IFNULL(p_value,0)` -- so a percentage
    discount of 500 was accepted end to end.

    It did not produce a negative price, because `sp_student_coupon_validate`
    clamps with `LEAST(v_discount, p_amount)`. It produced a **free cohort**:
    the achiever typed 500 meaning 50, and gave the thing away. Silent, and only
    discoverable by reading the orders afterwards.

    A schema was added to the form in `Skovo/src/schemas/achiever.js`, and a
    schema in the browser is a courtesy -- this endpoint is reachable with
    `curl`, and the client check does nothing for a request that never passes
    through the form. This module is the half that actually holds.

WHY A PERCENTAGE CEILING OF 100 AND NO FLAT CEILING
    More than "all of it" is not a discount. A flat rupee amount has no such
    natural ceiling -- 5000 off a 50000 course is ordinary -- so flat is only
    required to be positive, and the checkout clamp remains the backstop.

SHAPE
    Mirrors `cohort_validation.validate_cohort_input`: return a message naming
    the offending field, or None. The caller turns it into a 400. Keeping the
    same shape means both live in the same place in the reader's head.

    The limits here and in the browser schema must stay identical. Where they
    disagree, the server wins and the client is the bug.
"""
import datetime
import re

# coupons.code is VARCHAR(40); 41 characters is MySQL errno 1406, which the
# route turns into a 500 with an opaque error id rather than a readable refusal.
MAX_CODE = 40

# Letters, digits, hyphen, underscore. A coupon code is typed by a student from
# a screenshot or a WhatsApp message, so spaces and punctuation are a support
# ticket waiting to happen, not a feature.
CODE_PATTERN = re.compile(r'^[A-Za-z0-9_-]+$')

MAX_PERCENT = 100


def _num(v):
    """Return a float, or None when the value is absent or not a number."""
    if v in (None, '', 'null'):
        return None
    try:
        return float(v)
    except (ValueError, TypeError):
        return None


def _date(v):
    """Parse an ISO date or datetime. Returns None when absent or unparseable.

    Unparseable and absent are deliberately not distinguished here: the ordering
    check below simply does not run when either side is missing, which is the
    same behaviour it had before. Rejecting a malformed date is the stored
    procedure's business, and it already does it.
    """
    if not v or not isinstance(v, str):
        return None
    s = v.strip().replace('Z', '+00:00')
    try:
        return datetime.datetime.fromisoformat(s)
    except ValueError:
        try:
            return datetime.datetime.strptime(s[:10], '%Y-%m-%d')
        except ValueError:
            return None


def validate_coupon_input(data):
    """Return an error message naming the offending field, or None."""
    code = (data.get('code') or '').strip()
    if not code:
        return 'Coupon code is required.'
    if len(code) > MAX_CODE:
        return f'Coupon code must be {MAX_CODE} characters or fewer.'
    if not CODE_PATTERN.match(code):
        return 'Coupon code can use letters, numbers, hyphens and underscores only.'

    dtype = data.get('discount_type')
    if dtype not in (None, '', 'percent', 'flat'):
        return "Discount type must be 'percent' or 'flat'."
    # The route defaults an unrecognised type to 'percent', so the ceiling below
    # has to assume percent when the caller said nothing.
    is_percent = dtype != 'flat'

    value = _num(data.get('value'))
    if value is None:
        return 'Discount value is required.'
    if value <= 0:
        return 'Discount value must be greater than zero.'
    if is_percent and value > MAX_PERCENT:
        return f'A percentage discount cannot be more than {MAX_PERCENT}%.'

    for field, label in (('max_discount', 'Maximum discount'),
                         ('min_amount', 'Minimum order amount')):
        n = _num(data.get(field))
        if n is not None and n < 0:
            return f'{label} cannot be negative.'

    for field, label in (('max_uses', 'Total uses'),
                         ('per_user_limit', 'Per-student limit')):
        raw = data.get(field)
        if raw in (None, '', 'null'):
            continue
        try:
            n = int(raw)
        except (ValueError, TypeError):
            return f'{label} must be a whole number.'
        if n < 1:
            return f'{label} must be at least 1.'

    # A coupon that expires before it starts is never valid for a single
    # moment. Nothing rejected it, so it could be created, listed, and quietly
    # refused at every checkout with "Coupon expired" — which reads as a
    # student problem rather than a coupon that was never viable.
    start, end = _date(data.get('valid_from')), _date(data.get('valid_until'))
    if start and end and end <= start:
        return 'Valid-until must be after valid-from.'

    applies = data.get('applies_to')
    if applies not in (None, '', 'cohort', 'session'):
        return "Applies to must be 'cohort' or 'session'."

    return None
