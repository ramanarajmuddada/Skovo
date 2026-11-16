from portal.helpers.error_capture import capture_error
from portal.helpers.helpers import serialize_datetime
import uuid
from flask import jsonify
from flask_restx import Resource, reqparse
from flask_jwt_extended import jwt_required, get_jwt_identity, get_jwt
from portal.models import db
from portal.helpers.sp import call_proc, call_proc_one
from . import ns, logger
from portal.helpers.admin_auth import can, AREA_OPS

create_parser = reqparse.RequestParser()
create_parser.add_argument('name',        type=str,  location='json', required=True)
create_parser.add_argument('slug',        type=str,  location='json', required=True)
create_parser.add_argument('description', type=str,  location='json', required=False)
create_parser.add_argument('icon_url',    type=str,  location='json', required=False)
create_parser.add_argument('is_active',   type=bool, location='json', required=False, default=True)
create_parser.add_argument('parent_id',   type=str,  location='json', required=False)


def _parent_error(domain_id, parent_id, all_domains):
    """Why `parent_id` cannot be this domain's parent, or None if it can.
    Domains form a tree; a parent that is the domain itself or one of its own
    descendants would make a loop, and the admin screen would recurse forever."""
    if not parent_id:
        return None
    by_id = {x['id']: x for x in all_domains}
    if parent_id not in by_id:
        return 'Parent group not found.'
    node = parent_id
    while node:
        if node == domain_id:
            return 'A domain cannot sit under itself or one of its own sub-domains.'
        node = by_id.get(node, {}).get('parent_id')
    return None

def _domain_dict(d):
    """d is a plain dict row, as returned by call_proc/call_proc_one."""
    if not d:
        return None
    created_at = d.get('created_at')
    return {
        'id':          d.get('id'),
        'name':        d.get('name'),
        'slug':        d.get('slug'),
        'description': d.get('description'),
        'icon_url':    d.get('icon_url'),
        'parent_id':   d.get('parent_id'),
        'is_active':   bool(d.get('is_active')) if d.get('is_active') is not None else True,
        'created_at':  serialize_datetime(created_at) if created_at else None,
    }

@ns.route('/domains')
class AdminDomainList(Resource):
    @ns.doc(description='Admin: list all domains.')
    @jwt_required()
    def get(self):
        try:
            claims = get_jwt()
            if not can(AREA_OPS):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)

            # ── SP: sp_domains_list — high limit since domains are a small,
            # bounded set; re-sorted by name in Python since the SP orders by
            # created_at (matches this screen's prior ordering behavior).
            rows = call_proc('sp_domains_list', 1000, 0, 0)
            result = sorted((_domain_dict(d) for d in rows), key=lambda d: (d['name'] or '').lower())

            return jsonify(response={'domains': result}, status=200, bool=True)
        except Exception as e:
            logger.error(f"Error in GET /admin/domains: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @ns.doc(description='Admin: create a new domain.')
    @jwt_required()
    def post(self):
        try:
            claims = get_jwt()
            if not can(AREA_OPS):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)

            args = create_parser.parse_args()

            # ── SP: sp_domains_list — no UNIQUE constraint on slug in the DB,
            # so the conflict check still needs a lookup (small, bounded table).
            all_domains = call_proc('sp_domains_list', 1000, 0, 0)
            if any(d['slug'] == args['slug'] for d in all_domains):
                return jsonify(response={'message': f'Domain with slug "{args["slug"]}" already exists.'}, status=409, bool=False)

            parent_id = (args.get('parent_id') or '').strip() or None
            err = _parent_error(None, parent_id, all_domains)
            if err:
                return jsonify(response={'message': err}, status=400, bool=False)

            admin_id = get_jwt_identity()
            # ── SP: sp_domains_create (+ sp_domains_set_parent) ─────────────
            domain = call_proc_one(
                'sp_domains_create',
                str(uuid.uuid4()), args['name'], args['slug'], args.get('description'), args.get('icon_url'),
                1 if args.get('is_active', True) else 0, admin_id, admin_id,
            )
            if parent_id:
                domain = call_proc_one('sp_domains_set_parent', domain['id'], parent_id, admin_id)
            db.session.commit()

            logger.info(f"Admin created domain {domain['id']} ({domain['slug']}) (via sp_domains_create)")
            return jsonify(response={'message': 'Domain created.', 'domain': _domain_dict(domain)}, status=201, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in POST /admin/domains: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

@ns.route('/domains/<string:domain_id>')
class AdminDomainDetail(Resource):
    @ns.doc(description='Admin: update a domain.')
    @jwt_required()
    def put(self, domain_id):
        try:
            claims = get_jwt()
            if not can(AREA_OPS):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)

            # ── SP: sp_domains_get — existence check + current values, since
            # sp_domains_update is a full replace (not a partial update). ────
            domain = call_proc_one('sp_domains_get', domain_id)
            if not domain:
                return jsonify(response={'message': 'Domain not found.'}, status=404, bool=False)

            from flask import request as req
            d = req.get_json() or {}

            new_slug = domain['slug']
            if 'slug' in d and d['slug']:
                all_domains = call_proc('sp_domains_list', 1000, 0, 0)
                if any(x['slug'] == d['slug'] and x['id'] != domain_id for x in all_domains):
                    return jsonify(response={'message': f'Slug "{d["slug"]}" already in use.'}, status=409, bool=False)
                new_slug = d['slug']

            # Parent only when the field is sent; '' / null moves it to the top
            # level. Checked before anything is written.
            move_parent = 'parent_id' in d
            parent_id = (d.get('parent_id') or '').strip() or None if move_parent else None
            if move_parent:
                err = _parent_error(domain_id, parent_id, call_proc('sp_domains_list', 1000, 0, 0))
                if err:
                    return jsonify(response={'message': err}, status=400, bool=False)

            admin_id = get_jwt_identity()
            updated = call_proc_one(
                'sp_domains_update',
                domain_id,
                d['name'] if ('name' in d and d['name']) else domain['name'],
                new_slug,
                d['description'] if 'description' in d else domain['description'],
                d['icon_url'] if 'icon_url' in d else domain['icon_url'],
                (1 if d['is_active'] else 0) if 'is_active' in d else (1 if domain['is_active'] else 0),
                domain.get('created_by'),
                admin_id,
            )
            if move_parent:
                updated = call_proc_one('sp_domains_set_parent', domain_id, parent_id, admin_id)
            db.session.commit()
            logger.info(f"Admin updated domain {domain_id} (via sp_domains_update)")
            return jsonify(response={'message': 'Domain updated.', 'domain': _domain_dict(updated)}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in PUT /admin/domains/{domain_id}: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @ns.doc(description='Admin: hard-delete a domain.')
    @jwt_required()
    def delete(self, domain_id):
        try:
            claims = get_jwt()
            if not can(AREA_OPS):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)

            # ── SP: sp_domains_get + sp_domains_delete ───────────────────────
            domain = call_proc_one('sp_domains_get', domain_id)
            if not domain:
                return jsonify(response={'message': 'Domain not found.'}, status=404, bool=False)

            call_proc('sp_domains_delete', domain_id)
            db.session.commit()

            logger.info(f"Admin hard-deleted domain {domain_id} (via sp_domains_delete)")
            return jsonify(response={'message': 'Domain deleted.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in DELETE /admin/domains/{domain_id}: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)
