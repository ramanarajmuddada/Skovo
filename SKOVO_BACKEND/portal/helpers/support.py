"""Shared constants and serializers for Help & support."""
import os
import re

from flask_jwt_extended import get_jwt
from portal.helpers.helpers import serialize_datetime

# Fallbacks. The live lists are master_support_audience / master_support_portal
# -- see audience_options() / portal_options() below.
#
# Moving these to masters makes their LABELS and ORDER editable and lets one be
# switched off without a deploy. It does NOT make a NEW value work: `public` has
# its own unauthenticated route and `portal` is derived from the JWT role, so a
# fourth row here would be a dropdown entry with no code behind it.
AUDIENCES = ('student', 'achiever', 'public')
CHANNELS = ('email', 'phone')
STATUSES = ('open', 'in_progress', 'solved')
# Fallback only. The live list is master_support_category -- see
# category_options() below. Kept so a database that has not had
# migrate_support_category_master.py applied still validates rather than
# refusing every category.
CATEGORIES = ('payments', 'account', 'documents', 'payouts', 'refund', 'wallet', 'points_dispute',
              'streak_restore', 'other')
SOURCES = ('web', 'mobile', 'bhaai')
REFERENCE_TYPES = ('payment_orders', 'bookings', 'payout_requests', 'refunds', 'wallet_ledger',
                   'score_events', 'career_streaks', 'other')
PORTALS = ('student', 'achiever')

# Money issues need proof (screenshot / PDF), and pick the exact item from a list.
PROOF_REQUIRED = ('payments', 'payouts', 'refund', 'wallet')
MAX_PROOF = 3
PICKER = {'payments': 'payment_orders', 'payouts': 'payout_requests', 'refund': 'payment_orders'}


def _inr(v):
    from decimal import Decimal
    v = Decimal(str(v or 0))
    return f"₹{v:,.2f}".replace('.00', '') if v == v.to_integral() else f"₹{v:,.2f}"


def reference_options(portal, user_id, category):
    """The person's own payments or payouts, newest first, as {id, label}."""
    from sqlalchemy import text
    from portal.models import db
    kind = PICKER.get(category)
    if not kind:
        return kind, []
    ist = "DATE_FORMAT(DATE_ADD(o.created_at, INTERVAL 330 MINUTE), '%d %b %Y')"
    if kind == 'payout_requests':
        if portal != 'achiever':
            return kind, []
        rows = db.session.execute(text(
            f"SELECT o.id, {ist}, o.amount, o.status FROM payout_requests o"
            " WHERE o.achiever_id = :u ORDER BY o.created_at DESC LIMIT 50"), {'u': user_id}).fetchall()
        return kind, [{'id': r[0], 'label': f"{r[1]} · {_inr(r[2])} · {str(r[3] or '').capitalize()}"} for r in rows]
    who = 'o.achiever_id' if portal == 'achiever' else 'o.student_id'
    rows = db.session.execute(text(
        f"SELECT o.id, {ist}, o.gross, o.status, COALESCE(c.title, s.title, o.kind) FROM payment_orders o"
        "  LEFT JOIN cohorts c ON c.id = o.ref_id"
        "  LEFT JOIN achiever_slots s ON s.id = o.slot_id"
        f" WHERE {who} = :u ORDER BY o.created_at DESC LIMIT 50"), {'u': user_id}).fetchall()
    return kind, [{'id': r[0], 'label': f"{r[1]} · {_inr(r[2])} · {r[4] or 'Payment'} · {str(r[3] or '').capitalize()}"}
                  for r in rows]


def issue_extras(ids):
    """{issue_id: (attachments list, txn_ref)} for issues listed by procedures."""
    import json
    from sqlalchemy import text, bindparam
    from portal.models import db
    ids = [i for i in ids if i]
    if not ids:
        return {}
    rows = db.session.execute(text(
        "SELECT id, attachments, txn_ref, reopen_count, reopened_at, confirmed_at, status, resolved_at"
        " FROM support_issues WHERE id IN :ids"
    ).bindparams(bindparam('ids', expanding=True)), {'ids': ids}).fetchall()
    out = {}
    for r in rows:
        try:
            att = json.loads(r[1]) if r[1] else []
        except ValueError:
            att = []
        out[r[0]] = (att, r[2], {'reopen_count': int(r[3] or 0), 'reopened_at': r[4], 'confirmed_at': r[5],
                                  'status': r[6], 'resolved_at': r[7]})
    return out


def with_extras(issues):
    """Add attachments / txn_ref to serialized issues."""
    from sqlalchemy import text
    from portal.models import db
    ex = issue_extras([i.get('id') for i in issues if i])
    try:
        from portal.helpers.support_chat import message_counts
        chat = message_counts([i.get('id') for i in issues if i])
    except Exception:
        db.session.rollback()
        chat = {}   # table not there yet
    ist = "DATE_FORMAT(DATE_ADD(created_at, INTERVAL 330 MINUTE), '%d %b %Y')"
    for i in issues:
        if not i:
            continue
        att, ref, st = ex.get(i['id'], ([], None, {}))
        i['attachments'], i['txn_ref'] = att, ref
        # Reopen flow: Closed = Solved 7+ days ago; only the person reopens (max 3).
        from portal.helpers.support_chat import is_closed, MAX_REOPENS
        closed = is_closed({'status': st.get('status'), 'resolved_at': st.get('resolved_at')}) if st else False
        i['closed'] = closed
        i['reopen_count'] = st.get('reopen_count', 0)
        i['reopened'] = bool(st.get('reopened_at')) and i.get('status') != 'solved'
        i['confirmed'] = bool(st.get('confirmed_at'))
        i['can_reopen'] = i.get('status') == 'solved' and not closed and i['reopen_count'] < MAX_REOPENS
        n, last = chat.get(i['id'], (0, None))
        i['messages'], i['last_from'] = n, last
        # A readable reference instead of a bare id.
        i['reference_label'] = None
        rid = i.get('reference_id')
        if rid and i.get('reference_type') == 'payout_requests':
            r = db.session.execute(text(f"SELECT {ist}, amount, status, utr FROM payout_requests WHERE id = :i"), {'i': rid}).first()
            if r:
                i['reference_label'] = f"Payout · {r[0]} · {_inr(r[1])} · {str(r[2] or '').capitalize()}" + (f" · UTR {r[3]}" if r[3] else '')
        elif rid and i.get('reference_type') == 'payment_orders':
            r = db.session.execute(text(f"SELECT {ist}, gross, status, order_no FROM payment_orders WHERE id = :i"), {'i': rid}).first()
            if r:
                i['reference_label'] = f"Payment · {r[0]} · {_inr(r[1])} · {str(r[2] or '').capitalize()} · {r[3]}"
    return issues

_EMAIL_RE = re.compile(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')
_PHONE_RE = re.compile(r'^\+?[0-9]{7,15}$')


def support_inbox():
    return (os.environ.get('SUPPORT_EMAIL') or 'support@skovoai.com').strip()


def portal_from_jwt():
    role = (get_jwt().get('role') or '').lower()
    if role == 'mentor':
        return 'achiever'
    if role == 'student':
        return 'student'
    return None


def is_email(v):
    return bool(_EMAIL_RE.match((v or '').strip()))


def is_phone(v):
    digits = re.sub(r'[^\d+]', '', (v or '').strip())
    return bool(_PHONE_RE.match(digits))


def phone_digits(v):
    return re.sub(r'[^\d+]', '', (v or '').strip())


def safe_search(q):
    """Strip FULLTEXT boolean operators so a dash is not read as NOT."""
    s = (q or '').strip()[:80]
    return ''.join(ch for ch in s if ch.isalnum() or ch.isspace() or ch in '_.')


def serialize_contact(row):
    if not row:
        return None
    return {
        'id': row.get('id'),
        'audience': row.get('audience'),
        'channel': row.get('channel'),
        'value': row.get('value'),
        'label': row.get('label'),
        'hours': row.get('hours') or '',
        'sort_order': int(row.get('sort_order') or 0),
        'is_active': bool(row.get('is_active')),
        'created_at': serialize_datetime(row.get('created_at')),
        'updated_at': serialize_datetime(row.get('updated_at')),
    }


def serialize_issue(row):
    if not row:
        return None
    return {
        'id': row.get('id'),
        'user_id': row.get('user_id'),
        'contact_email': row.get('contact_email'),
        'portal': row.get('portal'),
        'subject': row.get('subject'),
        'body': row.get('body'),
        'category': row.get('category') or 'other',
        'status': row.get('status') or 'open',
        'reference_type': row.get('reference_type'),
        'reference_id': row.get('reference_id'),
        'source': row.get('source') or 'web',
        'first_response_at': serialize_datetime(row.get('first_response_at')),
        'resolved_at': serialize_datetime(row.get('resolved_at')),
        'resolved_by': row.get('resolved_by'),
        'created_at': serialize_datetime(row.get('created_at')),
        'updated_at': serialize_datetime(row.get('updated_at')),
        'total': row.get('total'),
    }


def category_options():
    """Support issue categories, from master_support_category.

    Category is the one support vocabulary nothing branches on -- it is pure
    classification -- so a new row here works immediately, with no code change.
    """
    return _master_options('support_category', CATEGORIES)


def category_values():
    """Just the values, for validating what a client sent."""
    return tuple(o['value'] for o in category_options())


def _master_options(mtype, fallback):
    """One support vocabulary, from its master, falling back to the tuple.

    Shared by audience, portal and category: a masters lookup that fails must
    leave the list stale, never empty -- an empty list would make every value
    invalid and block people from raising an issue at all.
    """
    try:
        from portal.helpers.sp import call_proc
        rows = call_proc('sp_master_list', mtype, 1) or []
        opts = [{'value': r.get('value'), 'label': r.get('label')}
                for r in rows if r.get('value')]
        if opts:
            return opts
    except Exception:
        pass
    return [{'value': v, 'label': v.replace('_', ' ').title()} for v in fallback]


def audience_options():
    return _master_options('support_audience', AUDIENCES)


def audience_values():
    return tuple(o['value'] for o in audience_options())


def portal_options():
    return _master_options('support_portal', PORTALS)


def portal_values():
    return tuple(o['value'] for o in portal_options())


def channel_options():
    """Contact channels, from master_support_channel.

    Editable and reorderable, but see the migration's note: each value has a
    rendering case behind it (mailto / tel) and a third row would save fine and
    then render no button at all.
    """
    return _master_options('support_channel', CHANNELS)


def channel_values():
    return tuple(o['value'] for o in channel_options())
