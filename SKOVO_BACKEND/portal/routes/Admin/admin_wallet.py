"""Admin — SKOVO Wallet, refunds, alerts (feature-updates.md §15).

GET/PUT  /wallet/settings
GET/PUT  /refund-rules                              student cancellation rules (cohort, 1-on-1)
GET      /wallet/students/<user_id>                 balance + history
POST     /wallet/students/<user_id>/goodwill        {amount, kind: refund|bonus, reason}
GET      /wallet/payout-requests?status=
POST     /wallet/payout-requests/<id>/decide        {approve, note}
POST     /payments/<order_id>/refund                {amount, refund_to, reason, case_key}
GET      /refunds/report                            by case, destination, reason; wallet liability
GET      /alerts?status=open                        abuse, failed refunds, SLA, chargebacks
POST     /alerts/<id>/close
GET      /chargebacks
GET      /credit-notes
"""
from portal.helpers.error_capture import capture_error
from flask import jsonify, request
from flask_restx import Resource
from flask_jwt_extended import jwt_required, get_jwt_identity
from sqlalchemy import text
from portal.models import db
from portal.helpers.admin_auth import can, AREA_FINANCE
from portal.helpers.audit import log_audit
from portal.helpers import wallet as W
from . import ns, logger

DEC = ('bonus_student_cancel_pct', 'bonus_staff_cancel_pct')
INT = ('bonus_expiry_months', 'bonus_cap_pct', 'send_to_bank_days', 'pro_refund_days', 'abuse_refunds',
       'abuse_days', 'refund_retry_max', 'refund_sla_days', 'prorata_min_keep_pct')
USABLE = ('cohort', 'session', 'subscription')
CASES = ('student_cancel', 'achiever_cancel', 'admin_cancel', 'achiever_no_show', 'reschedule_rejected',
         'duplicate_payment', 'failed_order', 'pro_refund', 'goodwill', 'other')


def _denied():
    return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)


def _err(where, e):
    db.session.rollback()
    logger.error(f"{where}: {e}")
    return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)},
                   status=500, bool=False)


def _no(msg, code=400):
    return jsonify(response={'message': msg}, status=code, bool=False)


def _ser(r):
    out = {}
    for k, v in dict(r).items():
        if hasattr(v, 'isoformat'):
            v = v.isoformat()
        elif v.__class__.__name__ == 'Decimal':
            v = float(v)
        out[k] = v
    return out


@ns.route('/wallet/settings')
class AdminWalletSettings(Resource):
    @jwt_required()
    def get(self):
        try:
            if not can(AREA_FINANCE):
                return _denied()
            s = W.settings()
            db.session.commit()
            return jsonify(response={'settings': _ser(s)}, status=200, bool=True)
        except Exception as e:
            return _err('GET /admin/wallet/settings', e)

    @jwt_required()
    def put(self):
        try:
            if not can(AREA_FINANCE):
                return _denied()
            d = request.get_json() or {}
            sets, p = [], {}
            if 'enabled' in d:
                sets.append('enabled = :enabled')
                p['enabled'] = 1 if d['enabled'] in (True, 1, '1', 'true') else 0
            for k in DEC:
                if k in d:
                    try:
                        v = float(d[k])
                    except (TypeError, ValueError):
                        return _no(f'{k} must be a number.')
                    if not (0 <= v <= 50):
                        return _no('Bonus % must be 0–50.')
                    sets.append(f'{k} = :{k}')
                    p[k] = v
            for k in INT:
                if k in d:
                    try:
                        v = int(d[k])
                    except (TypeError, ValueError):
                        return _no(f'{k} must be a whole number.')
                    if not (0 <= v <= 3650):
                        return _no(f'{k} is out of range.')
                    if k in ('bonus_cap_pct', 'prorata_min_keep_pct') and v > 100:
                        return _no(f'{k} must be 0–100.')
                    sets.append(f'{k} = :{k}')
                    p[k] = v
            if 'usable_on' in d:
                vals = [x for x in (d['usable_on'] if isinstance(d['usable_on'], list) else str(d['usable_on']).split(','))
                        if str(x).strip()]
                if any(str(x).strip() not in USABLE for x in vals):
                    return _no(f"Wallet can be used on: {', '.join(USABLE)}.")
                sets.append('usable_on = :usable_on')
                p['usable_on'] = ','.join(str(x).strip() for x in vals)
            if 'reverse_mode' in d:
                if d['reverse_mode'] not in ('full', 'proportional'):
                    return _no('Points reversal must be full or proportional.')
                sets.append('reverse_mode = :reverse_mode')
                p['reverse_mode'] = d['reverse_mode']
            if 'credit_note_prefix' in d:
                pre = str(d['credit_note_prefix']).strip()[:12]
                if not pre:
                    return _no('Credit note prefix is required.')
                sets.append('credit_note_prefix = :cnp')
                p['cnp'] = pre
            if not sets:
                return _no('Nothing to change.')
            admin = get_jwt_identity()
            before = _ser(W.settings())
            p['admin'] = admin
            db.session.execute(text(f"UPDATE wallet_settings SET {', '.join(sets)}, updated_by = :admin WHERE id = 1"), p)
            db.session.commit()
            after = _ser(W.settings())
            log_audit('wallet_settings_updated', 'wallet_settings', '1', admin, {'before': before, 'after': after})
            return jsonify(response={'settings': after, 'message': 'Saved.'}, status=200, bool=True)
        except Exception as e:
            return _err('PUT /admin/wallet/settings', e)


@ns.route('/wallet/students/<string:user_id>')
class AdminStudentWallet(Resource):
    @jwt_required()
    def get(self, user_id):
        try:
            if not can(AREA_FINANCE):
                return _denied()
            return jsonify(response={**W.balances(user_id), 'history': W.history(user_id, 200)}, status=200, bool=True)
        except Exception as e:
            return _err('GET admin student wallet', e)


@ns.route('/wallet/students/<string:user_id>/goodwill')
class AdminGoodwill(Resource):
    @jwt_required()
    def post(self, user_id):
        try:
            if not can(AREA_FINANCE):
                return _denied()
            d = request.get_json() or {}
            try:
                amount = float(d.get('amount'))
            except (TypeError, ValueError):
                return _no('Enter an amount.')
            if not (0 < amount <= 100000):
                return _no('Amount must be more than 0.')
            reason = (d.get('reason') or '').strip()
            if not reason:
                return _no('A reason is required.')
            kind = d.get('kind') if d.get('kind') in ('refund', 'bonus') else 'bonus'
            admin = get_jwt_identity()
            if not W.goodwill(user_id, amount, kind, reason, admin):
                return _no('Could not add credit.', 409)
            db.session.commit()
            log_audit('wallet_goodwill', 'wallet', user_id, admin, {'amount': amount, 'kind': kind, 'reason': reason})
            from portal.helpers.notifications import notify_user
            notify_user(user_id, f"₹{amount:.0f} added to your SKOVO Wallet", reason, type='payment', reference_type='wallet')
            return jsonify(response={'message': 'Credit added.', **W.balances(user_id)}, status=200, bool=True)
        except Exception as e:
            return _err('POST goodwill', e)


@ns.route('/wallet/payout-requests')
class AdminPayoutRequests(Resource):
    @jwt_required()
    def get(self):
        try:
            if not can(AREA_FINANCE):
                return _denied()
            rows = db.session.execute(text(
                "SELECT r.*, u.full_name, u.email FROM wallet_payout_requests r JOIN users u ON u.id = r.user_id "
                "WHERE (:s = '' OR r.status = :s) ORDER BY r.created_at DESC LIMIT 200"),
                {'s': request.args.get('status') or ''}).mappings().all()
            return jsonify(response={'requests': [_ser(r) for r in rows]}, status=200, bool=True)
        except Exception as e:
            return _err('GET payout requests', e)


@ns.route('/wallet/payout-requests/<string:req_id>/decide')
class AdminPayoutDecide(Resource):
    @jwt_required()
    def post(self, req_id):
        try:
            if not can(AREA_FINANCE):
                return _denied()
            d = request.get_json() or {}
            admin = get_jwt_identity()
            ok, msg = W.decide_payout(req_id, d.get('approve') in (True, 1, '1', 'true'), admin, (d.get('note') or '')[:255])
            if not ok:
                db.session.rollback()
                return _no(msg, 409)
            db.session.commit()
            log_audit('wallet_payout_decided', 'wallet_payout_requests', req_id, admin, {'approve': d.get('approve')})
            return jsonify(response={'message': msg}, status=200, bool=True)
        except Exception as e:
            return _err('POST payout decide', e)


@ns.route('/payments/<string:order_id>/refund')
class AdminRefundOrder(Resource):
    @jwt_required()
    def post(self, order_id):
        try:
            if not can(AREA_FINANCE):
                return _denied()
            d = request.get_json() or {}
            amount = d.get('amount')
            try:
                amount = None if amount in (None, '') else float(amount)
            except (TypeError, ValueError):
                return _no('Amount must be a number.')
            reason = (d.get('reason') or '').strip()
            if not reason:
                return _no('A reason is required.')
            case = d.get('case_key') if d.get('case_key') in CASES else 'admin_cancel'
            dest = d.get('refund_to') if d.get('refund_to') in ('wallet', 'original') else 'original'
            admin = get_jwt_identity()
            from portal.helpers.refunds import issue_refund
            import uuid as _u
            ok, info = issue_refund(order_id, amount, reason, admin, refund_key=f"rf-adm-{_u.uuid4().hex[:16]}",
                                    destination=dest, case_key=case, reason_code='other', reason_text=reason)
            if not ok:
                return _no(f'Refund failed: {info}', 502)
            log_audit('admin_refund', 'payment_orders', order_id, admin,
                      {'amount': amount, 'destination': dest, 'case': case, 'reason': reason})
            return jsonify(response={'message': 'Refund issued.'}, status=200, bool=True)
        except Exception as e:
            return _err('POST admin refund', e)


@ns.route('/refunds/report')
class AdminRefundReport(Resource):
    @jwt_required()
    def get(self):
        try:
            if not can(AREA_FINANCE):
                return _denied()
            q = lambda sql, **p: [_ser(r) for r in db.session.execute(text(sql), p).mappings().all()]
            days = int(request.args.get('days') or 30)
            by_case = q("SELECT IFNULL(case_key, 'unknown') AS case_key, destination, COUNT(*) AS n, SUM(amount) AS amount, "
                        "SUM(bonus_amount) AS bonus FROM refunds WHERE status = 'succeeded' AND created_at >= "
                        "DATE_SUB(UTC_TIMESTAMP(), INTERVAL :d DAY) GROUP BY case_key, destination", d=days)
            by_reason = q("SELECT IFNULL(reason_code, 'not given') AS reason_code, COUNT(*) AS n FROM refunds "
                          "WHERE created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL :d DAY) GROUP BY reason_code", d=days)
            liability = q("SELECT IFNULL(SUM(CASE WHEN kind = 'refund' THEN amount END), 0) AS refund_money FROM wallet_ledger")[0]
            bonus = q("SELECT IFNULL(SUM(remaining), 0) AS bonus_credit FROM wallet_bonus_lots WHERE expires_at > UTC_TIMESTAMP()")[0]
            bonus_flow = q("SELECT type, IFNULL(SUM(amount), 0) AS amount FROM wallet_ledger WHERE kind = 'bonus' "
                           "AND created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL :d DAY) GROUP BY type", d=days)
            top = q("SELECT o.student_id, u.full_name, COUNT(*) AS refunds FROM refunds r JOIN payment_orders o "
                    "ON o.id = r.order_id JOIN users u ON u.id = o.student_id WHERE r.status = 'succeeded' AND r.created_at >= "
                    "DATE_SUB(UTC_TIMESTAMP(), INTERVAL :d DAY) GROUP BY o.student_id, u.full_name ORDER BY refunds DESC "
                    "LIMIT 10", d=days)
            pending_bank = q("SELECT COUNT(*) AS n FROM refunds WHERE destination = 'original' AND status IN ('pending', 'failed')")[0]
            return jsonify(response={'days': days, 'by_case': by_case, 'by_reason': by_reason,
                                     'wallet_liability': {**liability, **bonus}, 'bonus_flow': bonus_flow,
                                     'top_refunders': top, 'bank_refunds_open': pending_bank['n']},
                           status=200, bool=True)
        except Exception as e:
            return _err('GET refunds report', e)


@ns.route('/alerts')
class AdminAlerts(Resource):
    @jwt_required()
    def get(self):
        try:
            if not can(AREA_FINANCE):
                return _denied()
            rows = db.session.execute(text(
                "SELECT * FROM admin_alerts WHERE (:s = '' OR status = :s) ORDER BY created_at DESC LIMIT 200"),
                {'s': request.args.get('status', 'open')}).mappings().all()
            return jsonify(response={'alerts': [_ser(r) for r in rows]}, status=200, bool=True)
        except Exception as e:
            return _err('GET alerts', e)


@ns.route('/alerts/<string:alert_id>/close')
class AdminAlertClose(Resource):
    @jwt_required()
    def post(self, alert_id):
        try:
            if not can(AREA_FINANCE):
                return _denied()
            n = db.session.execute(text(
                "UPDATE admin_alerts SET status = 'closed', closed_by = :a, closed_at = UTC_TIMESTAMP() "
                "WHERE id = :i AND status = 'open'"), {'a': get_jwt_identity(), 'i': alert_id}).rowcount
            db.session.commit()
            return jsonify(response={'message': 'Closed.' if n else 'Already closed.'}, status=200, bool=True)
        except Exception as e:
            return _err('POST alert close', e)


@ns.route('/chargebacks')
class AdminChargebacks(Resource):
    @jwt_required()
    def get(self):
        try:
            if not can(AREA_FINANCE):
                return _denied()
            rows = db.session.execute(text(
                "SELECT c.*, o.order_no, o.kind, u.full_name FROM chargebacks c JOIN payment_orders o ON o.id = c.order_id "
                "LEFT JOIN users u ON u.id = c.user_id ORDER BY c.created_at DESC LIMIT 200")).mappings().all()
            return jsonify(response={'chargebacks': [_ser(r) for r in rows]}, status=200, bool=True)
        except Exception as e:
            return _err('GET chargebacks', e)


@ns.route('/credit-notes')
class AdminCreditNotes(Resource):
    @jwt_required()
    def get(self):
        try:
            if not can(AREA_FINANCE):
                return _denied()
            rows = db.session.execute(text(
                "SELECT cn.*, o.order_no, u.full_name FROM credit_notes cn JOIN payment_orders o ON o.id = cn.order_id "
                "LEFT JOIN users u ON u.id = cn.user_id ORDER BY cn.created_at DESC LIMIT 500")).mappings().all()
            return jsonify(response={'credit_notes': [_ser(r) for r in rows]}, status=200, bool=True)
        except Exception as e:
            return _err('GET credit notes', e)


@ns.route('/refund-rules')
class AdminRefundRules(Resource):
    """Student cancellation rules: hours before the class -> refund %.
    Saving starts a new version; bookings already paid keep their rules."""

    @jwt_required()
    def get(self):
        try:
            if not can(AREA_FINANCE):
                return _denied()
            from portal.helpers.refunds import student_rules
            from portal.helpers.sp import call_proc
            own = bool(call_proc('sp_refund_rules_get', 'session'))
            out = {'cohort': student_rules('cohort'), 'session': student_rules('session'), 'session_own': own}
            db.session.commit()
            return jsonify(response=out, status=200, bool=True)
        except Exception as e:
            return _err('GET /admin/refund-rules', e)

    @jwt_required()
    def put(self):
        try:
            if not can(AREA_FINANCE):
                return _denied()
            import json
            from decimal import Decimal, InvalidOperation
            from portal.helpers.refunds import RULE_SETS, student_rules
            from portal.helpers.sp import call_proc_one
            d = request.get_json() or {}
            kind = d.get('kind')
            if kind not in RULE_SETS:
                return _no('Pick cohort or 1-on-1.')
            raw = d.get('rules') or []
            if not isinstance(raw, list) or not 1 <= len(raw) <= 6:
                return _no('Add 1 to 6 rules.')
            rules = []
            for r in raw:
                try:
                    h = Decimal(str(r.get('min_hours'))).quantize(Decimal('0.01'))
                    pc = Decimal(str(r.get('pct'))).quantize(Decimal('0.01'))
                except (InvalidOperation, TypeError, AttributeError):
                    return _no('Every rule needs hours and a refund %.')
                if not (0 <= h <= 720):
                    return _no('Hours must be 0 to 720 (30 days).')
                if not (0 <= pc <= 100):
                    return _no('Refund % must be 0 to 100.')
                rules.append((h, pc))
            rules.sort(key=lambda x: x[0], reverse=True)
            if len({h for h, _ in rules}) != len(rules):
                return _no('Two rules have the same hours.')
            if rules[-1][0] != 0:
                return _no('Add a rule for 0 hours (cancelling just before the class).')
            if any(rules[i][1] < rules[i + 1][1] for i in range(len(rules) - 1)):
                return _no('Cancelling earlier must never refund less than cancelling later.')
            admin = get_jwt_identity()
            before = student_rules(kind)
            payload = json.dumps([{'min_hours': float(h), 'pct': float(pc)} for h, pc in rules])
            res = call_proc_one('sp_refund_rules_save', RULE_SETS[kind], payload) or {}
            db.session.commit()
            after = student_rules(kind)
            log_audit('refund_rules_updated', 'refund_rules', RULE_SETS[kind], admin,
                      {'kind': kind, 'version': res.get('version'), 'before': before, 'after': after})
            return jsonify(response={'rules': after, 'message': 'Saved. New bookings follow these rules.'},
                           status=200, bool=True)
        except Exception as e:
            return _err('PUT /admin/refund-rules', e)


# ── Class rules (Start window, End session, automatic close, strikes) ───────
@ns.route('/class-rules')
class AdminClassRules(Resource):
    @jwt_required()
    def get(self):
        try:
            if not can(AREA_FINANCE):
                return _denied()
            from portal.helpers import class_rules as CR
            r = CR.rules()
            db.session.commit()
            return jsonify(response={'settings': {k: r[k] for k in CR.FIELDS}}, status=200, bool=True)
        except Exception as e:
            return _err('GET /admin/class-rules', e)

    @jwt_required()
    def put(self):
        try:
            if not can(AREA_FINANCE):
                return _denied()
            import json
            from portal.helpers import class_rules as CR
            from portal.helpers.sp import call_proc_one
            d = request.get_json() or {}
            limits = {'start_before_min': (0, 60), 'start_after_min': (1, 60), 'end_before_min': (0, 60),
                      'auto_close_min': (10, 720), 'release_hours': (0, 168), 'change_lock_hours': (0, 168),
                      'strike_missed': (0, 10), 'strike_late_cancel': (0, 10), 'strike_left_early': (0, 10),
                      'strike_pause_at': (1, 50), 'strike_suspend_at': (1, 50), 'strike_days': (1, 365),
                      'reminders_on': (0, 1)}
            out = {}
            for k, (lo, hi) in limits.items():
                if k not in d:
                    continue
                v = d[k]
                if k == 'reminders_on':
                    v = 1 if v in (True, 1, '1', 'true') else 0
                try:
                    v = int(v)
                except (TypeError, ValueError):
                    return _no(f'{k} must be a whole number.')
                if not lo <= v <= hi:
                    return _no(f'{k} must be {lo} to {hi}.')
                out[k] = v
            if not out:
                return _no('Nothing to change.')
            before = {k: CR.rules()[k] for k in CR.FIELDS}
            merged = {**before, **out}
            if merged['strike_suspend_at'] <= merged['strike_pause_at']:
                return _no('Suspend must be at more strikes than pause.')
            admin = get_jwt_identity()
            call_proc_one('sp_class_rules_save', json.dumps(out), admin)
            db.session.commit()
            after = {k: CR.rules()[k] for k in CR.FIELDS}
            log_audit('class_rules_updated', 'class_rules', '1', admin, {'before': before, 'after': after})
            return jsonify(response={'settings': after, 'message': 'Saved.'}, status=200, bool=True)
        except Exception as e:
            return _err('PUT /admin/class-rules', e)


@ns.route('/class-issues')
class AdminClassIssues(Resource):
    """Complaints (money held), classes with no check-ins, missed classes,
    strikes in the window and paused achievers."""

    @jwt_required()
    def get(self):
        try:
            if not can(AREA_FINANCE):
                return _denied()
            from portal.helpers.sp import call_proc
            issues = [_ser(r) for r in (call_proc('sp_admin_class_issues') or [])]
            strikes = [_ser(r) for r in (call_proc('sp_admin_strikes_list') or [])]
            paused = [_ser(r) for r in (call_proc('sp_admin_paused_achievers') or [])]
            db.session.commit()
            return jsonify(response={'issues': issues, 'strikes': strikes, 'paused': paused}, status=200, bool=True)
        except Exception as e:
            return _err('GET /admin/class-issues', e)


@ns.route('/class-issues/<string:issue_id>/<string:action>')
class AdminClassIssueAction(Resource):
    """release: the achiever is paid (after the 24 hours).
    refund: 100% back to the student's wallet (all students for a whole-class
    issue); `strike: true` also gives the achiever a 'left early' strike."""

    @jwt_required()
    def post(self, issue_id, action):
        try:
            if not can(AREA_FINANCE):
                return _denied()
            from portal.helpers import class_rules as CR
            from portal.helpers.sp import call_proc, call_proc_one
            from portal.helpers.refunds import issue_refund
            i = call_proc_one('sp_class_issue_get', issue_id)
            if not i or i.get('status') != 'open':
                return _no('This issue is already closed.', 409)
            d = request.get_json(silent=True) or {}
            note = (d.get('note') or '').strip()[:500] or None
            admin = get_jwt_identity()
            if action == 'release':
                call_proc_one('sp_class_issue_resolve', issue_id, 'released', admin, note or 'Released to achiever')
                db.session.commit()
                log_audit('class_issue_released', 'class_issue', issue_id, admin, {'note': note})
                return jsonify(response={'message': 'Released. The achiever is paid after the 24 hours.'}, status=200, bool=True)
            if action != 'refund':
                return _no('Unknown action.', 404)
            total = 0.0
            if i['source_type'] == 'session':
                total = CR.refund_session(i['source_id'], 'achiever_no_show', 'Class problem confirmed by admin',
                                          actor_id=admin, suffix='ci')
            else:
                rows = [e for e in (call_proc('sp_cohort_enrollments_list', 50000, 0) or [])
                        if e.get('cohort_id') == i['source_id'] and e.get('payment_status') == 'paid'
                        and (not i.get('booking_id') or e['id'] == i['booking_id'])]
                for e in rows:
                    oid, amt = e.get('payment_order_id'), float(e.get('amount_paid') or 0)
                    if not oid or amt <= 0:
                        continue
                    ok, info = issue_refund(oid, amt, 'Class problem confirmed by admin', actor_id=admin,
                                            refund_key='rf-%s-ci' % str(oid)[:22], case_key='achiever_no_show')
                    if not ok:
                        db.session.rollback()
                        return _no(f'Refund failed: {info}', 502)
                    db.session.execute(text("UPDATE cohort_enrollments SET payment_status = 'refunded' WHERE id = :i"),
                                       {'i': e['id']})
                    total += amt
                    try:
                        from portal.helpers.notifications import notify_user
                        notify_user(e['user_id'], 'Refund for your class',
                                    f"We checked your report. {CR.inr(amt)} is back in your SKOVO Wallet.",
                                    type='cohort', reference_type='cohort', reference_id=i['source_id'])
                    except Exception:
                        pass
            call_proc_one('sp_class_issue_resolve', issue_id, 'refunded', admin,
                          note or f'Refunded {CR.inr(total)} to the wallet')
            db.session.commit()
            if d.get('strike') and i.get('achiever_id'):
                CR.add_strike(i['achiever_id'], 'left_early', i['source_type'], i['source_id'], note=note, by=admin)
            log_audit('class_issue_refunded', 'class_issue', issue_id, admin,
                      {'amount': total, 'strike': bool(d.get('strike')), 'note': note})
            return jsonify(response={'message': f'{CR.inr(total)} refunded to the wallet.'}, status=200, bool=True)
        except Exception as e:
            return _err('POST /admin/class-issues action', e)


@ns.route('/strikes/<string:strike_id>/remove')
class AdminStrikeRemove(Resource):
    @jwt_required()
    def post(self, strike_id):
        try:
            if not can(AREA_FINANCE):
                return _denied()
            from portal.helpers.sp import call_proc_one
            note = ((request.get_json(silent=True) or {}).get('note') or '').strip()[:500]
            if not note:
                return _no('Add a reason (kept in the Audit Log).')
            admin = get_jwt_identity()
            row = call_proc_one('sp_achiever_strike_remove', strike_id, admin, note) or {}
            db.session.commit()
            log_audit('strike_removed', 'achiever_strike', strike_id, admin, {'note': note, 'achiever': row.get('achiever_id')})
            return jsonify(response={'message': 'Strike removed.'}, status=200, bool=True)
        except Exception as e:
            return _err('POST /admin/strikes remove', e)


@ns.route('/achievers/<string:achiever_id>/unpause')
class AdminAchieverUnpause(Resource):
    @jwt_required()
    def post(self, achiever_id):
        try:
            if not can(AREA_FINANCE):
                return _denied()
            from portal.helpers.sp import call_proc_one
            admin = get_jwt_identity()
            call_proc_one('sp_achiever_set_paused', achiever_id, 0)
            db.session.commit()
            log_audit('achiever_unpaused', 'achiever', achiever_id, admin, {})
            try:
                from portal.helpers.achiever_notify import tell_achiever
                tell_achiever(achiever_id, 'New classes open again',
                              'An admin reviewed your account. You can create classes and take bookings again.')
            except Exception:
                pass
            return jsonify(response={'message': 'Unpaused.'}, status=200, bool=True)
        except Exception as e:
            return _err('POST /admin/achievers unpause', e)
