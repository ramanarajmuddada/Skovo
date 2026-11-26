import secrets
import string
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace

# The DB stores all datetimes as naive UTC (see portal/scheduler.py). Browser
# <input type="datetime-local"> fields submit naive local wall-clock strings with
# no offset — for this India-only platform that's IST (UTC+5:30). This is the one
# place that assumption lives, so every cohort/session create-or-update path stays
# in sync.
_IST_OFFSET = timedelta(hours=5, minutes=30)

class CommissionRuleMissing(RuntimeError):
    """No commission rule resolved — the sale must not be priced.

    Deliberately fatal. An earlier version of this module fell back to a
    constant when the rules table was unreachable, which meant a misconfigured
    database silently priced every sale at the old default: the sale succeeded,
    the numbers looked plausible, and the wrong achiever share was only
    discovered weeks later in the payouts. Refusing the sale is recoverable;
    quietly paying the wrong amount is not.
    """


def resolve_commission_rate(achiever_id=None, tier=None, kind=None) -> float:
    """Rate for this sale, most specific rule winning: achiever > tier > global.

    Callers pricing a *new* order should prefer sp_payment_order_open, which
    resolves the rate inside the same transaction that opens the order — a rate
    read here and used a moment later could be changed in between. This helper
    is for display (showing an achiever their cut) and for the older cohort and
    course flows that do not yet go through payment_orders.

    Raises CommissionRuleMissing if nothing resolves.
    """
    from sqlalchemy import text
    from portal.models import db

    try:
        row = db.session.execute(text("""
            SELECT rate FROM `commission_rules`
             WHERE is_active = 1
               AND effective_from <= UTC_TIMESTAMP()
               AND (effective_to IS NULL OR effective_to > UTC_TIMESTAMP())
               AND (kind IS NULL OR kind = :kind)
               AND (
                     (scope = 'achiever' AND scope_id = :achiever_id)
                  OR (scope = 'tier'     AND scope_id = :tier)
                  OR (scope = 'global')
                   )
             ORDER BY
                CASE scope WHEN 'achiever' THEN 1 WHEN 'tier' THEN 2 ELSE 3 END,
                CASE WHEN kind IS NULL THEN 2 ELSE 1 END,
                effective_from DESC
             LIMIT 1
        """), {
            'kind': kind,
            'achiever_id': achiever_id,
            'tier': str(tier) if tier is not None else None,
        }).scalar()

        if row is not None:
            return float(row)
    except CommissionRuleMissing:
        raise
    except Exception as exc:
        raise CommissionRuleMissing(
            f"commission_rules unreadable: {exc}"
        ) from exc

    raise CommissionRuleMissing(
        f"no active rule for achiever={achiever_id} tier={tier} kind={kind}; "
        "a global rule in commission_rules is mandatory"
    )


def split_earning(price, achiever_id=None, tier=None, kind=None) -> tuple:
    """Return (platform_fee, achiever_earning) for a gross price, rounded to 2dp.

    The extra arguments are optional so the 20-odd existing call sites keep
    working unchanged; passing them opts into per-achiever and per-tier rates.

    Raises CommissionRuleMissing rather than guessing a rate — see that class.
    """
    gross = float(price or 0)
    rate = resolve_commission_rate(achiever_id, tier, kind)
    platform_fee = round(gross * rate, 2)
    return platform_fee, round(gross - platform_fee, 2)


def get_payment_setting(key, cast=None):
    """Read one operational knob from payment_settings.

    No default argument on purpose: a caller that supplies a default has just
    reintroduced the hardcoded value this table exists to remove. A missing
    key is a misconfiguration and raises.
    """
    from sqlalchemy import text
    from portal.models import db

    row = db.session.execute(text(
        "SELECT setting_value, value_type FROM `payment_settings` "
        "WHERE setting_key = :k"
    ), {'k': key}).fetchone()

    if row is None:
        raise KeyError(f"payment_settings['{key}'] is not set")

    value, vtype = row[0], (row[1] or 'string')
    if cast:
        return cast(value)
    if vtype == 'int':
        return int(value)
    if vtype == 'decimal':
        return float(value)
    if vtype == 'bool':
        return str(value).strip().lower() in ('1', 'true', 'yes', 'on')
    return value


def generate_otp(length: int = 6) -> str:
    """Generate a cryptographically secure numeric OTP of given length."""
    return ''.join(secrets.choice(string.digits) for _ in range(length))


def compute_readiness_level(score: int) -> str:
    """The configured level name for a score.

    Levels are rows in readiness_levels -- editable, and any number of them.
    They used to be three literals here, which meant a rename had to be made in
    nine places and the top one stayed "Achiever", already the mentor role.

    The literals survive only as a fallback for a database that has not had the
    levels seeded: a lookup failure should give a slightly stale badge, not a
    blank one.
    """
    try:
        from portal.helpers.sp import call_proc
        from portal.models import db
        from sqlalchemy import text
        row = db.session.execute(text(
            "SELECT label FROM readiness_levels "
            "WHERE is_active = 1 AND min_score <= :s "
            "ORDER BY min_score DESC LIMIT 1"
        ), {'s': int(score or 0)}).fetchone()
        if row and row[0]:
            return row[0]
    except Exception:
        pass
    if score >= 65:
        return "Achiever"
    elif score >= 30:
        return "Pioneer"
    return "Explorer"


def readiness_level_gates():
    """Every configured level a student can still climb to, lowest first.

    Returns [(label, min_score), ...] for the active rows in readiness_levels,
    skipping the bottom band -- a level that starts at 0 is not a gate, everyone
    already has it.

    This exists because two screens were still building the student's "what is
    next" ladder out of readiness_rules.pioneer_min / achiever_min, columns the
    levels table replaced. That named a level at 30 and another at 65 no matter
    what the admin had configured, so the ladder disagreed with the badge the
    same student was wearing.

    Empty on a lookup failure, so callers fall back to showing only the
    Opportunity Hub rather than inventing bands.
    """
    try:
        from portal.models import db
        from sqlalchemy import text
        rows = db.session.execute(text(
            "SELECT label, min_score FROM readiness_levels "
            "WHERE is_active = 1 AND min_score > 0 ORDER BY min_score"
        )).fetchall()
        return [(r[0], int(r[1])) for r in rows if r[0]]
    except Exception:
        return []


# The Opportunities Hub gate (Scope §4.5, Playbook §5.7). The spec floor, used
# only when the config row cannot be read.
OPPORTUNITY_HUB_MIN_SCORE = 60


def opportunity_hub_min_score() -> int:
    """The live Opportunities Hub gate, from `readiness_rules`.

    The threshold is admin-editable on the Readiness Rules screen, so a constant
    is not the truth — and the two disagreed in production: the rules row said
    65 while the dashboard counted down to a hardcoded 60, which promised a
    student the Hub five points before it would actually open. Everything that
    shows the gate or enforces it reads this, so the countdown and the check
    can never drift apart again.

    Falls back to the spec floor if the row is unreadable — a gate that opens
    slightly early beats a screen that cannot render.
    """
    try:
        # ── SP: sp_readiness_rules_list — singleton config row, same reader
        # the Opportunities gate itself uses. ───────────────────────────────
        from portal.helpers.sp import call_proc
        rows = call_proc('sp_readiness_rules_list', 1, 0) or []
        value = rows[0].get('opportunity_unlock_score') if rows else None
        if value is not None:
            return int(value)
    except Exception:
        pass
    return OPPORTUNITY_HUB_MIN_SCORE


def is_opportunity_hub_unlocked(score: int) -> bool:
    """Opportunity Hub unlocks at the configured readiness score (v1 spec: 60)."""
    return int(score or 0) >= opportunity_hub_min_score()


def offer_effective_price(row):
    """Effective price for a cohort/course dict honoring its offer window.

    Achievers can set an `offer_price` (flat) or `offer_percent` (%) with an
    optional [offer_starts_at, offer_ends_at] window. Returns
    (effective_price: int, offer_label: str | None). Falls back to the base price.
    """
    import datetime as _dt
    try:
        base = int(row.get('price') or 0)
    except (TypeError, ValueError):
        base = 0
    now = _dt.datetime.utcnow()
    starts, ends = row.get('offer_starts_at'), row.get('offer_ends_at')
    if (starts and now < starts) or (ends and now > ends):
        return base, None
    op, opct = row.get('offer_price'), row.get('offer_percent')
    if op not in (None, ''):
        return int(op), (row.get('offer_label') or 'Offer')
    if opct not in (None, '', 0):
        # Exact, never rounded (see offer_tier_price).
        return offer_tier_price(base, 'percent', opct), (row.get('offer_label') or f'{int(opct)}% off')
    return base, None


def offer_tier_price(price, kind, value):
    """Price after one slab's discount, exact -- never rounded (Rs 5 at 50% is
    Rs 2.50, not Rs 3: rounding up made "50% off" really 40% off). Whole-rupee
    price x whole % / 100 always lands on a paisa, so nothing is lost.
    sp_payment_cohort_hold_offer computes the same figure."""
    from decimal import Decimal
    price, value = Decimal(int(price or 0)), Decimal(int(value or 0))
    final = price - value if kind == 'amount' else price * (100 - value) / 100
    return float(final.quantize(Decimal('0.01')))


def parse_offer_tiers(raw):
    """cohorts.offer_tiers as a dict {type, tiers: [{seats|None, value}]}, or None."""
    import json as _json
    if not raw:
        return None
    try:
        t = _json.loads(raw) if isinstance(raw, (str, bytes)) else raw
    except (TypeError, ValueError):
        return None
    if not isinstance(t, dict) or not t.get('tiers'):
        return None
    return t


def cohort_offer_state(row):
    """The public offer on a cohort as a student would get it right now.

    Window and first-N limit both apply (offer_seats; places counted by
    sp_cohort_offer_used). Returns None when no offer is live, else a dict:
    {price, offer_price, discount, label, ends_at, seats, used, left}.
    sp_payment_cohort_hold_offer re-checks the limit under the row lock.
    """
    base = int(row.get('price') or 0)
    tiers = parse_offer_tiers(row.get('offer_tiers'))
    if tiers and base > 0:
        import datetime as _dt
        ends = row.get('offer_ends_at')
        if ends and _dt.datetime.utcnow() > ends:
            return None
        from portal.helpers.sp import call_proc_one
        used = int((call_proc_one('sp_cohort_offer_used', row.get('id')) or {}).get('used') or 0)
        kind, cum = tiers.get('type') or 'percent', 0
        slabs = tiers['tiers']
        for i, t in enumerate(slabs):
            seats = t.get('seats')
            cum = cum + int(seats) if seats is not None else None
            if cum is None or used < cum:
                eff = offer_tier_price(base, kind, t.get('value'))
                nxt = slabs[i + 1] if i + 1 < len(slabs) else None
                return {
                    'price': base, 'offer_price': eff, 'discount': base - eff,
                    'label': f"{int(t['value'])}% off" if kind == 'percent' else f"₹{int(t['value'])} off",
                    'ends_at': ends, 'seats': cum, 'used': used,
                    'left': (cum - used) if cum is not None else None,
                    'next_price': offer_tier_price(base, kind, nxt.get('value')) if nxt else base,
                    'slab': i + 1, 'slabs': len(slabs),
                }
        return None
    eff, label = offer_effective_price(row)
    if base <= 0 or eff >= base or eff < 1:
        return None
    seats = row.get('offer_seats')
    used = 0
    if seats is not None:
        from portal.helpers.sp import call_proc_one
        used = int((call_proc_one('sp_cohort_offer_used', row.get('id')) or {}).get('used') or 0)
        if used >= int(seats):
            return None
    return {
        'price': base, 'offer_price': eff, 'discount': base - eff, 'label': label,
        'ends_at': row.get('offer_ends_at'), 'seats': seats, 'used': used,
        'left': (int(seats) - used) if seats is not None else None,
        'next_price': base, 'slab': 1, 'slabs': 1,
    }


def score_from_assessment_steps(steps: list) -> int:
    """
    Calculate assessment score (max 75 pts) from completed ReadinessAssessment steps.
      Step 1 — Skills:     +2 per skill, max 10 skills → max 20 pts
      Step 2 — Experience: +10 internship, +5/project (max 3) → max 25 pts
      Step 3 — Career goal set → 20 pts
      Step 4 — Engagement: +5 groups, +5 cohorts → max 10 pts
    """
    total = 0
    for s in steps:
        data = s.step_data or {}
        if s.step == 1:
            skills = data.get('skills', [])
            total += min(len(skills) * 2, 20) if isinstance(skills, list) else 0
        elif s.step == 2:
            pts = 10 if data.get('has_internship') else 0
            projects = int(data.get('projects_count', 0) or 0)
            pts += min(projects * 5, 15)
            total += min(pts, 25)
        elif s.step == 3:
            if (data.get('career_goal') or '').strip():
                total += 20
        elif s.step == 4:
            pts = (5 if data.get('in_groups') else 0)
            pts += (5 if int(data.get('cohorts_attended', 0) or 0) > 0 else 0)
            total += min(pts, 10)
    return min(total, 75)


def paginate_query(query, page: int, per_page: int):
    """Return paginated SQLAlchemy query results."""
    pagination = query.paginate(page=page, per_page=per_page, error_out=False)
    return {
        'items': pagination.items,
        'total': pagination.total,
        'page': pagination.page,
        'per_page': pagination.per_page,
        'pages': pagination.pages,
        'has_next': pagination.has_next,
        'has_prev': pagination.has_prev,
    }


def serialize_datetime(dt) -> str:
    """Naive datetimes are UTC — say so explicitly, or the browser's `new Date()`
    parses the offset-less string as local time and shifts it by the user's
    timezone all over again on render.

    Accepts a `date` as well as a `datetime`, and returns it untouched. A date
    has no time to shift and no timezone to declare, so stamping it with `Z`
    would turn "12 September" into a midnight UTC instant that renders as the
    11th for anyone west of Greenwich. Handling both here is what makes it safe
    to call on every outgoing column without first checking which kind it is —
    and that is the point: the alternative is 130 call sites each deciding for
    themselves, which is how the offset-less ones got there in the first place.
    """
    if dt is None:
        return None
    if isinstance(dt, date) and not isinstance(dt, datetime):
        return dt.isoformat()
    if dt.tzinfo is None:
        return dt.isoformat() + 'Z'
    return dt.isoformat()


def effective_cohort_status(c) -> str:
    """upcoming until session_date, then live until the achiever Ends.

    The scheduler writes `live` at start. It does **not** write `completed` —
    only End session (or an explicit status write) does. A clock that auto-
    completed at duration cut a class that was still teaching.

    Stored `completed` / `cancelled` still outrank the clock: a date edit must
    not reopen a class that has been taught.
    """
    if c.status in ('cancelled', 'completed') or not c.session_date:
        return c.status
    now = datetime.utcnow()
    if c.session_date > now:
        # Start opens a few minutes early; once pressed the row says `live`,
        # and every screen must agree (it showed Upcoming in one place and
        # Live in another for those minutes).
        if c.status == 'live' or getattr(c, 'started_at', None):
            return 'live'
        return 'upcoming'
    # A class nobody ended stayed "Live now" for months. Six hours past its
    # booked end it is over, whoever forgot the button; the stored row is left
    # alone, so completion still needs a real End session.
    end = c.session_date + timedelta(minutes=(getattr(c, 'duration_minutes', None) or 90))
    if now > end + timedelta(hours=6):
        return 'completed'
    return 'live'


def cohort_join_open(c) -> bool:
    """Join from T-15 until End session. Caller still checks meeting_link."""
    st = effective_cohort_status(c)
    if st in ('cancelled', 'completed') or not c.session_date:
        return False
    return datetime.utcnow() >= (c.session_date - timedelta(minutes=15))


def cohort_time_up(c) -> bool:
    """True when the booked minutes have elapsed and the achiever has not Ended."""
    if effective_cohort_status(c) != 'live' or not c.session_date:
        return False
    end = c.session_date + timedelta(minutes=(c.duration_minutes or 90))
    return datetime.utcnow() >= end


def cohort_tasks_open(cohort) -> bool:
    """True once an enrolled student may see and submit a cohort's tasks.

    A task belongs to a class, so it opens when the class opens -- the moment
    the session starts, not when it ends. Achievers set the follow-up work
    while the meeting is still running at least as often as afterwards, and the
    old rule (session_date + duration must have passed) left such a task
    invisible in My Tasks for the rest of the hour. To the achiever who had just
    assigned it, and to the students staring at an empty list, that read as the
    assignment never having saved.

    `cohort` is a mapping -- the shape every sp_cohorts_* row comes back as.

    A stored 'completed' outranks the clock -- that is an achiever or admin
    saying the class is over, and it must keep the tasks open even if
    session_date is later edited to a future date. That rule used to live here
    as its own branch; it now lives in effective_cohort_status, which every
    other guard also reads, so the two can no longer disagree about the same
    cohort. Everything defers to that one derivation, and a status column the
    scheduler has not caught up with can neither hide a task nor reveal one early.
    """
    if not cohort:
        return False
    if (cohort.get('status') or '').lower() == 'cancelled' or cohort.get('missed_at'):
        return False
    eff = effective_cohort_status(SimpleNamespace(
        status=cohort.get('status'),
        session_date=cohort.get('session_date'),
        duration_minutes=cohort.get('duration_minutes'),
    ))
    # Class rules: tasks open when the class ends (End session or the
    # automatic close), so nobody does homework during the class.
    from portal.helpers import class_rules as CR
    if CR.follows(cohort):
        return eff == 'completed'
    return eff in ('live', 'completed')


def parse_local_to_utc(value):
    """Parse an ISO-ish datetime string from a datetime-local input into a naive
    UTC datetime for storage. Strings that already carry an offset/Z are honored
    instead of assumed-IST. Returns None for falsy input."""
    if not value:
        return None
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is not None:
        return parsed.astimezone(timezone.utc).replace(tzinfo=None)
    return parsed - _IST_OFFSET


def format_ist(value, fmt='%d %b %Y, %I:%M %p', suffix=' IST'):
    """Render a stored naive-UTC datetime as the IST wall-clock a reader expects.

    The inverse of `parse_local_to_utc`, and it did not exist. `_IST_OFFSET` was
    used in exactly one direction — input — so every outgoing email had to
    remember to add 5:30 by hand, and none of them did:

      * The enrolment mail (`Cohorts/cohorts.py`) printed `session_date`
        straight through `strftime`. A class stored at 15:45 UTC was announced
        as **3:45 PM** instead of 9:15 PM — and the `.ics` attached to that same
        message was correct, because `calendar_invite.py` emits a `Z` suffix and
        the calendar app converts properly. One email, two different times for
        one class.
      * The reschedule mail (`Achiever/achiever.py`) was worse: it appended the
        literal string `' IST'` to a UTC time, so it did not merely show the
        wrong hour, it asserted a timezone it was not using.

    The suffix is on by default for that reason. A bare time in an email is
    ambiguous to the reader and, as above, easy for the next writer to label
    wrongly. Pass `suffix=''` where the surrounding copy already says IST.

    Returns None for falsy input, so callers can keep their own 'soon' fallback.
    """
    if not value:
        return None
    if getattr(value, 'tzinfo', None) is not None:
        value = value.astimezone(timezone.utc).replace(tzinfo=None)
    return (value + _IST_OFFSET).strftime(fmt) + suffix


def normalise_indian_mobile(raw):
    """Store one canonical shape (+91XXXXXXXXXX) whatever the student typed.

    People enter 9876543210, 09876543210, +91 98765 43210, 91-9876543210. A
    number that cannot be read is dropped rather than rejected — this is an
    optional field and signup must never fail because of it.
    """
    if not raw:
        return None
    digits = ''.join(ch for ch in str(raw) if ch.isdigit())
    if len(digits) == 10:
        pass
    elif len(digits) == 11 and digits.startswith('0'):
        digits = digits[1:]
    elif len(digits) == 12 and digits.startswith('91'):
        digits = digits[2:]
    else:
        return None
    # Indian mobile numbers start 6-9.
    return f'+91{digits}' if digits[0] in '6789' else None


def normalise_phone(value):
    """A bare 10-digit Indian mobile, or None.

    Delegates to normalise_indian_mobile rather than repeating its rules. Two
    copies of the same parsing drift, and the failure that follows is nasty:
    signup accepts a number that checkout then rejects, so the account exists
    but cannot pay. The only difference is shape — users.phone stores
    +91XXXXXXXXXX, while Cashfree's customer_phone wants the ten digits alone.
    """
    canonical = normalise_indian_mobile(value)
    return canonical[3:] if canonical else None
