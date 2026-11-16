"""
College Reviews — students write reviews, admin moderates
"""
from portal.helpers.error_capture import capture_error
from portal.helpers.helpers import serialize_datetime
import uuid
from flask import jsonify, request
from flask_restx import Resource
from flask_jwt_extended import jwt_required, get_jwt_identity
from portal.models import db
from portal.helpers.sp import call_proc, call_proc_one
from portal.helpers.decorators import require_role
from . import ns, logger

def _dict(r, user_cache):
    user_id = r.get('user_id')
    if user_id not in user_cache:
        # ── SP: sp_users_get ─────────────────────────────────────────────────
        user_cache[user_id] = call_proc_one('sp_users_get', user_id)
    u = user_cache[user_id]
    return {
        'id': r['id'], 'college_id': r.get('college_id'), 'user_id': r.get('user_id'),
        'author_name': u.get('full_name') if u else 'Anonymous',
        'rating': r.get('rating'), 'academics_rating': r.get('academics_rating'),
        'placement_rating': r.get('placement_rating'), 'facilities_rating': r.get('facilities_rating'),
        'campus_life_rating': r.get('campus_life_rating'),
        'review_text': r.get('review_text'), 'pros': r.get('pros'), 'cons': r.get('cons'),
        'is_verified': bool(r.get('is_verified')), 'is_active': bool(r.get('is_active')),
        'created_at': serialize_datetime(r['created_at']) if r.get('created_at') else None,
    }


@ns.route('/<string:college_id>')
class CollegeReviewList(Resource):
    @jwt_required()
    def get(self, college_id):
        try:
            # ── SP: sp_college_reviews_list — no by-college-id filter on the
            # generic CRUD proc, so pull a bounded batch and filter here. ──────
            all_reviews = call_proc('sp_college_reviews_list', 50000, 0, 1)
            reviews = [r for r in all_reviews if r.get('college_id') == college_id]
            reviews.sort(key=lambda r: (r.get('is_verified') or 0, r.get('created_at') or ''), reverse=True)
            avg = sum(r.get('rating') or 0 for r in reviews) / len(reviews) if reviews else 0
            user_cache = {}
            return jsonify(response={
                'reviews': [_dict(r, user_cache) for r in reviews],
                'total': len(reviews),
                'avg_rating': round(avg, 1),
            }, status=200, bool=True)
        except Exception as e:
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @jwt_required()
    def post(self, college_id):
        try:
            user_id = get_jwt_identity()
            # ── SP: sp_college_reviews_list — no by-college-id+user-id lookup
            # proc exists, so pull a bounded batch and check here. ─────────────
            all_reviews = call_proc('sp_college_reviews_list', 50000, 0, 0)
            if any(r.get('college_id') == college_id and r.get('user_id') == user_id for r in all_reviews):
                return jsonify(response={'message': 'You already reviewed this college.'}, status=409, bool=False)
            data = request.get_json() or {}
            if not data.get('rating'):
                return jsonify(response={'message': 'rating required.'}, status=400, bool=False)
            rating = int(data['rating'])
            if not (1 <= rating <= 5):
                return jsonify(response={'message': 'rating must be 1–5.'}, status=400, bool=False)

            # ── SP: sp_college_reviews_create ───────────────────────────────────
            review_id = str(uuid.uuid4())
            call_proc_one(
                'sp_college_reviews_create',
                review_id, college_id, user_id, rating,
                int(data['academics_rating']) if data.get('academics_rating') else None,
                int(data['placement_rating']) if data.get('placement_rating') else None,
                int(data['facilities_rating']) if data.get('facilities_rating') else None,
                int(data['campus_life_rating']) if data.get('campus_life_rating') else None,
                data.get('review_text'), data.get('pros'), data.get('cons'),
                0, 1,
            )
            db.session.commit()
            return jsonify(response={'message': 'Review submitted.', 'id': review_id}, status=201, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/<string:college_id>/<string:review_id>')
class CollegeReviewDetail(Resource):
    @jwt_required()
    def put(self, college_id, review_id):
        try:
            user_id = get_jwt_identity()
            # ── SP: sp_college_reviews_get + _update (full replace) ─────────────
            r = call_proc_one('sp_college_reviews_get', review_id)
            if not r or r.get('college_id') != college_id or r.get('user_id') != user_id:
                return jsonify(response={'message': 'Not found.'}, status=404, bool=False)
            data = request.get_json() or {}

            def field(key, caster=None):
                if key not in data:
                    return r.get(key)
                v = data[key]
                return caster(v) if (caster and v is not None) else v

            call_proc_one(
                'sp_college_reviews_update',
                review_id, r.get('college_id'), r.get('user_id'),
                field('rating', int), field('academics_rating', int), field('placement_rating', int),
                field('facilities_rating', int), field('campus_life_rating', int),
                field('review_text'), field('pros'), field('cons'),
                r.get('is_verified'), r.get('is_active'),
            )
            db.session.commit()
            return jsonify(response={'message': 'Updated.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @jwt_required()
    def delete(self, college_id, review_id):
        try:
            user_id = get_jwt_identity()
            # ── SP: sp_college_reviews_get + _update (soft delete via full replace) ─
            r = call_proc_one('sp_college_reviews_get', review_id)
            if not r or r.get('college_id') != college_id or r.get('user_id') != user_id:
                return jsonify(response={'message': 'Not found.'}, status=404, bool=False)

            call_proc_one(
                'sp_college_reviews_update',
                review_id, r.get('college_id'), r.get('user_id'), r.get('rating'),
                r.get('academics_rating'), r.get('placement_rating'), r.get('facilities_rating'),
                r.get('campus_life_rating'), r.get('review_text'), r.get('pros'), r.get('cons'),
                r.get('is_verified'), 0,
            )
            db.session.commit()
            return jsonify(response={'message': 'Deleted.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


# Admin moderation
from portal.api import api as _api
_admin_ns = _api.namespace('admin', description='Admin Panel')


@_admin_ns.route('/college-reviews/<string:review_id>/verify')
class AdminVerifyReview(Resource):
    @require_role('admin', 'super_admin')
    def post(self, review_id):
        try:
            # ── SP: sp_college_reviews_get + _update (full replace) ─────────────
            r = call_proc_one('sp_college_reviews_get', review_id)
            if not r:
                return jsonify(response={'message': 'Not found.'}, status=404, bool=False)

            call_proc_one(
                'sp_college_reviews_update',
                review_id, r.get('college_id'), r.get('user_id'), r.get('rating'),
                r.get('academics_rating'), r.get('placement_rating'), r.get('facilities_rating'),
                r.get('campus_life_rating'), r.get('review_text'), r.get('pros'), r.get('cons'),
                1, r.get('is_active'),
            )
            db.session.commit()
            return jsonify(response={'message': 'Verified.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)
