"""
Who is allowed to reuse an email address, and who is not.

SKOVO keeps identities in four tables — users (students), achievers, admins and
super_admins — each with its own UNIQUE(email). That prevents a duplicate inside
one table but not across them, so before this the same address could hold both a
student account and an achiever account.

The rule, per the founder:

    student  <-> achiever      NOT allowed — two different people
    admin    <-> super-admin   allowed — the same operator holds both
    student/achiever <-> admin/super-admin
                               allowed — an operator may also be a student

A student's readiness score, bookings and Pro plan are not an achiever's
earnings and payouts. Sharing one login between them makes "which account am I
signed in as?" ambiguous, and on mobile there is only one session to answer with.
"""
from portal.helpers.sp import call_proc_one

# Which other roles a given portal refuses to share an address with.
_CONFLICTS = {
    'student':  (('in_achievers', 'achiever'),),
    'achiever': (('in_users', 'student'),),
    # Admin and super-admin intentionally conflict with nothing.
    'admin': (),
    'super_admin': (),
}

def email_conflict(email, registering_as):
    """The role that already owns `email` and blocks this signup, or None.

    `registering_as` is one of 'student', 'achiever', 'admin', 'super_admin'.
    Only cross-role conflicts are reported — a duplicate *within* the same table
    is left to that table's UNIQUE key, which already returns the right 409.
    """
    conflicts = _CONFLICTS.get(registering_as)
    if not conflicts:
        return None

    # ── SP: sp_identity_email_lookup — one row of flags across all four tables ──
    row = call_proc_one('sp_identity_email_lookup', (email or '').strip().lower()) or {}
    for column, role in conflicts:
        if row.get(column):
            return role
    return None


# Which table each portal's accounts live in, for the existence check below.
_ROLE_COLUMN = {
    'student': 'in_users',
    'achiever': 'in_achievers',
    'admin': 'in_admins',
    'super_admin': 'in_super_admins',
}


def email_exists(email, role=None):
    """True if `email` already has an account.

    The mirror image of email_conflict(), and needed because password reset
    asks the opposite question to signup: signup wants the address free, reset
    wants it taken. Reusing email_conflict() for reset inverted the whole flow
    -- real accounts were refused with a signup error and unregistered
    addresses were let through to the code screen.

    With `role`, only that portal's table is consulted, so an achiever reset
    does not fire for an address that is only a student. Without it, any of the
    four tables counts.
    """
    row = call_proc_one('sp_identity_email_lookup', (email or '').strip().lower()) or {}
    if role:
        column = _ROLE_COLUMN.get(role)
        return bool(column and row.get(column))
    return any(row.get(c) for c in _ROLE_COLUMN.values())


def conflict_message(role):
    """Refuse without saying which portal owns the address.

    This used to name the other portal ("already registered as an achiever
    account") because that tells the person what to do. It is an account
    enumeration channel: anyone with a signup form could sort an address list
    into student / achiever / not-registered, unauthenticated and unthrottled.
    ST01-003/004/005 make it explicit — the refusal must not leak the owner.

    `role` is kept in the signature (and used by callers for logging) so the
    server still records which portal blocked the signup; only the text the
    caller receives is generic.
    """
    return ('This email is already registered on SKOVO. Each account needs its '
            'own email address — please use a different one, or sign in with '
            'the account you already have.')
