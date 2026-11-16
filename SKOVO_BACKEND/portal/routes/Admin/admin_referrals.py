from portal.helpers.error_capture import capture_error
from portal.helpers.helpers import serialize_datetime
from flask import jsonify, request
from flask_restx import Resource, reqparse
from flask_jwt_extended import jwt_required, get_jwt_identity
from portal.helpers.decorators import require_role
from portal.helpers.sp import call_proc, call_proc_one
from . import ns, logger

list_parser = reqparse.RequestParser()
list_parser.add_argument('page',     type=int, location='args', default=1)
list_parser.add_argument('per_page', type=int, location='args', default=20)
list_parser.add_argument('status',   type=str, location='args', required=False)


def _ref_row(r, users_by_id):
    referrer = users_by_id.get(r.get('referrer_id'))
    referred = users_by_id.get(r.get('referred_user_id')) if r.get('referred_user_id') else None
    created_at = r.get('created_at')
    return {
        'id':               r.get('id'),
        'referral_code':    r.get('referral_code'),
        'referrer_id':      r.get('referrer_id'),
        'referrer_name':    referrer.get('full_name') if referrer else 'Unknown',
        'referrer_email':   referrer.get('email')     if referrer else None,
        'referred_email':   r.get('referred_email'),
        'referred_name':    referred.get('full_name') if referred else None,
        'status':           r.get('status'),
        'reward_given':     bool(r.get('reward_given')),
        'created_at':       serialize_datetime(created_at) if created_at else None,
    }


@ns.route('/referrals')
class AdminReferralList(Resource):
    @require_role('admin', 'super_admin')
    def get(self):
        try:
            args  = list_parser.parse_args()

            # ── SP: sp_referrals_list — no status filter on the generic CRUD
            # proc, so pull a bounded batch and filter here. ──────────────────
            rows = call_proc('sp_referrals_list', 20000, 0)
            all_rows = rows
            if args.get('status'):
                rows = [r for r in rows if r.get('status') == args['status']]
            rows.sort(key=lambda r: r.get('created_at') or '', reverse=True)

            total = len(rows)
            per_page = args['per_page']
            page = args['page']
            pages = (total + per_page - 1) // per_page if per_page else 1
            start = (page - 1) * per_page
            page_rows = rows[start:start + per_page]

            # ── SP: sp_users_list — batch lookup for referrer/referred names ──
            all_users = call_proc('sp_users_list', 50000, 0)
            users_by_id = {u['id']: u for u in all_users}

            total_completed = sum(1 for r in all_rows if r.get('status') == 'completed')
            total_pending   = sum(1 for r in all_rows if r.get('status') == 'pending')

            return jsonify(
                response={
                    'referrals': [_ref_row(r, users_by_id) for r in page_rows],
                    'total': total,
                    'stats': {
                        'total_completed': total_completed,
                        'total_pending':   total_pending,
                    },
                },
                pagination={'page': page, 'pages': pages, 'total': total},
                status=200, bool=True
            )
        except Exception as e:
            logger.error(f"AdminReferralList.get: {e}")
            return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)}, status=500, bool=False)


def _rule_out(rule):
    from portal.helpers.referral_rewards import describe_rule
    out = {k: rule.get(k) for k in (
        'id', 'trigger_kind', 'referrer_audience', 'friend_audience',
        'cohort_count', 'pro_months', 'milestone_count',
        'referrer_kind', 'referrer_points', 'referrer_pro_days',
        'referrer_coupon_type', 'referrer_coupon_value', 'referrer_coupon_applies',
        'referrer_pay_amount', 'referrer_seats',
        'friend_kind', 'friend_points', 'friend_pro_days',
        'friend_coupon_type', 'friend_coupon_value', 'friend_coupon_applies',
        'friend_pay_amount', 'friend_seats',
    )}
    out['is_active'] = bool(rule.get('is_active'))
    out['summary'] = describe_rule(rule)
    # Friends who finish signup from this moment on count toward the rule.
    out['created_at'] = serialize_datetime(rule['created_at']) if rule.get('created_at') else None
    for key in ('referrer_coupon_value', 'friend_coupon_value', 'referrer_pay_amount', 'friend_pay_amount'):
        if out.get(key) is not None:
            out[key] = float(out[key])
    return out


@ns.route('/referral-rules')
class AdminReferralRules(Resource):
    @require_role('admin', 'super_admin')
    def get(self):
        try:
            rows = call_proc('sp_referral_rules_list') or []
            return jsonify(response={'rules': [_rule_out(r) for r in rows]}, status=200, bool=True)
        except Exception as e:
            logger.error(f"AdminReferralRules.get: {e}")
            return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)}, status=500, bool=False)

    @require_role('admin', 'super_admin')
    def post(self):
        try:
            from portal.helpers.referral_rewards import validate_rule, save_rule
            from portal.models import db
            data = request.get_json() or {}
            # An id edits (or pauses) that rule in place. Editing keeps the
            # rule's id and created_at, so friends already paid are not paid
            # again, which deleting and re-adding would risk.
            rule_id = (data.get('id') or '').strip() or None
            if rule_id and not any(r.get('id') == rule_id for r in (call_proc('sp_referral_rules_list') or [])):
                return jsonify(response={'message': 'That reward no longer exists.'}, status=404, bool=False)
            err = validate_rule(data)
            if err:
                return jsonify(response={'message': err}, status=400, bool=False)
            row = save_rule(data, get_jwt_identity(), rule_id)
            db.session.commit()
            return jsonify(response={'rule': _rule_out(row or {}), 'message': 'Reward saved.'}, status=200, bool=True)
        except Exception as e:
            from portal.models import db
            db.session.rollback()
            logger.error(f"AdminReferralRules.post: {e}")
            return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)}, status=500, bool=False)


@ns.route('/referral-rules/<string:rule_id>')
class AdminReferralRule(Resource):
    @require_role('admin', 'super_admin')
    def delete(self, rule_id):
        try:
            from portal.models import db
            call_proc_one('sp_referral_rule_delete', rule_id)
            db.session.commit()
            return jsonify(response={'message': 'Reward removed.'}, status=200, bool=True)
        except Exception as e:
            from portal.models import db
            db.session.rollback()
            logger.error(f"AdminReferralRule.delete: {e}")
            return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)}, status=500, bool=False)
