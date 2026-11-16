import json

from portal.helpers.error_capture import capture_error
from datetime import datetime
from sqlalchemy import text
from flask import jsonify, request
from flask_restx import Resource
from portal.models import db
from portal.helpers.sp import call_proc_one
from . import ns, logger


def _notify(user_id, title, body, ref_type, ref_id):
    try:
        from portal.helpers.notifications import notify_user
        notify_user(user_id=user_id, title=title, body=body, type='payment',
                    reference_type=ref_type, reference_id=ref_id)
    except Exception as ne:
        logger.error(f"Webhook notify_user failed: {ne}")


def _track(event, entity_type, entity_id, user_id, order_id, amount):
    try:
        from portal.helpers.analytics import track_event
        track_event(event, entity_type=entity_type, entity_id=entity_id, user_id=user_id,
                    meta={'order_id': order_id, 'amount_paise': amount})
    except Exception:
        pass






@ns.route('/cashfree')
class CashfreeWebhook(Resource):
    # Return plain dicts, never jsonify(). flask-restx serialises whatever a
    # Resource method returns, so handing it an already-built Flask Response
    # raises "Object of type Response is not JSON serializable" -- which turns
    # every reply, including the success path, into a 500. Cashfree reads that
    # as failure and retries the delivery indefinitely.
    def post(self):
        """Cashfree payment webhook — verifies, deduplicates, then applies.

        The gateway is the only trustworthy source of payment truth: the
        browser return URL can be closed, replayed or forged, so it is used
        purely to poll status and never to confirm.

        Cashfree retries until it receives a 2xx, so this must be safe to run
        repeatedly for one payment. `payment_events.provider_event_id` is
        UNIQUE — a duplicate delivery loses the insert race, returns 200, and
        no downstream procedure runs a second time.
        """
        from portal.helpers.cashfree import (
            verify_webhook_signature, CashfreeNotConfigured,
        )
        from portal.models.payment_events import PaymentEvents

        raw = request.get_data()
        signature = request.headers.get('x-webhook-signature', '')
        timestamp = request.headers.get('x-webhook-timestamp', '')

        # Which product signed this. Payouts transfers are signed with the
        # payout client secret, which may differ from the PG pair, so the
        # secret has to be chosen BEFORE verifying — hence this peek at the
        # unverified body.
        #
        # Reading it here is safe because the value is used for exactly one
        # thing: picking which of SKOVO's own secrets to hash against. A forged
        # `type` buys nothing — the signature still has to match a real secret,
        # and nothing else on this request is trusted until it does.
        kind = 'payment'
        try:
            peeked = json.loads(raw or b'{}')
            peeked_type = str(peeked.get('type') or peeked.get('event') or '')
            if peeked_type.upper().startswith('TRANSFER_'):
                kind = 'payout'
        except (ValueError, AttributeError):
            pass

        # Fail closed. An unverifiable webhook is refused, never processed.
        try:
            ok = verify_webhook_signature(raw, signature, timestamp, kind=kind)
        except CashfreeNotConfigured as e:
            logger.error(f"Cashfree webhook rejected: {e}")
            return {'error': 'Webhook not configured'}, 500

        if not ok:
            logger.warning("Cashfree webhook: invalid or stale signature rejected")
            return {'error': 'Invalid signature'}, 400

        try:
            payload = request.get_json(force=True, silent=True) or {}

            # Cashfree has several live API versions and this endpoint is
            # registered at 2026-01-01 while the client sends 2023-08-01, so the
            # envelope is read defensively rather than assuming one shape. A
            # webhook we cannot parse is a payment we cannot confirm, and the
            # money has already moved by then.
            event_type = payload.get('type') or payload.get('event') or ''
            data = payload.get('data') or payload.get('payload') or {}
            order = data.get('order') or {}
            payment = data.get('payment') or {}

            order_no = (order.get('order_id')
                        or data.get('order_id')
                        or payload.get('order_id'))
            cf_payment_id = (payment.get('cf_payment_id')
                             or payment.get('payment_id')
                             or data.get('cf_payment_id'))

            if not event_type:
                logger.warning("Cashfree webhook: no event type in payload keys=%s",
                               list(payload.keys())[:8])

            transfer = data.get('transfer') if isinstance(data.get('transfer'), dict) else {}
            transfer_id = (data.get('transfer_id') or transfer.get('transfer_id')
                           or payload.get('transfer_id'))

            # Cashfree's own delivery id. Falling back to a composite keeps the
            # uniqueness guarantee if the header is ever absent.
            event_id = (request.headers.get('x-webhook-id')
                        or (f"{event_type}:{transfer_id}" if transfer_id
                            else f"{event_type}:{order_no}:{cf_payment_id}"))

            # Record before acting. A duplicate delivery fails this insert on the
            # UNIQUE constraint, which is exactly the dedupe we want.
            evt = PaymentEvents(
                provider='cashfree',
                provider_event_id=str(event_id)[:120],
                event_type=event_type[:60],
                provider_order_id=str(order_no)[:80] if order_no else None,
                raw_payload=raw,
                signature_ok=True,
            )
            try:
                db.session.add(evt)
                db.session.commit()
            except Exception:
                db.session.rollback()
                logger.info(f"Cashfree webhook: duplicate event {event_id} ignored")
                return {'status': 'duplicate'}, 200

            if str(event_type or '').upper().startswith('TRANSFER_'):
                from portal.helpers.payout_transfer import apply_transfer_result
                gw = (data.get('status') or transfer.get('status')
                      or str(event_type).split('_', 1)[-1])
                utr = (data.get('transfer_utr') or data.get('utr')
                       or transfer.get('transfer_utr') or transfer.get('utr'))
                reason = (data.get('status_description') or data.get('reason')
                          or transfer.get('status_description'))
                if transfer_id:
                    apply_transfer_result(transfer_id, gw, utr, reason)
                else:
                    logger.warning("Cashfree payout webhook %s: no transfer_id", event_type)
                evt.processed = True
                evt.processed_at = datetime.utcnow()
                db.session.commit()
                return {'status': 'ok'}, 200

            if not order_no:
                logger.warning(f"Cashfree webhook {event_type}: no order_id in payload")
                return {'status': 'ignored'}, 200

            # order_no is what we sent as payment_orders.order_no.
            row = db.session.execute(text(
                "SELECT id, kind, status FROM payment_orders WHERE order_no = :n"
            ), {'n': order_no}).fetchone()

            if not row:
                logger.warning(f"Cashfree webhook: unknown order_no={order_no}")
                return {'status': 'unknown-order'}, 200

            order_id, kind, current = row[0], row[1], row[2]

            if event_type in ('PAYMENT_SUCCESS_WEBHOOK', 'PAYMENT_SUCCESS'):
                # Cohorts confirm through their own procedure — the shared
                # one would try to book a 1-on-1 slot. filled_seats moves here;
                # the checkout hold already occupied the cap.
                if kind == 'cohort':
                    result = call_proc_one('sp_payment_cohort_mark_paid',
                                           order_id, 'cashfree', str(cf_payment_id))
                else:
                    result = call_proc_one('sp_payment_order_mark_paid',
                                           order_id, 'cashfree', str(cf_payment_id),
                                           None)
                db.session.commit()

                outcome = (result or {}).get('result')
                logger.info(f"Cashfree webhook: order {order_no} ({kind}) -> {outcome}")

                # Pro turns on here. On a retry too: activation is idempotent,
                # and a first attempt that failed must get another chance.
                if kind == 'cohort' and outcome == 'paid':
                    from portal.helpers.booking_alert import alert_cohort_booking
                    alert_cohort_booking(order_id=order_id)
                if kind == 'session' and outcome == 'paid':
                    from portal.helpers.booking_alert import alert_new_booking
                    alert_new_booking(order_id=order_id)
                if kind == 'subscription' and outcome in ('paid', 'already_paid'):
                    from portal.routes.Subscription.subscription import activate_paid_subscription
                    activate_paid_subscription(order_id)

                # The Razorpay handler notified the student here; keep that.
                # Only on a first transition, so a gateway retry does not send
                # the same confirmation three times.
                if outcome == 'paid':
                    who = db.session.execute(text(
                        "SELECT student_id FROM payment_orders WHERE id = :i"
                    ), {'i': order_id}).scalar()
                    if who:
                        _notify(who, 'Payment Confirmed!',
                                'Your payment went through. You are all set.',
                                kind, order_id)
                    _track('payment_captured', kind, order_id, who, order_no, None)

                # The hold lapsed and someone else took the seat while this
                # payment was in flight. The money is already captured, so the
                # only correct action is to give it back.
                if outcome == 'slot_taken_refund_required':
                    # The hold lapsed and someone else took the seat while this
                    # payment was in flight. The money is already captured and
                    # we cannot deliver, so give it back here rather than
                    # leaving a log line for someone to find later.
                    logger.error(
                        f"Cashfree: order {order_no} paid but seat gone — refunding")
                    try:
                        from portal.helpers.reconcile import _refund
                        gross = db.session.execute(text(
                            "SELECT gross FROM payment_orders WHERE id = :i"
                        ), {'i': order_id}).scalar()
                        _refund(order_id, order_no, gross)
                    except Exception as re:
                        # Never let a refund failure turn into a non-2xx: the
                        # gateway would retry the whole webhook, and the payment
                        # itself was applied correctly. The reconciler retries
                        # the refund on its next pass.
                        logger.error(
                            f"Cashfree: auto-refund failed for {order_no}: {re}")

            elif event_type in ('PAYMENT_FAILED_WEBHOOK', 'PAYMENT_USER_DROPPED_WEBHOOK',
                                'PAYMENT_FAILED', 'PAYMENT_USER_DROPPED'):
                # Do not release the hold here. expire_payment_holds owns that,
                # and letting a 'dropped' event free a seat would race a student
                # who retried and is mid-payment on the same order.
                db.session.execute(text(
                    "UPDATE payment_orders SET status = 'failed', "
                    "failure_reason = :r, updated_at = UTC_TIMESTAMP() "
                    "WHERE id = :i AND status IN ('created','pending')"
                ), {'r': event_type, 'i': order_id})
                db.session.commit()
                logger.info(f"Cashfree webhook: order {order_no} marked failed ({event_type})")

            elif event_type in ('REFUND_STATUS_WEBHOOK', 'REFUND_STATUS'):
                # Record gateway refund status; money already moved in issue_refund.
                refund_id = (payload.get('data') or {}).get('refund') or {}
                if isinstance(refund_id, dict):
                    key = refund_id.get('refund_id') or refund_id.get('cf_refund_id')
                    st = (refund_id.get('refund_status') or '').lower()
                else:
                    key, st = None, ''
                if key:
                    mapped = 'succeeded' if st in ('success', 'succeeded', 'completed') else (
                        'failed' if st in ('failed', 'cancelled') else 'pending')
                    # The bank reference (ARN / UTR) feeds the student's refund
                    # tracker (feature-updates.md §15).
                    arn = refund_id.get('refund_arn') or refund_id.get('arn') or refund_id.get('refund_utr')
                    db.session.execute(text(
                        "UPDATE refunds SET status = :s, arn = IFNULL(:arn, arn), updated_at = UTC_TIMESTAMP() "
                        " WHERE refund_key = :k OR gateway_refund_id = :k"
                    ), {'s': mapped, 'k': str(key), 'arn': str(arn)[:80] if arn else None})
                    db.session.commit()
                logger.info("Cashfree refund webhook: key=%s status=%s", key, st)

            elif str(event_type or '').upper().startswith('DISPUTE'):
                # Chargebacks (§15): lock, then restore or treat as refunded.
                from portal.helpers.chargebacks import apply_dispute
                apply_dispute(order_id, data.get('dispute') if isinstance(data.get('dispute'), dict) else data,
                              event_type)
                db.session.commit()

            else:
                logger.info(f"Cashfree webhook: unhandled event {event_type}")

            evt.processed = True
            evt.processed_at = datetime.utcnow()
            db.session.commit()

            return {'status': 'ok'}, 200

        except Exception as e:
            db.session.rollback()
            logger.error(f"Cashfree webhook processing error: {e}")
            error_id = capture_error(e)
            # 500 makes Cashfree retry, which is what we want for a transient
            # fault — the dedupe above stops the retry double-applying.
            return {'error': 'Internal error', 'error_id': error_id}, 500
