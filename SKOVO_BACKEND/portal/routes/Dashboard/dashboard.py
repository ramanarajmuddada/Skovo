from portal.helpers.error_capture import capture_error
import json
from flask import jsonify
from flask_restx import Resource
from flask_jwt_extended import jwt_required, get_jwt_identity
from portal.helpers.helpers import opportunity_hub_min_score, serialize_datetime
from portal.helpers.sp import call_proc, call_proc_one
from portal.models import db
from . import ns, logger


def _as_list(v):
    if isinstance(v, str):
        try:
            return json.loads(v)
        except Exception:
            return []
    return v or []


@ns.route('/')
class Dashboard(Resource):
    @ns.doc(description='Get student dashboard data: readiness score, upcoming cohorts, quick stats.')
    @jwt_required()
    def get(self):
        try:
            user_id = get_jwt_identity()
            user = call_proc_one('sp_users_get', user_id)
            if not user:
                return jsonify(response={'message': 'User not found.'}, status=404, bool=False)

            # Rebuild from the ledger before reading it. sp_readiness_score_get
            # returns whatever was last cached, and the cache is only as fresh
            # as the last award — an award that failed its rebuild, a rule an
            # admin retuned, or a decay tick left the dashboard showing a
            # number the ledger had already moved past. One extra CALL buys a
            # score that is right every time the screen is opened.
            # ── SP: sp_score_read, then sp_readiness_score_get ───────────────
            # Same guarantee as before -- the number is right every time the
            # screen opens -- but it only pays for a rebuild when something has
            # actually changed.
            call_proc_one('sp_score_read', user_id)
            db.session.commit()
            readiness = call_proc_one('sp_readiness_score_get', user_id)
            score = readiness['score'] if readiness else 0
            level = readiness['level'] if readiness else 'Explorer'
            cohorts_done = readiness['cohorts_completed'] if readiness else 0
            tasks_done = readiness['tasks_completed'] if readiness else 0
            hub_min = opportunity_hub_min_score()

            # Upcoming cohorts (latest 4) — joined with achiever + domain in the SP
            cohort_list = []
            for c in call_proc('sp_dashboard_upcoming_cohorts', 4):
                cohort_list.append({
                    'id': c['id'],
                    'title': c['title'],
                    'domain': {'id': c['domain_id'], 'name': c['domain_name'], 'slug': c['domain_slug']} if c['domain_id'] else None,
                    'achiever': {
                        'id': c['achiever_id'],
                        'full_name': c['achiever_name'],
                        'designation': c['achiever_designation'],
                        'company': c['achiever_company'],
                        'avatar_url': c['achiever_avatar'],
                    } if c['achiever_id'] else None,
                    'session_date': serialize_datetime(c['session_date']),
                    'duration_minutes': c['duration_minutes'],
                    'total_seats': c['total_seats'],
                    'filled_seats': c['filled_seats'],
                    'price': float(c['price']) if c['price'] else 0,
                    'status': c['status'],
                    'about': c['about'],
                    'what_you_learn': _as_list(c['what_you_learn']),
                    'thumbnail_url': c['thumbnail_url'],
                })

            from portal.routes.Cohorts.cohorts import _active_checkout_holds
            held = _active_checkout_holds([item['id'] for item in cohort_list])
            for item in cohort_list:
                total = item.get('total_seats')
                filled = item.get('filled_seats') or 0
                h = held.get(item['id'], 0)
                item['available_seats'] = (
                    None if not total else max(0, int(total) - int(filled) - int(h)))

            return jsonify(
                response={
                    'user_id': user['id'],
                    'full_name': user['full_name'],
                    'avatar_url': user['avatar_url'],
                    'readiness': {
                        'score': score,
                        'level': level,
                        'cohorts_completed': cohorts_done,
                        'tasks_completed': tasks_done,
                        'base_points': float(readiness['base_points'] or 0) if readiness else 0.0,
                        'opportunity_hub_unlocked': score >= hub_min,
                        # Both numbers come from the live readiness_rules row,
                        # so the countdown a student reads and the check that
                        # lets them in can never disagree. Shipped, so the
                        # frontend never has to hardcode the gate either.
                        'hub_min_score': hub_min,
                        'points_needed_for_hub': max(0, hub_min - score),
                    },
                    'upcoming_cohorts': cohort_list,
                    'quick_actions': [
                        {'label': 'Join Cohort', 'subtitle': 'Sunday sessions', 'action': 'cohorts'},
                        {'label': 'Find College', 'subtitle': 'Rank-fit match', 'action': 'colleges'},
                        {'label': 'Freshers Hub', 'subtitle': 'Opportunity Hub', 'action': 'opportunities'},
                        {'label': 'Assemble', 'subtitle': 'Community', 'action': 'assemble'},
                    ]
                },
                status=200,
                bool=True
            )

        except Exception as e:
            import traceback
            db.session.rollback()
            logger.error(f"Error in GET /dashboard: {e}\n{traceback.format_exc()}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)
