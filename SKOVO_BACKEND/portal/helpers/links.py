"""Is this link safe to store and openable when rendered?

One implementation, because there were about to be three. The unlock-score bug
(brief 1.7) was three copies of the same number that agreed today and would not
have agreed after the next change; a URL check is the same shape, and getting it
wrong in one copy is an XSS hole rather than a wrong badge.

Two different questions, deliberately two functions:

  * `is_openable` -- attachments and evidence, which may be either an external
    link or a root-relative path, because that is what /v1/upload hands back for
    a stored file.
  * `is_external_url` -- meeting links and thumbnails, where a root-relative path
    is meaningless: a Teams or Meet room is never on our own origin.

Both refuse every other scheme, which is the point. `javascript:alert(1)` in a
field that is later rendered as `<a href>` is stored XSS against whoever opens
it (X04-042, X04-155), and `data:text/html,...` is the same trick. Neither can
pass a startswith allowlist, so the allowlist is the check -- do not "improve"
this into a blocklist of bad schemes.
"""

_EXTERNAL_SCHEMES = ('http://', 'https://')


def is_external_url(value):
    """True for an absolute http(s) URL."""
    return str(value or '').strip().lower().startswith(_EXTERNAL_SCHEMES)


def is_openable(value):
    """True for an absolute http(s) URL or a root-relative path.

    A bare filename ('report.pdf') and a local drive path ('C:\\x.pdf') are both
    refused: they render as a dead link, which is worse than no link at all
    because the reader cannot tell a missing file from a broken one.
    """
    v = str(value or '').strip()
    return is_external_url(v) or v.startswith('/')


def check_openable(value, label):
    """Message naming the field, or None. Empty is allowed -- these are optional."""
    if not str(value or '').strip():
        return None
    if not is_openable(value):
        return f'{label} must be a link starting with http:// or https://'
    return None


def check_external(value, label):
    """Message naming the field, or None. Empty is allowed."""
    if not str(value or '').strip():
        return None
    if not is_external_url(value):
        return f'{label} must start with http:// or https://.'
    return None
