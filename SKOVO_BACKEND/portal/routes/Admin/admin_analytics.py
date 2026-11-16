from portal.helpers.error_capture import capture_error
import datetime
from flask import jsonify, request
from flask_restx import Resource
from flask_jwt_extended import jwt_required, get_jwt
from portal.helpers.sp import call_proc, call_proc_one
from . import ns, logger
from portal.helpers.admin_auth import can, AREA_OPS


@ns.route('/analytics')
class AdminAnalytics(Resource):
    @jwt_required()
    def get(self):
        """Platform analytics — event counts, funnel stats, top cohorts, mentor utilisation."""
        try:
            claims = get_jwt()
            if not can(AREA_OPS):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)

            days = int(request.args.get('days', 30))
            since = datetime.datetime.utcnow() - datetime.timedelta(days=days)
            fourteen_days = datetime.datetime.utcnow() - datetime.timedelta(days=14)

            # ── SP: sp_admin_analytics_* — see database/stored_procedures/
            # endpoints/admin_analytics.sql ────────────────────────────────────
            event_counts = call_proc('sp_admin_analytics_events', since)
            daily_signups = call_proc('sp_admin_analytics_daily_signups', fourteen_days)
            funnel = call_proc_one('sp_admin_analytics_cohort_funnel') or {}
            top_cohorts = call_proc('sp_admin_analytics_top_cohorts')
            mentor_utilisation = call_proc('sp_admin_analytics_mentor_utilisation')
            session_statuses = call_proc('sp_admin_analytics_session_statuses')

            total_enrollments = funnel.get('total_enrollments', 0)
            paid_enrollments = funnel.get('paid_enrollments', 0)

            return jsonify(
                response={
                    'period_days': days,
                    'events': [{'type': e['event_type'], 'count': e['cnt']} for e in event_counts],
                    'daily_signups': [{'date': str(d['day']), 'count': d['cnt']} for d in daily_signups],
                    'cohort_funnel': {
                        'total_cohorts': funnel.get('total_cohorts', 0),
                        'total_enrollments': total_enrollments,
                        'paid_enrollments': paid_enrollments,
                        'free_enrollments': funnel.get('free_enrollments', 0),
                        'conversion_rate': round(paid_enrollments / total_enrollments * 100, 1) if total_enrollments else 0,
                    },
                    'top_cohorts': [{'id': c['id'], 'title': c['title'], 'enrolled': c['enrolled']} for c in top_cohorts],
                    'mentor_utilisation': [{'name': m['full_name'], 'sessions': m['sessions']} for m in mentor_utilisation],
                    'session_statuses': [{'status': s['status'], 'count': s['cnt']} for s in session_statuses],
                },
                status=200, bool=True
            )
        except Exception as e:
            logger.error(f"GET /admin/analytics error: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


def _rate(num, den):
    return round((num or 0) / den * 100, 1) if den else 0.0


@ns.route('/analytics/v1-metrics')
class AdminV1Metrics(Resource):
    @ns.doc(description='The v1 success metrics (spec §8): score distribution, unlock rate, DAU/MAU, Pro.')
    @jwt_required()
    def get(self):
        try:
            if not can(AREA_OPS):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)

            # ── SP: sp_metrics_* ─────────────────────────────────────────────
            dist = call_proc_one('sp_metrics_score_distribution') or {}
            unlock = call_proc_one('sp_metrics_unlock_rate') or {}
            hub = call_proc_one('sp_metrics_hub_application_rate') or {}
            eng = call_proc_one('sp_metrics_engagement') or {}
            pro = call_proc_one('sp_metrics_pro') or {}

            def i(v): return int(v or 0)
            activated = i(unlock.get('activated'))
            unlocked = i(unlock.get('unlocked'))
            hub_unlocked = i(hub.get('unlocked_users'))
            applied = i(hub.get('applied_users'))
            dau, mau = i(eng.get('dau')), i(eng.get('mau'))
            total_students = i(pro.get('total_students'))
            active_pro = i(pro.get('active_pro'))

            return jsonify(response={
                'score_distribution': {
                    'buckets': [
                        {'label': '0–19',   'count': i(dist.get('b0'))},
                        {'label': '20–39',  'count': i(dist.get('b20'))},
                        {'label': '40–59',  'count': i(dist.get('b40'))},
                        {'label': '60–79',  'count': i(dist.get('b60'))},
                        {'label': '80–100', 'count': i(dist.get('b80'))},
                    ],
                    'total': i(dist.get('total')),
                    'avg_score': float(dist.get('avg_score') or 0),
                },
                'unlock_rate': {
                    'floor': i(unlock.get('unlock_floor')) or 60,
                    'activated': activated,
                    'unlocked': unlocked,
                    # Spec target: 20%+ of activated users reach the floor.
                    'rate': _rate(unlocked, activated),
                    'target': 20,
                },
                'hub_application_rate': {
                    'unlocked_users': hub_unlocked,
                    'applied_users': applied,
                    # Spec target: 50%+ of unlocked users apply.
                    'rate': _rate(applied, hub_unlocked),
                    'target': 50,
                },
                'engagement': {
                    'dau': dau, 'mau': mau,
                    # Spec target: DAU/MAU 25%+.
                    'dau_mau': _rate(dau, mau),
                    'target': 25,
                },
                'pro': {
                    'active_subscribers': active_pro,
                    'total_students': total_students,
                    'conversion_rate': _rate(active_pro, total_students),
                    'mrr_estimate': round(float(pro.get('mrr_estimate') or 0)),
                },
            }, status=200, bool=True)
        except Exception as e:
            logger.error(f"GET /admin/analytics/v1-metrics error: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)
