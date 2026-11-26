"""
Achiever Reviews — students rate achievers/mentors
"""
from portal.helpers.error_capture import capture_error
import types
import uuid
from flask import jsonify, request
from flask_restx import Resource
from flask_jwt_extended import jwt_required, get_jwt_identity
from portal.models import db
from portal.helpers.sp import call_proc, call_proc_one
from portal.helpers.helpers import effective_cohort_status, serialize_datetime
from . import ns, logger


# What a review may be attached to. Free text before, so a client could invent
# a context and the rows became unfilterable — the cohort feedback screens read
# `context_type == 'cohort'` and would silently miss anything spelled otherwise.
_CONTEXT_TYPES = ('general', 'session', 'cohort')


def _cohort_feedback_guard(user_id, achiever_id, cohort_id):
    """None when this student may rate this cohort, else a ready-to-return body.

    Three things have to hold, and each gets its own message because they are
    different problems with different fixes:

      1. the cohort exists and belongs to the achiever being reviewed,
      2. the student holds a confirmed enrolment in *that* cohort,
      3. the class has actually started.

    (3) is the judgement call. Feedback on a class nobody has attended yet is
    not feedback — and these ratings are what students and admins judge an achiever
    by, so letting them fill up before anyone has taught anything
    would corrupt the one signal that decision rests on. `effective_cohort_status`
    is the same real-time derivation the browse list and the enrol guard use, so
    a student who can see "live" on the card can rate it.
    """
    from flask import jsonify as _jsonify

    if not cohort_id:
        return _jsonify(response={'message': 'Which class is this feedback for?'},
                        status=400, bool=False)

    # ── SP: sp_cohorts_get ───────────────────────────────────────────────────
    cohort = call_proc_one('sp_cohorts_get', cohort_id)
    if not cohort or cohort.get('deleted_at') or cohort.get('achiever_id') != achiever_id:
        # Same 404 whether it is missing or someone else's — a 403 here would
        # confirm the id exists to anyone probing with a valid student token.
        return _jsonify(response={'message': 'Class not found.'}, status=404, bool=False)

    # ── SP: sp_cohort_enrollments_get_by_user_cohort ─────────────────────────
    enrolment = call_proc_one('sp_cohort_enrollments_get_by_user_cohort', user_id, cohort_id)
    if not enrolment or enrolment.get('payment_status') not in ('paid', 'free'):
        return _jsonify(response={'message': 'You can only give feedback on a class you joined.'},
                        status=403, bool=False)
    # The check-in code is the proof of attendance: no code, no review. A
    # cancelled or missed class never ran, so it can't be rated either.
    if cohort.get('status') == 'cancelled' or cohort.get('missed_at'):
        return _jsonify(response={'message': 'This class did not run, so it cannot be rated.'},
                        status=403, bool=False)
    if not enrolment.get('attended'):
        return _jsonify(response={'message': 'Only students who checked in can rate this class.'},
                        status=403, bool=False)

    eff = effective_cohort_status(types.SimpleNamespace(
        status=cohort.get('status'),
        session_date=cohort.get('session_date'),
        duration_minutes=cohort.get('duration_minutes'),
    ))
    if eff == 'cancelled':
        return _jsonify(response={'message': 'This class was cancelled.'}, status=400, bool=False)
    if eff == 'upcoming':
        return _jsonify(response={'message': 'You can leave feedback once the class has started.'},
                        status=400, bool=False)
    return None


def _dict(r, user=None):
    created_at = r.get('created_at')
    return {
        'id': r.get('id'),
        'rating': r.get('rating'),
        'review_text': r.get('review_text'),
        'context_type': r.get('context_type'),
        # Which class the feedback was about. Without it the achiever and admin
        # screens can see a rating but not what it was for.
        'context_id': r.get('context_id'),
        'user_name': user.get('full_name') if user else 'Anonymous',
        'created_at': serialize_datetime(created_at) if created_at else None,
    }


# ── The caller's own reviews ──────────────────────────────────────────────────
# Registered before the dynamic <achiever_id> rule so "mine" is never read as
# an achiever id. Werkzeug prefers the static segment anyway; the ordering is
# here so it stays obvious to the next reader.
#
# Bookings.jsx tracked which sessions had been rated in local state alone, so a
# reload lost it: a student saw "Rate" again on a session they had already
# rated, and re-rating silently overwrote the first score. This is what lets
# the screen know the truth on load.

def _context_title(r):
    """The cohort title a review is about ('' for a 1-on-1 or general review)."""
    if r.get('context_type') != 'cohort' or not r.get('context_id'):
        return ''
    try:
        c = call_proc_one('sp_cohorts_get', r['context_id']) or {}
        return c.get('title') or ''
    except Exception:                                        # noqa: BLE001
        return ''

@ns.route('/mine')
class MyReviews(Resource):

    @jwt_required()
    def get(self):
        """Reviews written by the current user, keyed by what they were about."""
        try:
            user_id = get_jwt_identity()
            # ── SP: sp_achiever_reviews_list — the generic CRUD proc has no
            # by-user filter, so the batch is bounded and filtered here. Same
            # shape as the POST guard above; worth a dedicated proc when
            # review volume justifies it. ─────────────────────────────────────
            rows = call_proc('sp_achiever_reviews_list', 100000, 0, 0)
            mine = [r for r in rows if r.get('user_id') == user_id]
            return jsonify(response={'reviews': [{
                'id':           r.get('id'),
                'achiever_id':  r.get('achiever_id'),
                'rating':       r.get('rating'),
                'review_text':  r.get('review_text'),
                'context_type': r.get('context_type'),
                'context_id':   r.get('context_id'),
                'created_at':   serialize_datetime(r['created_at']) if r.get('created_at') else None,
            } for r in mine]}, status=200, bool=True)
        except Exception as e:
            error_id = capture_error(e)
            logger.error(f"my-reviews failed: {e}")
            return jsonify(response={'message': 'Could not load your reviews.',
                                     'error_id': error_id}, status=500, bool=False)


@ns.route('/<string:achiever_id>')
class AchieverReviewList(Resource):
    @jwt_required()
    def get(self, achiever_id):
        try:
            # ── SP: sp_achiever_reviews_list + sp_users_list ───────────────────
            all_reviews = call_proc('sp_achiever_reviews_list', 5000, 0, 1)
            reviews = [r for r in all_reviews if r.get('achiever_id') == achiever_id]
            reviews.sort(key=lambda r: r.get('created_at') or '', reverse=True)

            all_users = call_proc('sp_users_list', 50000, 0)
            users_by_id = {u['id']: u for u in all_users}

            avg = sum(r['rating'] for r in reviews) / len(reviews) if reviews else 0
            # Who joined each reviewed cohort and who attended, so admin can open
            # a class and see it beside its reviews.
            from sqlalchemy import text as _t
            cohort_ids = sorted({r['context_id'] for r in reviews if r.get('context_type') == 'cohort' and r.get('context_id')})
            roster = {}
            for cid in cohort_ids:
                roster[cid] = [{'user_id': x[0], 'name': x[1], 'attended': bool(x[2])} for x in db.session.execute(_t(
                    "SELECT e.user_id, u.full_name, e.attended FROM cohort_enrollments e "
                    "JOIN users u ON u.id = e.user_id WHERE e.cohort_id = :c "
                    "AND e.payment_status IN ('paid', 'free') ORDER BY u.full_name"), {'c': cid}).fetchall()]
            return jsonify(response={
                'roster': roster,
                # Which cohort / session each review is about, so admin can read
                # them per class instead of one mixed list.
                'reviews': [{**_dict(r, users_by_id.get(r.get('user_id'))),
                             'user_id': r.get('user_id'), 'context_title': _context_title(r)} for r in reviews],
                'avg_rating': round(avg, 1),
                'count': len(reviews),
            }, status=200, bool=True)
        except Exception as e:
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @jwt_required()
    def post(self, achiever_id):
        try:
            user_id = get_jwt_identity()
            data = request.get_json() or {}
            if not data.get('rating'):
                return jsonify(response={'message': 'rating required.'}, status=400, bool=False)
            rating = int(data['rating'])
            if not (1 <= rating <= 5):
                return jsonify(response={'message': 'rating must be 1–5.'}, status=400, bool=False)

            context_type = data.get('context_type') or 'general'
            context_id = data.get('context_id') or None
            review_text = data.get('review_text')

            if context_type not in _CONTEXT_TYPES:
                return jsonify(response={'message': 'Unknown feedback context.'},
                               status=400, bool=False)

            # Only let a student review an achiever they've actually engaged with —
            # a 1-on-1 session or a confirmed cohort enrolment. Without this any
            # authenticated user could post reviews and inflate public ratings.
            #
            # `cohort` is checked against the *specific* cohort in context_id, not
            # merely "has this student ever been in any cohort of this achiever's".
            # The looser check was all that existed, and it let a student enrolled
            # in one class post feedback carrying another class's id — so a rating
            # landed on a session they never sat in, and the achiever could not
            # tell the difference.
            if context_type == 'cohort':
                err = _cohort_feedback_guard(user_id, achiever_id, context_id)
                if err:
                    return err
            else:
                # ── SP: sp_achiever_sessions_list, sp_cohort_enrollments_list,
                # sp_cohorts_list ─
                all_sessions = call_proc('sp_achiever_sessions_list', 200000, 0)
                had_session = any(s.get('mentor_id') == achiever_id and s.get('student_id') == user_id
                                  for s in all_sessions)

                had_cohort = False
                if not had_session:
                    all_enrollments = call_proc('sp_cohort_enrollments_list', 200000, 0)
                    all_cohorts = call_proc('sp_cohorts_list', 5000, 0)
                    cohorts_by_id = {c['id']: c for c in all_cohorts}
                    for e in all_enrollments:
                        if e.get('user_id') != user_id or e.get('payment_status') not in ('paid', 'free'):
                            continue
                        cohort = cohorts_by_id.get(e.get('cohort_id'))
                        if cohort and cohort.get('achiever_id') == achiever_id:
                            had_cohort = True
                            break

                if not (had_session or had_cohort):
                    return jsonify(response={'message': 'You can only review an achiever after a session or cohort with them.'}, status=403, bool=False)

            # ── SP: sp_achiever_reviews_list + _create/_update — update-or-insert:
            # one review per (achiever, user, context_type, context_id). ────────
            all_reviews = call_proc('sp_achiever_reviews_list', 100000, 0, 0)
            existing = next((
                r for r in all_reviews
                if r.get('achiever_id') == achiever_id and r.get('user_id') == user_id
                and r.get('context_type') == context_type and r.get('context_id') == context_id
            ), None)

            if existing:
                r = call_proc_one(
                    'sp_achiever_reviews_update',
                    existing['id'], achiever_id, user_id, rating, review_text, context_type, context_id, 1,
                )
                message = 'Review updated.'
            else:
                r = call_proc_one(
                    'sp_achiever_reviews_create',
                    str(uuid.uuid4()), achiever_id, user_id, rating, review_text, context_type, context_id, 1,
                )
                message = 'Review submitted.'
            db.session.commit()

            user = call_proc_one('sp_users_get', user_id)
            return jsonify(response={'message': message, 'review': _dict(r, user)}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/<string:achiever_id>/<string:review_id>')
class AchieverReviewDetail(Resource):
    @jwt_required()
    def delete(self, achiever_id, review_id):
        try:
            user_id = get_jwt_identity()
            # ── SP: sp_achiever_reviews_get + _update (soft-delete via is_active) ─
            r = call_proc_one('sp_achiever_reviews_get', review_id)
            if not r or r.get('achiever_id') != achiever_id or r.get('user_id') != user_id:
                return jsonify(response={'message': 'Not found.'}, status=404, bool=False)
            call_proc_one(
                'sp_achiever_reviews_update',
                review_id, r.get('achiever_id'), r.get('user_id'), r.get('rating'),
                r.get('review_text'), r.get('context_type'), r.get('context_id'), 0,
            )
            db.session.commit()
            return jsonify(response={'message': 'Deleted.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)
