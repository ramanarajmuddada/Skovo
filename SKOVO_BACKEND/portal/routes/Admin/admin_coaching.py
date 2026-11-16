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

def _as_list(v):
    if isinstance(v, str):
        try:
            return json.loads(v)
        except Exception:
            return []
    return v or []

list_parser = reqparse.RequestParser()
list_parser.add_argument('page', type=int, location='args', default=1)
list_parser.add_argument('per_page', type=int, location='args', default=20)
list_parser.add_argument('search', type=str, location='args', required=False)

create_parser = reqparse.RequestParser()
create_parser.add_argument('name', type=str, location='json', required=True)
create_parser.add_argument('description', type=str, location='json', required=False)
create_parser.add_argument('city', type=str, location='json', required=False)
create_parser.add_argument('state', type=str, location='json', required=False)
create_parser.add_argument('address', type=str, location='json', required=False)
create_parser.add_argument('categories', type=list, location='json', required=False)
create_parser.add_argument('logo_url', type=str, location='json', required=False)
create_parser.add_argument('website_url', type=str, location='json', required=False)
create_parser.add_argument('contact_phone', type=str, location='json', required=False)
create_parser.add_argument('contact_email', type=str, location='json', required=False)
create_parser.add_argument('discount_percent', type=str, location='json', required=False)
create_parser.add_argument('discount_info', type=str, location='json', required=False)
create_parser.add_argument('is_verified', type=bool, location='json', required=False)
create_parser.add_argument('is_active', type=bool, location='json', required=False, default=True)

update_parser = reqparse.RequestParser()
update_parser.add_argument('name', type=str, location='json', required=False)
update_parser.add_argument('description', type=str, location='json', required=False)
update_parser.add_argument('city', type=str, location='json', required=False)
update_parser.add_argument('state', type=str, location='json', required=False)
update_parser.add_argument('address', type=str, location='json', required=False)
update_parser.add_argument('categories', type=list, location='json', required=False)
update_parser.add_argument('logo_url', type=str, location='json', required=False)
update_parser.add_argument('website_url', type=str, location='json', required=False)
update_parser.add_argument('contact_phone', type=str, location='json', required=False)
update_parser.add_argument('contact_email', type=str, location='json', required=False)
update_parser.add_argument('discount_percent', type=str, location='json', required=False)
update_parser.add_argument('discount_info', type=str, location='json', required=False)
update_parser.add_argument('is_verified', type=bool, location='json', required=False)
update_parser.add_argument('is_active', type=bool, location='json', required=False)

def _coaching_dict(c):
    if not c:
        return None
    created_at = c.get('created_at')
    return {
        'id': c.get('id'),
        'name': c.get('name'),
        'description': c.get('description'),
        'city': c.get('city'),
        'state': c.get('state'),
        'address': c.get('address'),
        'categories': _as_list(c.get('categories')),
        'logo_url': c.get('logo_url'),
        'website_url': c.get('website_url'),
        'contact_phone': c.get('contact_phone'),
        'contact_email': c.get('contact_email'),
        'discount_percent': c.get('discount_percent'),
        'discount_info': c.get('discount_info'),
        'is_verified': bool(c.get('is_verified')),
        'is_active': bool(c.get('is_active')),
        'created_at': serialize_datetime(created_at) if created_at else None,
    }


def _coaching_sp_args(centre_id, args, existing=None):
    """Build the 19 positional args for sp_coaching_centres_create / _update."""
    existing = existing or {}

    def val(key, caster=lambda x: x):
        if args.get(key) is not None:
            return caster(args[key])
        return existing.get(key)

    def val_json(key):
        if args.get(key) is not None:
            return json.dumps(args[key])
        return existing.get(key)

    is_active = (1 if args['is_active'] else 0) if args.get('is_active') is not None else (1 if existing.get('is_active', True) else 0)
    is_verified = (1 if args['is_verified'] else 0) if args.get('is_verified') is not None else (1 if existing.get('is_verified', False) else 0)

    return [
        centre_id,
        val('name'),
        val('description'),
        val('city'),
        val('state'),
        val('address'),
        val_json('categories') or '[]',
        val('discount_info'),
        val('discount_percent', _int),
        val('logo_url'),
        existing.get('banner_url'),
        val('website_url'),
        val('contact_phone'),
        val('contact_email'),
        is_active,
        is_verified,
    ]


@ns.route('/coaching')
class AdminCoachingList(Resource):
    @ns.doc(description='Admin: paginated list of all coaching centres.')
    @jwt_required()
    def get(self):
        try:
            claims = get_jwt()
            if not can(AREA_CONTENT):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)

            args = list_parser.parse_args()

            # ── SP: sp_coaching_centres_list — no search filter on the generic
            # CRUD proc, so pull a bounded batch and filter here. ────────────
            rows = call_proc('sp_coaching_centres_list', 5000, 0, 0)
            if args.get('search'):
                s = args['search'].lower()
                rows = [c for c in rows if s in (c.get('name') or '').lower() or s in (c.get('city') or '').lower()]

            total = len(rows)
            per_page = args['per_page']
            page = args['page']
            pages = (total + per_page - 1) // per_page if per_page else 1
            start = (page - 1) * per_page
            page_rows = rows[start:start + per_page]

            result = [_coaching_dict(c) for c in page_rows]

            return jsonify(
                response={'coaching_centres': result},
                pagination={'total': total, 'pages': pages, 'page': page, 'per_page': per_page},
                status=200, bool=True
            )
        except Exception as e:
            logger.error(f"Error in GET /admin/coaching: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @ns.doc(description='Admin: create a new coaching centre.')
    @jwt_required()
    def post(self):
        try:
            claims = get_jwt()
            if not can(AREA_CONTENT):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)

            args = create_parser.parse_args()
            admin_id = get_jwt_identity()

            # ── SP: sp_coaching_centres_create ───────────────────────────────
            centre_id = str(uuid.uuid4())
            sp_args = _coaching_sp_args(centre_id, args) + [admin_id, admin_id, None]
            centre = call_proc_one('sp_coaching_centres_create', *sp_args)
            db.session.commit()

            logger.info(f"Admin created coaching centre {centre_id} (via sp_coaching_centres_create)")
            return jsonify(response={'message': 'Coaching centre created.', 'coaching_centre': _coaching_dict(centre)}, status=201, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in POST /admin/coaching: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

@ns.route('/coaching/<string:centre_id>')
class AdminCoachingDetail(Resource):
    @ns.doc(description='Admin: update a coaching centre.')
    @jwt_required()
    def put(self, centre_id):
        try:
            claims = get_jwt()
            if not can(AREA_CONTENT):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)

            # ── SP: sp_coaching_centres_get — existence check + current values,
            # since sp_coaching_centres_update is a full replace. ─────────────
            existing = call_proc_one('sp_coaching_centres_get', centre_id)
            if not existing or existing.get('deleted_at'):
                return jsonify(response={'message': 'Coaching centre not found.'}, status=404, bool=False)

            args = update_parser.parse_args()
            admin_id = get_jwt_identity()

            # Only the fields actually sent — see helpers/partial_update.
            # reqparse fills omitted arguments with None, and this is a full
            # replace, so passing `args` straight through NULLs everything the
            # caller did not resend.
            sp_args = _coaching_sp_args(centre_id, supplied(args), existing) + [existing.get('created_by'), admin_id, None]
            centre = call_proc_one('sp_coaching_centres_update', *sp_args)
            db.session.commit()

            logger.info(f"Admin updated coaching centre {centre_id} (via sp_coaching_centres_update)")
            return jsonify(response={'message': 'Coaching centre updated.', 'coaching_centre': _coaching_dict(centre)}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in PUT /admin/coaching/{centre_id}: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @ns.doc(description='Admin: soft-delete a coaching centre.')
    @jwt_required()
    def delete(self, centre_id):
        try:
            claims = get_jwt()
            if not can(AREA_CONTENT):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)

            # ── SP: sp_coaching_centres_get + sp_coaching_centres_delete (soft) ─
            existing = call_proc_one('sp_coaching_centres_get', centre_id)
            if not existing or existing.get('deleted_at'):
                return jsonify(response={'message': 'Coaching centre not found.'}, status=404, bool=False)

            call_proc('sp_coaching_centres_delete', centre_id)
            db.session.commit()

            logger.info(f"Admin soft-deleted coaching centre {centre_id} (via sp_coaching_centres_delete)")
            return jsonify(response={'message': 'Coaching centre deleted.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in DELETE /admin/coaching/{centre_id}: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)
