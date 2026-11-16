"""
Catch an email typed one keystroke wrong, before anything is sent to it.

`user@gmil.com` is a valid address by every syntax rule and reaches nobody. The
person waits for a code that cannot arrive, and on a live sender every one of
those is a hard bounce -- the metric Amazon watches most closely, and the fastest
way to lose production access.

Deliberately conservative. It suggests only where the domain is one edit away
from a provider that a very large share of Indian students actually use, and it
never rewrites anything: the caller offers the correction and the person decides.
A real address at an unusual domain must never be refused because this file has
not heard of it.
"""
import re

# Providers common enough here that a near-miss is almost certainly a typo.
KNOWN_DOMAINS = (
    'gmail.com', 'yahoo.com', 'yahoo.in', 'outlook.com', 'hotmail.com',
    'live.com', 'icloud.com', 'rediffmail.com', 'protonmail.com',
)

# Ones worth naming outright: two edits away, or a wrong TLD, so the distance
# check below would not reach them.
EXPLICIT = {
    'gmai.com': 'gmail.com',
    'gmail.co': 'gmail.com',
    'gmail.con': 'gmail.com',
    'gmail.cm': 'gmail.com',
    'gamil.com': 'gmail.com',
    'gmails.com': 'gmail.com',
    'yaho.com': 'yahoo.com',
    'yahoo.co': 'yahoo.com',
    'hotmail.co': 'hotmail.com',
    'outlook.co': 'outlook.com',
    'iclould.com': 'icloud.com',
    'rediff.com': 'rediffmail.com',
}


def _edit_distance_at_most_one(a, b):
    """True when `a` becomes `b` with one insert, delete, substitution or swap.

    The swap matters more than the rest: transposing two adjacent letters --
    gmial, hotmial, yahho -- is the commonest typing mistake there is, and plain
    edit distance scores it as two substitutions, so it would be missed.
    """
    if a == b:
        return False                      # identical is not a typo
    la, lb = len(a), len(b)
    if abs(la - lb) > 1:
        return False

    if la == lb:
        diff = [i for i, (x, y) in enumerate(zip(a, b)) if x != y]
        if len(diff) == 1:                # one substitution
            return True
        if len(diff) == 2:                # adjacent swap
            i, j = diff
            return j == i + 1 and a[i] == b[j] and a[j] == b[i]
        return False

    # one insert/delete: walk both, allowing a single skip in the longer one
    short, long_ = (a, b) if la < lb else (b, a)
    i = j = 0
    skipped = False
    while i < len(short) and j < len(long_):
        if short[i] == long_[j]:
            i += 1
            j += 1
        elif skipped:
            return False
        else:
            skipped = True
            j += 1
    return True


def suggest_email(email):
    """A corrected address when the domain looks mistyped, else None.

    Returns the whole address, not just the domain, so the caller can offer it
    verbatim -- there is nothing for the UI to reassemble and get wrong.
    """
    if not email or '@' not in email:
        return None

    local, _, domain = (email or '').strip().lower().rpartition('@')
    if not local or not domain:
        return None

    if domain in KNOWN_DOMAINS:           # already right, nothing to say
        return None

    fixed = EXPLICIT.get(domain)
    if fixed:
        return f'{local}@{fixed}'

    for known in KNOWN_DOMAINS:
        if _edit_distance_at_most_one(domain, known):
            return f'{local}@{known}'

    return None


# ── Syntax, as opposed to plausibility ───────────────────────────────────────
#
# suggest_email() above answers "is this address a typo of a real one". Nothing
# answered the cruder question: is it an email address at all. Registration
# checked that the field was non-empty and short enough, and then accepted it —
# so `no-at-sign.example.com`, `two@@example.com` and `user@localhost` all
# created live accounts with tokens issued. X04-008/009/010.
#
# The damage is not the bad row. An account whose address cannot receive mail is
# **unrecoverable**: no OTP, no password reset and no notification will ever
# arrive, and the person cannot prove ownership to get it changed. It also feeds
# sp_identity_email_lookup, so cross-portal uniqueness is enforced over strings
# that are not addresses.
#
# Deliberately permissive, for the same reason as the file above: this product's
# core audience is at iitb.ac.in and company.co.uk, so anything stricter than
# "one @, a dot in the domain, no spaces" starts refusing real students. It is a
# syntax floor, not an RFC 5322 implementation — the only real proof an address
# works is mail arriving at it, which is what the OTP step is for.
_EMAIL_RE = re.compile(r'^[^@\s]+@[^@\s.]+(\.[^@\s.]+)+$')

MAX_LOCAL_PART = 64          # RFC 5321 §4.5.3.1.1


def check_email_format(email, label='Email'):
    """Return an error message, or None if the address is syntactically usable.

    Trims first, so a pasted address with a trailing space is not refused for
    a reason the person cannot see on screen.
    """
    value = (email or '').strip()
    if not value:
        return f'{label} is required.'
    if not _EMAIL_RE.match(value):
        return f'Enter a valid email address, for example name@example.com.'
    if len(value.split('@', 1)[0]) > MAX_LOCAL_PART:
        return f'{label} is not valid: the part before the @ is too long.'
    return None
