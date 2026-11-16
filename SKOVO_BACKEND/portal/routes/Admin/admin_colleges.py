from portal.helpers.error_capture import capture_error
from portal.helpers.helpers import serialize_datetime
from portal.helpers.partial_update import supplied
import json
import uuid
import datetime
from flask import jsonify
from flask_restx import Resource, reqparse
from flask_jwt_extended import jwt_required, get_jwt_identity, get_jwt
from portal.models import db
from portal.helpers.sp import call_proc, call_proc_one
from . import ns, logger
from portal.helpers.admin_auth import can, AREA_CONTENT


def _int(v):
    try:
        return int(v) if v not in (None, '', 'null') else None
    except (ValueError, TypeError):
        return None


def _float(v):
    try:
        return float(v) if v not in (None, '', 'null') else None
    except (ValueError, TypeError):
        return None


list_parser = reqparse.RequestParser()
list_parser.add_argument('page', type=int, location='args', default=1)
list_parser.add_argument('per_page', type=int, location='args', default=20)
list_parser.add_argument('search', type=str, location='args', required=False)

create_parser = reqparse.RequestParser()
create_parser.add_argument('name', type=str, location='json', required=True)
create_parser.add_argument('institution_subdomain', type=str, location='json', required=False)
create_parser.add_argument('type', type=str, location='json', required=False)
create_parser.add_argument('location_city', type=str, location='json', required=False)
create_parser.add_argument('location_state', type=str, location='json', required=False)
create_parser.add_argument('nirf_ranking', type=int, location='json', required=False)
create_parser.add_argument('naac_grade', type=str, location='json', required=False)
create_parser.add_argument('annual_fees_min', type=str,   location='json', required=False)
create_parser.add_argument('annual_fees_max', type=str,   location='json', required=False)
create_parser.add_argument('placement_rate', type=str,   location='json', required=False)
create_parser.add_argument('avg_package', type=str,   location='json', required=False)
create_parser.add_argument('highest_package', type=str,   location='json', required=False)
create_parser.add_argument('website_url', type=str, location='json', required=False)
create_parser.add_argument('logo_url',               type=str,   location='json', required=False)
create_parser.add_argument('banner_url',              type=str,   location='json', required=False)
create_parser.add_argument('about',                   type=str,   location='json', required=False)
create_parser.add_argument('accreditation',           type=str,   location='json', required=False)
create_parser.add_argument('contact_info',            type=str,   location='json', required=False)
create_parser.add_argument('admission_process',       type=str,   location='json', required=False)
create_parser.add_argument('entrance_exams_accepted', type=list,  location='json', required=False)
create_parser.add_argument('hostel_fee',              type=str,   location='json', required=False)
create_parser.add_argument('established_year',        type=str,   location='json', required=False)
create_parser.add_argument('facilities',              type=list,  location='json', required=False)
create_parser.add_argument('top_recruiters',          type=list,  location='json', required=False)
create_parser.add_argument('is_active',               type=bool,  location='json', required=False)

update_parser = reqparse.RequestParser()
update_parser.add_argument('name',                    type=str,   location='json', required=False)
update_parser.add_argument('institution_subdomain',   type=str,   location='json', required=False)
update_parser.add_argument('type',                    type=str,   location='json', required=False)
update_parser.add_argument('location_city',           type=str,   location='json', required=False)
update_parser.add_argument('location_state',          type=str,   location='json', required=False)
update_parser.add_argument('nirf_ranking',            type=str,   location='json', required=False)
update_parser.add_argument('naac_grade',              type=str,   location='json', required=False)
update_parser.add_argument('annual_fees_min',         type=str,   location='json', required=False)
update_parser.add_argument('annual_fees_max',         type=str,   location='json', required=False)
update_parser.add_argument('placement_rate',          type=str,   location='json', required=False)
update_parser.add_argument('avg_package',             type=str,   location='json', required=False)
update_parser.add_argument('highest_package',         type=str,   location='json', required=False)
update_parser.add_argument('website_url',             type=str,   location='json', required=False)
update_parser.add_argument('logo_url',                type=str,   location='json', required=False)
update_parser.add_argument('banner_url',              type=str,   location='json', required=False)
update_parser.add_argument('about',                   type=str,   location='json', required=False)
update_parser.add_argument('accreditation',           type=str,   location='json', required=False)
update_parser.add_argument('contact_info',            type=str,   location='json', required=False)
update_parser.add_argument('admission_process',       type=str,   location='json', required=False)
update_parser.add_argument('entrance_exams_accepted', type=list,  location='json', required=False)
update_parser.add_argument('hostel_fee',              type=str,   location='json', required=False)
update_parser.add_argument('established_year',        type=str,   location='json', required=False)
update_parser.add_argument('facilities',              type=list,  location='json', required=False)
update_parser.add_argument('top_recruiters',          type=list,  location='json', required=False)
update_parser.add_argument('is_active',               type=bool,  location='json', required=False)


def _as_list(v):
    if isinstance(v, str):
        try:
            return json.loads(v)
        except Exception:
            return []
    return v or []


def _college_dict(c):
    """c is a plain dict row, as returned by call_proc/call_proc_one."""
    if not c:
        return None
    created_at = c.get('created_at')
    return {
        'id': c.get('id'), 'name': c.get('name'), 'type': c.get('type'),
        'institution_subdomain': c.get('institution_subdomain'),
        'location_city': c.get('location_city'), 'location_state': c.get('location_state'),
        'nirf_ranking': c.get('nirf_ranking'), 'naac_grade': c.get('naac_grade'),
        'annual_fees_min': c.get('annual_fees_min'), 'annual_fees_max': c.get('annual_fees_max'),
        'placement_rate': c.get('placement_rate'), 'avg_package': c.get('avg_package'),
        'highest_package': c.get('highest_package'), 'website_url': c.get('website_url'),
        'logo_url': c.get('logo_url'), 'banner_url': c.get('banner_url'),
        'about': c.get('about'), 'accreditation': c.get('accreditation'),
        'contact_info': c.get('contact_info'), 'admission_process': c.get('admission_process'),
        'entrance_exams_accepted': _as_list(c.get('entrance_exams_accepted')),
        'hostel_fee': c.get('hostel_fee'), 'established_year': c.get('established_year'),
        'facilities': _as_list(c.get('facilities')), 'top_recruiters': _as_list(c.get('top_recruiters')),
        'is_active': bool(c.get('is_active')),
        'created_at': serialize_datetime(created_at) if created_at else None,
    }


def _val_json(args, existing, key):
    """JSON-column fields: fresh list from `args` needs json.dumps(); a value
    falling back to `existing` (from sp_colleges_get) is already a JSON string."""
    if args.get(key) is not None:
        return json.dumps(args[key])
    return existing.get(key)


def _college_sp_args(college_id, args, existing=None):
    """Build the 31 positional args for sp_colleges_create / sp_colleges_update,
    falling back to `existing` values (a dict from sp_colleges_get) for fields
    not present in a partial update payload."""
    existing = existing or {}

    def val(key, caster=lambda x: x):
        if args.get(key) is not None:
            return caster(args[key])
        return existing.get(key)

    return [
        college_id,
        val('name'),
        (args['institution_subdomain'] or '').strip().lower() or None if args.get('institution_subdomain') is not None else existing.get('institution_subdomain'),
        val('type'),
        val('location_city'),
        val('location_state'),
        val('nirf_ranking', _int),
        val('naac_grade'),
        val('annual_fees_min', _int),
        val('annual_fees_max', _int),
        val('placement_rate', _float),
        val('avg_package', _float),
        val('highest_package', _float),
        val('website_url'),
        val('logo_url'),
        val('banner_url'),
        val('about'),
        val('accreditation'),
        val('contact_info'),
        val('admission_process'),
        _val_json(args, existing, 'entrance_exams_accepted') or '[]',
        val('hostel_fee', _int),
        val('established_year', _int),
        existing.get('total_students'),
        _val_json(args, existing, 'facilities') or '[]',
        _val_json(args, existing, 'top_recruiters') or '[]',
        existing.get('achievements'),
        (1 if args['is_active'] else 0) if args.get('is_active') is not None else (1 if existing.get('is_active', True) else 0),
    ]


@ns.route('/colleges')
class AdminCollegeList(Resource):
    @ns.doc(description='Admin: paginated list of all colleges.')
    @jwt_required()
    def get(self):
        try:
            claims = get_jwt()
            if not can(AREA_CONTENT):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)

            args = list_parser.parse_args()

            # ── SP: sp_colleges_list — no search param on the generic CRUD proc,
            # so pull a bounded batch and filter/paginate here. ────────────────
            rows = call_proc('sp_colleges_list', 5000, 0, 0)
            if args.get('search'):
                s = args['search'].lower()
                rows = [c for c in rows if s in (c.get('name') or '').lower()]

            total = len(rows)
            per_page = args['per_page']
            page = args['page']
            pages = (total + per_page - 1) // per_page if per_page else 1
            start = (page - 1) * per_page
            page_rows = rows[start:start + per_page]

            result = [_college_dict(c) for c in page_rows]

            return jsonify(
                response={'colleges': result},
                pagination={'total': total, 'pages': pages, 'page': page, 'per_page': per_page},
                status=200, bool=True
            )
        except Exception as e:
            logger.error(f"Error in GET /admin/colleges: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @ns.doc(description='Admin: create a new college.')
    @jwt_required()
    def post(self):
        try:
            claims = get_jwt()
            if not can(AREA_CONTENT):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)

            args = create_parser.parse_args()
            admin_id = get_jwt_identity()

            # ── SP: sp_colleges_create ────────────────────────────────────────
            college_id = str(uuid.uuid4())
            sp_args = _college_sp_args(college_id, args) + [admin_id, admin_id, None]
            college = call_proc_one('sp_colleges_create', *sp_args)
            db.session.commit()

            logger.info(f"Admin created college {college_id} (via sp_colleges_create)")
            return jsonify(response={'message': 'College created.', 'college': _college_dict(college)}, status=201, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in POST /admin/colleges: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

@ns.route('/colleges/<string:college_id>')
class AdminCollegeDetail(Resource):
    @ns.doc(description='Admin: update a college.')
    @jwt_required()
    def put(self, college_id):
        try:
            claims = get_jwt()
            if not can(AREA_CONTENT):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)

            # ── SP: sp_colleges_get — existence check + current values, since
            # sp_colleges_update is a full replace (not a partial update). ────
            existing = call_proc_one('sp_colleges_get', college_id)
            if not existing or existing.get('deleted_at'):
                return jsonify(response={'message': 'College not found.'}, status=404, bool=False)

            args = update_parser.parse_args()
            admin_id = get_jwt_identity()

            # Only the fields actually sent — see helpers/partial_update.
            # reqparse fills omitted arguments with None, and this is a full
            # replace, so passing `args` straight through NULLs everything the
            # caller did not resend.
            sp_args = _college_sp_args(college_id, supplied(args), existing) + [existing.get('created_by'), admin_id, None]
            college = call_proc_one('sp_colleges_update', *sp_args)
            db.session.commit()

            logger.info(f"Admin updated college {college_id} (via sp_colleges_update)")
            return jsonify(response={'message': 'College updated.', 'college': _college_dict(college)}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in PUT /admin/colleges/{college_id}: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @ns.doc(description='Admin: soft-delete a college.')
    @jwt_required()
    def delete(self, college_id):
        try:
            claims = get_jwt()
            if not can(AREA_CONTENT):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)

            # ── SP: sp_colleges_get + sp_colleges_delete (soft-delete: sets
            # deleted_at = NOW(), matching the prior ORM behavior). ───────────
            existing = call_proc_one('sp_colleges_get', college_id)
            if not existing or existing.get('deleted_at'):
                return jsonify(response={'message': 'College not found.'}, status=404, bool=False)

            call_proc('sp_colleges_delete', college_id)
            db.session.commit()

            logger.info(f"Admin soft-deleted college {college_id} (via sp_colleges_delete)")
            return jsonify(response={'message': 'College deleted.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in DELETE /admin/colleges/{college_id}: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)
