from portal.helpers.error_capture import capture_error
from portal.helpers.helpers import serialize_datetime
import datetime
from flask import jsonify
from flask_restx import Resource, reqparse
from flask_jwt_extended import jwt_required, get_jwt
from portal.models import db
from portal.helpers.sp import call_proc, call_proc_one
from . import ns, logger
from portal.helpers.admin_auth import can, AREA_MODERATION

list_parser = reqparse.RequestParser()
list_parser.add_argument('page',       type=int,  location='args', default=1)
list_parser.add_argument('per_page',   type=int,  location='args', default=20)
list_parser.add_argument('verified',   type=str,  location='args', required=False)
list_parser.add_argument('college_id', type=str,  location='args', required=False)


def _review_row(r):
    user    = call_proc_one('sp_users_get', r.get('user_id'))
    college = call_proc_one('sp_colleges_get', r.get('college_id'))
    created_at = r.get('created_at')
    return {
        'id':                r.get('id'),
        'college_id':        r.get('college_id'),
        'college_name':      college['name'] if college else 'Unknown',
        'user_id':           r.get('user_id'),
        'author_name':       user['full_name'] if user else 'Anonymous',
        'author_email':      user['email']     if user else None,
        'rating':            r.get('rating'),
        'academics_rating':  r.get('academics_rating'),
        'placement_rating':  r.get('placement_rating'),
        'facilities_rating': r.get('facilities_rating'),
        'campus_life_rating':r.get('campus_life_rating'),
        'review_text':       r.get('review_text'),
        'pros':              r.get('pros'),
        'cons':              r.get('cons'),
        'is_verified':       bool(r.get('is_verified')),
        'is_active':         bool(r.get('is_active')),
        'created_at':        serialize_datetime(created_at) if created_at else None,
    }


@ns.route('/college-reviews')
class AdminCollegeReviewList(Resource):
    @jwt_required()
    def get(self):
        try:
            if not can(AREA_MODERATION):
                return jsonify(response={'message': 'Admin access only.'}, status=403, bool=False)
            args  = list_parser.parse_args()

            # ── SP: sp_college_reviews_list — no college_id/verified filters
            # on the generic CRUD proc, so pull a bounded batch and filter here.
            rows = call_proc('sp_college_reviews_list', 5000, 0, 0)
            if args.get('college_id'):
                rows = [r for r in rows if r.get('college_id') == args['college_id']]
            if args.get('verified') is not None:
                want = args['verified'] == 'true'
                rows = [r for r in rows if bool(r.get('is_verified')) == want]
            rows.sort(key=lambda r: r.get('created_at') or datetime.datetime.min, reverse=True)

            total = len(rows)
            per_page = args['per_page']
            page = args['page']
            pages = (total + per_page - 1) // per_page if per_page else 1
            start = (page - 1) * per_page
            page_rows = rows[start:start + per_page]

            return jsonify(
                response={
                    'reviews': [_review_row(r) for r in page_rows],
                    'total': total,
                },
                pagination={'page': page, 'pages': pages, 'total': total},
                status=200, bool=True
            )
        except Exception as e:
            logger.error(f"AdminCollegeReviewList.get: {e}")
            return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)}, status=500, bool=False)


@ns.route('/college-reviews/<string:review_id>/verify')
class AdminReviewVerify(Resource):
    @jwt_required()
    def post(self, review_id):
        try:
            if not can(AREA_MODERATION):
                return jsonify(response={'message': 'Admin access only.'}, status=403, bool=False)
            # ── SP: sp_college_reviews_get + _update (full replace) ───────────
            r = call_proc_one('sp_college_reviews_get', review_id)
            if not r:
                return jsonify(response={'message': 'Not found.'}, status=404, bool=False)
            new_verified = 0 if r.get('is_verified') else 1
            updated = call_proc_one(
                'sp_college_reviews_update',
                review_id, r['college_id'], r['user_id'], r['rating'], r.get('academics_rating'),
                r.get('placement_rating'), r.get('facilities_rating'), r.get('campus_life_rating'),
                r.get('review_text'), r.get('pros'), r.get('cons'), new_verified, r.get('is_active'),
            )
            db.session.commit()
            return jsonify(response={'message': f"Review {'verified' if new_verified else 'unverified'}.", 'is_verified': bool(new_verified)}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)}, status=500, bool=False)


@ns.route('/college-reviews/<string:review_id>')
class AdminReviewDelete(Resource):
    @jwt_required()
    def delete(self, review_id):
        try:
            if not can(AREA_MODERATION):
                return jsonify(response={'message': 'Admin access only.'}, status=403, bool=False)
            # ── SP: sp_college_reviews_get + _update (soft-hide via is_active) ─
            r = call_proc_one('sp_college_reviews_get', review_id)
            if not r:
                return jsonify(response={'message': 'Not found.'}, status=404, bool=False)
            call_proc_one(
                'sp_college_reviews_update',
                review_id, r['college_id'], r['user_id'], r['rating'], r.get('academics_rating'),
                r.get('placement_rating'), r.get('facilities_rating'), r.get('campus_life_rating'),
                r.get('review_text'), r.get('pros'), r.get('cons'), r.get('is_verified'), 0,
            )
            db.session.commit()
            return jsonify(response={'message': 'Review hidden.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)}, status=500, bool=False)
