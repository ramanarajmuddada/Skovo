"""Admin CRUD for the `cities` entity table — the list the Student Portal reads.

Why this exists when the Masters screen already offers a "City" type: that one
writes `master_city`, a flat name/label list with no state column. Every
student-facing city dropdown is state-scoped and served from the `cities`
entity table via sp_cities_by_state, so a city added through Masters was
saved successfully and then never appeared anywhere a student could see it.
This module edits the table those dropdowns actually read.

The stored procedures already existed (sp_cities_create/_update/_delete in
database/stored_procedures/geo.sql) and are unchanged — only the admin-facing
routes were missing, so nothing here needs a database deploy.
"""
from portal.helpers.error_capture import capture_error
from portal.helpers.helpers import serialize_datetime
import uuid
from flask import jsonify, request
from flask_restx import Resource, reqparse
from flask_jwt_extended import jwt_required, get_jwt_identity
from portal.models import db
from portal.helpers.sp import call_proc, call_proc_one
from . import ns, logger
from portal.helpers.admin_auth import can, AREA_OPS

create_parser = reqparse.RequestParser()
create_parser.add_argument('state_id',   type=str, location='json', required=False)
create_parser.add_argument('state_code', type=str, location='json', required=False)
create_parser.add_argument('name',       type=str, location='json', required=True)
create_parser.add_argument('district',   type=str, location='json', required=False)
create_parser.add_argument('tier',       type=int, location='json', required=False)
create_parser.add_argument('sort_order', type=int, location='json', required=False)
create_parser.add_argument('is_active',  type=bool, location='json', required=False, default=True)


def _city_dict(c):
    if not c:
        return None
    return {
        'id':         c.get('id'),
        'state_id':   c.get('state_id'),
        'state_code': c.get('state_code'),
        'state_name': c.get('state_name'),
        'name':       c.get('name'),
        'district':   c.get('district'),
        'tier':       c.get('tier'),
        'sort_order': c.get('sort_order'),
        'is_active':  bool(c.get('is_active')) if c.get('is_active') is not None else True,
        'created_at': serialize_datetime(c.get('created_at')) if c.get('created_at') else None,
    }


def _resolve_state(state_id, state_code):
    """A state id from either form of reference, or None."""
    if state_id:
        return state_id
    if state_code:
        # ── SP: sp_states_get_by_code ────────────────────────────────────────
        return (call_proc_one('sp_states_get_by_code', state_code) or {}).get('id')
    return None


@ns.route('/cities')
class AdminCityList(Resource):
    @ns.doc(description='Admin: cities in a state (?state_id= or ?state_code=). '
                        'Includes inactive rows so they can be restored.')
    @jwt_required()
    def get(self):
        try:
            if not can(AREA_OPS):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)

            state_id = _resolve_state(request.args.get('state_id'), request.args.get('state_code'))
            if not state_id:
                return jsonify(response={'message': 'Pass state_id or state_code.'},
                               status=400, bool=False)

            # ── SP: sp_cities_by_state — only_active = 0 so the admin sees the
            # deactivated ones too; the student endpoint passes 1. ───────────
            rows = call_proc('sp_cities_by_state', state_id, 0) or []
            return jsonify(response={'cities': [_city_dict(c) for c in rows]},
                           status=200, bool=True)
        except Exception as e:
            logger.error(f"Error in GET /admin/cities: {e}")
            return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)},
                           status=500, bool=False)

    @ns.doc(description='Admin: add a city to a state.')
    @jwt_required()
    def post(self):
        try:
            if not can(AREA_OPS):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)

            args = create_parser.parse_args()
            state_id = _resolve_state(args.get('state_id'), args.get('state_code'))
            if not state_id:
                return jsonify(response={'message': 'Pick a state for the city.'},
                               status=400, bool=False)

            name = (args.get('name') or '').strip()
            if not name:
                return jsonify(response={'message': 'City name is required.'}, status=400, bool=False)

            # Names are compared case-insensitively so "kadapa" cannot be added
            # next to "Kadapa" and split the same city into two options.
            # ── SP: sp_cities_by_state ───────────────────────────────────────
            existing = call_proc('sp_cities_by_state', state_id, 0) or []
            clash = next((c for c in existing
                          if (c.get('name') or '').strip().lower() == name.lower()), None)
            if clash:
                # A deactivated row is the common case here: someone removed the
                # city earlier and is now adding it back. Reactivating keeps the
                # id, so profiles that already point at it stay valid.
                if not clash.get('is_active'):
                    # ── SP: sp_cities_update ─────────────────────────────────
                    restored = call_proc_one('sp_cities_update', clash['id'], None, None, None, None,
                                             None, 1, get_jwt_identity())
                    db.session.commit()
                    logger.info(f"Admin reactivated city {clash['id']} ({name})")
                    return jsonify(response={'message': f'"{name}" was inactive and has been restored.',
                                             'city': _city_dict(restored)}, status=200, bool=True)
                return jsonify(response={'message': f'"{name}" already exists in this state.'},
                               status=409, bool=False)

            admin_id = get_jwt_identity()
            # ── SP: sp_cities_create ─────────────────────────────────────────
            city = call_proc_one('sp_cities_create', str(uuid.uuid4()), state_id, name,
                                 args.get('district'), args.get('tier'),
                                 args.get('sort_order'),
                                 1 if args.get('is_active', True) else 0, admin_id)
            db.session.commit()

            logger.info(f"Admin created city {(city or {}).get('id')} ({name}) (via sp_cities_create)")
            return jsonify(response={'message': f'"{name}" added.', 'city': _city_dict(city)},
                           status=201, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in POST /admin/cities: {e}")
            return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)},
                           status=500, bool=False)


@ns.route('/cities/<string:city_id>')
class AdminCityDetail(Resource):
    @ns.doc(description='Admin: rename a city, move it, or activate/deactivate it.')
    @jwt_required()
    def put(self, city_id):
        try:
            if not can(AREA_OPS):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)

            d = request.get_json() or {}
            name = d.get('name')
            if 'name' in d and not (name or '').strip():
                return jsonify(response={'message': 'City name cannot be empty.'},
                               status=400, bool=False)

            # sp_cities_update COALESCEs every argument, so passing None leaves a
            # column alone — that is what makes this a genuine partial update.
            # ── SP: sp_cities_update ─────────────────────────────────────────
            updated = call_proc_one(
                'sp_cities_update', city_id,
                _resolve_state(d.get('state_id'), d.get('state_code')),
                name.strip() if name else None,
                d.get('district'), d.get('tier'), d.get('sort_order'),
                None if 'is_active' not in d else (1 if d['is_active'] else 0),
                get_jwt_identity(),
            )
            if not updated:
                return jsonify(response={'message': 'City not found.'}, status=404, bool=False)
            db.session.commit()

            logger.info(f"Admin updated city {city_id}")
            return jsonify(response={'message': 'City updated.', 'city': _city_dict(updated)},
                           status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in PUT /admin/cities/{city_id}: {e}")
            return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)},
                           status=500, bool=False)

    @ns.doc(description='Admin: deactivate a city. Students stop seeing it; '
                        'profiles already pointing at it are left intact.')
    @jwt_required()
    def delete(self, city_id):
        try:
            if not can(AREA_OPS):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)

            # Deactivates rather than deletes, deliberately: the row is
            # referenced by student profiles, and removing it would strand them.
            # ── SP: sp_cities_delete ─────────────────────────────────────────
            call_proc('sp_cities_delete', city_id)
            db.session.commit()

            logger.info(f"Admin deactivated city {city_id}")
            return jsonify(response={'message': 'City removed from the list.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in DELETE /admin/cities/{city_id}: {e}")
            return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)},
                           status=500, bool=False)
