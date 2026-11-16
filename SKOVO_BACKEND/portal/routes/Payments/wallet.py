"""SKOVO Wallet + refund tracker — student API (feature-updates.md §15).

GET  /payments/wallet                       balances, history, what the wallet can be used for
POST /payments/wallet/send-to-bank          {amount}  refund money back to the original source
GET  /payments/refunds                      my refunds: status timeline, destination, ARN, credit note
POST /payments/refunds/<id>/to-wallet       take a failed bank refund as wallet credit
GET  /payments/credit-notes/<number>        printable GST credit note
GET  /payments/subscription-refund          quote: unused days and the wallet refund
POST /payments/subscription-refund          {reason_code}  cancel Pro any time; unused days to the wallet
"""
from portal.helpers.error_capture import capture_error
import datetime
import html
from flask import jsonify, request, Response
from flask_restx import Resource
from flask_jwt_extended import jwt_required, get_jwt_identity
from sqlalchemy import text
from portal.models import db
from portal.helpers import wallet as W
from . import ns, logger


def _err(where, e):
    db.session.rollback()
    logger.error(f"{where}: {e}")
    return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)},
                   status=500, bool=False)


def _no(msg, code=400):
    return jsonify(response={'message': msg}, status=code, bool=False)


@ns.route('/wallet')
class MyWallet(Resource):
    @jwt_required()
    def get(self):
        try:
            me = get_jwt_identity()
            s = W.settings()
            pending = db.session.execute(text(
                "SELECT id, amount, status, created_at FROM wallet_payout_requests WHERE user_id = :u "
                "ORDER BY created_at DESC LIMIT 5"), {'u': me}).mappings().all()
            db.session.commit()
            return jsonify(response={
                'enabled': True,  # v1: the wallet is always on
                **W.balances(me),
                'usable_on': [x.strip() for x in str(s.get('usable_on') or '').split(',') if x.strip()],
                'bonus_cap_pct': int(s.get('bonus_cap_pct') or 0),
                'send_to_bank_days': 0,  # v1: spend-only, never back to a bank
                'history': W.history(me),
                'payout_requests': [{'id': p['id'], 'amount': float(p['amount']), 'status': p['status'],
                                     'at': p['created_at'].isoformat() + 'Z'} for p in pending],
            }, status=200, bool=True)
        except Exception as e:
            return _err('GET /payments/wallet', e)


@ns.route('/wallet/send-to-bank')
class SendToBank(Resource):
    @jwt_required()
    def post(self):
        try:
            if not W.enabled():
                return _no('The wallet is not available.', 409)
            try:
                amount = float((request.get_json() or {}).get('amount'))
            except (TypeError, ValueError):
                return _no('Enter an amount.')
            rid, err = W.request_payout(get_jwt_identity(), amount)
            if err:
                db.session.rollback()
                return _no(err, 409)
            db.session.commit()
            return jsonify(response={'message': 'Request sent. Our team will process it shortly.', 'id': rid},
                           status=201, bool=True)
        except Exception as e:
            return _err('POST send-to-bank', e)


_STEPS = {'pending': 'Processing', 'succeeded': 'Credited', 'failed': 'Retrying', 'cancelled': 'Moved'}


@ns.route('/refunds')
class MyRefunds(Resource):
    @jwt_required()
    def get(self):
        try:
            rows = db.session.execute(text(
                "SELECT r.*, o.kind FROM refunds r JOIN payment_orders o ON o.id = r.order_id "
                "WHERE o.student_id = :u ORDER BY r.created_at DESC LIMIT 100"), {'u': get_jwt_identity()}).mappings().all()
            out = []
            for r in rows:
                wallet_dest = r['destination'] == 'wallet'
                timeline = [{'step': 'Started', 'done': True, 'at': r['created_at'].isoformat() + 'Z'}]
                if wallet_dest:
                    timeline.append({'step': 'Credited to SKOVO Wallet', 'done': r['status'] == 'succeeded'})
                else:
                    timeline += [{'step': 'Processing', 'done': r['status'] in ('succeeded',)},
                                 {'step': 'Credited to your bank', 'done': r['status'] == 'succeeded' and bool(r.get('arn')),
                                  'reference': r.get('arn')}]
                out.append({
                    'id': r['id'], 'order_id': r['order_id'], 'kind': r['kind'], 'amount': float(r['amount']),
                    'bonus': float(r.get('bonus_amount') or 0), 'destination': r['destination'],
                    'status': r['status'], 'status_label': _STEPS.get(r['status'], r['status']),
                    'reference': r.get('arn'), 'credit_note': r.get('credit_note_no'),
                    'can_move_to_wallet': r['status'] == 'failed' and not r.get('next_retry_at') and W.enabled(),
                    'timeline': timeline, 'reason': r.get('reason'),
                })
            return jsonify(response={'refunds': out}, status=200, bool=True)
        except Exception as e:
            return _err('GET /payments/refunds', e)


@ns.route('/refunds/<string:refund_id>/to-wallet')
class RefundToWallet(Resource):
    @jwt_required()
    def post(self, refund_id):
        try:
            from portal.helpers.refunds import move_failed_to_wallet
            ok, info = move_failed_to_wallet(refund_id, get_jwt_identity())
            if not ok:
                db.session.rollback()
                return _no(str(info), 409)
            return jsonify(response={'message': 'Added to your SKOVO Wallet.'}, status=200, bool=True)
        except Exception as e:
            return _err('POST refund to wallet', e)


@ns.route('/credit-notes/<string:number>')
class CreditNote(Resource):
    @jwt_required()
    def get(self, number):
        try:
            me = get_jwt_identity()
            cn = db.session.execute(text(
                "SELECT cn.*, o.order_no, o.kind, u.full_name FROM credit_notes cn "
                "JOIN payment_orders o ON o.id = cn.order_id LEFT JOIN users u ON u.id = cn.user_id "
                "WHERE cn.number = :n AND cn.user_id = :u"), {'n': number, 'u': me}).mappings().first()
            if not cn:
                return _no('Credit note not found.', 404)
            e = html.escape
            page = f"""<!doctype html><html><head><meta charset="utf-8"><title>Credit note {e(cn['number'])}</title>
<style>body{{font-family:Arial,sans-serif;max-width:640px;margin:32px auto;color:#111}}td{{padding:6px 0}}
.h{{font-size:22px;font-weight:700}}.m{{color:#555}}</style></head><body>
<div class="h">SKOVO — Credit Note</div><div class="m">{e(cn['number'])}</div><hr>
<table><tr><td>Issued to</td><td>{e(cn['full_name'] or '')}</td></tr>
<tr><td>Date</td><td>{cn['created_at']:%d %b %Y}</td></tr>
<tr><td>Original invoice / order</td><td>{e(cn['order_no'])} ({e(cn['kind'])})</td></tr>
<tr><td>Amount credited</td><td>₹{float(cn['amount']):,.2f}</td></tr>
<tr><td>Refunded to</td><td>{'SKOVO Wallet' if cn['destination'] == 'wallet' else 'Original payment method'}</td></tr></table>
<hr><div class="m">This credit note reverses the amount above from the original invoice.</div></body></html>"""
            return Response(page, mimetype='text/html')
        except Exception as e:
            return _err('GET credit note', e)


@ns.route('/subscription-refund')
class SubscriptionRefund(Resource):
    """Cancel Skovo Pro any time. Pro stops at once; the unused days come back
    to the SKOVO wallet (refunds.pro_cancel_quote has the maths). Web-bought Pro
    only -- app-store purchases are refunded by Google / Apple."""

    @jwt_required()
    def get(self):
        try:
            from portal.helpers.refunds import pro_cancel_quote
            q = pro_cancel_quote(get_jwt_identity())
            db.session.commit()
            if not q:
                return _no('No active Skovo Pro to cancel.', 404)
            q = {**q, 'expires_at': q['expires_at'].isoformat() + 'Z'}
            q.pop('order_id', None)
            return jsonify(response=q, status=200, bool=True)
        except Exception as e:
            return _err('GET subscription refund quote', e)

    @jwt_required()
    def post(self):
        try:
            me = get_jwt_identity()
            from portal.helpers.refunds import pro_cancel_quote, issue_refund, choice_from
            from portal.helpers.wallet import remove_pro
            q = pro_cancel_quote(me)
            if not q:
                return _no('No active Skovo Pro to cancel.', 404)
            _, code, txt = choice_from(request.get_json(silent=True))
            if q['refund'] > 0:
                ok, info = issue_refund(q['order_id'], q['refund'], 'Pro cancelled (unused days)', me,
                                        refund_key=f"rf-{q['order_no'][:24]}-p", destination='wallet',
                                        case_key='pro_refund', reason_code=code, reason_text=txt)
                if not ok:
                    return _no('Could not cancel right now. Try again or contact support.', 502)
            # A part refund does not switch Pro off by itself; cancelling does.
            remove_pro({'order_no': q['order_no']}, status='cancelled')
            db.session.commit()
            amt = f"₹{q['refund']:,.2f}".replace('.00', '')
            return jsonify(response={
                'message': (f"Skovo Pro is cancelled. {amt} for the {q['unused_days']} unused days is in your SKOVO Wallet."
                            if q['refund'] > 0 else 'Skovo Pro is cancelled.'),
                'refund': q['refund'],
            }, status=200, bool=True)
        except Exception as e:
            return _err('POST subscription refund', e)
