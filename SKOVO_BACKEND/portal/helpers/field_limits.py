"""Length caps for free-text fields, checked before MySQL sees them.

Sheet X-04 asks the same question of 31 fields: what happens at "max length + 1"?
The answer must be *a 400 naming the field*, never a 500 with an opaque error id.

Two different failure modes hide behind that:

  * A **VARCHAR** column raises MySQL errno 1406 ("Data too long") the moment it
    is exceeded. `achievers.email` is VARCHAR(255) and nothing checked it, so a
    256-character address was a 500 on the registration form. `payout_upi` (100),
    `payout_account_name` (150), `payout_account_number` (50) and `payout_ifsc`
    (20) are the same shape on the payout screen.

  * A **TEXT** column does not complain until 65535 bytes, so `full_name`,
    `designation`, `company` and `bio` never 500 in practice -- but a name with
    no ceiling is a rendering problem on every screen that shows it, and X-04
    wants a *stated* limit to test the boundary against. These caps are chosen,
    not derived from the column.

Caps that mirror a real column are marked; changing one of those without the
migration reintroduces the 500.
"""

# Mirrors a column -- do not raise without a migration.
EMAIL = 255              # achievers.email VARCHAR(255)
UPI = 100                # achievers.payout_upi VARCHAR(100)
ACCOUNT_NAME = 150       # achievers.payout_account_name VARCHAR(150)
ACCOUNT_NUMBER = 50      # achievers.payout_account_number VARCHAR(50)
IFSC = 20                # achievers.payout_ifsc VARCHAR(20)

# Chosen caps on TEXT columns.
FULL_NAME = 120
DESIGNATION = 150
COMPANY = 150
BIO = 5000
URL = 1000
PASSWORD = 128           # bcrypt truncates past 72 bytes anyway; this is the
                         # stated max so a long password is refused, not silently

# ── Achiever courses ──────────────────────────────────────────────────────────
# `achiever_courses.py` imported nothing from this module, so none of these had
# a stated ceiling. Two of them mirror a column and will 1406 without a
# migration; the other two are TEXT and are capped for rendering, not safety.
COURSE_LEVEL = 30        # achiever_courses.level VARCHAR(30)
COURSE_CATEGORY = 100    # achiever_courses.category VARCHAR(100)
COURSE_TITLE = 255       # chosen: the column is TEXT, but a title is a heading
COURSE_DESCRIPTION = 5000  # chosen, same reasoning as BIO

                         # half-honoured.


def too_long(value, cap):
    return isinstance(value, str) and len(value.strip()) > cap


def check(value, label, cap):
    """Return a message naming the field, or None."""
    if too_long(value, cap):
        return f'{label} must be {cap} characters or fewer.'
    return None


def check_all(pairs):
    """First failure among [(value, label, cap), ...], or None.

    Ordered, so the message a caller gets is stable rather than depending on
    dict iteration -- a test asserting on the message should not flap.
    """
    for value, label, cap in pairs:
        err = check(value, label, cap)
        if err:
            return err
    return None
