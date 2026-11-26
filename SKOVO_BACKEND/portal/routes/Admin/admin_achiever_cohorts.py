"""Admin -- one achiever's cohorts: students, attendance, payments, reviews.

GET /achievers/<achiever_id>/cohorts               every cohort he created, with totals
GET /achievers/<achiever_id>/cohorts/<cohort_id>   who joined, attended or was absent,
                                                   what each paid (coupon, discount) and their review
SQL: database/stored_procedures/achiever_cohorts_admin.sql
"""
from portal.helpers.error_capture import capture_error
from flask import jsonify
from flask_restx import Resource
from flask_jwt_extended import jwt_required
from portal.helpers.sp import call_proc, call_proc_one
from portal.helpers.admin_auth import can, AREA_USERS
from portal.helpers.helpers import serialize_datetime
from . import ns, logger


def _num(v):
    return float(v) if v is not None else 0


def _err(where, e):
    logger.error(f"{where}: {e}")
    return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)}, status=500, bool=False)


def cohort_rows(achiever_id):
    """Every cohort the achiever created, with seats, attendance, money, rating."""
    import types
    from portal.helpers.helpers import effective_cohort_status
    rows = call_proc('sp_admin_achiever_cohorts', achiever_id) or []
    # Classes the achiever never started (class rules): shown as Missed.
    from sqlalchemy import text
    from portal.models import db
    # Also when each class was created, for the "Date by: Created date" filter.
    extra = {m[0]: (m[1], m[2]) for m in db.session.execute(text(
        "SELECT id, missed_at IS NOT NULL, created_at FROM cohorts WHERE achiever_id = :a"),
        {'a': achiever_id}).fetchall()}
    return [{
        'id': r['id'], 'title': r['title'], 'missed': bool((extra.get(r['id']) or (0, None))[0]),
        'created_at': serialize_datetime((extra.get(r['id']) or (0, None))[1]),
        # The clock's view (upcoming / live / completed), not the stored column.
        'status': effective_cohort_status(types.SimpleNamespace(
            status=r.get('status'), session_date=r.get('session_date'),
            duration_minutes=r.get('duration_minutes'))),
        'session_date': serialize_datetime(r['session_date']) if r.get('session_date') else None,
        'duration_minutes': r.get('duration_minutes'), 'price': _num(r.get('price')),
        'is_free': not _num(r.get('price')),
        'total_seats': r.get('total_seats'), 'joined': int(r.get('joined') or 0),
        'attended': int(r.get('attended') or 0), 'collected': _num(r.get('collected')),
        'earned': _num(r.get('earned')),
        'avg_rating': _num(r.get('avg_rating')) if r.get('avg_rating') is not None else None,
        'reviews': int(r.get('reviews') or 0),
    } for r in rows]


def cohort_detail(achiever_id, cohort_id):
    """One cohort: who joined, attended or was absent, what each paid, their review."""
    rows = call_proc('sp_admin_achiever_cohort_students', achiever_id, cohort_id) or []
    students = [{
        'enrollment_id': r.get('enrollment_id'),
        'user_id': r['user_id'], 'name': r['full_name'], 'email': r.get('email'),
        'joined_at': serialize_datetime(r['enrolled_at']) if r.get('enrolled_at') else None,
        'attended': bool(r.get('attended')), 'payment_status': r.get('payment_status'),
        'price': _num(r.get('price')), 'coupon_code': r.get('coupon_code'),
        'discount': _num(r.get('discount_amount')), 'offer': bool(r.get('offer_applied')),
        'paid': _num(r.get('amount_paid')),
        'achiever_earning': _num(r.get('achiever_earning')), 'platform_fee': _num(r.get('platform_fee')),
        'rating': r.get('rating'), 'review_text': r.get('review_text'),
    } for r in rows]
    active = [s for s in students if s['payment_status'] in ('paid', 'free')]
    from portal.helpers import class_rules as CR
    c = call_proc_one('sp_cohorts_get', cohort_id) or {}
    return {'students': students,
            'timeline': CR.timeline(c, c.get('session_date'), c.get('duration_minutes')) if c else None,
            'summary': {
        'joined': len(active), 'attended': sum(1 for s in active if s['attended']),
        'absent': sum(1 for s in active if not s['attended']),
        'reviewed': sum(1 for s in students if s['rating'] is not None),
        'collected': sum(s['paid'] for s in students if s['payment_status'] == 'paid'),
        'refunded': sum(s['paid'] for s in students if s['payment_status'] == 'refunded'),
        'achiever_share': sum(s['achiever_earning'] for s in students if s['payment_status'] == 'paid'),
        'platform_share': sum(s['platform_fee'] for s in students if s['payment_status'] == 'paid'),
    }}


@ns.route('/achievers/<string:achiever_id>/cohorts')
class AdminAchieverCohorts(Resource):
    @jwt_required()
    def get(self, achiever_id):
        try:
            if not can(AREA_USERS):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
            return jsonify(response={'cohorts': cohort_rows(achiever_id)}, status=200, bool=True)
        except Exception as e:
            return _err('GET /admin/achievers/cohorts', e)


@ns.route('/achievers/<string:achiever_id>/cohorts/<string:cohort_id>')
class AdminAchieverCohortDetail(Resource):
    @jwt_required()
    def get(self, achiever_id, cohort_id):
        try:
            if not can(AREA_USERS):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
            return jsonify(response=cohort_detail(achiever_id, cohort_id), status=200, bool=True)
        except Exception as e:
            return _err('GET /admin/achievers/cohort detail', e)


@ns.route('/cohort-bookings')
class AdminCohortBookings(Resource):
    @jwt_required()
    def get(self):
        """Bookings > Cohort bookings: one row per class (students, money, status)."""
        import types
        from flask import request
        from portal.helpers.helpers import effective_cohort_status
        try:
            if not can(AREA_USERS):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
            search = (request.args.get('search') or '').strip()[:120] or None
            status = (request.args.get('status') or '').strip()
            rows = call_proc('sp_admin_cohort_bookings', search) or []
            out = []
            for r in rows:
                st = effective_cohort_status(types.SimpleNamespace(
                    status=r.get('status'), session_date=r.get('session_date'),
                    duration_minutes=r.get('duration_minutes')))
                if status and st != status:
                    continue
                out.append({
                    'id': r['id'], 'title': r['title'], 'status': st,
                    'session_date': serialize_datetime(r['session_date']) if r.get('session_date') else None,
                    'achiever_id': r.get('achiever_id'), 'achiever_name': r.get('achiever_name'),
                    'price': _num(r.get('price')), 'is_free': not _num(r.get('price')),
                    'total_seats': r.get('total_seats'), 'joined': int(r.get('joined') or 0),
                    'attended': int(r.get('attended') or 0), 'collected': _num(r.get('collected')),
                    'earned': _num(r.get('earned')), 'refunded': _num(r.get('refunded')),
                    'avg_rating': _num(r.get('avg_rating')) if r.get('avg_rating') is not None else None,
                    'reviews': int(r.get('reviews') or 0),
                    'deleted': bool(r.get('deleted')), 'gone': bool(r.get('gone')),
                    'bookings': int(r.get('bookings') or 0),
                })
            return jsonify(response={'cohorts': out,
                                     'collected': sum(c['collected'] for c in out)}, status=200, bool=True)
        except Exception as e:
            return _err('GET /admin/cohort-bookings', e)
