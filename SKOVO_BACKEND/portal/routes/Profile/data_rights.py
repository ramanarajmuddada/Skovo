"""Data download and account deletion — DPDP Act (feature-updates.md §16 item 14).

GET  /profile/my-data            everything SKOVO holds about me, as JSON
POST /profile/delete-account     {confirm: "DELETE", forfeit_wallet: bool}

Deletion rules:
  * wallet refund money must go back to the original payment method first
    (send-to-bank), or the student explicitly gives it up (forfeit_wallet)
  * bonus credit is forfeited
  * the account is anonymised and removed from leaderboards, leagues, buddy
    streaks and communities; ledgers stay (anonymised) as records require
"""
from portal.helpers.error_capture import capture_error
import datetime
import uuid
from flask import jsonify, request
from flask_restx import Resource
from flask_jwt_extended import jwt_required, get_jwt_identity
from sqlalchemy import text
from portal.models import db
from . import ns, logger

EXPORT = [
    ('profile', "SELECT * FROM user_profiles WHERE user_id = :u"),
    ('stages', "SELECT * FROM student_stages WHERE user_id = :u"),
    ('readiness', "SELECT score, level, base_points, decay_points FROM readiness_scores WHERE user_id = :u"),
    ('points_history', "SELECT event_type, points, occurred_at FROM score_events WHERE user_id = :u ORDER BY seq"),
    ('streak', "SELECT * FROM career_streaks WHERE user_id = :u"),
    ('streak_days', "SELECT day, kind FROM streak_days WHERE user_id = :u ORDER BY day"),
    ('quiz_attempts', "SELECT task_id, attempt_no, score, total, percent, submitted_at FROM quiz_attempts WHERE user_id = :u"),
    ('task_submissions', "SELECT task_id, status, evidence_url, evidence_text, mentor_score, submitted_at FROM task_submissions WHERE user_id = :u"),
    ('enrollments', "SELECT cohort_id, payment_status, amount_paid, enrolled_at FROM cohort_enrollments WHERE user_id = :u"),
    ('payments', "SELECT order_no, kind, gross, status, paid_at, refunded_amount FROM payment_orders WHERE student_id = :u"),
    ('wallet', "SELECT kind, type, amount, reason, created_at FROM wallet_ledger WHERE user_id = :u ORDER BY id"),
    ('coins', "SELECT delta, reason, created_at FROM coin_ledger WHERE user_id = :u ORDER BY id"),
    ('communities', "SELECT group_id, role, status, joined_at FROM group_memberships WHERE user_id = :u"),
    ('community_messages', "SELECT group_id, body, created_at FROM community_messages WHERE sender_id = :u AND deleted_at IS NULL"),
    ('leaderboard_profile', "SELECT alias, hide_photo FROM lb_profiles WHERE user_id = :u"),
    ('consents', "SELECT consent_type, policy_version, granted, created_at FROM user_consents WHERE user_id = :u"),
    ('notifications', "SELECT title, body, created_at FROM notification_logs WHERE user_id = :u ORDER BY created_at DESC LIMIT 500"),
]


def _ser(v):
    if hasattr(v, 'isoformat'):
        return v.isoformat()
    if v.__class__.__name__ == 'Decimal':
        return float(v)
    if isinstance(v, (bytes, bytearray)):
        return '[encrypted]'
    return v


@ns.route('/my-data')
class MyData(Resource):
    @jwt_required()
    def get(self):
        try:
            me = get_jwt_identity()
            user = db.session.execute(text("SELECT id, full_name, email, created_at FROM users WHERE id = :u"),
                                      {'u': me}).mappings().first()
            out = {'account': {k: _ser(v) for k, v in dict(user or {}).items()},
                   'exported_at': datetime.datetime.utcnow().isoformat() + 'Z'}
            for name, sql in EXPORT:
                try:
                    rows = db.session.execute(text(sql), {'u': me}).mappings().all()
                    out[name] = [{k: _ser(v) for k, v in dict(r).items() if k not in ('phone',)} for r in rows]
                except Exception as e:                       # noqa: BLE001  (a missing table never blocks the export)
                    logger.warning(f"my-data section {name} skipped: {e}")
                    db.session.rollback()
            return jsonify(response=out, status=200, bool=True)
        except Exception as e:
            logger.error(f"GET /profile/my-data: {e}")
            return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)},
                           status=500, bool=False)


def delete_account(user_id, requested_by='student', forfeit_wallet=False):
    """-> (ok, message). The caller commits."""
    from portal.helpers import wallet
    bal = wallet.balances(user_id)
    if bal['refund_money'] > 0 and not forfeit_wallet:
        return False, (f"You have ₹{bal['refund_money']:.0f} refund money in your SKOVO Wallet. Send it back to your "
                       "bank first, or confirm that you give it up.")
    db.session.execute(text(
        "INSERT INTO account_deletions (id, user_id, requested_by, wallet_refund_money, wallet_bonus, forfeited_wallet) "
        "VALUES (:i, :u, :r, :m, :b, :f)"),
        {'i': str(uuid.uuid4()), 'u': user_id, 'r': requested_by, 'm': bal['refund_money'], 'b': bal['bonus_credit'],
         'f': 1 if forfeit_wallet else 0})
    if bal['refund_money'] > 0:
        wallet._lock(user_id)
        wallet._ledger(user_id, 'refund', 'expire', -bal['refund_money'], f'deleted-{user_id}', reason='account deleted')
    db.session.execute(text("UPDATE wallet_bonus_lots SET remaining = 0 WHERE user_id = :u"), {'u': user_id})
    anon = f"deleted-{user_id[:8]}@deleted.skovo"
    db.session.execute(text(
        "UPDATE users SET full_name = 'Deleted student', email = :e, phone = NULL, avatar_url = NULL, "
        "status = 'deleted', deleted_at = UTC_TIMESTAMP(), updated_at = UTC_TIMESTAMP() WHERE id = :u"),
        {'e': anon, 'u': user_id})
    db.session.execute(text("UPDATE user_profiles SET phone = NULL WHERE user_id = :u"), {'u': user_id})
    db.session.execute(text(
        "INSERT INTO lb_profiles (user_id, removed, removed_reason) VALUES (:u, 1, 'account deleted') "
        "ON DUPLICATE KEY UPDATE removed = 1, removed_reason = 'account deleted'"), {'u': user_id})
    db.session.execute(text("UPDATE buddy_streaks SET status = 'ended', ended_at = UTC_TIMESTAMP() "
                            "WHERE (user_a = :u OR user_b = :u) AND status IN ('pending', 'active')"), {'u': user_id})
    db.session.execute(text("UPDATE group_memberships SET status = 'left' WHERE user_id = :u AND role <> 'owner'"),
                       {'u': user_id})
    db.session.execute(text("DELETE FROM follows WHERE follower_id = :u OR followee_id = :u"), {'u': user_id})
    return True, 'Your account has been deleted.'


@ns.route('/delete-account')
class DeleteAccount(Resource):
    @jwt_required()
    def post(self):
        try:
            d = request.get_json() or {}
            if d.get('confirm') != 'DELETE':
                return jsonify(response={'message': 'Type DELETE to confirm.'}, status=400, bool=False)
            ok, msg = delete_account(get_jwt_identity(), 'student', d.get('forfeit_wallet') in (True, 1, '1', 'true'))
            if not ok:
                db.session.rollback()
                return jsonify(response={'message': msg, 'needs_wallet_decision': True}, status=409, bool=False)
            db.session.commit()
            return jsonify(response={'message': msg}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"POST /profile/delete-account: {e}")
            return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)},
                           status=500, bool=False)
