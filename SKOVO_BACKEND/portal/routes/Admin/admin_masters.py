from portal.helpers.error_capture import capture_error
from portal.helpers.helpers import serialize_datetime
import uuid
from flask import current_app, jsonify, request
from flask_restx import Resource, reqparse
from flask_jwt_extended import jwt_required, get_jwt_identity, get_jwt
from sqlalchemy.exc import IntegrityError
from portal.models import db
from portal.helpers.sp import call_proc, call_proc_one
from . import ns, logger
from portal.helpers.admin_auth import can, AREA_OPS


# Masters CRUD goes through the sp_master_* stored procedures — see
# database/stored_procedures/master_tables.sql. Each dropdown lives in its own
# `master_<type>` table now, so every call carries the type: it is what the
# procedures resolve to a table name (via `master_registry`), and it is the only
# thing standing between a caller-supplied string and dynamic SQL.
#
# `id` alone can no longer identify a row — the same id could sit in any of 122
# tables — so update/delete take the type as well.
def _row_master_dict(m, mtype=None):
    if not m:
        return None
    ca, ua = m.get('created_at'), m.get('updated_at')
    return {
        'id':         m.get('id'),
        'type':       m.get('type') or mtype,
        'value':      m.get('value'),
        'label':      m.get('label'),
        'sort_order': m.get('sort_order'),
        'is_active':  bool(m.get('is_active')),
        'created_at': serialize_datetime(ca) if ca else None,
        'updated_at': serialize_datetime(ua) if ua else None,
    }


def _bust_cache(mtype):
    """The public endpoint caches each dropdown for five minutes. An admin edit
    should show up on the next page load, not five minutes later."""
    cache = getattr(current_app, 'cache', None)
    if cache:
        cache.delete(f'masters:{mtype}')


def _int(v, default=None):
    try:
        return int(v) if v not in (None, '', 'null') else default
    except (ValueError, TypeError):
        return default

list_parser = reqparse.RequestParser()
list_parser.add_argument('type', type=str, location='args')
list_parser.add_argument('active_only', type=str, location='args', default='true')

create_parser = reqparse.RequestParser()
create_parser.add_argument('type',       type=str, location='json', required=True)
create_parser.add_argument('value',      type=str, location='json', required=True)
create_parser.add_argument('label',      type=str, location='json', required=True)
create_parser.add_argument('sort_order', type=str, location='json', default='0')
create_parser.add_argument('is_active',  type=bool, location='json', default=True)

update_parser = reqparse.RequestParser()
update_parser.add_argument('type',       type=str,  location='json', required=True,
                           help='Which master table this option lives in.')
update_parser.add_argument('value',      type=str,  location='json')
update_parser.add_argument('label',      type=str,  location='json')
update_parser.add_argument('sort_order', type=str,  location='json')
update_parser.add_argument('is_active',  type=bool, location='json')


# ── Admin: full CRUD ─────────────────────────────────────────────────────────

@ns.route('/masters')
class AdminMasterList(Resource):

    @ns.doc(description='Admin: list all masters, optionally filtered by type.')
    @jwt_required()
    def get(self):
        try:
            claims = get_jwt()
            if not can(AREA_OPS):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)

            args = list_parser.parse_args()
            active_only = 1 if args.get('active_only', 'true').lower() == 'true' else 0

            # ── SP: sp_master_types — every registered dropdown ──────────────
            if args.get('type'):
                types = [args['type']]
            else:
                types = [r['type'] for r in call_proc('sp_master_types')]

            # ── SP: sp_master_list — one call per dropdown table ─────────────
            items, grouped = [], {}
            for mtype in types:
                rows = [_row_master_dict(m, mtype)
                        for m in call_proc('sp_master_list', mtype, active_only)]
                if rows:
                    grouped[mtype] = rows
                    items.extend(rows)

            return jsonify(response={'masters': items, 'grouped': grouped}, status=200, bool=True)
        except Exception as e:
            logger.error(f"GET /admin/masters error: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @ns.doc(description='Admin: create a new master option.')
    @jwt_required()
    def post(self):
        try:
            claims = get_jwt()
            if not can(AREA_OPS):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)

            args = create_parser.parse_args()
            new_id = str(uuid.uuid4())

            # ── SP: sp_master_create — reports duplicate/unknown_type itself ──
            res = call_proc_one(
                'sp_master_create',
                args['type'], new_id, args['value'], args['label'],
                _int(args.get('sort_order'), 0), get_jwt_identity(),
            )
            outcome = (res or {}).get('result')
            if outcome == 'duplicate':
                db.session.rollback()
                return jsonify(response={'message': f'"{args["value"]}" already exists under type "{args["type"]}".'}, status=409, bool=False)
            if outcome != 'ok':
                db.session.rollback()
                return jsonify(response={'message': f'Unknown dropdown type "{args["type"]}".'}, status=400, bool=False)
            db.session.commit()
            _bust_cache(args['type'])

            master = call_proc_one('sp_master_get', args['type'], new_id)
            logger.info(f"Admin created master {args['type']}/{args['value']} (via sp_master_create)")
            return jsonify(response={'message': 'Master option created.',
                                     'master': _row_master_dict(master, args['type'])},
                           status=201, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"POST /admin/masters error: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/masters/<string:master_id>')
class AdminMasterDetail(Resource):

    @ns.doc(description='Admin: update a master option.')
    @jwt_required()
    def put(self, master_id):
        try:
            claims = get_jwt()
            if not can(AREA_OPS):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)

            args = update_parser.parse_args()
            mtype = args.get('type')
            if not mtype:
                return jsonify(response={'message': 'type is required — it identifies which master table the option lives in.'}, status=400, bool=False)

            # ── SP: sp_master_get — 404 before attempting the write ──────────
            if not call_proc_one('sp_master_get', mtype, master_id):
                return jsonify(response={'message': 'Master option not found.'}, status=404, bool=False)

            # ── SP: sp_master_update — NULL leaves a field alone. The per-table
            # UNIQUE(value) still raises IntegrityError on a clashing rename. ──
            try:
                res = call_proc_one(
                    'sp_master_update',
                    mtype, master_id,
                    args.get('value'),
                    args.get('label'),
                    _int(args['sort_order']) if args.get('sort_order') is not None else None,
                    (1 if args['is_active'] else 0) if args.get('is_active') is not None else None,
                    get_jwt_identity(),
                )
                db.session.commit()
            except IntegrityError:
                db.session.rollback()
                return jsonify(response={'message': f'"{args["value"]}" already exists in this type.'}, status=409, bool=False)

            if (res or {}).get('result') != 'ok':
                return jsonify(response={'message': 'Master option not found.'}, status=404, bool=False)
            _bust_cache(mtype)

            master = call_proc_one('sp_master_get', mtype, master_id)
            return jsonify(response={'message': 'Updated.', 'master': _row_master_dict(master, mtype)},
                           status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"PUT /admin/masters/{master_id} error: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @ns.doc(description='Admin: delete a master option.')
    @jwt_required()
    def delete(self, master_id):
        try:
            claims = get_jwt()
            if not can(AREA_OPS):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)

            mtype = request.args.get('type') or (request.get_json(silent=True) or {}).get('type')
            if not mtype:
                return jsonify(response={'message': 'type is required — it identifies which master table the option lives in.'}, status=400, bool=False)

            # ── SP: sp_master_delete — reports notfound/unknown_type itself ───
            res = call_proc_one('sp_master_delete', mtype, master_id)
            outcome = (res or {}).get('result')
            if outcome != 'ok':
                db.session.rollback()
                status = 400 if outcome == 'unknown_type' else 404
                msg = (f'Unknown dropdown type "{mtype}".' if outcome == 'unknown_type'
                       else 'Master option not found.')
                return jsonify(response={'message': msg}, status=status, bool=False)
            db.session.commit()
            _bust_cache(mtype)

            logger.info(f"Admin deleted master {mtype}/{master_id} (via sp_master_delete)")
            return jsonify(response={'message': 'Deleted.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"DELETE /admin/masters/{master_id} error: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


# ── Bulk create (seed multiple options at once) ───────────────────────────────

@ns.route('/masters/bulk')
class AdminMasterBulk(Resource):

    @ns.doc(description='Admin: bulk create master options for a type. Skips duplicates.')
    @jwt_required()
    def post(self):
        try:
            claims = get_jwt()
            if not can(AREA_OPS):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)

            data = request.get_json() or {}
            items = data.get('items', [])
            if not items:
                return jsonify(response={'message': '"items" array is required.'}, status=400, bool=False)

            admin_id = get_jwt_identity()
            created, skipped = 0, 0
            touched = set()
            # ── SP: sp_master_create — reports 'duplicate' / 'unknown_type'
            # per item rather than raising, so one bad row skips instead of
            # rolling back the batch. Each item commits independently. ─────────
            for i, item in enumerate(items):
                t = (item.get('type') or '').strip()
                v = (item.get('value') or '').strip()
                l = (item.get('label') or '').strip()
                if not t or not v or not l:
                    skipped += 1
                    continue
                try:
                    res = call_proc_one(
                        'sp_master_create',
                        t, str(uuid.uuid4()), v, l,
                        _int(item.get('sort_order'), i), admin_id,
                    )
                    if (res or {}).get('result') == 'ok':
                        db.session.commit()
                        created += 1
                        touched.add(t)
                    else:
                        db.session.rollback()
                        skipped += 1
                except IntegrityError:
                    db.session.rollback()
                    skipped += 1

            for t in touched:
                _bust_cache(t)
            return jsonify(response={'message': f'{created} created, {skipped} skipped.', 'created': created, 'skipped': skipped}, status=201, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"POST /admin/masters/bulk error: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)
