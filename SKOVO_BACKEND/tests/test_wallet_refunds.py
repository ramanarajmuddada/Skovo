"""SKOVO Wallet + refunds (feature-updates.md §15), against the real database.

Cashfree is never called: the gateway refund function is replaced in each
test that sends money back to a card / UPI.
"""
import datetime
import uuid

import pytest
from sqlalchemy import text

WCOLS = ('enabled', 'bonus_student_cancel_pct', 'bonus_staff_cancel_pct', 'bonus_cap_pct', 'bonus_expiry_months',
         'usable_on', 'reverse_mode', 'abuse_refunds', 'abuse_days', 'send_to_bank_days')


@pytest.fixture
def W(db, app, monkeypatch):
    before = db.session.execute(text(f"SELECT {', '.join(WCOLS)} FROM wallet_settings WHERE id = 1")).mappings().first()
    db.session.execute(text(
        "UPDATE wallet_settings SET enabled = 1, bonus_student_cancel_pct = 10, bonus_staff_cancel_pct = 15, "
        "bonus_cap_pct = 50, bonus_expiry_months = 6, usable_on = 'cohort,session,subscription', "
        "reverse_mode = 'full', abuse_refunds = 3, abuse_days = 30, send_to_bank_days = 90 WHERE id = 1"))
    db.session.commit()
    calls = []

    def fake_refund(order_no, amount, refund_id=None, note=''):
        calls.append((order_no, amount))
        return True, {'cf_refund_id': f'cf-{refund_id}', 'refund_arn': 'ARN123'}
    monkeypatch.setattr('portal.helpers.payments.refund_payment', fake_refund)
    made = {'users': [], 'orders': [], 'calls': calls}
    with app.app_context():
        yield made
    db.session.execute(text(f"UPDATE wallet_settings SET {', '.join(f'{c} = :{c}' for c in WCOLS)} WHERE id = 1"),
                       dict(before))
    for o in made['orders']:
        for t in ('refunds', 'credit_notes'):
            db.session.execute(text(f"DELETE FROM {t} WHERE order_id = :o"), {'o': o})
        db.session.execute(text("DELETE FROM payment_orders WHERE id = :o"), {'o': o})
    for u in made['users']:
        for t in ('wallet_ledger', 'wallet_bonus_lots', 'wallets', 'wallet_payout_requests', 'score_events',
                  'readiness_scores', 'notification_logs', 'subscriptions'):
            db.session.execute(text(f"DELETE FROM {t} WHERE user_id = :u"), {'u': u})
        db.session.execute(text("DELETE FROM admin_alerts WHERE ref LIKE :u"), {'u': f'{u}%'})
        db.session.execute(text("DELETE FROM users WHERE id = :u"), {'u': u})
    db.session.commit()


def student(db, W):
    uid = str(uuid.uuid4())
    db.session.execute(text("INSERT INTO users (id, full_name, email, status, created_at, updated_at) "
                            "VALUES (:i, 'Wallet Test', :e, 'active', UTC_TIMESTAMP(), UTC_TIMESTAMP())"),
                       {'i': uid, 'e': f'wallet-test-{uid}@skovo.test'})
    db.session.commit()
    W['users'].append(uid)
    return uid


def order(db, W, uid, gross, kind='cohort', status='paid'):
    oid = str(uuid.uuid4())
    db.session.execute(text(
        "INSERT INTO payment_orders (id, order_no, kind, student_id, currency, gross, discount, status, paid_at, "
        "created_at, updated_at) VALUES (:i, :n, :k, :u, 'INR', :g, 0, :s, UTC_TIMESTAMP(), UTC_TIMESTAMP(), UTC_TIMESTAMP())"),
        {'i': oid, 'n': f'WT-{oid[:12].upper()}', 'k': kind, 'u': uid, 'g': gross, 's': status})
    db.session.commit()
    W['orders'].append(oid)
    return oid


def bal(uid):
    from portal.helpers import wallet
    return wallet.balances(uid)


def test_wallet_refund_with_bonus(db, W):
    from portal.helpers.refunds import issue_refund
    u = student(db, W)
    o = order(db, W, u, 1000)
    ok, _ = issue_refund(o, None, 'test', u, destination='wallet', case_key='student_cancel')
    assert ok
    b = bal(u)
    assert (b['refund_money'], b['bonus_credit']) == (1000.0, 100.0)
    assert W['calls'] == []                                       # no gateway call
    r = db.session.execute(text("SELECT destination, bonus_amount, credit_note_no, status FROM refunds WHERE order_id = :o"),
                           {'o': o}).mappings().first()
    assert r['destination'] == 'wallet' and float(r['bonus_amount']) == 100 and r['credit_note_no']


def test_no_bonus_for_duplicate_payment(db, W):
    from portal.helpers.refunds import issue_refund
    u = student(db, W)
    o = order(db, W, u, 500)
    issue_refund(o, None, 'dup', u, destination='wallet', case_key='duplicate_payment')
    assert bal(u)['bonus_credit'] == 0


def test_original_refund_calls_gateway(db, W):
    from portal.helpers.refunds import issue_refund
    u = student(db, W)
    o = order(db, W, u, 700)
    ok, _ = issue_refund(o, None, 'test', u, destination='original', case_key='student_cancel')
    assert ok and W['calls'] and W['calls'][0][1] == 700
    assert bal(u)['total'] == 0
    arn = db.session.execute(text("SELECT arn FROM refunds WHERE order_id = :o"), {'o': o}).scalar()
    assert arn == 'ARN123'


def test_spend_bonus_first_capped_then_refund_money(db, W):
    from portal.helpers.refunds import issue_refund
    from portal.helpers import wallet
    u = student(db, W)
    issue_refund(order(db, W, u, 1000), None, 't', u, destination='wallet', case_key='student_cancel')  # 1000 + 100
    o2 = order(db, W, u, 1500, status='created')
    rest = wallet.apply_to_order(o2, u, 1500, 'cohort', True)
    db.session.commit()
    assert rest == 400.0                                          # 100 bonus + 1000 refund money
    assert bal(u)['total'] == 0
    row = db.session.execute(text("SELECT wallet_amount, wallet_bonus_used, gateway_amount FROM payment_orders WHERE id = :o"),
                             {'o': o2}).mappings().first()
    assert (float(row['wallet_amount']), float(row['wallet_bonus_used']), float(row['gateway_amount'])) == (1100, 100, 400)


def test_refund_of_split_order_returns_wallet_part_first(db, W):
    from portal.helpers.refunds import issue_refund
    from portal.helpers import wallet
    u = student(db, W)
    issue_refund(order(db, W, u, 1000), None, 't', u, destination='wallet', case_key='student_cancel')
    o2 = order(db, W, u, 1500, status='created')
    wallet.apply_to_order(o2, u, 1500, 'cohort', True)
    db.session.execute(text("UPDATE payment_orders SET status = 'paid' WHERE id = :o"), {'o': o2})
    db.session.commit()
    W['calls'].clear()
    ok, _ = issue_refund(o2, None, 'cancel', u, destination='original', case_key='student_cancel')
    assert ok
    assert W['calls'][0][1] == 400.0                              # only the card part to the bank
    b = bal(u)
    assert (b['refund_money'], b['bonus_credit']) == (1000.0, 100.0)


def test_failed_order_restores_wallet_part(db, W):
    from portal.helpers.refunds import issue_refund
    from portal.helpers import wallet
    u = student(db, W)
    issue_refund(order(db, W, u, 800), None, 't', u, destination='wallet', case_key='duplicate_payment')
    o2 = order(db, W, u, 1000, status='created')
    wallet.apply_to_order(o2, u, 1000, 'cohort', True)
    db.session.execute(text("UPDATE payment_orders SET status = 'failed' WHERE id = :o"), {'o': o2})
    db.session.commit()
    assert bal(u)['total'] == 0
    wallet.restore_failed_orders()
    db.session.commit()
    assert bal(u)['refund_money'] == 800.0
    wallet.restore_failed_orders()                                 # once only
    db.session.commit()
    assert bal(u)['refund_money'] == 800.0


def test_bonus_expires_refund_money_never(db, W):
    from portal.helpers import wallet
    u = student(db, W)
    wallet.credit_refund(u, 300, 'seed-r')
    wallet.credit_bonus(u, 50, 'seed-b', expires_at=datetime.datetime.utcnow() + datetime.timedelta(seconds=1))
    db.session.commit()
    db.session.execute(text("UPDATE wallet_bonus_lots SET expires_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 DAY) "
                            "WHERE user_id = :u"), {'u': u})
    db.session.commit()
    assert wallet.expire_bonus() >= 1
    db.session.commit()
    b = bal(u)
    assert (b['refund_money'], b['bonus_credit']) == (300.0, 0.0)


def test_wallet_disabled_falls_back_to_original(db, W):
    from portal.helpers.refunds import issue_refund
    db.session.execute(text("UPDATE wallet_settings SET enabled = 0 WHERE id = 1"))
    db.session.commit()
    u = student(db, W)
    o = order(db, W, u, 200)
    issue_refund(o, None, 't', u, destination='wallet', case_key='student_cancel')
    assert W['calls'] and bal(u)['total'] == 0


def test_pro_refund_removes_pro_and_reverses_points(db, W):
    from portal.helpers.refunds import issue_refund
    u = student(db, W)
    o = order(db, W, u, 999, kind='subscription')
    no = db.session.execute(text("SELECT order_no FROM payment_orders WHERE id = :o"), {'o': o}).scalar()
    db.session.execute(text("INSERT INTO subscriptions (id, user_id, plan, status, amount, started_at, expires_at, "
                            "payment_order_id, created_at, updated_at) VALUES (UUID(), :u, 'annual', 'active', 999, "
                            "UTC_TIMESTAMP(), DATE_ADD(UTC_TIMESTAMP(), INTERVAL 1 YEAR), :n, UTC_TIMESTAMP(), UTC_TIMESTAMP())"),
                       {'u': u, 'n': no})
    rule = db.session.execute(text("SELECT event_type FROM score_event_rules WHERE metric_key = 'pro_subscription' LIMIT 1")).scalar()
    if rule:
        db.session.execute(text("INSERT INTO score_events (id, user_id, event_type, points, ref_id) VALUES (UUID(), :u, :t, 20, 'x')"),
                           {'u': u, 't': rule})
    db.session.commit()
    ok, _ = issue_refund(o, None, 'pro', u, destination='wallet', case_key='pro_refund')
    assert ok
    st = db.session.execute(text("SELECT status FROM subscriptions WHERE user_id = :u"), {'u': u}).scalar()
    assert st == 'refunded'
    if rule:
        rev = db.session.execute(text("SELECT IFNULL(SUM(points), 0) FROM score_events WHERE user_id = :u "
                                      "AND event_type = 'refund_reversal'"), {'u': u}).scalar()
        assert float(rev) == -20.0


def test_abuse_alert_after_three_refunds(db, W):
    from portal.helpers.refunds import issue_refund
    u = student(db, W)
    for _ in range(3):
        issue_refund(order(db, W, u, 100), None, 't', u, destination='wallet', case_key='student_cancel')
    n = db.session.execute(text("SELECT COUNT(*) FROM admin_alerts WHERE kind = 'refund_abuse' AND ref LIKE :u"),
                           {'u': f'{u}%'}).scalar()
    assert n == 1


def test_send_to_bank_rules(db, W):
    from portal.helpers.refunds import issue_refund
    from portal.helpers import wallet
    u = student(db, W)
    issue_refund(order(db, W, u, 600), None, 't', u, destination='wallet', case_key='student_cancel')
    rid, err = wallet.request_payout(u, 10000)
    assert err
    rid, err = wallet.request_payout(u, 600)
    db.session.commit()
    assert rid and not err
    W['calls'].clear()
    ok, msg = wallet.decide_payout(rid, True, None)
    db.session.commit()
    assert ok and W['calls'][0][1] == 600.0
    assert bal(u)['refund_money'] == 0.0


def test_refund_more_than_left_is_refused(db, W):
    from portal.helpers.refunds import issue_refund
    u = student(db, W)
    o = order(db, W, u, 300)
    ok, info = issue_refund(o, 500, 't', u, destination='wallet')
    assert not ok
