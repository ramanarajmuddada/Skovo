"""
BhaAI v1 routes.

GET  /bhaai/quota  what this student may do today, and starter questions.
                   Never calls the model: opening the page costs nothing.
POST /bhaai/ask    one question, one model call, a short grounded reply.

Membership is read live on every request (is_pro), so a lapsed plan stops
chatting at once. The allowance is reserved before the model is called and
released if the call fails, so a provider outage does not eat a question.
"""
import uuid

from flask import jsonify, request
from flask_jwt_extended import decode_token, get_jwt, get_jwt_identity, jwt_required
from flask_limiter.util import get_remote_address
from flask_restx import Resource

from portal.helpers import bhaai, llm
from portal.helpers.error_capture import capture_error
from portal.helpers.rate_limit import limiter
from portal.helpers.sp import call_proc_one
from portal.models import db
from . import ns, logger


def _per_student():
    """One burst budget per signed-in student, not per shared college Wi-Fi."""
    auth = (request.headers.get('Authorization') or '').strip()
    if auth.lower().startswith('bearer '):
        try:
            ident = decode_token(auth.split(None, 1)[1].strip()).get('sub')
            if ident:
                return f'bhaai:{ident}'
        except Exception:
            pass
    return get_remote_address()


def _student_only():
    """Students only: achievers and admins carry a role claim and are refused."""
    role = (get_jwt() or {}).get('role')
    if role in ('mentor', 'admin', 'super_admin'):
        return jsonify(response={'message': 'BhaAI is for students.'}, status=403, bool=False)
    return None


def _is_pro(user_id):
    from portal.routes.Subscription.subscription import is_pro
    return is_pro(user_id)


@ns.route('/quota')
class BhaAIQuota(Resource):
    @ns.doc(description='Today\'s BhaAI allowance and starter questions. No model call.')
    @jwt_required()
    def get(self):
        try:
            blocked = _student_only()
            if blocked:
                return blocked
            user_id = get_jwt_identity()
            pro = _is_pro(user_id)
            return jsonify(response={
                'enabled': llm.is_configured(),
                'is_pro': pro,
                'quota': bhaai.quota(user_id, pro),
                'starters': bhaai.starters(user_id),
                'max_chars': bhaai.MAX_QUESTION_CHARS,
            }, status=200, bool=True)
        except Exception as e:
            logger.error(f"GET /bhaai/quota: {e}")
            return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)},
                           status=500, bool=False)


@ns.route('/ask')
class BhaAIAsk(Resource):
    decorators = [limiter.limit("6 per minute;40 per hour", key_func=_per_student)]

    @ns.doc(description='Ask BhaAI one question. Returns { reply, links, quota }.')
    @jwt_required()
    def post(self):
        usage_id = None
        try:
            blocked = _student_only()
            if blocked:
                return blocked
            user_id = get_jwt_identity()
            data = request.get_json(silent=True) or {}
            question = str(data.get('message') or '').strip()
            if not question:
                return jsonify(response={'message': 'Type a question first.'}, status=400, bool=False)
            if len(question) > bhaai.MAX_QUESTION_CHARS:
                return jsonify(response={'message': f'Keep it under {bhaai.MAX_QUESTION_CHARS} characters.'},
                               status=400, bool=False)

            if not llm.is_configured():
                return jsonify(response={'message': 'BhaAI is not switched on yet.', 'code': 'not_configured'},
                               status=503, bool=False)

            pro = _is_pro(user_id)
            limit = bhaai.daily_limit(pro)
            if limit == 0:
                return jsonify(response={'message': 'BhaAI chat is part of Skovo Pro.', 'code': 'pro_required',
                                         'quota': bhaai.quota(user_id, pro)},
                               status=403, bool=False)

            usage_id = str(uuid.uuid4())
            res = call_proc_one('sp_bhaai_usage_reserve', usage_id, user_id, llm.model_name(),
                                bhaai.day_start_utc(), limit) or {}
            db.session.commit()
            if not int(res.get('reserved') or 0):
                usage_id = None
                return jsonify(response={
                    'message': "You've used today's BhaAI questions. They reset at midnight."
                               + ('' if pro else ' Skovo Pro gives you more.'),
                    'code': 'quota', 'quota': bhaai.quota(user_id, pro),
                }, status=429, bool=False)

            messages = bhaai.build_messages(bhaai.fact_sheet(user_id, pro), question, data.get('history'))
            try:
                text, usage = llm.chat(messages, max_tokens=bhaai.MAX_REPLY_TOKENS)
            except (llm.LLMError, llm.LLMNotConfigured) as e:
                logger.error(f"BhaAI model call failed for {user_id}: {e}")
                call_proc_one('sp_bhaai_usage_finish', usage_id, 'failed', None, None)
                db.session.commit()
                usage_id = None
                return jsonify(response={
                    'message': "BhaAI couldn't answer just now. Try again in a minute; this one didn't count.",
                    'code': 'unavailable', 'quota': bhaai.quota(user_id, pro),
                }, status=502, bool=False)

            call_proc_one('sp_bhaai_usage_finish', usage_id, 'done',
                          usage.get('input_tokens'), usage.get('output_tokens'))
            db.session.commit()
            usage_id = None
            reply, links = bhaai.split_reply(text)
            return jsonify(response={
                'reply': reply or "I don't have enough in your Skovo data to answer that yet.",
                'links': links,
                'quota': bhaai.quota(user_id, pro),
            }, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            if usage_id:
                # Never leave a reserved question counting against the student.
                try:
                    call_proc_one('sp_bhaai_usage_finish', usage_id, 'failed', None, None)
                    db.session.commit()
                except Exception:
                    db.session.rollback()
            logger.error(f"POST /bhaai/ask: {e}")
            return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)},
                           status=500, bool=False)
