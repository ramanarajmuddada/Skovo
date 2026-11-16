from portal.helpers.error_capture import capture_error
import uuid
import datetime
from flask import jsonify
from flask_restx import Resource, reqparse
from flask_jwt_extended import jwt_required, get_jwt_identity, get_jwt
from portal.models import db
from portal.helpers.sp import call_proc, call_proc_one
from portal.helpers.helpers import serialize_datetime, opportunity_hub_min_score
from . import ns, logger


# One reader for the Hub gate - see the note in Opportunities/opportunities.py.
_opportunity_unlock_floor = opportunity_hub_min_score
apply_parser = reqparse.RequestParser()
apply_parser.add_argument('opportunity_id', type=str, location='json', required=True, help='Opportunity ID is required.')
apply_parser.add_argument('resume_link', type=str, location='json', required=False)
apply_parser.add_argument('cover_note', type=str, location='json', required=False)
# One-tap apply: id of a Document Vault file to send as the resume (Pro).
apply_parser.add_argument('document_id', type=str, location='json', required=False)

status_parser = reqparse.RequestParser()
status_parser.add_argument('status', type=str, location='json', required=True,
                           help='New status is required.')

_VALID_STATUSES = {'applied', 'interviewing', 'offered', 'rejected', 'withdrawn'}
_ADMIN_STATUSES = {'interviewing', 'offered', 'rejected'}
_USER_STATUSES = {'withdrawn'}


@ns.route('/')
class ApplicationList(Resource):
    @ns.doc(description='Get all applications for the current user with pipeline stats.')
    @jwt_required()
    def get(self):
        try:
            user_id = get_jwt_identity()
            # ── SP: sp_opportunity_applications_list, sp_opportunities_list —
            # no by-user-id filter on the generic CRUD proc, so pull bounded
            # batches and join/filter in Python. ────────────────────────────────
            all_apps = call_proc('sp_opportunity_applications_list', 50000, 0)
            apps = [a for a in all_apps if a.get('user_id') == user_id]
            apps.sort(key=lambda a: a.get('applied_at') or datetime.datetime.min, reverse=True)

            opps_by_id = {o['id']: o for o in call_proc('sp_opportunities_list', 5000, 0)}

            stats = {'total': len(apps), 'applied': 0, 'interviewing': 0, 'offered': 0, 'rejected': 0, 'withdrawn': 0}
            result = []

            for a in apps:
                if a.get('status') in stats:
                    stats[a['status']] += 1

                opp = opps_by_id.get(a.get('opportunity_id'))
                result.append({
                    'id': a['id'],
                    'opportunity_id': a.get('opportunity_id'),
                    'title': opp.get('title') if opp else None,
                    'company': opp.get('company') if opp else None,
                    'type': opp.get('type') if opp else None,
                    'location': opp.get('location') if opp else None,
                    'is_remote': opp.get('is_remote') if opp else None,
                    'stipend_min': opp.get('stipend_min') if opp else None,
                    'stipend_max': opp.get('stipend_max') if opp else None,
                    'stipend_type': opp.get('stipend_type') if opp else None,
                    'duration': opp.get('duration') if opp else None,
                    'deadline': serialize_datetime(opp.get('deadline')) if opp else None,
                    'description': opp.get('description') if opp else None,
                    'skills_required': opp.get('skills_required') if opp else None,
                    'application_link': opp.get('application_link') if opp else None,
                    'resume_link': a.get('resume_link'),
                    'cover_note': a.get('cover_note'),
                    'status': a.get('status'),
                    'applied_at': serialize_datetime(a.get('applied_at')),
                    'status_updated_at': serialize_datetime(a.get('status_updated_at')),
                })

            return jsonify(
                response={'applications': result, 'stats': stats},
                status=200, bool=True
            )
        except Exception as e:
            logger.error(f"Error in GET /applications: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @ns.doc(description='Apply to an opportunity. Readiness score gate enforced.')
    @jwt_required()
    def post(self):
        try:
            user_id = get_jwt_identity()
            args = apply_parser.parse_args()

            # ── SP: sp_opportunities_get ─────────────────────────────────────────
            opp = call_proc_one('sp_opportunities_get', args['opportunity_id'])
            if not opp or opp.get('status') != 'active':
                return jsonify(response={'message': 'Opportunity not found or no longer active.'}, status=404, bool=False)

            if opp.get('deadline') and opp['deadline'] < datetime.datetime.utcnow():
                return jsonify(response={'message': 'Application deadline has passed.'}, status=400, bool=False)

            # Readiness score gate — the platform-wide Opportunity Hub threshold is a
            # floor under every opportunity; an opportunity's own min_readiness_score
            # can only raise the bar further, never lower it.
            # ── SP: sp_readiness_score_get ──────────────────────────────────────
            readiness = call_proc_one('sp_readiness_score_get', user_id)
            user_score = readiness.get('score') if readiness else 0
            required_score = max(_opportunity_unlock_floor(), opp.get('min_readiness_score') or 0)
            if user_score < required_score:
                return jsonify(
                    response={
                        'message': (
                            f'Minimum readiness score of {required_score} is required. '
                            f'Your current score: {user_score}. '
                            f'Complete the readiness assessment to unlock this opportunity.'
                        ),
                        'required_score': required_score,
                        'your_score': user_score,
                    },
                    status=403, bool=False
                )

            # v1 spec: browsing the hub is score-gated; APPLYING is Skovo Pro.
            from portal.routes.Subscription.subscription import is_pro
            if not is_pro(user_id):
                from portal.helpers.pro_limits import upgrade_payload
                return jsonify(response=upgrade_payload('opportunities'), status=403, bool=False)

            # One-tap apply — send a saved Document Vault file as the resume.
            resume_link = args.get('resume_link')
            doc_id = args.get('document_id')
            if doc_id:
                # ── SP: sp_docvault_by_user (ownership-scoped lookup) ────────────
                my_docs = call_proc('sp_docvault_by_user', user_id, None) or []
                doc = next((d for d in my_docs if str(d.get('id')) == str(doc_id)), None)
                if not doc:
                    return jsonify(response={'message': 'Document not found in your vault.'}, status=404, bool=False)
                resume_link = doc.get('file_url') or resume_link

            # Duplicate check
            # ── SP: sp_opportunity_applications_get_by_user_opp ──────────────────
            existing = call_proc_one('sp_opportunity_applications_get_by_user_opp', user_id, args['opportunity_id'])
            if existing:
                if existing.get('status') == 'withdrawn':
                    # Allow re-apply after withdrawal
                    # ── SP: sp_opportunity_application_reapply ─────────────────────
                    call_proc_one(
                        'sp_opportunity_application_reapply',
                        existing['id'], resume_link, args.get('cover_note'),
                    )
                    db.session.commit()
                    return jsonify(
                        response={'message': 'Application re-submitted.', 'application_id': existing['id']},
                        status=200, bool=True
                    )
                return jsonify(
                    response={'message': 'You have already applied to this opportunity.'},
                    status=409, bool=False
                )

            # ── SP: sp_opportunity_applications_create ───────────────────────────
            app_id = str(uuid.uuid4())
            call_proc_one(
                'sp_opportunity_applications_create',
                app_id, user_id, args['opportunity_id'], resume_link, args.get('cover_note'),
                'applied', user_id, user_id,
            )
            db.session.commit()

            from portal.helpers import score
            score.award(user_id, score.APPLICATION_SUBMITTED, ref_id=app_id)
            from portal.helpers import engagement
            engagement.track(user_id, 'career_tool_used')
            db.session.commit()

            return jsonify(
                response={'message': 'Application submitted successfully.', 'application_id': app_id},
                status=200, bool=True
            )
        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in POST /applications: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/<string:application_id>/status')
class ApplicationStatus(Resource):
    @ns.doc(
        description=(
            'Update application status.\n\n'
            '**Students** can only set status to `withdrawn` (their own application).\n\n'
            '**Admins** can set: `interviewing`, `offered`, `rejected`.'
        )
    )
    @jwt_required()
    def patch(self, application_id):
        try:
            user_id = get_jwt_identity()
            claims = get_jwt()
            role = claims.get('role', 'student')
            args = status_parser.parse_args()
            new_status = args['status']

            if new_status not in _VALID_STATUSES:
                return jsonify(
                    response={'message': f"Invalid status. Must be one of: {', '.join(sorted(_VALID_STATUSES))}."},
                    status=400, bool=False
                )

            # ── SP: sp_opportunity_applications_get ──────────────────────────────
            app_obj = call_proc_one('sp_opportunity_applications_get', application_id)
            if not app_obj:
                return jsonify(response={'message': 'Application not found.'}, status=404, bool=False)

            # Authorization: only admins manage the pipeline (interviewing/offered/rejected).
            # Everyone else (students, achievers) may only act on their own application,
            # and only to withdraw it.
            if role != 'admin':
                if app_obj.get('user_id') != user_id:
                    return jsonify(response={'message': 'Access denied.'}, status=403, bool=False)
                if new_status not in _USER_STATUSES:
                    return jsonify(
                        response={'message': 'You can only withdraw your own application.'},
                        status=403, bool=False
                    )

            # Admins cannot set withdrawn status (only the student can)
            if role == 'admin' and new_status == 'withdrawn':
                return jsonify(
                    response={'message': 'Admins cannot mark an application as withdrawn.'},
                    status=400, bool=False
                )

            # ── SP: sp_opportunity_application_set_status ────────────────────────
            updated = call_proc_one('sp_opportunity_application_set_status', application_id, new_status)
            db.session.commit()

            # Score signal: being shortlisted for an interview (+10, per shortlist).
            # 'interviewing' is this platform's name for the shortlisted state.
            if new_status == 'interviewing':
                from portal.helpers import score
                score.award(app_obj.get('user_id'), score.OPPORTUNITY_SHORTLISTED,
                            ref_id=application_id)
                db.session.commit()

            return jsonify(
                response={'message': 'Status updated.', 'status': updated.get('status')},
                status=200, bool=True
            )
        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in PATCH /applications/{application_id}/status: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)
