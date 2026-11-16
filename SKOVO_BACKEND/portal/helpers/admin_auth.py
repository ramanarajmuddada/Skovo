"""
Admin access check.

There are no admin roles. Every approved admin can do everything; the only
question this module answers is whether the caller is a signed-in admin at all.

The role system this replaces (founder / product_ops / content_moderator /
finance) was never actually enforced: the admin_role claim was never written
into the token, so current_admin_role() always fell through to its `or FOUNDER`
default and every admin passed every check. The Team & Roles screen wrote a
column that nothing read. Removing it changes no behaviour -- it only stops the
console promising a restriction it never applied.

`can(AREA)` and the AREA_ constants are kept because ~38 route handlers call
them, and because they still document which part of the console a route belongs
to. They no longer discriminate between admins.

    from portal.helpers.admin_auth import can, AREA_FINANCE

    if not can(AREA_FINANCE):
        return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)

The real control is elsewhere and unchanged: _install_admin_approval_gate in
portal/api/__init__.py rejects any admin whose state is not 'active', on every
admin endpoint, before the handler runs. Approval is the gate; this is only the
"are you an admin" half.
"""
import logging

from flask_jwt_extended import get_jwt

logger = logging.getLogger("skovo")

# ── Areas ────────────────────────────────────────────────────────────────
# Retained as documentation of what a route touches, not as a permission.
AREA_USERS = 'users'            # student/achiever accounts, KYC, bans
AREA_FINANCE = 'finance'        # payments, payouts, subscriptions, invoices
AREA_MODERATION = 'moderation'  # reports, community moderation, reviews
AREA_SCORE = 'score'            # score rules, manual adjustment
AREA_CONTENT = 'content'        # cohorts, courses, colleges, market, CG data
AREA_OPS = 'ops'                # platform config, invites, audit, error logs


def is_admin():
    """True if the current token is an admin token. Fails closed."""
    try:
        claims = get_jwt()
    except Exception:
        return False
    return claims.get('role') == 'admin'


def can(area=None):
    """
    True if the signed-in admin may act in this area.

    Every approved admin may act in every area, so this is `is_admin()`. The
    parameter is accepted and ignored so the call sites keep reading as a
    statement about what the route touches.
    """
    return is_admin()
