"""Validate cohort input before MySQL sees it.

Sheet X-04 ("Cohort create", 45 cases) and the brief's recurring theme:

    Validate before MySQL sees it. A 256-char title reaching the column is a 500
    with an opaque error id. Return a 400 naming the field.

Before this, the cohort routes checked `title` and `price` and let everything
else through to `_cohort_sp_args`, which casts each field on the way to
`sp_cohorts_create`. Three separate ways that produced a 500 the achiever could
do nothing with:

  * `int('abc')` on duration_minutes / total_seats -- ValueError, uncaught.
  * `parse_local_to_utc('not a date')` on registration_deadline -- ValueError.
    session_date was guarded; the deadline next to it never was, and since the
    deadline became enforced (brief 1.2) a bad value also closes enrolment.
  * `level` is VARCHAR(50); 51 characters is MySQL errno 1406, a 500.

`level` is checked for length, not against a vocabulary. The three labels the
courses screens use (beginner/intermediate/advanced) are a *courses* convention,
and cohort level-based visibility was deliberately removed on 2026-08-30 -- so
an allowlist here would reject values that are legitimately in the column today.
Length is the part that actually breaks.

Both the achiever routes and the admin routes call this, so the two cannot drift.
"""
from portal.helpers.helpers import parse_local_to_utc
from portal.helpers.links import check_external, check_openable

# Column limits that actually exist, plus sane caps on the TEXT columns. TEXT
# holds 65535 bytes, so an unbounded title is a 500 waiting to happen and an
# unbounded `about` is a payload nobody can render.
MAX_TITLE = 255
MAX_ABOUT = 5000
MAX_LEVEL = 50          # cohorts.level is VARCHAR(50)
MAX_URL = 1000
MAX_DURATION = 1440     # a single session, so one day is the ceiling
MAX_SEATS = 100000


def _blank(v):
    """True for the shapes an emptied form field arrives in."""
    return v is None or (isinstance(v, str) and not v.strip())


def _too_long(v, cap):
    return isinstance(v, str) and len(v.strip()) > cap


# helpers.links owns the scheme allowlist for every field later rendered as an
# `<a href>` or `<img src>`. The two cohort links need *different* rules and it
# matters which way round:
#
#   meeting_link   -- a Teams or Meet room is never on our own origin, so a
#                     root-relative path is meaningless here. External only.
#   thumbnail_url  -- /v1/upload hands back "/uploads/<name>", so an uploaded
#                     thumbnail IS root-relative. Refusing that would reject the
#                     app's own upload flow.
_LINK_RULES = {
    'meeting_link': (check_external, 'Meeting link'),
    'thumbnail_url': (check_openable, 'Thumbnail URL'),
}


def validate_cohort_input(data, *, require_title=True, creating=False):
    """Return an error message naming the offending field, or None if the input is fine.

    `require_title` is False on PUT, where an absent key means "leave it alone"
    rather than "set it to empty".

    `creating` is True on POST: domain, about, learn-list, when and duration
    are required so a class a student can actually judge exists. PUT still
    allows a missing key (leave alone).
    """
    if creating:
        if _blank(data.get('domain_id')):
            return 'Pick a domain.'
        if _blank(data.get('about')):
            return 'Tell students what this class is about.'
        learn = data.get('what_you_learn') or []
        if isinstance(learn, str):
            learn = [learn]
        if not any(str(x).strip() for x in learn if x is not None):
            return 'Add at least one thing students will learn.'
        if _blank(data.get('session_date')):
            return 'Pick when the session runs.'
        if _blank(data.get('duration_minutes')):
            return 'Enter how many minutes this class runs.'

    if 'title' in data or require_title:
        title = (data.get('title') or '').strip()
        if require_title and not title:
            return 'Title is required.'
        if len(title) > MAX_TITLE:
            return f'Title must be {MAX_TITLE} characters or fewer.'

    if _too_long(data.get('about'), MAX_ABOUT):
        return f'About must be {MAX_ABOUT} characters or fewer.'

    if _too_long(data.get('level'), MAX_LEVEL):
        return f'Level must be {MAX_LEVEL} characters or fewer.'

    # ── Whole numbers. Blank is not zero: it means "not set". ────────────────
    for field, label, low, high in (
        ('duration_minutes', 'Duration', 1, MAX_DURATION),
        ('total_seats', 'Total seats', 0, MAX_SEATS),
        ('price', 'Price', 0, None),
    ):
        if field not in data or _blank(data[field]):
            continue
        try:
            n = int(data[field])
        except (TypeError, ValueError):
            return f'{label} must be a whole number.'
        if n < low:
            return (f'{label} cannot be negative.' if low == 0
                    else f'{label} must be at least {low}.')
        if high is not None and n > high:
            return f'{label} must be {high} or less.'

    # ── Dates. Naming which date is wrong matters: the form has two. ─────────
    for field, label in (('session_date', 'Session date'),
                         ('registration_deadline', 'Registration deadline')):
        if field not in data or _blank(data[field]):
            continue
        try:
            parse_local_to_utc(data[field])
        except (ValueError, TypeError):
            return f'{label} is not a valid date. Use ISO 8601.'

    # ── Links. Optional, but if present they must be openable. ──────────────
    for field, (checker, label) in _LINK_RULES.items():
        if field not in data or _blank(data[field]):
            continue
        if _too_long(data[field], MAX_URL):
            return f'{label} must be {MAX_URL} characters or fewer.'
        err = checker(data[field], label)
        if err:
            return err

    return None
