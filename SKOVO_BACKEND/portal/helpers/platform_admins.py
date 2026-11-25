"""
The only two accounts allowed into the staff consoles.

    Admin        -> skovoadmin@gmail.com        (admins table)
    Super admin  -> skovosuperadmin@gmail.com   (super_admins table)

This is an allowlist, deliberately written in code and not read from the
database: a row someone inserts into `admins` or `super_admins` by any route
must still not gain access. It is enforced in three places -- the two login
endpoints, and a hook in portal/api/__init__.py that re-checks every request
carrying an admin or super-admin token. Changing the list is a code change and a
redeploy, on purpose.
"""

ADMIN_EMAILS = frozenset({'skovoadmin@gmail.com'})
SUPER_ADMIN_EMAILS = frozenset({'skovosuperadmin@gmail.com'})


def _norm(email):
    return (email or '').strip().lower()


def is_allowed_admin_email(email):
    return _norm(email) in ADMIN_EMAILS


def is_allowed_super_admin_email(email):
    return _norm(email) in SUPER_ADMIN_EMAILS
