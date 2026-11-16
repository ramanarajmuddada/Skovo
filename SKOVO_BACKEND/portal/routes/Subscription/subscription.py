"""
Skovo Pro subscription — the student membership.

Plan prices AND promotional offers are admin-managed in the DB (subscription_plans
table + Admin → Subscriptions screen) — nothing is hardcoded. Coupon codes reuse
the platform coupon system (sp_student_coupon_validate, context 'pro').

Paid flow mirrors the cohort flow: subscribe → Cashfree order → the SDK collects
payment → verify (signature) → activate. Duration is derived server-side from the
stored plan, so the client cannot grant itself extra months.
"""
from portal.helpers.error_capture import capture_error
from portal.helpers.helpers import serialize_datetime
import os
import uuid
import hmac
import hashlib
from datetime import datetime
from sqlalchemy import text
from flask import jsonify, request
from flask_restx import Resource
from flask_jwt_extended import jwt_required, get_jwt_identity
from portal.models import db
from portal.helpers.sp import call_proc, call_proc_one
from . import ns, logger

from portal.helpers.pro_limits import get_pro_limits, free_limit

DEFAULT_PLAN = 'annual'
COUPON_CONTEXT = 'pro'   # coupons with applies_to in ('all','pro') apply to Pro

# ── What Pro actually buys ────────────────────────────────────────────────────
# Every entry here is a gate that exists in the code — `enforced_in` names the
# file that enforces it. The list is deliberately not marketing copy: the Skovo
# Pro screen reads it back with live state (see /entitlements below), so a perk
# with no gate behind it would render as an active benefit the product never
# delivers. If you add a line here, add the gate in the same change.
PRO_PERK_DETAILS = [
    {
        'key': 'cohorts',
        'title': 'Unlimited cohorts',
        'detail': 'Every paid cohort is covered by your membership — enrol in one tap, '
                  'no checkout, no limit on how many.',
        'route': '/cohorts',
        'enforced_in': 'Cohorts/cohorts.py (sp_student_cohort_enroll_pro)',
    },
    {
        'key': 'colleges',
        'title': 'Detailed Colleges with scholarships',
        'detail': 'Full college profiles with the scholarships you are eligible for, '
                  'and an unlimited comparison list.',
        'route': '/colleges',
        'enforced_in': 'Colleges/colleges.py (scholarship block + FREE_SAVED_COLLEGES)',
    },
    {
        'key': 'community',
        'title': 'Unlimited community Leads & Creations',
        'detail': 'Lead, join and create as many communities as you like — plus direct '
                  'messages and pinned posts.',
        'route': '/assemble',
        'enforced_in': 'Assemble/assemble.py (_membership_quota, _dm_guard)',
    },
    {
        'key': 'opportunities',
        'title': 'Personalised Fresh Job Opportunities',
        'detail': 'A For You feed ranked against your branch, interests and city, newest '
                  'roles first — and one-tap apply from your Vault.',
        'route': '/opportunities',
        'enforced_in': 'Opportunities/opportunities.py (for_you), Applications/applications.py',
    },
    {
        'key': 'bhaai',
        'title': 'Early BhaAI (Career Agent) Access',
        'detail': 'Ask BhaAI about your path and get answers built from your own Skovo '
                  'data — your score, vault, cohorts and saved colleges.',
        'route': '/bhaai',
        'enforced_in': 'BhaAI/bhaai.py (is_pro + daily allowance) + pages/BhaAI.jsx',
    },
    {
        'key': 'career_tools',
        'title': 'Priority Career Tools access',
        # {credits} is filled in by pro_perk_details() below.
        'detail': 'Unlimited Document Vault, a shareable public profile, priority support '
                  'and {credits} free 1-on-1 session{s} with every membership.',
        'route': '/document-vault',
        'enforced_in': 'DocumentVault/document_vault.py (FREE_DOC_LIMIT, public profile)',
    },
]

# Flat titles — the landing page and older clients read this shape. Derived, so
# the two can never drift apart.
PRO_PERKS = [p['title'] for p in PRO_PERK_DETAILS]


def pro_perk_details():
    """The perk list with the live credit count written into it.

    PRO_PERK_DETAILS is a module-level constant, so anything interpolated into
    it would have frozen at import. This resolves the one templated field per
    request, against the same admin-editable cap the rest of the page reads.
    Falls back to the unformatted sentence rather than 500-ing a paid page.
    """
    try:
        credits = free_limit('session_credits')
    except Exception:
        return [dict(p, detail=p['detail'].replace(' {credits}', '').replace('{s}', 's'))
                for p in PRO_PERK_DETAILS]
    if credits is None:
        word, plural = 'unlimited', 's'
    else:
        word, plural = str(int(credits)), ('' if int(credits) == 1 else 's')
    return [dict(p, detail=p['detail'].format(credits=word, s=plural))
            if '{credits}' in p['detail'] else dict(p)
            for p in PRO_PERK_DETAILS]


def is_pro(user_id: str) -> bool:
    """True if the user has a live Skovo Pro membership. Fails closed on error."""
    try:
        row = call_proc_one('sp_subscription_is_active', user_id)
        return bool(row and row.get('is_active'))
    except Exception:
        return False


# Free Pro days won through Refer & Earn (sp_referral_pro_extend). Pro all the
# same, but the student may still buy a plan; the days left carry over.
REFERRAL_PLAN = 'referral'


def _is_referral_only(sub) -> bool:
    return bool(sub and sub.get('is_active') and sub.get('plan') == REFERRAL_PLAN)


def activate_paid_subscription(order_id):
    """Turn on the Pro plan a confirmed order paid for, then give any referral
    prize a Pro purchase earns. Call after the order is marked paid and
    committed. Safe to call twice (webhook and reconcile). Never raises."""
    try:
        row = call_proc_one('sp_subscription_activate_for_order', order_id) or {}
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        logger.error(f"Skovo Pro activation failed for order {order_id}: {e}")
        capture_error(e)
        return None
    result = row.get('result')
    if result == 'activated' and row.get('user_id'):
        logger.info(f"Skovo Pro activated for order {order_id}")
        from portal.helpers.referral_rewards import on_pro_paid
        on_pro_paid(row.get('user_id'))
    return result


def _serialize(sub):
    if not sub:
        return None
    ea = sub.get('expires_at')
    sa = sub.get('started_at')
    return {
        'plan': sub.get('plan'),
        'status': sub.get('status'),
        'is_active': bool(sub.get('is_active')),
        'started_at': serialize_datetime(sa) if sa else None,
        'expires_at': serialize_datetime(ea) if ea else None,
        'amount': float(sub.get('amount') or 0),
    }


# ── Plans (admin-managed, DB-driven) ──────────────────────────────────────────
def _load_plans(active_only=True):
    # ── SP: sp_subscription_plans_list ────────────────────────────────────────
    return call_proc('sp_subscription_plans_list', 1 if active_only else 0) or []


def _get_plan(key):
    for p in _load_plans(active_only=False):
        if p.get('plan_key') == key:
            return p
    return None


def _effective_price(plan):
    """Return (effective_price:int, offer_label:str|None), honoring the offer window."""
    base = int(plan['price'])
    now = datetime.utcnow()
    starts, ends = plan.get('offer_starts_at'), plan.get('offer_ends_at')
    if (starts and now < starts) or (ends and now > ends):
        return base, None
    op, opct = plan.get('offer_price'), plan.get('offer_percent')
    if op not in (None, ''):
        return int(op), (plan.get('offer_label') or 'Limited-time offer')
    if opct not in (None, '', 0):
        return int(round(base * (100 - int(opct)) / 100)), (plan.get('offer_label') or f'{int(opct)}% off')
    return base, None


def _plan_public(plan):
    eff, offer_label = _effective_price(plan)
    months = int(plan['months']) or 1
    return {
        'key': plan['plan_key'],
        'label': plan['label'],
        'price': int(plan['price']),
        'effective_price': eff,
        'months': months,
        'effective_monthly': round(eff / months),
        'offer_label': offer_label,
    }


@ns.route('/')
class SubscriptionStatus(Resource):
    @jwt_required()
    def get(self):
        """Current membership status + admin-managed plans + this month's credits."""
        try:
            user_id = get_jwt_identity()
            sub = call_proc_one('sp_subscription_get', user_id)
            active = bool(sub and sub.get('is_active'))
            credits = None
            if active:
                allowance = free_limit('session_credits')
                c = call_proc_one('sp_pro_session_credits', user_id, allowance)
                # `remaining` is None when the allowance is unlimited, which is
                # not the same as none left -- clients must not render it as 0.
                credits = {'allowance': c.get('allowance'), 'used': c.get('used'),
                           'remaining': c.get('remaining'),
                           'unlimited': c.get('allowance') is None} if c else None
            plans = [_plan_public(p) for p in _load_plans(active_only=True)]
            annual = next((p for p in plans if p['key'] == 'annual'), (plans[-1] if plans else None))
            limits = get_pro_limits()
            return jsonify(response={
                'is_pro': active,
                # A referral-only Pro can still buy a plan (days carry over).
                'can_buy': (not active) or _is_referral_only(sub),
                'referral_pro': _is_referral_only(sub),
                'subscription': _serialize(sub),
                'plans': plans,
                'price': annual['effective_price'] if annual else 1499,   # backward-compat
                'months': annual['months'] if annual else 12,
                'perks': PRO_PERKS,
                'perk_details': pro_perk_details(),
                'session_credits': credits,
                'limits': limits,
            }, status=200, bool=True)
        except Exception as e:
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/plans')
class PublicPlans(Resource):
    def get(self):
        """Public pricing — powers the landing page's pricing section.

        No auth: plan prices and live offers are public marketing copy, and the
        landing page is served to logged-out visitors. Nothing user-specific is
        returned here — membership status still lives behind the JWT on `GET /`.
        """
        try:
            plans = [_plan_public(p) for p in _load_plans(active_only=True)]
            return jsonify(response={'plans': plans, 'perks': PRO_PERKS,
                                     'perk_details': pro_perk_details(),
                                     'limits': get_pro_limits()}, status=200, bool=True)
        except Exception as e:
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


# ── Live perk state ───────────────────────────────────────────────────────────
# The Skovo Pro screen used to print six static strings. That is fine as an
# advert and useless as a screen a member returns to: a paying member cannot
# tell from it whether anything actually changed. This endpoint answers, per
# perk, "is it on for me right now, and how much of the free allowance is left"
# — so the same list serves both audiences without being written twice.
#
# Each block reads the free-tier constant from the module that enforces it
# rather than restating the number here; a cap that is changed in one place and
# copied in another is a cap that will be shown wrong. Imports are local
# because those route modules import this one for is_pro().

def _perk_state(user_id, pro):
    """Per-perk status. `usage` is only present where a free allowance exists."""
    from portal.helpers.pro_limits import cohort_free_perk_status, get_pro_limits

    limits = get_pro_limits()
    states = {}

    # 1. Cohorts — Pro covers every priced seat; free members get N, set by admin.
    try:
        fp = cohort_free_perk_status(user_id)
        used, allowance, free_left = fp['used'], fp['allowance'], fp['available']
    except Exception:
        used, allowance, free_left = 0, limits['free_paid_cohorts'], None
    n = allowance
    states['cohorts'] = {
        'active': pro,
        'usage': {'used': used, 'limit': None if pro else n},
        'free_label': (
            'Every paid cohort free' if n is None else
            f'{n} free paid cohort{"s" if n != 1 else ""}' if free_left is None else
            (f'{used}/{n} free paid cohorts used' if n else 'No free paid cohorts — take Pro')
        ),
        'pro_label': 'Every paid cohort included',
    }

    # 2. Colleges
    saved = int((call_proc_one('sp_saved_colleges_count', user_id) or {}).get('total', 0) or 0)
    cap_col = limits['saved_colleges']
    states['colleges'] = {
        'active': pro,
        'usage': {'used': saved, 'limit': None if pro else cap_col},
        'free_label': (f'{saved} saved · scholarships locked' if cap_col is None
                       else f'{saved}/{cap_col} saved · scholarships locked'),
        'pro_label': f'{saved} saved · scholarship matches on every college',
    }

    # 3. Communities
    groups = int((call_proc_one('sp_assemble_my_group_count', user_id) or {}).get('total', 0) or 0)
    cap_g = limits['communities']
    states['community'] = {
        'active': pro,
        'usage': {'used': groups, 'limit': None if pro else cap_g},
        'free_label': (f'{groups} communities · no direct messages' if cap_g is None
                       else f'{groups}/{cap_g} communities · no direct messages'),
        'pro_label': f'{groups} communities · unlimited, with direct messages',
    }

    # 4. Opportunities — browsing is score-gated for everyone; the personalised
    #    feed and applying are Pro. Report the score gate too, because a Pro
    #    member below the floor still cannot see the hub and deserves to know
    #    that from here rather than from an empty screen.
    from portal.routes.Opportunities.opportunities import _opportunity_unlock_floor
    score = int((call_proc_one('sp_readiness_score_get', user_id) or {}).get('score', 0) or 0)
    floor = int(_opportunity_unlock_floor() or 0)
    states['opportunities'] = {
        'active': pro,
        'blocked_by_score': score < floor,
        'usage': {'used': score, 'limit': floor},
        'free_label': 'Browse only — no For You feed, no applying',
        'pro_label': ('Personalised feed + one-tap apply' if score >= floor else
                      f'Unlocks at readiness {floor} — you are at {score}'),
    }

    # 5. BhaAI — the chat is live for Pro; the allowance is the measurable part.
    from portal.helpers import bhaai
    pro_daily, free_daily = bhaai.daily_limit(True), bhaai.daily_limit(False)
    states['bhaai'] = {
        'active': pro,
        'free_label': (f'{free_daily} question{"s" if free_daily != 1 else ""} a day'
                       if free_daily else 'Preview only'),
        'pro_label': f'{pro_daily} questions a day',
    }

    # 6. Career tools — the Vault cap is the measurable half; the shareable
    #    profile and session credits ride along with it.
    docs = len(call_proc('sp_docvault_by_user', user_id, None) or [])
    cap_d = limits['vault_docs']
    credits = limits['session_credits']
    credits_txt = 'unlimited' if credits is None else credits
    states['career_tools'] = {
        'active': pro,
        'usage': {'used': docs, 'limit': None if pro else cap_d},
        'free_label': (f'{docs} documents · no shareable profile' if cap_d is None
                       else f'{docs}/{cap_d} documents · no shareable profile'),
        'pro_label': f'{docs} documents · unlimited, shareable profile, {credits_txt} free 1-on-1s',
    }
    return states


@ns.route('/entitlements')
class Entitlements(Resource):
    @jwt_required()
    def get(self):
        """Each Pro perk with its live state for this student — what is on, and
        how much of the free allowance is spent."""
        try:
            user_id = get_jwt_identity()
            pro = is_pro(user_id)
            try:
                states = _perk_state(user_id, pro)
            except Exception as pe:
                # A perk row failing to resolve must not blank the page — fall
                # back to the static list with no usage numbers.
                logger.warning(f"perk state degraded: {pe}")
                states = {}
            perks = []
            for p in pro_perk_details():
                st = states.get(p['key']) or {'active': pro}
                perks.append({**p, **st})
            return jsonify(response={
                'is_pro': pro,
                'perks': perks,
                'limits': get_pro_limits(),
            }, status=200, bool=True)
        except Exception as e:
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/subscribe')
class Subscribe(Resource):
    @jwt_required()
    def post(self):
        """Open a Cashfree order for the chosen plan (with any active offer + coupon
        applied) and return payment_session_id. The webhook activates the plan
        + activate."""
        try:
            user_id = get_jwt_identity()
            data = request.get_json() or {}

            if is_pro(user_id) and not _is_referral_only(call_proc_one('sp_subscription_get', user_id)):
                return jsonify(response={'message': 'You already have an active Skovo Pro membership.'}, status=409, bool=False)

            # ── Step 1: price the chosen plan (offer + coupon) & create order ─
            plan_key = data.get('plan') or DEFAULT_PLAN
            plan = _get_plan(plan_key)
            if not plan or not plan.get('is_active'):
                plan = _get_plan(DEFAULT_PLAN)
                plan_key = DEFAULT_PLAN
            if not plan:
                return jsonify(response={'message': 'Subscription plans are not configured.'}, status=500, bool=False)

            eff, _label = _effective_price(plan)
            final = eff
            coupon_code = (data.get('coupon_code') or '').strip()
            if coupon_code:
                # ── SP: sp_student_coupon_validate ────────────────────────────
                cv = call_proc_one('sp_student_coupon_validate', coupon_code, user_id, float(eff), COUPON_CONTEXT, None)
                if not cv or not cv.get('valid'):
                    return jsonify(response={'message': (cv or {}).get('message') or 'Invalid coupon.'}, status=400, bool=False)
                final = int(round(float(cv.get('final_amount') or eff)))

            if final < 1:
                return jsonify(response={'message': 'This plan cannot be reduced below ₹1.'}, status=400, bool=False)

            from portal.helpers.cashfree import (
                create_order, CashfreeError, CashfreeNotConfigured,
            )
            from portal.helpers.helpers import get_payment_setting, normalise_phone

            # ── SP: sp_users_get ─────────────────────────────────────────────
            me = call_proc_one('sp_users_get', user_id) or {}
            phone = normalise_phone(data.get('phone') or me.get('phone'))
            if not phone:
                return jsonify(response={'message': 'A mobile number is required to pay.',
                                         'need_phone': True}, status=400, bool=False)

            order_uuid = str(uuid.uuid4())
            order_no = f"{get_payment_setting('order_no_prefix')}-{order_uuid[:12].upper()}"

            # A subscription has no achiever and no capacity — the order exists
            # so the payment has something to attach to and the webhook has a row
            # to confirm. commission_rate is still snapshotted; a Pro sale is
            # entirely the platform's, so the achiever share resolves to zero.
            try:
                call_proc_one(
                    'sp_payment_order_open',
                    order_uuid, order_no, 'subscription', user_id, None,
                    None, None, float(final), 0, coupon_code or None, None,
                )
                db.session.commit()
            except Exception as oe:
                db.session.rollback()
                logger.error(f"Skovo Pro order open failed: {oe}")
                return jsonify(response={'message': 'Could not start checkout. Please try again.'},
                               status=500, bool=False)

            # SKOVO Wallet (§15): coupon already applied; wallet pays next.
            from portal.helpers import wallet as W
            to_pay = W.apply_to_order(order_uuid, user_id, float(final), 'subscription', bool(data.get('use_wallet')))
            db.session.commit()
            if to_pay <= 0:
                call_proc_one('sp_subscription_create_pending', str(uuid.uuid4()), user_id, plan_key, final, order_no)
                db.session.commit()
                W.complete_wallet_order(order_uuid, 'subscription')
                db.session.commit()
                return jsonify(response={'message': 'Paid with your SKOVO Wallet. Skovo Pro is active.',
                                         'order_id': order_uuid, 'paid_with_wallet': True},
                               status=200, bool=True)

            try:
                checkout = create_order(
                    order_no=order_no,
                    amount=float(to_pay),
                    currency=get_payment_setting('currency'),
                    customer={'id': user_id, 'phone': phone,
                              'email': me.get('email'), 'name': me.get('full_name')},
                    return_url=f"{os.environ.get('FRONTEND_URL', '')}/skovo-pro?order={order_uuid}",
                    notify_url=f"{os.environ.get('API_URL', '')}/v1/webhooks/cashfree",
                    note=f"Skovo Pro {plan_key}",
                )
            except (CashfreeError, CashfreeNotConfigured) as ce:
                db.session.execute(text(
                    "UPDATE payment_orders SET status = 'failed', "
                    "failure_reason = :r, expires_at = UTC_TIMESTAMP() WHERE id = :i"
                ), {'r': str(ce)[:200], 'i': order_uuid})
                db.session.commit()
                logger.error(f"Skovo Pro Cashfree order failed: {ce}")
                error_id = capture_error(ce)          # see cohorts.py — same gap
                return jsonify(response={'message': 'Payment gateway error. Please try again.',
                                         'error_id': error_id},
                               status=502, bool=False)

            # ── SP: sp_subscription_create_pending (stores plan + final amount) ─
            call_proc_one('sp_subscription_create_pending', str(uuid.uuid4()), user_id,
                          plan_key, final, order_no)
            db.session.commit()

            return jsonify(response={
                'message': 'Order created. Complete payment to activate Skovo Pro.',
                'order_id': order_uuid,
                'order_no': order_no,
                'payment_session_id': checkout['payment_session_id'],
                'mode': os.environ.get('CASHFREE_ENV', 'sandbox'),
                'amount': float(final),
                'final_amount': final,
                'plan': plan_key,
                'currency': get_payment_setting('currency'),
            }, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)
