from portal.helpers.error_capture import capture_error
from portal.helpers.partial_update import supplied
import json
import types
from flask import jsonify
from flask_restx import Resource, reqparse
from flask_jwt_extended import jwt_required, get_jwt_identity, get_jwt
from portal.models import db
from portal.helpers.sp import call_proc, call_proc_one
from portal.helpers.helpers import parse_local_to_utc, serialize_datetime, effective_cohort_status
from portal.helpers.cohort_validation import validate_cohort_input
from . import ns, logger
from portal.helpers.admin_auth import can, AREA_CONTENT


def _int(v, default=None):
    try:
        return int(float(v)) if v not in (None, '', 'null') else default
    except (ValueError, TypeError):
        return default


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
list_parser.add_argument('status', type=str, location='args', required=False)
list_parser.add_argument('kind', type=str, location='args', required=False)         # demo | free | paid
list_parser.add_argument('achiever_id', type=str, location='args', required=False)
list_parser.add_argument('date_from', type=str, location='args', required=False)   # YYYY-MM-DD, IST
list_parser.add_argument('date_to', type=str, location='args', required=False)

update_parser = reqparse.RequestParser()
update_parser.add_argument('title', type=str, location='json', required=False)
update_parser.add_argument('achiever_id', type=str, location='json', required=False)
update_parser.add_argument('domain_id', type=str, location='json', required=False)
update_parser.add_argument('session_date', type=str, location='json', required=False)
update_parser.add_argument('duration_minutes', type=str, location='json', required=False)
update_parser.add_argument('total_seats', type=str, location='json', required=False)
update_parser.add_argument('price', type=str, location='json', required=False)
update_parser.add_argument('about', type=str, location='json', required=False)
update_parser.add_argument('what_you_learn', type=list, location='json', required=False)
update_parser.add_argument('thumbnail_url', type=str, location='json', required=False)
update_parser.add_argument('status', type=str, location='json', required=False)
update_parser.add_argument('level', type=str, location='json', required=False)
update_parser.add_argument('registration_deadline', type=str, location='json', required=False)
update_parser.add_argument('meeting_link', type=str, location='json', required=False)


def _cohort_kind(c):
    """demo = free class run on probation; free = no charge after approval; paid."""
    if c.get('is_demo'):
        return 'demo'
    return 'paid' if (c.get('price') or 0) > 0 else 'free'


def _cohort_dict(c):
    achiever_id, domain_id = c.get('achiever_id'), c.get('domain_id')
    achiever = call_proc_one('sp_achievers_get', achiever_id) if achiever_id else None
    domain = call_proc_one('sp_domains_get', domain_id) if domain_id else None
    status_shim = types.SimpleNamespace(
        status=c.get('status'), session_date=c.get('session_date'), duration_minutes=c.get('duration_minutes'),
    )
    return {
        'id': c.get('id'),
        'title': c.get('title'),
        # Raw id too: `achiever` is None when that mentor was removed, and the
        # edit form needs to know there WAS one to say so.
        'achiever_id': c.get('achiever_id'),
        'achiever': {
            'id': achiever['id'],
            'full_name': achiever['full_name'],
            'designation': achiever['designation'],
            'company': achiever['company'],
        } if achiever else None,
        'domain': {
            'id': domain['id'],
            'name': domain['name'],
            'slug': domain['slug'],
        } if domain else None,
        'session_date': serialize_datetime(c.get('session_date')),
        'duration_minutes': c.get('duration_minutes'),
        'total_seats': c.get('total_seats'),
        'filled_seats': c.get('filled_seats'),
        'price': int(c['price']) if c.get('price') is not None else 0,
        'status': effective_cohort_status(status_shim),
        # Not started in time (class rules): cancelled, everyone refunded.
        'missed': bool(c.get('missed_at')),
        'kind': _cohort_kind(c),
        'about': c.get('about'),
        'what_you_learn': _as_list(c.get('what_you_learn')),
        'thumbnail_url': c.get('thumbnail_url'),
        'level': c.get('level'),
        'registration_deadline': serialize_datetime(c.get('registration_deadline')),
        'meeting_link': c.get('meeting_link'),
        'created_at': serialize_datetime(c.get('created_at')),
    }


# order matches sp_cohorts_create/_update after (id, title)
FIELDS = [
    ('achiever_id', None), ('domain_id', None), ('session_date', 'date'), ('duration_minutes', _int),
    ('total_seats', _int), ('filled_seats', None), ('price', _int), ('status', None), ('reminder_sent', None),
    ('about', None), ('what_you_learn', 'json'), ('thumbnail_url', None), ('level', None),
    ('registration_deadline', 'date'), ('meeting_link', None),
    ('target_categories', None), ('target_streams', None), ('target_degree_cats', None),
    ('target_exam_targets', None), ('target_prof_courses', None), ('target_years', None),
    ('target_degrees', None), ('target_branches', None),
]


def _build_args(cid, title, d, existing=None):
    existing = existing or {}
    args = [cid, title]
    for field, caster in FIELDS:
        if field in d:
            v = d[field]
            if caster == 'json':
                v = json.dumps(v) if v is not None else None
            elif caster == 'date':
                v = parse_local_to_utc(v) if v else None
            elif caster:
                v = caster(v)
            args.append(v)
        else:
            args.append(existing.get(field))
    return args


@ns.route('/cohorts')
class AdminCohortList(Resource):
    @ns.doc(description='Admin: paginated list of all cohorts.')
    @jwt_required()
    def get(self):
        try:
            claims = get_jwt()
            if not can(AREA_CONTENT):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)

            args = list_parser.parse_args()

            # ── SP: sp_cohorts_list — no search/status filters on the generic
            # CRUD proc, so pull a bounded batch and filter here. ────────────
            rows = call_proc('sp_cohorts_list', 5000, 0)
            if args.get('search'):
                s = args['search'].lower()
                rows = [c for c in rows if s in (c.get('title') or '').lower()]
            if args.get('achiever_id'):
                rows = [c for c in rows if c.get('achiever_id') == args['achiever_id']]
            if args.get('kind'):
                rows = [c for c in rows if _cohort_kind(c) == args['kind']]
            # Date range on the class day in IST (session_date is stored in UTC).
            if args.get('date_from') or args.get('date_to'):
                import datetime as _dt
                ist = lambda d: (d + _dt.timedelta(minutes=330)).strftime('%Y-%m-%d') if d else ''  # noqa: E731
                lo, hi = args.get('date_from') or '0000', args.get('date_to') or '9999'
                rows = [c for c in rows if c.get('session_date') and lo <= ist(c['session_date']) <= hi]
            # Counts per status (after search, before the status filter) for
            # the tiles over the list.
            # The real status (as each card shows it), not the stored column:
            # a class nobody ended stayed 'live' in the column for days.
            import types as _types
            from portal.helpers.helpers import effective_cohort_status as _eff
            st = {c['id']: _eff(_types.SimpleNamespace(status=c.get('status'), session_date=c.get('session_date'),
                                                       duration_minutes=c.get('duration_minutes'))) for c in rows}
            counts = {'all': len(rows), 'missed': sum(1 for c in rows if c.get('missed_at'))}
            for c in rows:
                counts[st[c['id']] or 'unknown'] = counts.get(st[c['id']] or 'unknown', 0) + 1
            if args.get('status'):
                rows = [c for c in rows if st[c['id']] == args['status']]

            total = len(rows)
            per_page = args['per_page']
            page = args['page']
            pages = (total + per_page - 1) // per_page if per_page else 1
            start = (page - 1) * per_page
            page_rows = rows[start:start + per_page]

            result = [_cohort_dict(c) for c in page_rows]

            return jsonify(
                response={'cohorts': result, 'counts': counts},
                pagination={'total': total, 'pages': pages, 'page': page, 'per_page': per_page},
                status=200, bool=True
            )
        except Exception as e:
            logger.error(f"Error in GET /admin/cohorts: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/cohorts/<string:cohort_id>')
class AdminCohortDetail(Resource):
    @ns.doc(description='Admin: update a cohort.')
    @jwt_required()
    def put(self, cohort_id):
        try:
            claims = get_jwt()
            if not can(AREA_CONTENT):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)

            # Achievers create and run cohorts; an admin edit or delete would
            # rewrite a class students joined, paid for and reviewed.
            return jsonify(response={'message': 'Cohorts are managed by their achiever.'}, status=403, bool=False)
            # ── SP: sp_cohorts_get + _update (full replace) ────────────────────
            existing = call_proc_one('sp_cohorts_get', cohort_id)
            if not existing or existing.get('deleted_at'):
                return jsonify(response={'message': 'Cohort not found.'}, status=404, bool=False)

            args = update_parser.parse_args()

            verr = validate_cohort_input(args, require_title=False)
            if verr:
                return jsonify(response={'message': verr}, status=400, bool=False)

            admin_id = get_jwt_identity()
            title = args['title'] if args.get('title') is not None else existing['title']
            # Only what was actually sent — see helpers/partial_update. Everything else
            # comes from `existing`, which is what makes this a partial update
            # rather than a destructive full replace.
            sp_args = (_build_args(cohort_id, title, supplied(args), existing)
                       + [existing.get('created_by'), admin_id, None])
            cohort = call_proc_one('sp_cohorts_update', *sp_args)
            db.session.commit()

            logger.info(f"Admin updated cohort {cohort_id} (via sp_cohorts_update)")
            return jsonify(response={'message': 'Cohort updated.', 'cohort': _cohort_dict(cohort)}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in PUT /admin/cohorts/{cohort_id}: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @ns.doc(description='Admin: soft-delete a cohort.')
    @jwt_required()
    def delete(self, cohort_id):
        try:
            claims = get_jwt()
            if not can(AREA_CONTENT):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)

            # Achievers create and run cohorts; an admin edit or delete would
            # rewrite a class students joined, paid for and reviewed.
            return jsonify(response={'message': 'Cohorts are managed by their achiever.'}, status=403, bool=False)
            # ── SP: sp_cohorts_get + _delete (soft delete) ─────────────────────
            existing = call_proc_one('sp_cohorts_get', cohort_id)
            if not existing or existing.get('deleted_at'):
                return jsonify(response={'message': 'Cohort not found.'}, status=404, bool=False)

            call_proc('sp_cohorts_delete', cohort_id)
            db.session.commit()

            logger.info(f"Admin soft-deleted cohort {cohort_id} (via sp_cohorts_delete)")
            return jsonify(response={'message': 'Cohort deleted.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in DELETE /admin/cohorts/{cohort_id}: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/cohorts/<string:cohort_id>/feedback')
class AdminCohortFeedback(Resource):
    @ns.doc(description='Admin: student feedback left on one cohort.')
    @jwt_required()
    def get(self, cohort_id):
        """The same rows the achiever sees, minus the ownership restriction.

        Reads `achiever_reviews` where context_type='cohort'. Kept as a read:
        moderating a review already has a home under Moderation, and giving the
        cohort screen its own delete would be a second way to remove the same
        row with no audit trail behind it.
        """
        try:
            if not can(AREA_CONTENT):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)

            # ── SP: sp_cohorts_get ───────────────────────────────────────────
            cohort = call_proc_one('sp_cohorts_get', cohort_id)
            if not cohort or cohort.get('deleted_at'):
                return jsonify(response={'message': 'Cohort not found.'}, status=404, bool=False)

            # ── SP: sp_achiever_reviews_list, sp_users_list, sp_achievers_get ─
            rows = [
                r for r in (call_proc('sp_achiever_reviews_list', 100000, 0, 1) or [])
                if r.get('context_type') == 'cohort' and r.get('context_id') == cohort_id
            ]
            rows.sort(key=lambda r: r.get('created_at') or '', reverse=True)

            users_by_id = {u['id']: u for u in (call_proc('sp_users_list', 50000, 0) or [])}
            achiever = (call_proc_one('sp_achievers_get', cohort['achiever_id'])
                        if cohort.get('achiever_id') else None)

            items = [{
                'id': r.get('id'),
                'rating': r.get('rating'),
                'review_text': r.get('review_text'),
                'student_name': (users_by_id.get(r.get('user_id')) or {}).get('full_name') or 'Student',
                'student_id': r.get('user_id'),
                'created_at': serialize_datetime(r.get('created_at')),
            } for r in rows]

            ratings = [r['rating'] for r in rows if r.get('rating') is not None]
            return jsonify(response={
                'cohort_id': cohort_id,
                'cohort_title': cohort.get('title'),
                'achiever_name': achiever.get('full_name') if achiever else None,
                'feedback': items,
                'count': len(items),
                'avg_rating': round(sum(ratings) / len(ratings), 1) if ratings else None,
                'breakdown': {str(n): sum(1 for x in ratings if x == n) for n in range(1, 6)},
                'enrolled_count': int(cohort.get('filled_seats') or 0),
            }, status=200, bool=True)
        except Exception as e:
            logger.error(f"Error in GET /admin/cohorts/{cohort_id}/feedback: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)
