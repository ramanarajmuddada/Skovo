"""
Admin — Skovo Pro subscription plans & offers.

Lets admins edit plan prices and run promotions (flat/percent offers with a
date window, or toggle a plan off) without a code deploy. Coupon codes are
managed in Admin → Coupons (create with 'all' or 'pro' applies-to to cover Pro).
"""
from portal.helpers.error_capture import capture_error
from flask import jsonify, request
from flask_restx import Resource
from flask_jwt_extended import jwt_required, get_jwt, get_jwt_identity
from portal.models import db
from portal.helpers.sp import call_proc, call_proc_one
from . import ns, logger
from portal.helpers.admin_auth import can, AREA_FINANCE


def _int(v, default=None):
    try:
        return int(v) if v not in (None, '', 'null') else default
    except (ValueError, TypeError):
        return default


def _dt(v):
    """Accept 'YYYY-MM-DD' or ISO datetime, or empty → None."""
    s = (v or '').strip() if isinstance(v, str) else v
    return s or None


def _plan_dict(p):
    def iso(x):
        return x.isoformat() if hasattr(x, 'isoformat') else x
    return {
        'key': p.get('plan_key'),
        'label': p.get('label'),
        'price': p.get('price'),
        'months': p.get('months'),
        'offer_price': p.get('offer_price'),
        'offer_percent': p.get('offer_percent'),
        'offer_label': p.get('offer_label'),
        'offer_starts_at': iso(p.get('offer_starts_at')),
        'offer_ends_at': iso(p.get('offer_ends_at')),
        'is_active': bool(p.get('is_active')),
        'sort_order': p.get('sort_order'),
    }


def _require_admin():
    """This module lives in the 'finance' area — see portal/helpers/admin_auth."""
    return can(AREA_FINANCE)


@ns.route('/subscriptions')
class AdminSubscriptions(Resource):
    @ns.doc(description='Admin: list Skovo Pro plans with prices and offers.')
    @jwt_required()
    def get(self):
        try:
            if not _require_admin():
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
            # ── SP: sp_subscription_plans_list (0 = include inactive) ──────────
            rows = call_proc('sp_subscription_plans_list', 0) or []
            from portal.helpers.pro_limits import get_pro_limits
            return jsonify(response={
                'plans': [_plan_dict(p) for p in rows],
                'limits': get_pro_limits(),
            }, status=200, bool=True)
        except Exception as e:
            logger.error(f"Error in GET /admin/subscriptions: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @ns.doc(description='Admin: update a plan price / offer / active state.')
    @jwt_required()
    def put(self):
        try:
            if not _require_admin():
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
            data = request.get_json() or {}
            plan_key = (data.get('key') or '').strip()
            if not plan_key:
                return jsonify(response={'message': 'Plan key is required.'}, status=400, bool=False)

            price = _int(data.get('price'))
            if price is not None and price < 1:
                return jsonify(response={'message': 'Price must be at least ₹1.'}, status=400, bool=False)

            # ── SP: sp_subscription_plan_update ───────────────────────────────
            call_proc_one(
                'sp_subscription_plan_update',
                plan_key,
                price,
                _int(data.get('offer_price')),
                _int(data.get('offer_percent')),
                (data.get('offer_label') or None),
                _dt(data.get('offer_starts_at')),
                _dt(data.get('offer_ends_at')),
                (1 if data.get('is_active', True) else 0),
            )
            # A typo in a plan name used to be permanent — _update never touched
            # the label. `months` deliberately stays fixed: it is the term an
            # existing subscriber already bought.
            label = (data.get('label') or '').strip()
            if label:
                call_proc_one('sp_subscription_plan_rename', plan_key, label)

            db.session.commit()
            rows = call_proc('sp_subscription_plans_list', 0) or []
            return jsonify(response={'message': 'Plan updated.', 'plans': [_plan_dict(p) for p in rows]}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in PUT /admin/subscriptions: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @ns.doc(description='Admin: create a new Skovo Pro plan.')
    @jwt_required()
    def post(self):
        """Add a plan. It starts inactive — creating one is not launching it."""
        try:
            if not _require_admin():
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
            data = request.get_json() or {}
            key = (data.get('key') or '').strip().lower()
            label = (data.get('label') or '').strip()
            months = _int(data.get('months'))
            price = _int(data.get('price'))

            if not key:
                return jsonify(response={'message': 'A plan key is required.'}, status=400, bool=False)
            if not key.replace('_', '').isalnum():
                return jsonify(response={'message': 'Plan key can use letters, numbers and underscores only.'},
                               status=400, bool=False)
            if not label:
                return jsonify(response={'message': 'A plan name is required.'}, status=400, bool=False)
            if months is None or months < 1:
                return jsonify(response={'message': 'Duration must be at least 1 month.'}, status=400, bool=False)
            if price is None or price < 0:
                return jsonify(response={'message': 'Price cannot be negative.'}, status=400, bool=False)

            # Offers are optional at creation. A launch promo is usually the
            # reason a plan is being added, so making the admin create the plan
            # first and then edit its card to add the discount was busywork.
            offer_price   = _int(data.get('offer_price'))
            offer_percent = _int(data.get('offer_percent'))
            offer_label   = (data.get('offer_label') or '').strip() or None
            offer_starts  = _dt(data.get('offer_starts_at'))
            offer_ends    = _dt(data.get('offer_ends_at'))

            if offer_price is not None and offer_percent is not None:
                return jsonify(response={'message': 'Set either a % off or a fixed offer price, not both.'},
                               status=400, bool=False)
            if offer_percent is not None and not (1 <= offer_percent <= 100):
                return jsonify(response={'message': 'Percent off must be between 1 and 100.'},
                               status=400, bool=False)
            if offer_price is not None and offer_price >= price:
                return jsonify(response={'message': 'The offer price must be lower than the base price.'},
                               status=400, bool=False)
            if offer_starts and offer_ends and offer_ends <= offer_starts:
                return jsonify(response={'message': 'The offer end date must be after the start date.'},
                               status=400, bool=False)

            try:
                # ── SP: sp_subscription_plan_create ───────────────────────────
                call_proc_one('sp_subscription_plan_create', key, label, months, price,
                              offer_price, offer_percent, offer_label,
                              offer_starts, offer_ends)
            except Exception as sp_err:
                db.session.rollback()
                msg = str(sp_err)
                if 'PLAN_KEY_EXISTS' in msg:
                    return jsonify(response={'message': f'A plan with the key "{key}" already exists.'},
                                   status=409, bool=False)
                if any(x in msg for x in ('MONTHS_INVALID', 'PRICE_INVALID', 'PLAN_KEY_REQUIRED')):
                    return jsonify(response={'message': 'Those plan details are not valid.'},
                                   status=400, bool=False)
                # The SP re-checks the offer rules; it is the last word if a
                # caller reaches it without going through the checks above.
                if 'OFFER_BOTH_SET' in msg:
                    return jsonify(response={'message': 'Set either a % off or a fixed offer price, not both.'},
                                   status=400, bool=False)
                if 'OFFER_PRICE_NOT_LOWER' in msg:
                    return jsonify(response={'message': 'The offer price must be lower than the base price.'},
                                   status=400, bool=False)
                if 'OFFER_WINDOW_INVALID' in msg:
                    return jsonify(response={'message': 'The offer end date must be after the start date.'},
                                   status=400, bool=False)
                if any(x in msg for x in ('OFFER_PERCENT_INVALID', 'OFFER_PRICE_INVALID')):
                    return jsonify(response={'message': 'That offer is not valid.'},
                                   status=400, bool=False)
                raise

            db.session.commit()
            rows = call_proc('sp_subscription_plans_list', 0) or []
            return jsonify(response={'message': f'Plan "{label}" created. Tick Active to show it to students.',
                                     'plans': [_plan_dict(p) for p in rows]}, status=201, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in POST /admin/subscriptions: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @ns.doc(description='Admin: delete a plan nobody has subscribed to.')
    @jwt_required()
    def delete(self):
        try:
            if not _require_admin():
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
            key = (request.args.get('key') or '').strip().lower()
            if not key:
                return jsonify(response={'message': 'Plan key is required.'}, status=400, bool=False)

            try:
                # ── SP: sp_subscription_plan_delete — refuses a plan in use ──
                call_proc_one('sp_subscription_plan_delete', key)
            except Exception as sp_err:
                db.session.rollback()
                if 'PLAN_IN_USE' in str(sp_err):
                    return jsonify(response={
                        'message': 'Students are subscribed to this plan, so it cannot be deleted. '
                                   'Untick Active to hide it from the app instead.'},
                        status=409, bool=False)
                raise

            db.session.commit()
            rows = call_proc('sp_subscription_plans_list', 0) or []
            return jsonify(response={'message': 'Plan deleted.', 'plans': [_plan_dict(p) for p in rows]},
                           status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in DELETE /admin/subscriptions: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/subscriptions/limits')
class AdminProLimits(Resource):
    """Free-tier numbers every student shares. After they hit the cap they take Pro."""

    @ns.doc(description='Admin: free-tier caps for Skovo Pro perks.')
    @jwt_required()
    def get(self):
        try:
            if not _require_admin():
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
            from portal.helpers.pro_limits import get_pro_limits, invalidate_pro_limits
            invalidate_pro_limits()
            return jsonify(response={'limits': get_pro_limits()}, status=200, bool=True)
        except Exception as e:
            logger.error(f"Error in GET /admin/subscriptions/limits: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @ns.doc(description='Admin: set free-tier caps. Applies to every student.')
    @jwt_required()
    def put(self):
        try:
            if not _require_admin():
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
            from portal.helpers.pro_limits import BOUNDS, KEYS, get_pro_limits, save_pro_limits
            data = request.get_json() or {}
            current = get_pro_limits()
            values = {}
            for k in KEYS:
                if k not in data:
                    values[k] = current[k]
                    continue
                # Explicit null is the admin choosing Unlimited, which is a
                # value, not a missing field. It has to pass through before the
                # whole-number check below rejects it.
                if data.get(k) is None:
                    values[k] = None
                    continue
                lo, hi = BOUNDS[k]
                n = _int(data.get(k))
                if n is None:
                    return jsonify(response={'message': f'{k} must be a whole number, or null for unlimited.'}, status=400, bool=False)
                if n < lo or n > hi:
                    return jsonify(
                        response={'message': f'{k} must be between {lo} and {hi}.'},
                        status=400, bool=False,
                    )
                values[k] = n

            admin_id = get_jwt().get('sub') or get_jwt_identity()
            limits = save_pro_limits(values, updated_by=admin_id)
            return jsonify(
                response={
                    'message': 'Allowances saved. Every student uses these numbers.',
                    'limits': limits,
                },
                status=200, bool=True,
            )
        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in PUT /admin/subscriptions/limits: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

