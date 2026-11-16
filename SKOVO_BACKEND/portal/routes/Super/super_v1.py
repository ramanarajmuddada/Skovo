"""Super admin — Version 1 overview (feature-updates.md §16 item 4).

GET /v1-overview   wallet liability, refunds, open alerts, league health,
                   streak health, score spread per stage, feature switches
"""
from portal.helpers.error_capture import capture_error
from flask import jsonify
from flask_restx import Resource
from flask_jwt_extended import jwt_required, get_jwt
from sqlalchemy import text
from portal.models import db
from . import ns, logger


def _q(sql, **p):
    out = []
    for r in db.session.execute(text(sql), p).mappings().all():
        out.append({k: (float(v) if v.__class__.__name__ == 'Decimal' else
                        (v.isoformat() if hasattr(v, 'isoformat') else v)) for k, v in dict(r).items()})
    return out


@ns.route('/v1-overview')
class SuperV1Overview(Resource):
    @jwt_required()
    def get(self):
        try:
            if get_jwt().get('super_admin') is not True:
                return jsonify(response={'message': 'Super admin access required'}, status=403, bool=False)
            return jsonify(response={
                'wallet_liability': _q(
                    "SELECT (SELECT IFNULL(SUM(amount), 0) FROM wallet_ledger WHERE kind = 'refund') AS refund_money, "
                    "(SELECT IFNULL(SUM(remaining), 0) FROM wallet_bonus_lots WHERE expires_at > UTC_TIMESTAMP()) AS bonus_credit")[0],
                'refunds_30d': _q(
                    "SELECT destination, IFNULL(case_key, 'unknown') AS case_key, COUNT(*) AS n, SUM(amount) AS amount "
                    "FROM refunds WHERE created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY) "
                    "GROUP BY destination, case_key"),
                'open_alerts': _q("SELECT kind, COUNT(*) AS n FROM admin_alerts WHERE status = 'open' GROUP BY kind"),
                'chargebacks_open': _q("SELECT COUNT(*) AS n FROM chargebacks WHERE status = 'open'")[0]['n'],
                'league_health': _q(
                    "SELECT stage_group, tier, COUNT(*) AS members, COUNT(DISTINCT group_no) AS groups "
                    "FROM league_members WHERE week_start = (SELECT MAX(week_start) FROM league_members) "
                    "GROUP BY stage_group, tier ORDER BY stage_group, tier"),
                'streak_health': _q(
                    "SELECT SUM(lifetime_current > 0) AS active, SUM(lifetime_current >= 7) AS at_7, "
                    "SUM(lifetime_current >= 30) AS at_30, SUM(lifetime_current >= 100) AS at_100 FROM career_streaks")[0],
                'score_spread': _q(
                    "SELECT st.stage_group, COUNT(*) AS students, ROUND(AVG(rs.score), 1) AS avg_score, "
                    "SUM(rs.score >= 100) AS at_ceiling, SUM(rs.score = 0) AS at_zero "
                    "FROM student_stages st JOIN readiness_scores rs ON rs.user_id = st.user_id "
                    "WHERE st.status = 'active' GROUP BY st.stage_group"),
                'features': {
                    'streaks': bool(db.session.execute(text("SELECT enabled FROM streak_settings WHERE id = 1")).scalar()),
                    'leaderboard': bool(db.session.execute(text("SELECT enabled FROM lb_settings WHERE id = 1")).scalar()),
                    'leagues': bool(db.session.execute(text("SELECT enabled FROM league_settings WHERE id = 1")).scalar()),
                    'wallet': bool(db.session.execute(text("SELECT enabled FROM wallet_settings WHERE id = 1")).scalar()),
                    'engagement': _q("SELECT daily_goal_enabled, quests_enabled, mistakes_enabled, "
                                     "friends_enabled, speed_enabled, achievements_enabled "
                                     "FROM engagement_settings WHERE id = 1")[0],
                },
            }, status=200, bool=True)
        except Exception as e:
            logger.error(f"GET /super/v1-overview: {e}")
            return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)},
                           status=500, bool=False)
