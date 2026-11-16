"""Cashfree Payouts: Admin Pay starts a transfer; paid only on SUCCESS + UTR.

A PENDING create response must not flip the ledger. TRANSFER_SUCCESS with a UTR
does. There is no payout minimum — ₹153 is a real withdrawal once it is available.
"""
import base64
import hashlib
import hmac
import json
import os
import time
import uuid

import pytest
from flask_jwt_extended import create_access_token
from sqlalchemy import text

from portal.helpers.cashfree import CashfreeError

WEBHOOK = '/v1/webhooks/cashfree'
ADMIN_PAYOUTS = '/v1/skovo-platform-panel-admin/payouts'
TEST_PREFIX = 'payout-xfer-test-'


@pytest.fixture
def client(app):
    return app.test_client()


def body(resp):
    payload = resp.get_json()
    assert payload is not None, f'no JSON body: {resp.data[:200]}'
    return payload


def signed_headers(payload, extra=None):
    secret = (os.environ.get('CASHFREE_WEBHOOK_SECRET')
              or os.environ.get('CASHFREE_SECRET_KEY_PRODUCTION')
              or os.environ.get('CASHFREE_SECRET_KEY_SANDBOX')
              or os.environ.get('CASHFREE_SECRET_KEY') or '')
    raw = json.dumps(payload).encode('utf-8')
    ts = str(int(time.time()))
    digest = hmac.new(secret.encode('utf-8'), ts.encode('utf-8') + raw, hashlib.sha256).digest()
    headers = {'x-webhook-signature': base64.b64encode(digest).decode(),
               'x-webhook-timestamp': ts, 'Content-Type': 'application/json'}
    if extra:
        headers.update(extra)
    return raw, headers


@pytest.fixture
def ready(app, db):
    from portal.helpers.sql_file import column_exists
    with app.app_context():
        if not column_exists('payout_requests', 'transfer_id'):
            pytest.skip('payout_requests.transfer_id is not on this database yet')
        n = db.session.execute(text("""
            SELECT COUNT(*) FROM information_schema.ROUTINES
             WHERE ROUTINE_SCHEMA = DATABASE()
               AND ROUTINE_NAME IN (
                   'sp_admin_payout_mark_processing',
                   'sp_admin_payout_mark_failed',
                   'sp_admin_payout_approve')
        """)).scalar()
        if n != 3:
            pytest.skip('payout transfer procedures are not loaded on this database yet')
        params = db.session.execute(text("""
            SELECT COUNT(*) FROM information_schema.PARAMETERS
             WHERE SPECIFIC_SCHEMA = DATABASE()
               AND SPECIFIC_NAME = 'sp_admin_payout_approve'
        """)).scalar()
        if params != 3:
            pytest.skip('sp_admin_payout_approve has not been reloaded with the UTR argument')


@pytest.fixture
def world(app, db, ready):
    aid = str(uuid.uuid4())
    admin_id = str(uuid.uuid4())
    db.session.execute(text("""
        INSERT INTO achievers (id, full_name, email, state, status, is_active,
                               is_verified, created_at, updated_at)
        VALUES (:i, 'Payout Transfer Test', :e, 'active', 'active', 1, 1,
                UTC_TIMESTAMP(), UTC_TIMESTAMP())
    """), {'i': aid, 'e': f'{TEST_PREFIX}{aid}@skovo.test'})
    db.session.execute(text("""
        INSERT INTO admins (id, full_name, email, password_hash, status, state, created_at)
        VALUES (:i, 'Payout Admin', :e, 'x', 'active', 'active', UTC_TIMESTAMP())
    """), {'i': admin_id, 'e': f'{TEST_PREFIX}{admin_id}@skovo.test'})
    db.session.commit()
    created = []

    def make_request(*, amount=153, status='pending', method='upi',
                     transfer_id=None, upi='xfer@bank'):
        rid = str(uuid.uuid4())
        db.session.execute(text("""
            INSERT INTO payout_requests
                (id, achiever_id, amount, status, method, account_name,
                 account_number, ifsc, upi, transfer_id, created_at)
            VALUES (:i, :a, :amt, :st, :m, 'Test Achiever', NULL, NULL, :u, :t,
                    UTC_TIMESTAMP())
        """), {'i': rid, 'a': aid, 'amt': amount, 'st': status, 'm': method,
               'u': upi, 't': transfer_id})
        db.session.commit()
        created.append(rid)
        return rid

    yield {'achiever': aid, 'admin': admin_id, 'request': make_request}

    for rid in created:
        db.session.execute(text('DELETE FROM ledger_entries WHERE payout_id = :i'), {'i': rid})
        db.session.execute(text('DELETE FROM audit_logs WHERE resource_id = :i'), {'i': rid})
        db.session.execute(text('DELETE FROM payout_request_lines WHERE request_id = :i'), {'i': rid})
        db.session.execute(text(
            "DELETE FROM payment_events WHERE provider_event_id LIKE :p"
        ), {'p': f'%{rid.replace("-", "")[:32]}%'})
        db.session.execute(text('DELETE FROM payout_requests WHERE id = :i'), {'i': rid})
    db.session.execute(text('DELETE FROM payout_requests WHERE achiever_id = :a'), {'a': aid})
    db.session.execute(text('DELETE FROM achievers WHERE id = :i'), {'i': aid})
    db.session.execute(text('DELETE FROM admins WHERE id = :i'), {'i': admin_id})
    db.session.commit()


def admin_headers(admin_id):
    return {'Authorization': 'Bearer ' + create_access_token(
        identity=str(admin_id),
        additional_claims={'role': 'admin', 'full_name': 'Payout Admin'})}


def status_of(db, rid):
    return db.session.execute(
        text('SELECT status FROM payout_requests WHERE id = :i'), {'i': rid}
    ).scalar()


@pytest.mark.case('PAYOUT-001')
def test_pay_with_a_pending_gateway_response_does_not_mark_paid(
        app, db, world, monkeypatch):
    """Admin Pay is a transfer start, not a ledger write."""
    rid = world['request']()

    def fake_create(*args, **kwargs):
        return {'data': {'status': 'PENDING', 'cf_transfer_id': 'cf-pending'}}

    monkeypatch.setattr('portal.helpers.cashfree.create_payout_transfer', fake_create)

    from portal.helpers.payout_transfer import initiate_payout
    with app.app_context():
        ok, payload, http = initiate_payout(rid, world['admin'])

    assert ok is True, payload
    assert http == 200, payload
    assert payload.get('status') == 'processing', payload
    assert status_of(db, rid) == 'processing'
    paid = db.session.execute(text(
        "SELECT COUNT(*) FROM ledger_entries WHERE payout_id = :i AND entry_type = 'payout'"
    ), {'i': rid}).scalar()
    assert paid == 0, 'a PENDING transfer wrote a payout ledger debit'


@pytest.mark.case('PAYOUT-002')
def test_transfer_success_with_utr_marks_paid(app, db, world, monkeypatch):
    rid = world['request']()

    monkeypatch.setattr(
        'portal.helpers.cashfree.create_payout_transfer',
        lambda *a, **k: {'status': 'PENDING'})

    from portal.helpers.payout_transfer import initiate_payout, apply_transfer_result
    with app.app_context():
        ok, payload, http = initiate_payout(rid, world['admin'])
        assert ok and payload.get('status') == 'processing', payload
        transfer_id = payload['transfer_id']
        applied = apply_transfer_result(transfer_id, 'SUCCESS', 'HDFC000UTR153',
                                        admin_id=world['admin'])

    assert applied.get('applied') is True, applied
    assert applied.get('status') == 'paid', applied
    row = db.session.execute(text(
        'SELECT status, utr FROM payout_requests WHERE id = :i'
    ), {'i': rid}).mappings().first()
    assert row['status'] == 'paid', dict(row)
    assert row['utr'] == 'HDFC000UTR153'
    n = db.session.execute(text(
        "SELECT COUNT(*) FROM ledger_entries WHERE payout_id = :i AND entry_type = 'payout'"
    ), {'i': rid}).scalar()
    assert n == 1, 'SUCCESS did not write the payout debit'


@pytest.mark.case('PAYOUT-003')
def test_webhook_success_marks_paid_and_stores_utr(app, client, db, world, monkeypatch):
    rid = world['request']()
    monkeypatch.setattr(
        'portal.helpers.cashfree.create_payout_transfer',
        lambda *a, **k: {'status': 'RECEIVED'})

    from portal.helpers.payout_transfer import initiate_payout
    with app.app_context():
        ok, payload, http = initiate_payout(rid, world['admin'])
    assert ok, payload
    transfer_id = payload['transfer_id']

    event = {
        'type': 'TRANSFER_SUCCESS',
        'data': {
            'transfer_id': transfer_id,
            'status': 'SUCCESS',
            'transfer_utr': 'YESB000UTR99',
        },
    }
    raw, headers = signed_headers(event, extra={'x-webhook-id': uuid.uuid4().hex})
    resp = client.post(WEBHOOK, data=raw, headers=headers)
    assert resp.status_code == 200, resp.data

    row = db.session.execute(text(
        'SELECT status, utr FROM payout_requests WHERE id = :i'
    ), {'i': rid}).mappings().first()
    assert row['status'] == 'paid', dict(row)
    assert row['utr'] == 'YESB000UTR99'


@pytest.mark.case('PAYOUT-004')
def test_admin_pay_via_http_does_not_mark_paid_on_pending(
        app, client, db, world, monkeypatch):
    rid = world['request']()
    monkeypatch.setattr(
        'portal.helpers.cashfree.create_payout_transfer',
        lambda *a, **k: {'status': 'PENDING'})

    with app.app_context():
        hdr = admin_headers(world['admin'])
    d = body(client.patch(f'{ADMIN_PAYOUTS}/{rid}', json={'status': 'paid'}, headers=hdr))
    assert d['status'] == 200, d
    assert d['response'].get('status') == 'processing', d
    assert status_of(db, rid) == 'processing'
    assert db.session.execute(text(
        "SELECT COUNT(*) FROM ledger_entries WHERE payout_id = :i"
    ), {'i': rid}).scalar() == 0


@pytest.mark.case('PAYOUT-005')
def test_a_failed_transfer_stays_reserved_and_can_be_retried(
        app, db, world, monkeypatch):
    rid = world['request']()

    def boom(*args, **kwargs):
        raise CashfreeError('insufficient funds', status=422, body='insufficient funds')

    monkeypatch.setattr('portal.helpers.cashfree.create_payout_transfer', boom)

    from portal.helpers.payout_transfer import initiate_payout
    with app.app_context():
        ok, payload, http = initiate_payout(rid, world['admin'])
    assert ok is False, payload
    assert http == 502, payload
    assert status_of(db, rid) == 'failed'
    assert db.session.execute(text(
        "SELECT COUNT(*) FROM ledger_entries WHERE payout_id = :i"
    ), {'i': rid}).scalar() == 0

    monkeypatch.setattr(
        'portal.helpers.cashfree.get_payout_transfer',
        lambda *a, **k: (_ for _ in ()).throw(CashfreeError('missing', status=404)))
    monkeypatch.setattr(
        'portal.helpers.cashfree.create_payout_transfer',
        lambda *a, **k: {'status': 'PENDING'})
    with app.app_context():
        ok, payload, http = initiate_payout(rid, world['admin'])
    assert ok is True, payload
    assert payload.get('status') == 'processing', payload
    assert status_of(db, rid) == 'processing'


@pytest.mark.case('PAYOUT-006')
def test_reject_is_refused_while_a_transfer_is_in_flight(app, client, db, world):
    rid = world['request'](status='processing', transfer_id='P' + 'a' * 32 + '01')
    with app.app_context():
        hdr = admin_headers(world['admin'])
    d = body(client.patch(f'{ADMIN_PAYOUTS}/{rid}', json={'status': 'rejected'}, headers=hdr))
    assert d['status'] == 409, d
    assert status_of(db, rid) == 'processing'


@pytest.mark.case('PAYOUT-007')
def test_immediate_success_from_create_marks_paid(app, db, world, monkeypatch):
    rid = world['request']()
    monkeypatch.setattr(
        'portal.helpers.cashfree.create_payout_transfer',
        lambda *a, **k: {'status': 'SUCCESS', 'transfer_utr': 'IMPSUTR1'})

    from portal.helpers.payout_transfer import initiate_payout
    with app.app_context():
        ok, payload, http = initiate_payout(rid, world['admin'])
    assert ok is True, payload
    assert payload.get('status') == 'paid', payload
    row = db.session.execute(text(
        'SELECT status, utr FROM payout_requests WHERE id = :i'
    ), {'i': rid}).mappings().first()
    assert row['status'] == 'paid'
    assert row['utr'] == 'IMPSUTR1'


@pytest.mark.case('PAYOUT-008')
def test_a_transfer_webhook_signed_with_the_payout_secret_is_accepted(
        app, client, db, world, monkeypatch):
    """Cashfree signs TRANSFER_* with the **payout** client secret.

    Every other test here signs with the PG pair, which is what most accounts
    use for both products — so the separate-pair case, the one
    CASHFREE_PAYOUT_CLIENT_SECRET_* exists for, went uncovered. Verified
    against the PG secret alone it is a clean 400: the money moves, no webhook
    lands, and the request sits on `processing` with nothing to release it.
    """
    monkeypatch.setenv('CASHFREE_PAYOUT_CLIENT_SECRET', 'payout-only-secret')
    monkeypatch.delenv('CASHFREE_PAYOUT_CLIENT_SECRET_SANDBOX', raising=False)
    monkeypatch.delenv('CASHFREE_PAYOUT_CLIENT_SECRET_PRODUCTION', raising=False)

    rid = world['request']()
    monkeypatch.setattr(
        'portal.helpers.cashfree.create_payout_transfer',
        lambda *a, **k: {'status': 'RECEIVED'})

    from portal.helpers.payout_transfer import initiate_payout
    with app.app_context():
        ok, payload, _ = initiate_payout(rid, world['admin'])
    assert ok, payload
    transfer_id = payload['transfer_id']

    event = {
        'type': 'TRANSFER_SUCCESS',
        'data': {
            'transfer_id': transfer_id,
            'status': 'SUCCESS',
            'transfer_utr': 'YESB000UTR77',
        },
    }
    raw = json.dumps(event).encode('utf-8')
    ts = str(int(time.time()))
    digest = hmac.new(b'payout-only-secret', ts.encode('utf-8') + raw, hashlib.sha256).digest()
    headers = {
        'x-webhook-signature': base64.b64encode(digest).decode(),
        'x-webhook-timestamp': ts,
        'Content-Type': 'application/json',
        'x-webhook-id': uuid.uuid4().hex,
    }

    resp = client.post(WEBHOOK, data=raw, headers=headers)
    assert resp.status_code == 200, resp.data

    row = db.session.execute(text(
        'SELECT status, utr FROM payout_requests WHERE id = :i'
    ), {'i': rid}).mappings().first()
    assert row['status'] == 'paid', dict(row)
    assert row['utr'] == 'YESB000UTR77'


@pytest.mark.case('PAYOUT-009')
def test_pay_repolls_a_processing_request_instead_of_refusing(
        app, db, world, monkeypatch):
    """A dropped TRANSFER_* webhook must not strand the payout.

    Reject refuses a live transfer by design and no scheduler polls, so Pay is
    the only way back. It re-asks Cashfree rather than sending again: a SUCCESS
    that never reached us as a webhook settles the request here.
    """
    rid = world['request'](status='processing', transfer_id='PXFERSTUCK01')

    def _sent_after_all(transfer_id):
        assert transfer_id == 'PXFERSTUCK01'
        return {'status': 'SUCCESS', 'transfer_utr': 'YESB000UTR55'}

    monkeypatch.setattr(
        'portal.helpers.cashfree.get_payout_transfer', _sent_after_all)
    # A second send would be a double payout — fail loudly if one is attempted.
    monkeypatch.setattr(
        'portal.helpers.cashfree.create_payout_transfer',
        lambda *a, **k: pytest.fail('re-poll must not start a second transfer'))

    from portal.helpers.payout_transfer import initiate_payout
    with app.app_context():
        ok, payload, http = initiate_payout(rid, world['admin'])

    assert ok and http == 200, payload
    row = db.session.execute(text(
        'SELECT status, utr, transfer_id FROM payout_requests WHERE id = :i'
    ), {'i': rid}).mappings().first()
    assert row['status'] == 'paid', dict(row)
    assert row['utr'] == 'YESB000UTR55'
    assert row['transfer_id'] == 'PXFERSTUCK01', dict(row)
