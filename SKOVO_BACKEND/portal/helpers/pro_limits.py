"""
Skovo Pro free-tier allowances.

One number per perk, set on Admin → Subscriptions, applied to every student.
After a free student hits the cap they must take Pro — there is no per-student
exception and no hardcoded 3/5/1 in the gates.

Fails open to DEFAULTS when the table or procedure is not on this database yet,
so a deploy that has not run the SQL still serves the previous product numbers.
"""
import time

from portal.helpers.sp import call_proc_one

# None means UNLIMITED, everywhere this module is read. Every gate has to
# treat it as "no cap" rather than falling through to a numeric comparison,
# because `used < None` raises in Python 3 instead of quietly passing.
DEFAULTS = {
    'free_paid_cohorts': 1,
    'saved_colleges': 3,
    'communities': 3,
    'vault_docs': 5,
    'session_credits': 2,
}

# Sent to sp_pro_free_limits_update in place of a number to mean "unlimited".
# NULL was already spoken for there — it means "leave this cap alone".
UNLIMITED_SENTINEL = -1

BOUNDS = {
    'free_paid_cohorts': (0, 20),
    'saved_colleges': (0, 50),
    'communities': (0, 50),
    'vault_docs': (0, 50),
    'session_credits': (0, 20),
}

KEYS = tuple(DEFAULTS.keys())

_cache = {'at': 0.0, 'data': None}
_TTL = 15


def invalidate_pro_limits():
    _cache['data'] = None
    _cache['at'] = 0.0


def _clamp(key, value):
    """A cap in range, or None for unlimited.

    None survives rather than collapsing to the default: a NULL column is the
    admin having chosen Unlimited, and coercing it back to a number would
    silently re-impose a cap they removed.
    """
    if value is None:
        return None
    lo, hi = BOUNDS[key]
    try:
        n = int(value)
    except (TypeError, ValueError):
        return DEFAULTS[key]
    if n < 0:            # the unlimited sentinel, arriving from the client
        return None
    return max(lo, min(hi, n))


def is_unlimited(value):
    """Read as a cap: None is no limit."""
    return value is None


def within(used, cap):
    """True while `used` is inside `cap`. Unlimited always passes."""
    return True if cap is None else used < cap


def _coerce(row):
    row = row or {}
    out = {}
    for k in KEYS:
        # A row from a database that has not run the rename yet still has the
        # old column; read it rather than silently reverting to the default.
        raw = row.get(k, row.get('monthly_session_credits') if k == 'session_credits'
                      else DEFAULTS[k])
        out[k] = _clamp(k, raw)
    return out


def get_pro_limits():
    now = time.time()
    if _cache['data'] is not None and (now - _cache['at']) < _TTL:
        return dict(_cache['data'])
    data = dict(DEFAULTS)
    try:
        row = call_proc_one('sp_pro_free_limits_get')
        if row:
            data = _coerce(row)
    except Exception:
        try:
            from sqlalchemy import text
            from portal.models import db
            row = db.session.execute(
                text('SELECT * FROM `pro_free_limits` WHERE `id` = 1')
            ).mappings().first()
            if row:
                data = _coerce(row)
        except Exception:
            data = dict(DEFAULTS)
    _cache['data'] = data
    _cache['at'] = now
    return dict(data)


def free_limit(key):
    if key not in DEFAULTS:
        raise KeyError(key)
    return get_pro_limits()[key]


def save_pro_limits(values, updated_by=None):
    """Persist caps. Procedure first, SQLAlchemy row if the SP is not on this DB yet."""
    payload = {k: _clamp(k, values.get(k, DEFAULTS[k])) for k in KEYS}
    # None means unlimited here, but NULL means "leave it alone" to the
    # procedure, so unlimited travels as the sentinel and is stored as NULL at
    # the far end. Passing None straight through would quietly keep the old cap.
    wire = {k: (UNLIMITED_SENTINEL if v is None else v) for k, v in payload.items()}
    row = None
    try:
        row = call_proc_one(
            'sp_pro_free_limits_update',
            wire['free_paid_cohorts'],
            wire['saved_colleges'],
            wire['communities'],
            wire['vault_docs'],
            wire['session_credits'],
            updated_by,
        )
        from portal.models import db
        db.session.commit()
    except Exception:
        from portal.models import db
        from portal.models.pro_free_limits import ProFreeLimits
        rec = db.session.query(ProFreeLimits).filter_by(id=1).first()
        if rec is None:
            rec = ProFreeLimits(id=1)
            db.session.add(rec)
        for k, v in payload.items():
            setattr(rec, k, v)
        rec.updated_by = updated_by
        db.session.commit()
        row = payload
    invalidate_pro_limits()
    return _coerce(row) if row else payload


def cohort_free_perk_status(user_id):
    """How many free paid-cohort seats this student has left.

    Always computes `available` against the live admin allowance so an older
    procedure that still returns allowance=1 cannot lie to the UI.
    """
    allowance = free_limit('free_paid_cohorts')
    if allowance is None:
        # Unlimited: no procedure call needed, and `used < None` would raise.
        return {'used': 0, 'allowance': None, 'available': True}
    used = 0
    try:
        row = call_proc_one('sp_cohort_free_perk_status', user_id, allowance) or {}
        used = int(row.get('used') or 0)
    except Exception:
        try:
            row = call_proc_one('sp_cohort_free_perk_status', user_id) or {}
            used = int(row.get('used') or 0)
        except Exception:
            used = 0
    return {
        'used': used,
        'allowance': allowance,
        'available': used < allowance,
    }


def upgrade_payload(kind, used=None, limit=None):
    """403 body every free-tier cap returns. Same shape on every screen."""
    limits = get_pro_limits()
    copy = {
        'cohorts': {
            'headline': 'Unlimited cohorts with Skovo Pro',
            'benefit': 'Every paid cohort is covered — enrol in one tap, no checkout.',
        },
        'colleges': {
            'headline': 'Save every college on your list',
            'benefit': 'Unlimited saved colleges, plus scholarship matches.',
        },
        'communities': {
            'headline': 'Every community, no limit',
            'benefit': 'Unlimited communities, direct messages and pinned posts.',
        },
        'vault': {
            'headline': 'Keep every document in one place',
            'benefit': 'Unlimited vault storage and a shareable public profile.',
        },
        'opportunities': {
            'headline': 'Apply in one tap',
            'benefit': 'Skovo Pro unlocks applying, plus a For You feed.',
        },
        'dms': {
            'headline': 'Message your community',
            'benefit': 'Direct messages are included with Skovo Pro.',
        },
        'bhaai': {
            'headline': 'Early BhaAI access',
            'benefit': 'Pro members are on the early-access list.',
        },
    }[kind]
    n = limit if limit is not None else {
        'cohorts': limits['free_paid_cohorts'],
        'colleges': limits['saved_colleges'],
        'communities': limits['communities'],
        'vault': limits['vault_docs'],
    }.get(kind)
    if kind == 'cohorts' and n is not None:
        message = (
            f"You've used your {n} free paid cohort{'s' if n != 1 else ''}. "
            'Take Skovo Pro for unlimited seats.'
            if (used is not None and n and used >= n) or n == 0
            else f'Free members get {n} paid cohort{"s" if n != 1 else ""}. Take Skovo Pro for unlimited.'
        )
    elif kind in ('colleges', 'communities', 'vault') and n is not None:
        noun = {'colleges': 'colleges', 'communities': 'communities', 'vault': 'documents'}[kind]
        shown = used if used is not None else n
        message = (
            f"You're at {shown} of {n} free {noun}. "
            'Take Skovo Pro to go unlimited.'
        )
    elif kind == 'opportunities':
        message = 'Applying to opportunities is a Skovo Pro feature. Take Skovo Pro to apply.'
    elif kind == 'dms':
        message = 'Direct messages are a Skovo Pro feature. Take Skovo Pro to send messages.'
    else:
        message = 'Take Skovo Pro to unlock this.'
    return {
        'message': message,
        'requires_pro': True,
        'upgrade': {
            **copy,
            'cta_label': 'Take Skovo Pro',
            'cta_route': '/skovo-pro',
            'used': used,
            'limit': n,
        },
    }
