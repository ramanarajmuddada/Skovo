"""
Admin — Market deals.

Full CRUD over the curated deals students see in Market, including the offer
window, Pro-exclusivity and ordering, plus click counts for attribution.
"""
from portal.helpers.error_capture import capture_error
import uuid
from flask import jsonify, request
from flask_restx import Resource
from flask_jwt_extended import jwt_required, get_jwt
from portal.models import db
from portal.helpers.sp import call_proc, call_proc_one
from portal.helpers.helpers import serialize_datetime
from . import ns, logger
from portal.helpers.admin_auth import can, AREA_CONTENT


def _int(v, default=None):
    try:
        return int(v) if v not in (None, '', 'null') else default
    except (ValueError, TypeError):
        return default


def _dt(v):
    """Accept 'YYYY-MM-DD' or ISO datetime, or empty → None."""
    s = (v or '').strip() if isinstance(v, str) else v
    return s or None


def _rate(v):
    """Affiliate commission percentage, e.g. 12.5. Blank means unrecorded."""
    try:
        return float(v) if v not in (None, '', 'null') else None
    except (ValueError, TypeError):
        return None


def _str(v):
    s = (v or '').strip() if isinstance(v, str) else v
    return s or None


def _deal_dict(d):
    return {
        'id': d.get('id'),
        'title': d.get('title'),
        'brand': d.get('brand'),
        'description': d.get('description'),
        'category': d.get('category'),
        'image_url': d.get('image_url'),
        'deal_url': d.get('deal_url'),
        'coupon_code': d.get('coupon_code'),
        'discount_label': d.get('discount_label'),
        'is_pro_only': bool(d.get('is_pro_only')),
        'starts_at': serialize_datetime(d.get('starts_at')),
        'ends_at': serialize_datetime(d.get('ends_at')),
        'is_active': bool(d.get('is_active')),
        'sort_order': d.get('sort_order'),
        'commission_rate': float(d['commission_rate']) if d.get('commission_rate') is not None else None,
        'is_featured': bool(d.get('is_featured')),
        'featured_until': serialize_datetime(d.get('featured_until')),
        'clicks': d.get('clicks', d.get('click_count')),
    }


def _require_admin():
    """This module lives in the 'content' area — see portal/helpers/admin_auth."""
    return can(AREA_CONTENT)


def _args(data):
    """Positional payload shared by create and update."""
    return (
        _str(data.get('title')),
        _str(data.get('brand')),
        _str(data.get('description')),
        _str(data.get('category')),
        _str(data.get('image_url')),
        _str(data.get('deal_url')),
        _str(data.get('coupon_code')),
        _str(data.get('discount_label')),
        (1 if data.get('is_pro_only') else 0),
        _dt(data.get('starts_at')),
        _dt(data.get('ends_at')),
        (1 if data.get('is_active', True) else 0),
        _int(data.get('sort_order'), 0),
        _rate(data.get('commission_rate')),
        (1 if data.get('is_featured') else 0),
        _dt(data.get('featured_until')),
    )


@ns.route('/market')
class AdminMarketList(Resource):
    @ns.doc(description='Admin: list every Market deal, active or not, with click counts.')
    @jwt_required()
    def get(self):
        try:
            if not _require_admin():
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
            page = max(1, int(request.args.get('page', 1) or 1))
            per_page = min(200, max(1, int(request.args.get('per_page', 50) or 50)))
            # ── SP: sp_market_deals_list_admin ───────────────────────────────
            rows = call_proc('sp_market_deals_list_admin', per_page, (page - 1) * per_page) or []
            return jsonify(response={'deals': [_deal_dict(d) for d in rows], 'page': page},
                           status=200, bool=True)
        except Exception as e:
            logger.error(f"Error in GET /admin/market: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @ns.doc(description='Admin: create a Market deal.')
    @jwt_required()
    def post(self):
        try:
            if not _require_admin():
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
            data = request.get_json() or {}
            if not _str(data.get('title')) or not _str(data.get('deal_url')):
                return jsonify(response={'message': 'Title and deal URL are required.'}, status=400, bool=False)

            deal_id = str(uuid.uuid4())
            # ── SP: sp_market_deals_create ───────────────────────────────────
            row = call_proc_one('sp_market_deals_create', deal_id, *_args(data))
            db.session.commit()
            return jsonify(response={'message': 'Deal created.', 'deal': _deal_dict(row or {})},
                           status=201, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in POST /admin/market: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/market/<string:deal_id>')
class AdminMarketDetail(Resource):
    @ns.doc(description='Admin: update a Market deal.')
    @jwt_required()
    def put(self, deal_id):
        try:
            if not _require_admin():
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
            if not call_proc_one('sp_market_deals_get', deal_id):
                return jsonify(response={'message': 'Deal not found.'}, status=404, bool=False)

            data = request.get_json() or {}
            # ── SP: sp_market_deals_update ───────────────────────────────────
            row = call_proc_one('sp_market_deals_update', deal_id, *_args(data))
            db.session.commit()
            return jsonify(response={'message': 'Deal updated.', 'deal': _deal_dict(row or {})},
                           status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in PUT /admin/market/{deal_id}: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @ns.doc(description='Admin: delete a Market deal and its click history.')
    @jwt_required()
    def delete(self, deal_id):
        try:
            if not _require_admin():
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
            # ── SP: sp_market_deals_delete ───────────────────────────────────
            res = call_proc_one('sp_market_deals_delete', deal_id) or {}
            db.session.commit()
            if not res.get('deleted'):
                return jsonify(response={'message': 'Deal not found.'}, status=404, bool=False)
            return jsonify(response={'message': 'Deal deleted.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in DELETE /admin/market/{deal_id}: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)
