import math
import types
from portal.helpers.error_capture import capture_error
from flask import jsonify, request
from flask_restx import Resource, reqparse
from flask_jwt_extended import jwt_required, get_jwt_identity
import datetime
from portal.helpers.video import sanitize_meeting_link
from portal.models import db
from portal.helpers.sp import call_proc, call_proc_one
from portal.helpers.helpers import serialize_datetime, effective_cohort_status
from . import ns, logger

list_parser = reqparse.RequestParser()
list_parser.add_argument('page', type=int, location='args', default=1)
list_parser.add_argument('per_page', type=int, location='args', default=12)
list_parser.add_argument('payment_status', type=str, location='args', required=False)
list_parser.add_argument('class_status', type=str, location='args', required=False)
list_parser.add_argument('date_from', type=str, location='args', required=False)  # YYYY-MM-DD, IST
list_parser.add_argument('date_to', type=str, location='args', required=False)


def _effective_status(cohort):
    """Real-time status (upcoming/live/completed) computed from session_date +
    duration — the DB column only flips when the 60s scheduler runs, so raw
    `status` can lag (or never change in dev where the scheduler is off)."""
    return effective_cohort_status(types.SimpleNamespace(
        status=cohort.get('status'), session_date=cohort.get('session_date'),
        duration_minutes=cohort.get('duration_minutes'),
    ))


def _cohort_can_join(cohort, eff_status):
    """Joinable while live, or from 15 min before start — mirrors CohortDetail."""
    if eff_status == 'live':
        return True
    if eff_status == 'upcoming' and cohort.get('session_date'):
        return cohort['session_date'] <= datetime.datetime.utcnow() + datetime.timedelta(minutes=15)
    return False


def _booking_dict(enr, cohort, achiever):
    from portal.helpers import class_rules as CR
    from portal.routes.AchieverReviews.achiever_reviews import cohort_review_allowed
    confirmed  = enr.get('payment_status') in ('paid', 'free')
    eff_status = _effective_status(cohort)
    cls        = CR.state(cohort, cohort.get('session_date'), cohort.get('duration_minutes'), eff_status)
    # Under the class rules the link opens only once the achiever has started.
    can_join   = confirmed and _cohort_can_join(cohort, eff_status) and cls['started']
    return {
        'id': enr['id'],
        'cohort_id': cohort['id'],
        'cohort_title': cohort.get('title'),
        'cohort_status': eff_status,
        'payment_status': enr.get('payment_status'),
        'payment_order_id': enr.get('payment_order_id'),
        'payment_id': enr.get('payment_id'),
        'amount_paid': float(enr.get('amount_paid') or 0),
        'attended': enr.get('attended'),
        'can_review': cohort_review_allowed(cohort, enr),
        'achiever_id': cohort.get('achiever_id'),
        'session_date': serialize_datetime(cohort.get('session_date')),
        'duration_minutes': cohort.get('duration_minutes'),
        'is_live': eff_status == 'live',
        'can_join': can_join,
        'class': cls,
        'rescheduled': bool(cohort.get('rescheduled_at') and enr.get('enrolled_at')
                            and cohort['rescheduled_at'] > enr['enrolled_at']),
        'can_report': bool(cls['rules'] and eff_status == 'completed' and enr.get('payment_status') == 'paid'
                           and CR.complaint_open(cohort)),
        # Surface the join link only inside the joinable window — not all day.
        'meeting_link': (sanitize_meeting_link(cohort.get('meeting_link')) or None) if can_join else None,
        'enrolled_at': serialize_datetime(enr.get('enrolled_at') or enr.get('created_at')),
        'achiever': {
            'full_name': achiever.get('full_name'),
            'designation': achiever.get('designation'),
            'avatar_url': achiever.get('avatar_url'),
        } if achiever else None,
    }


@ns.route('/')
class BookingList(Resource):
    @ns.doc(description='List all cohort enrollments (bookings) for the current student.')
    @jwt_required()
    def get(self):
        try:
            user_id = get_jwt_identity()
            args = list_parser.parse_args()

            # ── SP: sp_cohort_enrollments_list, sp_cohorts_list, sp_achievers_list
            # — no by-user-id filter on the generic CRUD proc, so pull bounded
            # batches and join/filter in Python. ────────────────────────────────
            all_enrollments = call_proc('sp_cohort_enrollments_list', 50000, 0)
            enrollments = [e for e in all_enrollments if e.get('user_id') == user_id]

            if args.get('payment_status'):
                enrollments = [e for e in enrollments if e.get('payment_status') == args['payment_status']]

            enrollments.sort(key=lambda e: e.get('created_at') or datetime.datetime.min, reverse=True)

            cohorts_by_id = {c['id']: c for c in call_proc('sp_cohorts_list', 5000, 0)}
            achievers_by_id = {a['id']: a for a in call_proc('sp_achievers_list', 5000, 0, 0)}

            # Bookings whose cohort no longer exists (deleted) can't be joined/rendered.
            enrollments = [e for e in enrollments if e.get('cohort_id') in cohorts_by_id]
            # Filter by the class's real status (upcoming / live / completed / cancelled).
            if args.get('class_status'):
                enrollments = [e for e in enrollments
                               if _effective_status(cohorts_by_id[e['cohort_id']]) == args['class_status']]

            # Date range on the class day in IST (session_date is stored in UTC).
            if args.get('date_from') or args.get('date_to'):
                _ist = lambda d: (d + datetime.timedelta(minutes=330)).strftime('%Y-%m-%d') if d else ''  # noqa: E731
                _lo, _hi = args.get('date_from') or '0000', args.get('date_to') or '9999'
                enrollments = [e for e in enrollments if cohorts_by_id[e['cohort_id']].get('session_date')
                               and _lo <= _ist(cohorts_by_id[e['cohort_id']]['session_date']) <= _hi]

            total = len(enrollments)
            page = args['page']
            per_page = args['per_page']
            pages = math.ceil(total / per_page) if per_page else 1
            start = (page - 1) * per_page
            page_items = enrollments[start:start + per_page]

            result = []
            for enr in page_items:
                cohort = cohorts_by_id[enr['cohort_id']]
                achiever = achievers_by_id.get(cohort.get('achiever_id')) if cohort.get('achiever_id') else None
                result.append(_booking_dict(enr, cohort, achiever))

            return jsonify(
                response={'bookings': result},
                pagination={
                    'total': total,
                    'pages': pages,
                    'page': page,
                },
                status=200,
                bool=True,
            )

        except Exception as e:
            logger.error(f"Error in GET /bookings/: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/<string:enrollment_id>/refund-preview')
class BookingRefundPreview(Resource):
    @jwt_required()
    def get(self, enrollment_id):
        try:
            user_id = get_jwt_identity()
            quote = call_proc_one('sp_refund_preview_cohort', enrollment_id, user_id, 'student') or {}
            if not quote.get('ok'):
                message = quote.get('message') or 'Booking not found.'
                status = 404 if 'not found' in message.lower() else 400
                return jsonify(response={'message': message}, status=status, bool=False)
            refund = float(quote.get('refund') or 0)
            from portal.helpers.refunds import prorata_amount
            from portal.helpers.wallet import choice_preview
            refund, _p = prorata_amount(enrollment_id, refund)
            if _p:
                quote['tier'] = 'partial'
            _full = _moved_refund(enrollment_id)
            if _full is not None:
                refund, quote['tier'] = _full, 'full'
            return jsonify(response={
                'refund': refund,
                'tier': quote.get('tier') or 'none',
                'hours_until': float(quote.get('hours_until') or 0),
                'text': _refund_text(refund, quote.get('tier')),
                # Wallet choice (feature-updates.md §15): instant + admin bonus.
                **choice_preview(refund, 'student_cancel', quote.get('order_id')),
            }, status=200, bool=True)
        except Exception as e:
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id},
                           status=500, bool=False)


def _refund_text(refund, tier):
    from portal.helpers.refunds import refund_text
    return refund_text(refund)


def _moved_refund(enrollment_id):
    """The achiever moved the class after this student booked: 100% back,
    whatever the cancellation rules say. None when that does not apply."""
    enr = call_proc_one('sp_cohort_enrollments_get', enrollment_id) or {}
    c = call_proc_one('sp_cohorts_get', enr.get('cohort_id')) if enr.get('cohort_id') else None
    if (c and c.get('rescheduled_at') and enr.get('enrolled_at') and c['rescheduled_at'] > enr['enrolled_at']
            and enr.get('payment_status') == 'paid'):
        return float(enr.get('amount_paid') or 0)
    return None


@ns.route('/<string:enrollment_id>/report')
class BookingReport(Resource):
    @ns.doc(description='Student: report a problem with a class that ended (within the complaint window).')
    @jwt_required()
    def post(self, enrollment_id):
        try:
            from portal.helpers import class_rules as CR
            user_id = get_jwt_identity()
            enr = call_proc_one('sp_cohort_enrollments_get', enrollment_id)
            if not enr or enr.get('user_id') != user_id:
                return jsonify(response={'message': 'Booking not found.'}, status=404, bool=False)
            c = call_proc_one('sp_cohorts_get', enr.get('cohort_id')) or {}
            if enr.get('payment_status') != 'paid' or not CR.complaint_open(c):
                return jsonify(response={'message': 'This class can no longer be reported here. Use Help & support.'},
                               status=400, bool=False)
            reason = ((request.get_json(silent=True) or {}).get('reason') or '').strip()[:1000]
            if len(reason) < 5:
                return jsonify(response={'message': 'Tell us what went wrong.'}, status=400, bool=False)
            call_proc_one('sp_class_issue_add', 'student_report', 'cohort', c['id'], enrollment_id,
                          c.get('achiever_id'), user_id, reason, 'open')
            db.session.commit()
            return jsonify(response={'message': "Thanks. An admin will check it. The achiever's payment for your seat is on hold until then."},
                           status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id},
                           status=500, bool=False)


@ns.route('/refund-rules')
class StudentRefundRules(Resource):
    @ns.doc(description='Cancellation rules shown before paying: ?kind=cohort|session')
    def get(self):
        try:
            from portal.helpers.refunds import student_rules
            kind = 'session' if request.args.get('kind') == 'session' else 'cohort'
            rules = student_rules(kind)
            db.session.commit()
            return jsonify(response={'kind': kind, 'rules': rules}, status=200, bool=True)
        except Exception as e:
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id},
                           status=500, bool=False)


@ns.route('/<string:enrollment_id>/cancel')
class BookingCancel(Resource):
    @ns.doc(description='Cancel a booking. Gateway refund first; ledger only on success.')
    @jwt_required()
    def post(self, enrollment_id):
        try:
            user_id = get_jwt_identity()

            quote = call_proc_one('sp_refund_preview_cohort', enrollment_id, user_id, 'student') or {}
            if not quote.get('ok'):
                message = quote.get('message') or 'Booking not found.'
                status = 404 if 'not found' in message.lower() else 400
                return jsonify(response={'message': message}, status=status, bool=False)

            refund_amt = float(quote.get('refund') or 0)
            tier = quote.get('tier') or 'none'
            old_status = quote.get('old_status')
            order_id = quote.get('order_id')

            # Pro-rata (feature-updates.md §15) when the cohort has it on.
            from portal.helpers.refunds import issue_refund, choice_from, prorata_amount
            refund_amt, _prorata = prorata_amount(enrollment_id, refund_amt)
            if _prorata:
                tier = 'partial'
            _full = _moved_refund(enrollment_id)
            if _full is not None:
                refund_amt, tier = _full, 'full'
            destination, reason_code, reason_text = choice_from(request.get_json(silent=True))

            if old_status == 'paid' and order_id and refund_amt > 0:
                ok, info = issue_refund(
                    order_id, refund_amt, 'cohort booking cancelled',
                    actor_id=user_id,
                    refund_key='rf-%s-c' % str(order_id)[:24],
                    destination=destination, case_key='student_cancel',
                    reason_code=reason_code, reason_text=reason_text,
                )
                if not ok:
                    return jsonify(response={
                        'message': 'Refund could not be issued. Your booking is unchanged. Try again or contact support.',
                    }, status=502, bool=False)

            result = call_proc_one('sp_student_cohort_booking_cancel', enrollment_id, user_id, 0)
            db.session.commit()

            if not result or not result.get('ok'):
                message = (result or {}).get('message', 'Booking not found.')
                status = 404 if message == 'Booking not found.' else 400
                return jsonify(response={'message': message}, status=status, bool=False)

            enr = call_proc_one('sp_cohort_enrollments_get', enrollment_id)
            cohort = call_proc_one('sp_cohorts_get', enr.get('cohort_id')) if enr and enr.get('cohort_id') else None

            try:
                from portal.helpers.email_template import send_email, simple_email_body
                student = call_proc_one('sp_users_get', user_id)
                if student and student.get('email'):
                    title = cohort.get('title') if cohort else 'your cohort'
                    if old_status == 'paid' and refund_amt > 0:
                        from portal.helpers.refunds import inr
                        heading, msg = 'Booking Cancelled & Refunded', (
                            f"Your enrollment in '{title}' was cancelled. {inr(refund_amt)} "
                            "is back in your SKOVO Wallet, ready for your next booking.")
                    elif old_status == 'paid':
                        heading, msg = 'Booking Cancelled', (
                            f"Your enrollment in '{title}' was cancelled. As per our cancellation policy, "
                            "no refund applies this close to the session.")
                    else:
                        heading, msg = 'Booking Cancelled', f"Your enrollment in '{title}' was cancelled."
                    send_email(student['email'], f"SKOVO — {heading}", simple_email_body(heading, msg))
            except Exception:
                pass

            msg = 'Booking cancelled successfully.'
            if old_status == 'paid':
                from portal.helpers.refunds import inr
                msg = (f'Booking cancelled. {inr(refund_amt)} is back in your SKOVO Wallet.'
                       if refund_amt > 0 else 'Booking cancelled. No refund applies this close to the session.')
            return jsonify(response={'message': msg, 'refund_amount': refund_amt}, status=200, bool=True)

        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in POST /bookings/{enrollment_id}/cancel: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)
