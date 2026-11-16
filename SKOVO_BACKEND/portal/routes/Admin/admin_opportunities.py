from portal.helpers.error_capture import capture_error
from portal.helpers.helpers import parse_local_to_utc, serialize_datetime
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

list_parser = reqparse.RequestParser()
list_parser.add_argument('page', type=int, location='args', default=1)
list_parser.add_argument('per_page', type=int, location='args', default=20)
list_parser.add_argument('search', type=str, location='args', required=False)
list_parser.add_argument('status', type=str, location='args', required=False)
list_parser.add_argument('type', type=str, location='args', required=False)

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

create_parser = reqparse.RequestParser()
create_parser.add_argument('title', type=str, location='json', required=True)
create_parser.add_argument('company', type=str, location='json', required=False)
create_parser.add_argument('type', type=str, location='json', required=False)
create_parser.add_argument('domain', type=str, location='json', required=False)
create_parser.add_argument('location', type=str, location='json', required=False)
create_parser.add_argument('is_remote', type=bool, location='json', required=False)
create_parser.add_argument('duration', type=str, location='json', required=False)
create_parser.add_argument('stipend_min', type=str, location='json', required=False)
create_parser.add_argument('stipend_max', type=str, location='json', required=False)
create_parser.add_argument('stipend_type', type=str, location='json', required=False, default='fixed')
create_parser.add_argument('min_readiness_score', type=str, location='json', required=False)
create_parser.add_argument('deadline', type=str, location='json', required=False)
create_parser.add_argument('description',          type=str,  location='json', required=False)
create_parser.add_argument('requirements',         type=list, location='json', required=False)
create_parser.add_argument('skills_required',      type=list, location='json', required=False)
create_parser.add_argument('eligibility_criteria', type=str,  location='json', required=False)
create_parser.add_argument('experience_level',     type=str,  location='json', required=False)
create_parser.add_argument('application_link',     type=str,  location='json', required=False)
create_parser.add_argument('is_featured',          type=bool, location='json', required=False)
create_parser.add_argument('status',               type=str,  location='json', required=False, default='active')

update_parser = reqparse.RequestParser()
update_parser.add_argument('title', type=str, location='json', required=False)
update_parser.add_argument('company', type=str, location='json', required=False)
update_parser.add_argument('type', type=str, location='json', required=False)
update_parser.add_argument('domain', type=str, location='json', required=False)
update_parser.add_argument('location', type=str, location='json', required=False)
update_parser.add_argument('is_remote', type=bool, location='json', required=False)
update_parser.add_argument('duration', type=str, location='json', required=False)
update_parser.add_argument('stipend_min', type=str, location='json', required=False)
update_parser.add_argument('stipend_max', type=str, location='json', required=False)
update_parser.add_argument('stipend_type', type=str, location='json', required=False)
update_parser.add_argument('min_readiness_score', type=str, location='json', required=False)
update_parser.add_argument('deadline', type=str, location='json', required=False)
update_parser.add_argument('description',          type=str,  location='json', required=False)
update_parser.add_argument('requirements',         type=list, location='json', required=False)
update_parser.add_argument('skills_required',      type=list, location='json', required=False)
update_parser.add_argument('eligibility_criteria', type=str,  location='json', required=False)
update_parser.add_argument('experience_level',     type=str,  location='json', required=False)
update_parser.add_argument('application_link',     type=str,  location='json', required=False)
update_parser.add_argument('is_featured',          type=bool, location='json', required=False)
update_parser.add_argument('status',               type=str,  location='json', required=False)

def _opp_dict(o):
    if not o:
        return None
    deadline = o.get('deadline')
    created_at = o.get('created_at')
    return {
        'id': o.get('id'),
        'title': o.get('title'),
        'company': o.get('company'),
        'type': o.get('type'),
        'domain': o.get('domain'),
        'location': o.get('location'),
        'is_remote': bool(o.get('is_remote')),
        'duration': o.get('duration'),
        'stipend_min': o.get('stipend_min'),
        'stipend_max': o.get('stipend_max'),
        'stipend_type': o.get('stipend_type'),
        'min_readiness_score': o.get('min_readiness_score'),
        'deadline': serialize_datetime(deadline) if deadline else None,
        'description':          o.get('description'),
        'requirements':         _as_list(o.get('requirements')),
        'skills_required':      _as_list(o.get('skills_required')),
        'eligibility_criteria': o.get('eligibility_criteria'),
        'experience_level':     o.get('experience_level'),
        'application_link':     o.get('application_link'),
        'is_featured':          bool(o.get('is_featured')),
        'status':               o.get('status'),
        'posted_by': o.get('posted_by'),
        'created_at': serialize_datetime(created_at) if created_at else None,
    }


def _opp_sp_args(opp_id, args, existing=None, posted_by=None):
    """Build the 25 positional args for sp_opportunities_create / _update."""
    existing = existing or {}

    def val(key, caster=lambda x: x):
        if args.get(key) is not None:
            return caster(args[key])
        return existing.get(key)

    def val_json(key):
        if args.get(key) is not None:
            return json.dumps(args[key])
        return existing.get(key)

    deadline = existing.get('deadline')
    if args.get('deadline') is not None:
        # parse_local_to_utc, not raw fromisoformat. An admin typing
        # "31 Dec 23:59" means 23:59 IST; stored unconverted it becomes 23:59
        # UTC, so applications keep being accepted until 05:29 the next morning
        # — five and a half hours past the deadline the students were shown.
        deadline = parse_local_to_utc(args['deadline'])

    return [
        opp_id,
        val('title'),
        val('company'),
        val('type'),
        val('domain'),
        val('location'),
        (1 if args['is_remote'] else 0) if args.get('is_remote') is not None else (1 if existing.get('is_remote') else 0),
        val('duration'),
        val('stipend_min', _int),
        val('stipend_max', _int),
        val('stipend_type'),
        val('min_readiness_score', _int),
        deadline,
        val_json('skills_required') or '[]',
        val('eligibility_criteria'),
        val('experience_level'),
        val('application_link'),
        (1 if args['is_featured'] else 0) if args.get('is_featured') is not None else (1 if existing.get('is_featured') else 0),
        val('description'),
        val_json('requirements') or '[]',
        val('status'),
        posted_by if posted_by is not None else existing.get('posted_by'),
    ]


@ns.route('/opportunities')
class AdminOpportunityList(Resource):
    @ns.doc(description='Admin: paginated list of all opportunities.')
    @jwt_required()
    def get(self):
        try:
            claims = get_jwt()
            if not can(AREA_CONTENT):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)

            args = list_parser.parse_args()

            # ── SP: sp_opportunities_list — no search/status/type filters on
            # the generic CRUD proc, so pull a bounded batch and filter here. ──
            rows = call_proc('sp_opportunities_list', 5000, 0)

            if args.get('search'):
                s = args['search'].lower()
                rows = [o for o in rows if s in (o.get('title') or '').lower() or s in (o.get('company') or '').lower()]
            if args.get('status'):
                rows = [o for o in rows if o.get('status') == args['status']]
            if args.get('type'):
                rows = [o for o in rows if o.get('type') == args['type']]

            total = len(rows)
            per_page = args['per_page']
            page = args['page']
            pages = (total + per_page - 1) // per_page if per_page else 1
            start = (page - 1) * per_page
            page_rows = rows[start:start + per_page]

            result = [_opp_dict(o) for o in page_rows]

            return jsonify(
                response={'opportunities': result},
                pagination={'total': total, 'pages': pages, 'page': page, 'per_page': per_page},
                status=200, bool=True
            )
        except Exception as e:
            logger.error(f"Error in GET /admin/opportunities: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @ns.doc(description='Admin: create a new opportunity.')
    @jwt_required()
    def post(self):
        try:
            claims = get_jwt()
            if not can(AREA_CONTENT):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)

            user_id = get_jwt_identity()
            args = create_parser.parse_args()

            if args.get('deadline'):
                try:
                    datetime.datetime.fromisoformat(args['deadline'])
                except ValueError:
                    return jsonify(response={'message': 'Invalid deadline format. Use ISO 8601.'}, status=400, bool=False)

            # ── SP: sp_opportunities_create ───────────────────────────────────
            opp_id = str(uuid.uuid4())
            sp_args = _opp_sp_args(opp_id, args, posted_by=user_id) + [user_id, user_id, None]
            opp = call_proc_one('sp_opportunities_create', *sp_args)
            db.session.commit()

            logger.info(f"Admin created opportunity {opp_id} (via sp_opportunities_create)")
            return jsonify(response={'message': 'Opportunity created.', 'opportunity': _opp_dict(opp)}, status=201, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in POST /admin/opportunities: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

@ns.route('/opportunities/<string:opp_id>')
class AdminOpportunityDetail(Resource):
    @ns.doc(description='Admin: update an opportunity.')
    @jwt_required()
    def put(self, opp_id):
        try:
            claims = get_jwt()
            if not can(AREA_CONTENT):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)

            # ── SP: sp_opportunities_get — existence check + current values,
            # since sp_opportunities_update is a full replace. ────────────────
            existing = call_proc_one('sp_opportunities_get', opp_id)
            if not existing or existing.get('deleted_at'):
                return jsonify(response={'message': 'Opportunity not found.'}, status=404, bool=False)

            args = update_parser.parse_args()

            if args.get('deadline') is not None:
                try:
                    datetime.datetime.fromisoformat(args['deadline'])
                except ValueError:
                    return jsonify(response={'message': 'Invalid deadline format. Use ISO 8601.'}, status=400, bool=False)

            admin_id = get_jwt_identity()
            # Only the fields actually sent — see helpers/partial_update.
            # reqparse fills omitted arguments with None, and this is a full
            # replace, so passing `args` straight through NULLs everything the
            # caller did not resend.
            sp_args = _opp_sp_args(opp_id, supplied(args), existing) + [existing.get('created_by'), admin_id, None]
            opp = call_proc_one('sp_opportunities_update', *sp_args)
            db.session.commit()

            logger.info(f"Admin updated opportunity {opp_id} (via sp_opportunities_update)")
            return jsonify(response={'message': 'Opportunity updated.', 'opportunity': _opp_dict(opp)}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in PUT /admin/opportunities/{opp_id}: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @ns.doc(description='Admin: soft-delete an opportunity.')
    @jwt_required()
    def delete(self, opp_id):
        try:
            claims = get_jwt()
            if not can(AREA_CONTENT):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)

            # ── SP: sp_opportunities_get + sp_opportunities_delete (soft) ────
            existing = call_proc_one('sp_opportunities_get', opp_id)
            if not existing or existing.get('deleted_at'):
                return jsonify(response={'message': 'Opportunity not found.'}, status=404, bool=False)

            call_proc('sp_opportunities_delete', opp_id)
            db.session.commit()

            logger.info(f"Admin soft-deleted opportunity {opp_id} (via sp_opportunities_delete)")
            return jsonify(response={'message': 'Opportunity deleted.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in DELETE /admin/opportunities/{opp_id}: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/opportunities/<string:opp_id>/applications')
class AdminOpportunityApplicants(Resource):
    """Who applied to this opportunity.

    This did not exist. An admin could post a role and students could apply to
    it, and there was no way — API or screen — to find out who had. The
    applications were being collected into a table nobody could read, which is
    worse than not collecting them: the students believe someone is looking.

    Read-only on purpose. Moving an applicant through the pipeline
    (interviewing / offered / rejected) is a decision with a notification
    attached and belongs behind its own endpoint with its own audit trail; this
    one answers the question "did anybody apply".
    """

    @ns.doc(description='Admin: the applicant pipeline for one opportunity.')
    @jwt_required()
    def get(self, opp_id):
        try:
            if not can(AREA_CONTENT):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)

            # ── SP: sp_opportunities_get — 404 before reading applicants, so a
            # made-up id cannot be used to probe whether one exists. ──────────
            opp = call_proc_one('sp_opportunities_get', opp_id)
            if not opp or opp.get('deleted_at'):
                return jsonify(response={'message': 'Opportunity not found.'}, status=404, bool=False)

            # ── SP: sp_opportunity_applicants ────────────────────────────────
            # Its own indexed procedure, not `sp_opportunity_applications_list(
            # 50000)` filtered in Python. The first draft did it the Python way
            # and `tests/test_ui05_performance.py` failed it — that test pins the
            # count of whole-table reads at 101 precisely so the next one is
            # caught the day it is written, and it caught this one. The LIMIT is
            # a silent correctness ceiling as much as a cost: past it an
            # application stops existing as far as this screen is concerned, and
            # nobody tells the applicant. The proc also folds in the per-row user
            # lookup, so this is one round trip whatever the pipeline holds.
            rows = call_proc('sp_opportunity_applicants', opp_id)

            stats = {'total': len(rows), 'applied': 0, 'interviewing': 0,
                     'offered': 0, 'rejected': 0, 'withdrawn': 0}
            applications = []
            for a in rows:
                if a.get('status') in stats:
                    stats[a['status']] += 1
                applications.append({
                    'id': a.get('id'),
                    'user_id': a.get('user_id'),
                    # LEFT JOINed, so a deleted student leaves the row visible
                    # with a blank name rather than dropping it and making the
                    # count disagree with the list.
                    'full_name': a.get('full_name'),
                    'email': a.get('email'),
                    'status': a.get('status'),
                    'cover_note': a.get('cover_note'),
                    'applied_at': serialize_datetime(a.get('applied_at')) if a.get('applied_at') else None,
                })

            return jsonify(
                response={
                    'opportunity': {'id': opp.get('id'), 'title': opp.get('title'),
                                    'company': opp.get('company')},
                    'applications': applications,
                    'stats': stats,
                },
                status=200, bool=True,
            )
        except Exception as e:
            logger.error(f"Error in GET /admin/opportunities/{opp_id}/applications: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id},
                           status=500, bool=False)
