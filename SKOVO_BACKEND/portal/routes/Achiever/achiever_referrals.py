"""Achiever Refer & Earn. Admin sets the prize. The achiever only shares a link."""
import os
import uuid

from flask import jsonify, request
from flask_jwt_extended import get_jwt, get_jwt_identity, jwt_required
from flask_restx import Resource

from portal.helpers.error_capture import capture_error
from portal.helpers.helpers import serialize_datetime
from portal.helpers.sp import call_proc, call_proc_one
from portal.models import db
from portal.routes.Achiever.achiever import _achievers_ns as ns

import logging
logger = logging.getLogger('skovo')


def _mine():
    """The achiever, if their state unlocks Refer & Earn (probation or active).
    A pending achiever's link would not resolve, so the page is closed too."""
    claims = get_jwt()
    if claims.get('role') != 'mentor':
        return None, jsonify(response={'message': 'Achiever access only.'}, status=403, bool=False)
    from portal.helpers.trust import require_screen
    achiever_id = get_jwt_identity()
    blocked = require_screen(achiever_id, 'referrals',
                             'Refer & Earn opens once your account is approved.')
    if blocked:
        return None, blocked
    return achiever_id, None


@ns.route('/portal/referrals')
class AchieverReferrals(Resource):
    @jwt_required()
    def get(self):
        try:
            achiever_id, err = _mine()
            if err:
                return err
            from portal.helpers.referral_rewards import achiever_code, describe_rule
            code = achiever_code(achiever_id)
            rows = call_proc('sp_referrals_by_referrer', achiever_id) or []
            grants = call_proc('sp_referral_grants_for', achiever_id) or []
            by_friend = {}
            for g in grants:
                if g.get('referrer_id') == achiever_id and g.get('friend_user_id'):
                    by_friend.setdefault(g.get('friend_user_id'), []).append(g.get('referrer_summary'))
            result = []
            for r in rows:
                prizes = [p for p in by_friend.get(r.get('referred_user_id'), []) if p]
                result.append({
                    'id': r.get('id'),
                    'referred_email': r.get('referred_email'),
                    'referred_name': r.get('referred_name'),
                    'friend_audience': r.get('friend_audience') or 'student',
                    'status': r.get('status'),
                    'reward': ', '.join(prizes) if prizes else None,
                    'created_at': serialize_datetime(r.get('created_at')) if r.get('created_at') else None,
                })
            rules = call_proc('sp_referral_rules_list') or []
            active = [
                describe_rule(rule) for rule in rules
                if rule.get('is_active') and (rule.get('referrer_audience') or 'student') == 'achiever'
            ]
            mine = [g for g in grants if g.get('friend_user_id') == achiever_id and g.get('friend_summary')]
            return jsonify(response={
                'referral_code': code,
                'student_link': f"/signup?ref={code}",
                'achiever_link': f"/skovo-achiever-portal/register?ref={code}",
                'referrals': result,
                'total': len(result),
                'completed': sum(1 for r in rows if r.get('status') == 'completed'),
                'rules': active,
                'my_rewards': [g.get('friend_summary') for g in mine],
            }, status=200, bool=True)
        except Exception as e:
            logger.error(f"AchieverReferrals.get: {e}")
            return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)}, status=500, bool=False)


@ns.route('/portal/referrals/send')
class AchieverReferralSend(Resource):
    @jwt_required()
    def post(self):
        try:
            achiever_id, err = _mine()
            if err:
                return err
            data = request.get_json() or {}
            email = (data.get('email') or '').strip().lower()
            audience = (data.get('friend_audience') or 'student').strip()
            if audience not in ('student', 'achiever'):
                return jsonify(response={'message': 'Choose a student or an achiever.'}, status=400, bool=False)
            if not email or '@' not in email:
                return jsonify(response={'message': 'Valid email required.'}, status=400, bool=False)
            me = call_proc_one('sp_achievers_get', achiever_id) or {}
            if email == (me.get('email') or '').lower():
                return jsonify(response={'message': 'You cannot refer yourself.'}, status=400, bool=False)

            from portal.helpers.referral_rewards import achiever_code
            code = f"{achiever_code(achiever_id)}-{uuid.uuid4().hex[:5].upper()}"
            res = call_proc_one(
                'sp_referrals_send', str(uuid.uuid4()), achiever_id, email, code, 'achiever', audience,
            )
            db.session.commit()
            if not res or not res.get('created'):
                return jsonify(response={'message': 'You already referred this email.'}, status=409, bool=False)

            try:
                from portal.helpers.email_template import send_email, simple_email_body
                ref_name = me.get('full_name') or 'An achiever'
                from portal.helpers.achiever_notify import achiever_url
                # Students sign up on the student site; achievers register on the achiever portal (skovoai.info).
                base = (os.environ.get('FRONTEND_URL') or 'https://skovoai.com').rstrip('/')
                stable = achiever_code(achiever_id)
                if audience == 'achiever':
                    url = achiever_url(f"/register?ref={stable}")
                    body = f"{ref_name} invited you to join SKOVO as an achiever. Sign up with referral code {stable}."
                    label = 'Join as an achiever'
                else:
                    url = f"{base}/signup?ref={stable}"
                    body = f"{ref_name} invited you to SKOVO. Sign up with referral code {stable}."
                    label = 'Join SKOVO'
                send_email(email, f"SKOVO — {ref_name} invited you", simple_email_body(
                    f"{ref_name} invited you", body, url, label,
                ))
            except Exception as mail_err:
                logger.warning(f"Achiever referral recorded but email failed for {email}: {mail_err}")

            return jsonify(response={'message': 'Referral recorded and invite sent.'}, status=201, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"AchieverReferralSend.post: {e}")
            return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)}, status=500, bool=False)
