"""
Market — curated student deals (v1 spec).

Brand offers, tool discounts and affiliate links surfaced to students. Deals
are managed in Admin → Market. A deal may be Pro-only; the coupon code and
destination URL are only released on click, and every click is logged so the
admin can see what converts.
"""
from portal.helpers.error_capture import capture_error
import uuid
from flask import jsonify, request
from flask_restx import Resource
from flask_jwt_extended import jwt_required, get_jwt_identity
from portal.models import db
from portal.helpers.sp import call_proc, call_proc_one
from portal.helpers.helpers import serialize_datetime
from . import ns, logger


def _deal_dict(d, is_pro):
    """Public shape. Pro-only deals keep their payload hidden until unlocked."""
    pro_only = bool(d.get('is_pro_only'))
    locked = pro_only and not is_pro
    return {
        'id': d.get('id'),
        'title': d.get('title'),
        'brand': d.get('brand'),
        'description': d.get('description'),
        'category': d.get('category'),
        'image_url': d.get('image_url'),
        'discount_label': d.get('discount_label'),
        'is_pro_only': pro_only,
        'locked': locked,
        # Withheld until the student clicks (and passes the Pro gate).
        'coupon_code': None if locked else d.get('coupon_code'),
        'ends_at': serialize_datetime(d.get('ends_at')),
    }


@ns.route('/')
class MarketList(Resource):
    @ns.doc(description='Browse live deals. Pro-only deals appear locked to free users.')
    @jwt_required()
    def get(self):
        try:
            user_id = get_jwt_identity()
            from portal.routes.Subscription.subscription import is_pro
            pro = is_pro(user_id)

            page = max(1, int(request.args.get('page', 1) or 1))
            per_page = min(60, max(1, int(request.args.get('per_page', 24) or 24)))
            category = request.args.get('category') or None
            search = request.args.get('search') or None

            # ── SP: sp_market_deals_list_public ──────────────────────────────
            rows = call_proc('sp_market_deals_list_public', category, search,
                             per_page, (page - 1) * per_page) or []
            # ── SP: sp_market_categories ─────────────────────────────────────
            cats = call_proc('sp_market_categories') or []

            return jsonify(response={
                'deals': [_deal_dict(d, pro) for d in rows],
                'categories': [{'category': c.get('category'), 'total': c.get('total')} for c in cats],
                'is_pro': pro,
                'page': page,
            }, status=200, bool=True)
        except Exception as e:
            logger.error(f"Error in GET /market: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/<string:deal_id>/redeem')
class MarketRedeem(Resource):
    @ns.doc(description='Redeem a deal — logs the click and returns the destination URL and coupon code.')
    @jwt_required()
    def post(self, deal_id):
        try:
            user_id = get_jwt_identity()
            # ── SP: sp_market_deals_get ──────────────────────────────────────
            deal = call_proc_one('sp_market_deals_get', deal_id)
            if not deal or not deal.get('is_active'):
                return jsonify(response={'message': 'This deal is no longer available.'}, status=404, bool=False)

            if deal.get('is_pro_only'):
                from portal.routes.Subscription.subscription import is_pro
                if not is_pro(user_id):
                    return jsonify(response={
                        'message': 'This deal is exclusive to Skovo Pro members.',
                        'requires_pro': True,
                    }, status=403, bool=False)

            # ── SP: sp_market_deal_click (logs + increments, returns payload) ─
            res = call_proc_one('sp_market_deal_click', str(uuid.uuid4()), deal_id, user_id) or {}
            db.session.commit()

            # Score signal: redeeming a deal (+2, capped 5/month).
            from portal.helpers import score
            score.award(user_id, score.MARKET_REDEEM, ref_id=deal_id)
            db.session.commit()

            return jsonify(response={
                'deal_url': res.get('deal_url'),
                'coupon_code': res.get('coupon_code'),
            }, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in POST /market/{deal_id}/redeem: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)
