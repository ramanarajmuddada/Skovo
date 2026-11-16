from portal.helpers.error_capture import capture_error
from portal.helpers.helpers import serialize_datetime
import uuid
from flask import jsonify, request
from flask_restx import Resource
from flask_jwt_extended import jwt_required, get_jwt_identity
from portal.helpers.sp import call_proc, call_proc_one
from portal.models import db
from . import ns, logger


@ns.route('/my')
class MyReferrals(Resource):
    @jwt_required()
    def get(self):
        """Student: get their referral code and list of referrals made."""
        try:
            user_id = get_jwt_identity()
            from portal.helpers.referral_rewards import stable_code, describe_rule
            referral_code = stable_code(user_id)

            rows = call_proc('sp_referrals_by_referrer', user_id) or []
            grants = call_proc('sp_referral_grants_for', user_id) or []
            by_friend = {}
            for g in grants:
                if g.get('referrer_id') == user_id and g.get('friend_user_id'):
                    by_friend.setdefault(g.get('friend_user_id'), []).append(g.get('referrer_summary'))
            result = []
            for r in rows:
                ca = r.get('created_at')
                prizes = [p for p in by_friend.get(r.get('referred_user_id'), []) if p]
                result.append({
                    'id':             r.get('id'),
                    'referred_email': r.get('referred_email'),
                    'referred_name':  r.get('referred_name'),
                    'status':         r.get('status'),
                    'reward_given':   bool(prizes) or bool(r.get('reward_given')),
                    'reward':         ', '.join(prizes) if prizes else None,
                    'created_at':     serialize_datetime(ca) if ca else None,
                })

            rules = call_proc('sp_referral_rules_list') or []
            active = [
                describe_rule(rule) for rule in rules
                if rule.get('is_active')
                and (rule.get('referrer_audience') or 'student') == 'student'
                and (rule.get('friend_audience') or 'student') == 'student'
            ]
            mine = [g for g in grants if g.get('friend_user_id') == user_id and g.get('friend_summary')]
            completed = sum(1 for r in rows if r.get('status') == 'completed')
            return jsonify(response={
                'referral_code': referral_code,
                'referrals':     result,
                'total':         len(result),
                'completed':     completed,
                'rules':         active,
                'my_rewards':    [g.get('friend_summary') for g in mine],
            }, status=200, bool=True)
        except Exception as e:
            logger.error(f"MyReferrals.get: {e}")
            return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)}, status=500, bool=False)


@ns.route('/send')
class SendReferral(Resource):
    @jwt_required()
    def post(self):
        """Student: send a referral invite (records the referral)."""
        try:
            user_id = get_jwt_identity()
            data    = request.get_json() or {}
            email   = (data.get('email') or '').strip().lower()
            if not email or '@' not in email:
                return jsonify(response={'message': 'Valid email required.'}, status=400, bool=False)
            me = call_proc_one('sp_users_get', user_id) or {}
            if email == (me.get('email') or '').lower():
                return jsonify(response={'message': 'You cannot refer yourself.'}, status=400, bool=False)

            from portal.helpers.referral_rewards import stable_code
            code = f"{stable_code(user_id)}-{uuid.uuid4().hex[:5].upper()}"
            res = call_proc_one(
                'sp_referrals_send', str(uuid.uuid4()), user_id, email, code, 'student', 'student',
            )
            db.session.commit()
            if not res or not res.get('created'):
                return jsonify(response={'message': 'You already referred this email.'}, status=409, bool=False)

            # Send the actual invite email — never fail the request over it.
            try:
                import os
                from portal.helpers.email_template import send_email, simple_email_body
                from portal.helpers.sp import call_proc_one as _one
                referrer = _one('sp_users_get', user_id) or {}
                ref_name = referrer.get('full_name') or 'Your friend'
                base_url = (os.environ.get('FRONTEND_URL') or 'https://skovoai.com').rstrip('/')
                signup_url = f"{base_url}/signup?ref={stable_code(user_id)}"
                send_email(
                    email,
                    f"SKOVO — {ref_name} invited you!",
                    simple_email_body(
                        f"{ref_name} invited you to SKOVO",
                        f"{ref_name} thinks SKOVO can boost your career — live cohorts with industry "
                        f"achievers, 1-on-1 guidance sessions, mock tests and more. "
                        f"Sign up with referral code {code} to get started.",
                        signup_url, 'Join SKOVO',
                    ),
                )
            except Exception as mail_err:
                logger.warning(f"Referral recorded but invite email failed for {email}: {mail_err}")

            return jsonify(response={'message': 'Referral recorded and invite sent.', 'id': res.get('id')}, status=201, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"SendReferral.post: {e}")
            return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)}, status=500, bool=False)
