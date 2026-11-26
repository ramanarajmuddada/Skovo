from portal.helpers.error_capture import capture_error
from flask import jsonify, request
from flask_restx import Resource, reqparse
from flask_jwt_extended import jwt_required, get_jwt, get_jwt_identity
from portal.models import db
from portal.helpers.sp import call_proc, call_proc_one
from portal.helpers.helpers import serialize_datetime
from . import ns, logger
from portal.helpers.admin_auth import can, AREA_CONTENT
from portal.helpers.audit import log_audit
import datetime

list_parser = reqparse.RequestParser()
list_parser.add_argument('page',           type=int, location='args', default=1)
list_parser.add_argument('per_page',       type=int, location='args', default=25)
list_parser.add_argument('search',         type=str, location='args', required=False)
list_parser.add_argument('payment_status', type=str, location='args', required=False)

update_parser = reqparse.RequestParser()
update_parser.add_argument('attended',       type=bool, location='json', required=False)

def _row_dict(r):
    return {
        'id': r.get('id'),
        'user_id': r.get('user_id'),
        'user_name': 'Deleted student' if r.get('user_gone') else r.get('user_name'),
        'user_email': None if r.get('user_gone') else r.get('user_email'),
        'user_deleted': bool(r.get('user_gone')),
        'cohort_id': r.get('cohort_id'),
        'cohort_title': 'Deleted cohort' if r.get('cohort_gone') and not r.get('cohort_title') else r.get('cohort_title'),
        'cohort_deleted': bool(r.get('cohort_gone')),
        'cohort_status': r.get('cohort_status'),
        'payment_status': r.get('payment_status'),
        'payment_order_id': r.get('payment_order_id'),
        'payment_id': r.get('payment_id'),
        'amount_paid': float(r.get('amount_paid') or 0),
        'attended': bool(r.get('attended')),
        'session_date': serialize_datetime(r.get('session_date')),
        'enrolled_at': serialize_datetime(r.get('enrolled_at') or r.get('created_at')),
    }


@ns.route('/bookings')
class AdminBookingList(Resource):
    @ns.doc(description='Admin: list all bookings with optional search and payment_status filter.')
    @jwt_required()
    def get(self):
        try:
            claims = get_jwt()
            if not can(AREA_CONTENT):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)

            args = list_parser.parse_args()

            # ── SP: sp_admin_bookings_page — search, status and paging in MySQL.
            # LEFT JOINs: a booking stays visible after its student or cohort is gone.
            per_page = max(1, min(int(args['per_page'] or 25), 100))
            page = max(1, int(args['page'] or 1))
            rows = call_proc('sp_admin_bookings_page', (args.get('search') or '')[:100],
                             (args.get('payment_status') or '')[:20], per_page, (page - 1) * per_page) or []
            total = int(rows[0]['total_rows']) if rows else 0
            total_revenue = float(rows[0]['total_revenue'] or 0) if rows else 0.0
            pages = (total + per_page - 1) // per_page if total else 1
            result = [_row_dict(r) for r in rows]

            return jsonify(
                response={'bookings': result, 'total_revenue': round(total_revenue, 2)},
                pagination={
                    'total': total,
                    'pages': pages,
                    'page': page,
                },
                status=200,
                bool=True,
            )

        except Exception as e:
            logger.error(f"Error in GET /admin/bookings: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

@ns.route('/bookings/<string:enrollment_id>')
class AdminBookingDetail(Resource):
    @ns.doc(description='Admin: update attended flag or payment_status for a booking.')
    @jwt_required()
    def patch(self, enrollment_id):
        try:
            claims = get_jwt()
            if not can(AREA_CONTENT):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)

            # ── SP: sp_cohort_enrollments_get + _update (full replace) ────────
            enr = call_proc_one('sp_cohort_enrollments_get', enrollment_id)
            if not enr:
                return jsonify(response={'message': 'Booking not found.'}, status=404, bool=False)

            body = request.get_json(silent=True) or {}
            if 'payment_status' in body:
                return jsonify(response={'message': 'Payment status changes only with a real payment or refund.'},
                               status=400, bool=False)
            args = update_parser.parse_args(strict=False)
            if args.get('attended') is None:
                return jsonify(response={'message': 'Nothing to change.'}, status=400, bool=False)
            attended = bool(args['attended'])
            payment_status = enr.get('payment_status')

            admin_id = get_jwt_identity()
            call_proc_one(
                'sp_cohort_enrollments_update',
                enrollment_id, enr.get('user_id'), enr.get('cohort_id'), payment_status,
                enr.get('payment_order_id'), enr.get('payment_id'), enr.get('amount_paid'),
                enr.get('platform_fee'), enr.get('achiever_earning'), 1 if attended else 0,
                enr.get('coupon_code'), enr.get('discount_amount'), enr.get('created_by'), admin_id,
            )
            log_audit('booking_attendance', 'cohort_enrollments', enrollment_id, admin_id,
                      {'attended': attended, 'was': bool(enr.get('attended'))})
            db.session.commit()

            # Score signal: verified cohort check-in (+2 per cohort). Fires only
            # on the transition into attended, and the per_item cap on the
            # cohort id keeps a re-save from paying twice.
            if attended and not enr.get('attended'):
                from portal.helpers import score
                score.award_cohort_attendance(enr.get('user_id'),
                                              enr.get('cohort_id'))
                db.session.commit()
                from portal.helpers.referral_rewards import evaluate_friend
                evaluate_friend(enr.get('user_id'))

            return jsonify(response={'message': 'Booking updated.'}, status=200, bool=True)

        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in PATCH /admin/bookings/{enrollment_id}: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @ns.doc(description='Admin: cancel/refund a booking and decrement filled_seats.')
    @jwt_required()
    def delete(self, enrollment_id):
        try:
            # v1: admin does not cancel bookings or sessions. The student cancels
            # (admin's cancellation rules) or the achiever cancels (100% back);
            # anything else is fixed from Wallet > Lookup > Add money to wallet.
            return jsonify(response={'message': 'Admin cannot cancel bookings in v1. Use Wallet > Lookup to refund a student.'},
                           status=403, bool=False)
            claims = get_jwt()
            if not can(AREA_CONTENT):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)

            # ── SP: sp_cohort_enrollments_get + _update, sp_cohorts_get + _update ─
            enr = call_proc_one('sp_cohort_enrollments_get', enrollment_id)
            if not enr:
                return jsonify(response={'message': 'Booking not found.'}, status=404, bool=False)

            old_status = enr.get('payment_status')
            if old_status not in ('paid', 'free', 'pending'):
                return jsonify(response={'message': 'Booking already cancelled or refunded.'}, status=400, bool=False)

            admin_id = get_jwt_identity()
            from portal.helpers.refunds import choice_from
            destination, reason_code, reason_text = choice_from(request.get_json(silent=True))
            amt = float(enr.get('amount_paid') or 0)

            # Refunding a class that already happened is a judgement call, so it
            # needs a written reason the audit log keeps.
            cohort = call_proc_one('sp_cohorts_get', enr.get('cohort_id')) or {}
            started = cohort.get('session_date')
            if (old_status == 'paid' and amt > 0 and started and started <= datetime.datetime.utcnow()
                    and not reason_text):
                return jsonify(response={'message': 'This cohort has already started. Add a reason to refund it.',
                                         'needs_reason': True}, status=400, bool=False)

            if old_status == 'paid':
                from portal.helpers.refunds import issue_refund
                oid = enr.get('payment_order_id')
                if oid and amt > 0:
                    ok, info = issue_refund(
                        oid, amt, 'admin cancelled booking',
                        actor_id=admin_id,
                        refund_key='rf-%s-a' % str(oid)[:24],
                        destination=destination, case_key='admin_cancel',
                        reason_code=reason_code, reason_text=reason_text,
                    )
                    if not ok:
                        return jsonify(response={
                            'message': 'Refund could not be issued. Booking is unchanged.',
                        }, status=502, bool=False)

            result = call_proc_one(
                'sp_student_cohort_booking_cancel', enrollment_id, None, 1,
            )
            if not result or not result.get('ok'):
                message = (result or {}).get('message') or 'Could not cancel booking.'
                return jsonify(response={'message': message}, status=400, bool=False)

            log_audit('booking_cancelled', 'cohort_enrollments', enrollment_id, admin_id,
                      {'was': old_status, 'refund': amt if old_status == 'paid' else 0,
                       'refund_to': destination if old_status == 'paid' else None,
                       'reason_code': reason_code, 'reason': reason_text})
            db.session.commit()
            return jsonify(response={'message': 'Booking cancelled.' + (
                f' ₹{amt:g} refunded to the {"wallet" if destination == "wallet" else "original payment"}.'
                if old_status == 'paid' and amt > 0 else '')}, status=200, bool=True)

        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in DELETE /admin/bookings/{enrollment_id}: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


def _session_dict(r):
    return {
        'id': r.get('id'),
        'status': r.get('status'),
        'payment_status': r.get('payment_status'),
        'amount': float(r.get('amount') or 0),
        'no_show': bool(r.get('no_show')),
        'note': r.get('note'),
        'starts_at': serialize_datetime(r.get('starts_at')),
        'created_at': serialize_datetime(r.get('created_at')),
        'cancelled_at': serialize_datetime(r.get('cancelled_at')),
        'student_id': r.get('student_id'),
        'student_name': 'Deleted student' if r.get('student_gone') else r.get('student_name'),
        'student_email': None if r.get('student_gone') else r.get('student_email'),
        'student_deleted': bool(r.get('student_gone')),
        'mentor_id': r.get('mentor_id'),
        'mentor_name': 'Deleted mentor' if r.get('mentor_gone') else r.get('mentor_name'),
        'mentor_deleted': bool(r.get('mentor_gone')),
    }


@ns.route('/bookings/sessions')
class AdminSessionList(Resource):
    @ns.doc(description='Admin: 1-on-1 mentor sessions, searchable and paged.')
    @jwt_required()
    def get(self):
        try:
            if not can(AREA_CONTENT):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
            args = request.args
            per_page = max(1, min(int(args.get('per_page') or 25), 100))
            page = max(1, int(args.get('page') or 1))
            rows = call_proc('sp_admin_sessions_page', (args.get('search') or '')[:100],
                             (args.get('status') or '')[:20], per_page, (page - 1) * per_page) or []
            total = int(rows[0]['total_rows']) if rows else 0
            return jsonify(
                response={'sessions': [_session_dict(r) for r in rows],
                          'total_revenue': round(float(rows[0]['total_revenue'] or 0), 2) if rows else 0},
                pagination={'total': total, 'page': page, 'pages': (total + per_page - 1) // per_page if total else 1},
                status=200, bool=True)
        except Exception as e:
            logger.error(f"Error in GET /admin/bookings/sessions: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/bookings/sessions/<string:session_id>')
class AdminSessionDetail(Resource):
    @ns.doc(description='Admin: what happened in a 1-on-1 (Start, End, missed, paid).')
    @jwt_required()
    def get(self, session_id):
        try:
            if not can(AREA_CONTENT):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
            from portal.helpers import class_rules as CR
            s = call_proc_one('sp_session_with_times', session_id)
            if not s:
                return jsonify(response={'message': 'Session not found.'}, status=404, bool=False)
            return jsonify(response={'timeline': CR.timeline(s, s.get('start_utc'), s.get('duration_minutes'))},
                           status=200, bool=True)
        except Exception as e:
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @ns.doc(description='Admin: cancel a 1-on-1 session; a paid one is refunded in full (provider-side rules).')
    @jwt_required()
    def delete(self, session_id):
        try:
            # v1: admin does not cancel bookings or sessions. The student cancels
            # (admin's cancellation rules) or the achiever cancels (100% back);
            # anything else is fixed from Wallet > Lookup > Add money to wallet.
            return jsonify(response={'message': 'Admin cannot cancel bookings in v1. Use Wallet > Lookup to refund a student.'},
                           status=403, bool=False)
            if not can(AREA_CONTENT):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
            admin_id = get_jwt_identity()
            from portal.helpers.refunds import choice_from, issue_refund
            destination, reason_code, reason_text = choice_from(request.get_json(silent=True))
            # Admin cancels on the platform's side: the same quote a mentor
            # cancelling gets (full refund), never the student's late-cancel tiers.
            quote = call_proc_one('sp_refund_preview_session', session_id, None, 'achiever') or {}
            if not quote.get('ok'):
                return jsonify(response={'message': quote.get('message') or 'Session not found.'}, status=400, bool=False)
            refund_amt = float(quote.get('refund') or 0)
            hours = float(quote.get('hours_until') or 0)
            if quote.get('old_status') == 'paid' and refund_amt > 0 and hours < 0 and not reason_text:
                return jsonify(response={'message': 'This session time has passed. Add a reason to refund it.',
                                         'needs_reason': True}, status=400, bool=False)
            if quote.get('old_status') == 'paid' and quote.get('order_id') and refund_amt > 0:
                ok, info = issue_refund(
                    quote['order_id'], refund_amt, 'admin cancelled 1-on-1 session', actor_id=admin_id,
                    refund_key='rf-%s-a' % str(quote['order_id'])[:24],
                    destination=destination, case_key='admin_cancel',
                    reason_code=reason_code, reason_text=reason_text)
                if not ok:
                    return jsonify(response={'message': 'Refund could not be issued. Session is unchanged.'},
                                   status=502, bool=False)
            result = call_proc_one('sp_student_session_cancel', session_id, None, 1)
            if not result or not result.get('ok'):
                db.session.rollback()
                return jsonify(response={'message': (result or {}).get('message') or 'Could not cancel.'},
                               status=400, bool=False)
            log_audit('session_cancelled', 'achiever_sessions', session_id, admin_id,
                      {'was': quote.get('old_status'), 'refund': refund_amt,
                       'refund_to': destination if refund_amt > 0 else None,
                       'reason_code': reason_code, 'reason': reason_text})
            db.session.commit()
            return jsonify(response={'message': 'Session cancelled.' + (
                f' ₹{refund_amt:g} refunded to the {"wallet" if destination == "wallet" else "original payment"}.'
                if refund_amt > 0 else '')}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in DELETE /admin/bookings/sessions/{session_id}: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)
