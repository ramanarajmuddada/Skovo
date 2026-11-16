from portal.helpers.error_capture import capture_error
import uuid
import json
from flask import jsonify, request
from flask_restx import Resource, reqparse
from flask_jwt_extended import jwt_required, get_jwt_identity
from portal.helpers.sp import call_proc, call_proc_one
from portal.models import db
from . import ns, logger

list_parser = reqparse.RequestParser()
list_parser.add_argument('search', type=str, location='args', required=False, help='Search by name or city')
list_parser.add_argument('category', type=str, location='args', required=False,
                         help='JEE|NEET|Coding|Skill Dev|Language|Finance|Design|Management')
list_parser.add_argument('city', type=str, location='args', required=False)
list_parser.add_argument('page', type=int, location='args', default=1)
list_parser.add_argument('per_page', type=int, location='args', default=10)


def _as_list(v):
    if isinstance(v, str):
        try:
            return json.loads(v)
        except Exception:
            return []
    return v or []


def _pages(total, per_page):
    return (total + per_page - 1) // per_page if per_page else 1


@ns.route('/')
class CoachingCentreList(Resource):
    @ns.doc(description='Browse coaching & skill centres. Filter by category and city.')
    @jwt_required()
    def get(self):
        try:
            args = list_parser.parse_args()
            page, per = max(1, args['page']), max(1, args['per_page'])
            search, cat, city = args.get('search'), args.get('category'), args.get('city')

            total = (call_proc_one('sp_coaching_count', search, cat, city) or {}).get('total', 0)
            rows = call_proc('sp_coaching_list', search, cat, city, per, (page - 1) * per)
            result = [{
                'id': c.get('id'), 'name': c.get('name'), 'description': c.get('description'),
                'city': c.get('city'), 'state': c.get('state'), 'categories': _as_list(c.get('categories')),
                'discount_info': c.get('discount_info'), 'discount_percent': c.get('discount_percent'),
                'logo_url': c.get('logo_url'), 'website_url': c.get('website_url'),
                'contact_phone': c.get('contact_phone'), 'contact_email': c.get('contact_email'),
                'is_verified': bool(c.get('is_verified')),
            } for c in rows]

            return jsonify(response={'centres': result},
                           pagination={'total': total, 'page': page, 'pages': _pages(total, per)},
                           status=200, bool=True)
        except Exception as e:
            logger.error(f"Error in GET /coaching-centres: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/<string:centre_id>')
class CoachingCentreDetail(Resource):
    @ns.doc(description='Get full details of a coaching centre.')
    @jwt_required()
    def get(self, centre_id):
        try:
            c = call_proc_one('sp_coaching_get', centre_id)
            if not c:
                return jsonify(response={'message': 'Centre not found.'}, status=404, bool=False)
            return jsonify(response={
                'id': c.get('id'), 'name': c.get('name'), 'description': c.get('description'),
                'city': c.get('city'), 'state': c.get('state'), 'address': c.get('address'),
                'categories': _as_list(c.get('categories')),
                'discount_info': c.get('discount_info'), 'discount_percent': c.get('discount_percent'),
                'logo_url': c.get('logo_url'), 'banner_url': c.get('banner_url'),
                'website_url': c.get('website_url'), 'contact_phone': c.get('contact_phone'),
                'contact_email': c.get('contact_email'), 'is_verified': bool(c.get('is_verified')),
            }, status=200, bool=True)
        except Exception as e:
            logger.error(f"Error in GET /coaching-centres/{centre_id}: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/enquire')
class CoachingEnquire(Resource):
    @ns.doc(description='Submit an enquiry for a coaching centre.')
    @jwt_required()
    def post(self):
        try:
            user_id = get_jwt_identity()
            data = request.get_json() or {}
            centre_id     = data.get('centre_id', '')
            student_name  = data.get('student_name', '')
            student_email = data.get('student_email', '')
            message       = data.get('message', '')

            if not centre_id or not student_name or not student_email:
                return jsonify(response={'message': 'centre_id, student_name and student_email are required.'}, status=400, bool=False)

            res = call_proc_one('sp_coaching_enquire', str(uuid.uuid4()), user_id, centre_id,
                                student_name, student_email, message)
            db.session.commit()
            if not res or res.get('result') == 'notfound':
                return jsonify(response={'message': 'Centre not found.'}, status=404, bool=False)
            name = res.get('centre_name')
            return jsonify(response={'message': f'Enquiry sent to {name}. They will contact you at {student_email}.'},
                           status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in POST /coaching-centres/enquire: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)
