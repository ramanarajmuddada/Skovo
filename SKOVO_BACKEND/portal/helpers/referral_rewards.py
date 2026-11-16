"""Pay a Refer & Earn prize only after Admin's gate is met.

Nothing here runs when an invite is sent. Each gate asks again when it
changes: signup, a marked-present cohort, a confirmed Pro payment, an
achiever turning active. A grant row is written first so a retry cannot add
the days or the points twice.

A rule pays only for friends who finished signup after the rule was created,
so adding (or deleting and re-adding) a rule never pays past friends.

Every entry point here commits, and rolls back on failure. Call them only
after the caller's own work is committed.
"""
import logging
import uuid
from datetime import datetime, timedelta

from portal.helpers.sp import call_proc, call_proc_one
from portal.models import db

logger = logging.getLogger('skovo')

TRIGGERS = ('signup', 'cohorts', 'pro_purchase', 'approved')
KINDS = ('none', 'points', 'pro_days', 'coupon', 'pay', 'seats')
STUDENT_KINDS = ('none', 'points', 'pro_days', 'coupon')
ACHIEVER_KINDS = ('none', 'pay', 'seats')
APPLIES = ('all', 'pro', 'cohort', 'session')
AUDIENCES = ('student', 'achiever')

# Referral points land on the Readiness score, which tops out at 100 and sets
# the Explorer / Pioneer / Achiever level. A large per-friend prize would let
# a student climb levels by inviting people instead of doing career work.
MAX_REFERRAL_POINTS = 10


# 13 characters of the id (8 hex, a dash, 4 hex). Links shared when codes were
# 8 characters still resolve; sp_referral_find_referrer refuses a prefix that
# matches two accounts.
CODE_ID_CHARS = 13


def stable_code(user_id):
    return f"SKV-{str(user_id)[:CODE_ID_CHARS].upper()}"


def achiever_code(achiever_id):
    return f"SKA-{str(achiever_id)[:CODE_ID_CHARS].upper()}"


def describe_rule(rule):
    """One sentence a person can read. The numbers come from the row Admin saved."""
    friend = rule.get('friend_audience') or 'student'
    who = 'an achiever you referred' if friend == 'achiever' else 'a friend'
    gate = {
        'signup': f'When {who} finishes signup',
        'cohorts': f"When {who} has attended {int(rule.get('cohort_count') or 0)} cohorts",
        'pro_purchase': f"When {who} pays for {int(rule.get('pro_months') or 0)} months of Pro",
        'approved': f'When {who} is approved and active',
    }.get(rule.get('trigger_kind'), f'When {who} qualifies')
    milestone = rule.get('milestone_count')
    if milestone:
        gate = f"When you reach {int(milestone)} friends who qualify ({gate[0].lower()}{gate[1:]})"
    return f"{gate}, {_prize_phrase(rule)}."


def _side_phrase(kind, points, days, ctype, cvalue, applies):
    if kind == 'points':
        n = int(points or 0)
        return f"{n} point{'s' if n != 1 else ''}"
    if kind == 'pro_days':
        n = int(days or 0)
        return f"{n} days of Skovo Pro"
    if kind == 'coupon':
        where = {'all': 'any payment', 'pro': 'Pro', 'cohort': 'a cohort', 'session': 'a session'}.get(applies, 'a payment')
        if ctype == 'percent':
            return f"a {int(cvalue or 0)}% coupon for {where}"
        return f"a ₹{int(cvalue or 0)} coupon for {where}"
    if kind == 'pay':
        return f"₹{int(float(points or 0))} added to earnings"
    if kind == 'seats':
        n = int(days or 0)
        return f"{n} extra seat{'s' if n != 1 else ''} per cohort"
    return ''


def _amount(rule, prefix):
    kind = rule.get(f'{prefix}_kind')
    if kind == 'pay':
        return rule.get(f'{prefix}_pay_amount')
    if kind == 'seats':
        return rule.get(f'{prefix}_seats')
    if kind == 'points':
        return rule.get(f'{prefix}_points')
    return rule.get(f'{prefix}_pro_days')


def _prize_phrase(rule):
    ref = _side_phrase(rule.get('referrer_kind'), _amount(rule, 'referrer'), _amount(rule, 'referrer'),
                       rule.get('referrer_coupon_type'), rule.get('referrer_coupon_value'), rule.get('referrer_coupon_applies'))
    fri = _side_phrase(rule.get('friend_kind'), _amount(rule, 'friend'), _amount(rule, 'friend'),
                       rule.get('friend_coupon_type'), rule.get('friend_coupon_value'), rule.get('friend_coupon_applies'))
    if ref and fri and ref == fri:
        return f"you both get {ref}"
    parts = []
    if ref:
        parts.append(f"you get {ref}")
    if fri:
        parts.append(f"your friend gets {fri}")
    return ' and '.join(parts) if parts else 'no prize is set'


def _int_or_none(value):
    if value is None or value == '':
        return None
    return int(value)


def validate_rule(data):
    """Return an error string, or None when the row is safe to store."""
    trigger = (data.get('trigger_kind') or '').strip()
    referrer_who = (data.get('referrer_audience') or 'student').strip()
    friend_who = (data.get('friend_audience') or 'student').strip()
    if referrer_who not in AUDIENCES or friend_who not in AUDIENCES:
        return 'Choose who is inviting and who they invite.'
    if referrer_who == 'student' and friend_who != 'student':
        return 'A student referral is for another student.'
    if friend_who == 'achiever' and referrer_who != 'achiever':
        return 'Only an achiever can refer another achiever.'
    if trigger not in TRIGGERS:
        return 'Choose when this prize is given.'
    if friend_who == 'achiever' and trigger != 'approved':
        return 'An achiever prize is given when that achiever is approved and active.'
    if friend_who == 'student' and trigger == 'approved':
        return 'Approval is for an achiever friend.'
    if trigger == 'cohorts' and not (1 <= int(data.get('cohort_count') or 0) <= 100):
        return 'Set how many cohorts the friend must attend, from 1 to 100.'
    if trigger == 'pro_purchase' and not (1 <= int(data.get('pro_months') or 0) <= 36):
        return 'Set how many months of Pro the friend must pay for.'
    milestone = data.get('milestone_count')
    if milestone not in (None, '', 0, '0'):
        if not (1 <= int(milestone) <= 1000):
            return 'The friend count must be from 1 to 1000.'
    sides = 0
    for prefix in ('referrer', 'friend'):
        who = referrer_who if prefix == 'referrer' else friend_who
        allowed = ACHIEVER_KINDS if who == 'achiever' else STUDENT_KINDS
        kind = (data.get(f'{prefix}_kind') or 'none').strip()
        if kind not in allowed:
            return 'A student receives points, Pro days, or a coupon. An achiever receives pay or extra seats.'
        if kind == 'none':
            continue
        sides += 1
        if kind == 'points' and not (1 <= int(data.get(f'{prefix}_points') or 0) <= MAX_REFERRAL_POINTS):
            return f'Points must be from 1 to {MAX_REFERRAL_POINTS}.'
        if kind == 'pro_days' and not (1 <= int(data.get(f'{prefix}_pro_days') or 0) <= 3650):
            return 'Pro days must be from 1 to 3650.'
        if kind == 'pay' and not (1 <= int(float(data.get(f'{prefix}_pay_amount') or 0)) <= 100000):
            return 'Pay must be from ₹1 to ₹100000.'
        if kind == 'seats' and not (1 <= int(data.get(f'{prefix}_seats') or 0) <= 1000):
            return 'Extra seats must be from 1 to 1000.'
        if kind == 'coupon':
            ctype = (data.get(f'{prefix}_coupon_type') or '').strip()
            applies = (data.get(f'{prefix}_coupon_applies') or '').strip()
            value = data.get(f'{prefix}_coupon_value')
            if ctype not in ('percent', 'flat') or applies not in APPLIES:
                return 'Set the coupon as a percent or a rupee amount, and where it can be used.'
            if ctype == 'percent' and not (1 <= int(float(value or 0)) <= 100):
                return 'A percent coupon must be from 1 to 100.'
            if ctype == 'flat' and not (float(value or 0) > 0):
                return 'Enter the coupon amount.'
    if sides == 0:
        return 'Give a prize to the referrer, the friend, or both.'
    return None


def save_rule(data, admin_id, rule_id=None):
    milestone = _int_or_none(data.get('milestone_count'))
    if milestone == 0:
        milestone = None
    return call_proc_one(
        'sp_referral_rule_upsert',
        rule_id or str(uuid.uuid4()),
        data.get('trigger_kind'),
        data.get('referrer_audience') or 'student',
        data.get('friend_audience') or 'student',
        _int_or_none(data.get('cohort_count')) if data.get('trigger_kind') == 'cohorts' else None,
        _int_or_none(data.get('pro_months')) if data.get('trigger_kind') == 'pro_purchase' else None,
        milestone,
        data.get('referrer_kind') or 'none',
        _int_or_none(data.get('referrer_points')),
        _int_or_none(data.get('referrer_pro_days')),
        data.get('referrer_coupon_type') or None,
        data.get('referrer_coupon_value') or None,
        data.get('referrer_coupon_applies') or None,
        data.get('referrer_pay_amount') or None,
        _int_or_none(data.get('referrer_seats')),
        data.get('friend_kind') or 'none',
        _int_or_none(data.get('friend_points')),
        _int_or_none(data.get('friend_pro_days')),
        data.get('friend_coupon_type') or None,
        data.get('friend_coupon_value') or None,
        data.get('friend_coupon_applies') or None,
        data.get('friend_pay_amount') or None,
        _int_or_none(data.get('friend_seats')),
        1 if data.get('is_active', True) else 0,
        admin_id,
    )


def bind_signup(friend_user_id, email, code):
    """Attach a finished signup to the link they used. Returns the result word."""
    code = (code or '').strip()
    if not code or not friend_user_id or not email:
        return 'skipped'
    found = call_proc_one('sp_referral_find_referrer', code) or {}
    referrer = found.get('referrer_id')
    if not referrer:
        return 'unknown'
    res = call_proc_one(
        'sp_referral_bind', str(uuid.uuid4()), referrer, email, friend_user_id, code.upper(),
        found.get('referrer_audience') or 'student', 'student',
    ) or {}
    result = res.get('result') or 'skipped'
    if result == 'bound':
        db.session.commit()
        evaluate_friend(friend_user_id)
    return result


def bind_achiever(friend_achiever_id, email, code):
    """Attach a finished achiever registration to the link they used."""
    code = (code or '').strip()
    if not code or not friend_achiever_id or not email:
        return 'skipped'
    found = call_proc_one('sp_referral_find_referrer', code) or {}
    referrer = found.get('referrer_id')
    if not referrer or (found.get('referrer_audience') or 'student') != 'achiever':
        return 'unknown'
    res = call_proc_one(
        'sp_referral_bind', str(uuid.uuid4()), referrer, email, friend_achiever_id, code.upper(),
        'achiever', 'achiever',
    ) or {}
    result = res.get('result') or 'skipped'
    if result == 'bound':
        db.session.commit()
        evaluate_friend(friend_achiever_id)
    return result


def on_achiever_active(achiever_id):
    """The friend is active. Pay any achiever-referral row that was waiting."""
    evaluate_friend(achiever_id)


def evaluate_friend(friend_user_id):
    """Pay every active rule this friend has just qualified for. Never raises."""
    if not friend_user_id:
        return
    try:
        row = call_proc_one('sp_referral_referrer_of', friend_user_id) or {}
        referrer_id = row.get('referrer_id')
        if not referrer_id:
            return
        ref_who = row.get('referrer_audience') or 'student'
        fri_who = row.get('friend_audience') or 'student'
        rules = call_proc('sp_referral_rules_list') or []
        for rule in rules:
            if not rule.get('is_active'):
                continue
            if (rule.get('referrer_audience') or 'student') != ref_who:
                continue
            if (rule.get('friend_audience') or 'student') != fri_who:
                continue
            _pay_rule(rule, referrer_id, friend_user_id)
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        logger.error(f"referral evaluate failed for {friend_user_id}: {e}")


def on_pro_paid(user_id):
    """A Pro plan was just turned on. Pay any Pro-purchase rule it meets."""
    evaluate_friend(user_id)


def _planned(rule, prefix):
    return _side_phrase(
        rule.get(f'{prefix}_kind'), _amount(rule, prefix), _amount(rule, prefix),
        rule.get(f'{prefix}_coupon_type'), rule.get(f'{prefix}_coupon_value'), rule.get(f'{prefix}_coupon_applies'),
    ) or None


def _pay_rule(rule, referrer_id, friend_user_id):
    trigger = rule.get('trigger_kind')
    friends = call_proc(
        'sp_referral_qualifying', referrer_id, trigger,
        rule.get('cohort_count'), rule.get('pro_months'),
        rule.get('friend_audience') or 'student',
        rule.get('created_at'),
    ) or []
    ordered = [r.get('friend_id') for r in friends if r.get('friend_id')]
    if friend_user_id not in ordered:
        return
    milestone = int(rule.get('milestone_count') or 0)
    if milestone:
        # Paid once per referrer, to whichever friend completes the count.
        # The key does not name the friend, so a list that reorders later
        # cannot make a second "Nth friend".
        if len(ordered) < milestone:
            return
        once_key = 'milestone'
    else:
        once_key = friend_user_id

    ref_summary = _planned(rule, 'referrer')
    fri_summary = _planned(rule, 'friend')
    # The grant row lands first. A retry sees it and does not add days again.
    grant_id = str(uuid.uuid4())
    created = call_proc_one(
        'sp_referral_grant_put', grant_id, rule['id'], referrer_id,
        friend_user_id, once_key, milestone, ref_summary, fri_summary,
    ) or {}
    if not created.get('created'):
        return
    ref_given = _grant_side(rule, 'referrer', referrer_id, f"{rule['id']}:{once_key}:{milestone}:referrer")
    fri_given = _grant_side(rule, 'friend', friend_user_id, f"{rule['id']}:{once_key}:{milestone}:friend")
    if (ref_given, fri_given) != (ref_summary, fri_summary):
        call_proc_one('sp_referral_grant_summary', grant_id, ref_given, fri_given)
    db.session.commit()


def _grant_side(rule, prefix, user_id, ref_id):
    """Give one side its prize. Returns the line the person sees, which is
    the planned phrase unless what was given differs (a coupon code, or seats
    with no cap to raise)."""
    kind = rule.get(f'{prefix}_kind') or 'none'
    planned = _planned(rule, prefix)
    if kind == 'points':
        points = int(rule.get(f'{prefix}_points') or 0)
        call_proc_one('sp_referral_score_add', user_id, points, ref_id, 'Referral reward')
        call_proc_one('sp_score_recalc', user_id)
    elif kind == 'pro_days':
        days = int(rule.get(f'{prefix}_pro_days') or 0)
        call_proc_one('sp_referral_pro_extend', user_id, days)
    elif kind == 'coupon':
        code, until = _issue_coupon(rule, prefix, user_id)
        return f"{planned}: code {code}, valid until {until:%d %b %Y}"
    elif kind == 'pay':
        amount = int(float(rule.get(f'{prefix}_pay_amount') or 0))
        call_proc_one('sp_referral_pay_add', user_id, amount, f'referral:{ref_id}')
    elif kind == 'seats':
        seats = int(rule.get(f'{prefix}_seats') or 0)
        res = call_proc_one('sp_referral_seats_add', user_id, seats) or {}
        if not int(res.get('applied') or 0):
            # NULL allocation = no cap. Nothing was added; do not claim it was.
            return f"{planned} (not needed: your cohorts have no seat limit)"
    return planned


COUPON_DAYS = 365


def _issue_coupon(rule, prefix, user_id):
    """One-use coupon only this user can redeem. Returns (code, valid_until)."""
    ctype = rule.get(f'{prefix}_coupon_type') or 'percent'
    value = rule.get(f'{prefix}_coupon_value') or 0
    applies = rule.get(f'{prefix}_coupon_applies') or 'all'
    code = f"REF{uuid.uuid4().hex[:10].upper()}"
    row = call_proc_one(
        'sp_referral_coupon_create',
        str(uuid.uuid4()), code, ctype, value, applies, user_id, COUPON_DAYS,
    ) or {}
    until = row.get('valid_until') or (datetime.utcnow() + timedelta(days=COUPON_DAYS))
    return row.get('code') or code, until
