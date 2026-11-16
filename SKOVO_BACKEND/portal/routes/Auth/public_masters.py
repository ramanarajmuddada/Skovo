from portal.helpers.error_capture import capture_error
from flask import current_app, jsonify, request
from flask_restx import Resource, reqparse
from portal.helpers.sp import call_proc
from . import ns, logger

public_parser = reqparse.RequestParser()
public_parser.add_argument('type', type=str, location='args')
public_parser.add_argument('types', type=str, location='args', help='Comma-separated list of types')

# Every dropdown now has its own `master_<type>` table rather than a slice of one
# shared `masters` table (see migrate_split_master_tables.py). Callers still ask
# by type name and still get {value, label} back, so the storage change is
# invisible to all 95 dropdowns already wired to this endpoint.
#
# `state` and `city` are different again: they are full entity tables with their
# own columns, not two-column option lists, so they keep their own procedures.
ENTITY_TYPES = ('state', 'city')

# Option lists change a few times a year and are read on nearly every screen.
# Splitting one table into 122 turned a single SELECT into one call per type, so
# without this a 47-type page load would be 47 round trips.
_CACHE_SECONDS = 300


def _entity(mtype):
    """{value, label} rows for a type served by a full entity table."""
    if mtype == 'state':
        # ── SP: sp_states_list ───────────────────────────────────────────────
        return [{'value': s.get('name'), 'label': s.get('name')} for s in call_proc('sp_states_list', 1)]
    if mtype == 'city':
        # ── SP: sp_cities_search (no query = every active city) ──────────────
        return [{'value': c.get('name'), 'label': c.get('name')}
                for c in call_proc('sp_cities_search', None, None, 5000)]
    return []


def _options(mtype):
    """One dropdown's options, cached. Unknown types return [] — sp_master_list
    resolves the table through `master_registry`, so an unregistered name simply
    finds nothing."""
    cache = getattr(current_app, 'cache', None)
    key = f'masters:{mtype}'
    if cache:
        hit = cache.get(key)
        if hit is not None:
            return hit

    if mtype in ENTITY_TYPES:
        rows = _entity(mtype)
    else:
        # ── SP: sp_master_list — reads master_<type> via the registry ────────
        # education_level only comes back for the few tables that carry that
        # column (e.g. master_entrance_exam) — sp_master_list omits it for
        # everything else, so it is passed through rather than assumed present.
        rows = [
            {'value': r.get('value'), 'label': r.get('label'),
             **({'education_level': r['education_level']} if 'education_level' in r else {})}
            for r in call_proc('sp_master_list', mtype, 1)
        ]

    if cache:
        cache.set(key, rows, timeout=_CACHE_SECONDS)
    return rows


def _all_types():
    """Every registered dropdown name — ── SP: sp_master_types ──"""
    return [r['type'] for r in call_proc('sp_master_types')] + list(ENTITY_TYPES)


def _migrated(mtype):
    """{value, label} rows for a type that now lives in its own table."""
    if mtype == 'state':
        # ── SP: sp_states_list ───────────────────────────────────────────────
        return [{'value': s.get('name'), 'label': s.get('name')} for s in call_proc('sp_states_list', 1)]
    if mtype == 'city':
        # ── SP: sp_cities_search (no query = every active city) ──────────────
        return [{'value': c.get('name'), 'label': c.get('name')}
                for c in call_proc('sp_cities_search', None, None, 5000)]
    return []


@ns.route('/masters/search')
class PublicMasterSearch(Resource):
    """One dropdown's options, filtered in the database.

    Every dropdown searches server-side, so this is the endpoint behind all of
    them. Deliberately NOT cached: a cache keyed by query would hold a separate
    entry per keystroke and evict the useful whole-list entries that /masters
    keeps.

    `q` empty returns the head of the list, so opening a dropdown before typing
    still shows something.
    """

    @ns.doc(description='Search one dropdown: ?type=city&q=hyd&limit=50')
    def get(self):
        try:
            mtype = (request.args.get('type') or '').strip()
            q = (request.args.get('q') or '').strip()
            try:
                limit = int(request.args.get('limit') or 50)
            except (TypeError, ValueError):
                limit = 50
            limit = max(1, min(limit, 200))

            if not mtype:
                return jsonify(response={'options': []}, status=200, bool=True)

            # Entity-backed types (colleges and friends) are not master tables,
            # so they keep their existing path and are filtered from the cached
            # list rather than by this procedure.
            if mtype in ENTITY_TYPES:
                rows = _entity(mtype)
                ql = q.lower()
                if ql:
                    starts = [r for r in rows if str(r.get('label', '')).lower().startswith(ql)]
                    rest = [r for r in rows
                            if not str(r.get('label', '')).lower().startswith(ql)
                            and ql in str(r.get('label', '')).lower()]
                    rows = starts + rest
                return jsonify(response={'options': rows[:limit]}, status=200, bool=True)

            # ── SP: sp_master_search — resolves master_<type> via the registry
            rows = call_proc('sp_master_search', mtype, q, limit) or []
            options = [
                {'value': r.get('value'), 'label': r.get('label'),
                 **({'education_level': r['education_level']} if 'education_level' in r else {})}
                for r in rows if r.get('value') is not None
            ]
            return jsonify(response={'options': options}, status=200, bool=True)
        except Exception as e:
            logger.error(f"GET /auth/masters/search: {e}")
            # A failed search must not empty the dropdown -- the client keeps
            # whatever it already had and filters that instead.
            return jsonify(response={'options': None, 'message': 'search_unavailable'},
                           status=200, bool=True)


@ns.route('/masters')
class PublicMasterList(Resource):

    @ns.doc(description='Public: fetch dropdown options from masters table. Pass ?type=college_type or ?types=college_type,degree_type')
    def get(self):
        try:
            args = public_parser.parse_args()

            if args.get('types'):
                wanted = [t.strip() for t in args['types'].split(',') if t.strip()]
            elif args.get('type'):
                wanted = [args['type']]
            else:
                wanted = _all_types()          # bare call = every dropdown

            # Same response shape as before the split: {grouped: {type: [{value,label}]}}.
            # A type with no rows is omitted rather than sent as [], matching what
            # the old single-table filter produced — useMasters keeps its fallback
            # for anything absent.
            grouped = {}
            for mtype in wanted:
                rows = _options(mtype)
                if rows:
                    grouped[mtype] = rows

            return jsonify(response={'grouped': grouped}, status=200, bool=True)
        except Exception as e:
            logger.error(f"GET /auth/masters error: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)
