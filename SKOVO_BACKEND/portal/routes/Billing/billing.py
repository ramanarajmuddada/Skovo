"""
Billing routes:
  Student  — POST /billing/coupons/validate, GET /billing/invoices, GET /billing/invoices/<id>
  Admin    — CRUD /skovo-platform-panel-admin/coupons
"""
from portal.helpers.error_capture import capture_error
from portal.helpers.helpers import serialize_datetime
import uuid
import datetime
from sqlalchemy.exc import IntegrityError
from flask import jsonify, request, Response
from flask_restx import Resource, reqparse
from flask_jwt_extended import jwt_required, get_jwt_identity, get_jwt
from portal.models import db
from portal.helpers.sp import call_proc, call_proc_one
from portal.api import api as _api
from . import ns, logger

_admin_ns = _api.namespace('skovo-platform-panel-admin', description='Admin Panel')


# ── Student: the coupons they can actually use ────────────────────────────────
@ns.route('/coupons')
class StudentCoupons(Resource):
    @ns.doc(description=(
        'Coupons a student can use right now.\n\n'
        'Students previously had no way to discover a code at all — they could '
        'only type one they had already been given somewhere else. Anything '
        'inactive, expired, not yet live, or fully redeemed is filtered out, so '
        'a code shown here is one that will actually work at checkout.'
    ))
    @jwt_required()
    def get(self):
        try:
            now = datetime.datetime.utcnow()
            # ── SP: sp_coupons_list ───────────────────────────────────────────
            rows = call_proc('sp_coupons_list', 5000, 0, 0) or []

            usable = []
            for c in rows:
                if not c.get('is_active'):
                    continue
                starts, ends = c.get('valid_from'), c.get('valid_until')
                if starts and starts > now:
                    continue          # not live yet
                if ends and ends < now:
                    continue          # expired
                max_uses, used = c.get('max_uses'), int(c.get('used_count') or 0)
                if max_uses and used >= int(max_uses):
                    continue          # fully redeemed
                usable.append({
                    'code': c.get('code'),
                    'discount_type': c.get('discount_type'),
                    'value': float(c.get('value') or 0),
                    'max_discount': float(c['max_discount']) if c.get('max_discount') else None,
                    'min_amount': float(c['min_amount']) if c.get('min_amount') else None,
                    'applies_to': c.get('applies_to') or 'all',
                    'valid_until': serialize_datetime(ends) if ends else None,
                })

            usable.sort(key=lambda c: c['value'], reverse=True)
            return jsonify(response={'coupons': usable, 'total': len(usable)},
                           status=200, bool=True)
        except Exception as e:
            logger.error(f"Error in GET /billing/coupons: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id},
                           status=500, bool=False)


# ── Student: validate a coupon before paying ──────────────────────────────────
@ns.route('/coupons/validate')
class CouponValidate(Resource):
    @jwt_required()
    def post(self):
        try:
            user_id = get_jwt_identity()
            data = request.get_json() or {}
            code = (data.get('code') or '').strip()
            amount = data.get('amount') or 0
            context_type = data.get('context_type') or 'cohort'
            context_id = data.get('context_id') or None
            if context_type not in ('cohort', 'session', 'course', 'pro'):
                return jsonify(response={'message': 'Invalid context_type.', 'valid': False},
                               status=400, bool=False)

            row = call_proc_one('sp_student_coupon_validate', code, user_id, amount,
                                context_type, context_id)
            if not row or not row.get('valid'):
                msg = (row or {}).get('message') or 'Invalid coupon.'
                return jsonify(response={'message': msg, 'valid': False}, status=200, bool=False)
            return jsonify(response={
                'valid': True, 'code': code.upper(), 'discount': round(float(row['discount'] or 0), 2),
                'final_amount': round(float(row['final_amount'] or 0), 2),
            }, status=200, bool=True)
        except Exception as e:
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


def _invoice_dict(i):
    return {
        'id': i['id'], 'invoice_number': i.get('invoice_number'),
        'description': i.get('description'), 'context_type': i.get('context_type'),
        # context_id is what a booking row is matched against — Bookings builds a
        # {context_id: invoice} map to decide whether to offer an Invoice button.
        # It was missing here, so that map was always empty and the button never
        # appeared on any booking, on either surface.
        'context_id': i.get('context_id'),
        'base_amount': float(i.get('base_amount') or 0), 'discount_amount': float(i.get('discount_amount') or 0),
        'gst_rate': float(i.get('gst_rate') or 0), 'gst_amount': float(i.get('gst_amount') or 0),
        'total_amount': float(i.get('total_amount') or 0), 'status': i.get('status'),
        'created_at': serialize_datetime(i['created_at']) if i.get('created_at') else None,
    }


# ── Student: list own invoices ────────────────────────────────────────────────
@ns.route('/invoices')
class InvoiceList(Resource):
    @jwt_required()
    def get(self):
        try:
            user_id = get_jwt_identity()
            # ── SP: sp_invoices_list — no by-user-id filter on the generic
            # CRUD proc, so pull a bounded batch and filter here. ──────────────
            items = call_proc('sp_invoices_list', 50000, 0)
            items = [i for i in items if i.get('user_id') == user_id]
            items.sort(key=lambda i: i.get('created_at') or datetime.datetime.min, reverse=True)
            return jsonify(response={'invoices': [_invoice_dict(i) for i in items]}, status=200, bool=True)
        except Exception as e:
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


# ── Student: download a single invoice as a printable HTML receipt ─────────────
@ns.route('/invoices/<string:invoice_id>')
class InvoiceDetail(Resource):
    @jwt_required()
    def get(self, invoice_id):
        try:
            user_id = get_jwt_identity()
            # ── SP: sp_invoices_get ──────────────────────────────────────────────
            i = call_proc_one('sp_invoices_get', invoice_id)
            if not i or i.get('user_id') != user_id:
                return jsonify(response={'message': 'Invoice not found.'}, status=404, bool=False)
            if request.args.get('format') == 'html':
                return Response(_invoice_html(i), mimetype='text/html')
            return jsonify(response=_invoice_dict(i), status=200, bool=True)
        except Exception as e:
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


def _invoice_html(i):
    # ── SP: sp_users_get ─────────────────────────────────────────────────────
    u = call_proc_one('sp_users_get', i.get('user_id'))
    return f"""<!DOCTYPE html><html><head><meta charset='utf-8'><title>{i.get('invoice_number')}</title>
<style>body{{font-family:Arial;max-width:640px;margin:24px auto;color:#1e293b}}
h1{{color:#2563eb}}table{{width:100%;border-collapse:collapse;margin-top:16px}}
td,th{{padding:8px;border-bottom:1px solid #e2e8f0;text-align:left}}.r{{text-align:right}}</style></head>
<body><h1>SKOVO</h1><p><strong>Tax Invoice</strong> — {i.get('invoice_number')}<br>
Date: {i['created_at'].strftime('%d %b %Y') if i.get('created_at') else ''}<br>
Billed to: {u.get('full_name') if u else ''} ({u.get('email') if u else ''})</p>
<table><tr><th>Description</th><th class='r'>Amount (₹)</th></tr>
<tr><td>{i.get('description') or ''}</td><td class='r'>{float(i.get('base_amount') or 0):.2f}</td></tr>
<tr><td>Discount</td><td class='r'>-{float(i.get('discount_amount') or 0):.2f}</td></tr>
<tr><td>GST ({float(i.get('gst_rate') or 0):.0f}%)</td><td class='r'>{float(i.get('gst_amount') or 0):.2f}</td></tr>
<tr><th>Total Paid</th><th class='r'>{float(i.get('total_amount') or 0):.2f}</th></tr></table>
<p style='margin-top:16px;color:#64748b;font-size:13px'>Status: {i.get('status')}. This is a computer-generated invoice.</p>
</body></html>"""


# ── Admin: coupon CRUD ────────────────────────────────────────────────────────
def _require_admin():
    return get_jwt().get('role') == 'admin'


def _coupon_dict(c):
    return {
        'id': c['id'], 'code': c.get('code'), 'discount_type': c.get('discount_type'),
        'value': float(c.get('value') or 0), 'max_discount': float(c['max_discount']) if c.get('max_discount') is not None else None,
        'min_amount': float(c.get('min_amount') or 0), 'applies_to': c.get('applies_to'),
        'max_uses': c.get('max_uses'), 'used_count': c.get('used_count'), 'per_user_limit': c.get('per_user_limit'),
        'valid_from': serialize_datetime(c['valid_from']) if c.get('valid_from') else None,
        'valid_until': serialize_datetime(c['valid_until']) if c.get('valid_until') else None,
        'is_active': bool(c.get('is_active')),
    }


def _parse_dt(v):
    if not v:
        return None
    try:
        return datetime.datetime.fromisoformat(v.replace('Z', ''))
    except Exception:
        return None


@_admin_ns.route('/coupons')
class AdminCouponList(Resource):
    @jwt_required()
    def get(self):
        try:
            if not _require_admin():
                return jsonify(response={'message': 'Admin access only.'}, status=403, bool=False)
            # ── SP: sp_coupons_list ──────────────────────────────────────────────
            items = call_proc('sp_coupons_list', 5000, 0, 0)
            items.sort(key=lambda c: c.get('created_at') or datetime.datetime.min, reverse=True)
            return jsonify(response={'coupons': [_coupon_dict(c) for c in items]}, status=200, bool=True)
        except Exception as e:
            return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)}, status=500, bool=False)

    @jwt_required()
    def post(self):
        try:
            if not _require_admin():
                return jsonify(response={'message': 'Admin access only.'}, status=403, bool=False)
            d = request.get_json() or {}
            code = (d.get('code') or '').strip().upper()
            if not code:
                return jsonify(response={'message': 'Coupon code required.'}, status=400, bool=False)
            # ── SP: sp_coupons_create — the code UNIQUE constraint enforces the
            # duplicate check, so IntegrityError -> 409 replaces the pre-SELECT. ─
            try:
                c = call_proc_one(
                    'sp_coupons_create',
                    str(uuid.uuid4()), code, d.get('discount_type', 'percent'), d.get('value') or 0,
                    d.get('max_discount') or None, d.get('min_amount') or 0, d.get('applies_to', 'all'),
                    d.get('max_uses') or None, 0, d.get('per_user_limit') or 1,
                    _parse_dt(d.get('valid_from')), _parse_dt(d.get('valid_until')),
                    1 if d.get('is_active', True) else 0, get_jwt_identity(),
                )
                db.session.commit()
            except IntegrityError:
                db.session.rollback()
                return jsonify(response={'message': 'Coupon code already exists.'}, status=409, bool=False)
            return jsonify(response={'message': 'Coupon created.', 'coupon': _coupon_dict(c)}, status=201, bool=True)
        except Exception as e:
            db.session.rollback()
            return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)}, status=500, bool=False)


@_admin_ns.route('/coupons/<string:coupon_id>')
class AdminCouponDetail(Resource):
    @jwt_required()
    def put(self, coupon_id):
        try:
            if not _require_admin():
                return jsonify(response={'message': 'Admin access only.'}, status=403, bool=False)
            # ── SP: sp_coupons_get + _update (full replace) ─────────────────────
            c = call_proc_one('sp_coupons_get', coupon_id)
            if not c:
                return jsonify(response={'message': 'Coupon not found.'}, status=404, bool=False)
            d = request.get_json() or {}

            def field(key, caster=None):
                if key not in d:
                    return c.get(key)
                v = d[key]
                return caster(v) if (caster and v is not None) else v

            updated = call_proc_one(
                'sp_coupons_update',
                coupon_id, c.get('code'),
                field('discount_type'), field('value'), field('max_discount'), field('min_amount'),
                field('applies_to'), field('max_uses'), c.get('used_count'), field('per_user_limit'),
                _parse_dt(d['valid_from']) if 'valid_from' in d else c.get('valid_from'),
                _parse_dt(d['valid_until']) if 'valid_until' in d else c.get('valid_until'),
                (1 if d['is_active'] else 0) if 'is_active' in d else c.get('is_active'),
                c.get('created_by'),
            )
            db.session.commit()
            return jsonify(response={'message': 'Coupon updated.', 'coupon': _coupon_dict(updated)}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)}, status=500, bool=False)

    @jwt_required()
    def delete(self, coupon_id):
        try:
            if not _require_admin():
                return jsonify(response={'message': 'Admin access only.'}, status=403, bool=False)
            # ── SP: sp_coupons_get + _update (soft-disable via full replace) ────
            c = call_proc_one('sp_coupons_get', coupon_id)
            if not c:
                return jsonify(response={'message': 'Coupon not found.'}, status=404, bool=False)
            call_proc_one(
                'sp_coupons_update',
                coupon_id, c.get('code'), c.get('discount_type'), c.get('value'), c.get('max_discount'),
                c.get('min_amount'), c.get('applies_to'), c.get('max_uses'), c.get('used_count'),
                c.get('per_user_limit'), c.get('valid_from'), c.get('valid_until'), 0, c.get('created_by'),
            )
            db.session.commit()
            return jsonify(response={'message': 'Coupon disabled.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)}, status=500, bool=False)
