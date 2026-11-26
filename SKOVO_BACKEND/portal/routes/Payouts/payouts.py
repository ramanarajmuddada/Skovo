import re

from portal.helpers.error_capture import capture_error
from portal.helpers.helpers import serialize_datetime
from flask import jsonify
from flask_restx import Resource, reqparse
from flask_jwt_extended import jwt_required, get_jwt_identity, get_jwt
from portal.models import db
from sqlalchemy import text
from portal.helpers.sp import call_proc, call_proc_one
from portal.helpers import field_limits as FL
from portal.helpers.admin_notify import tell_admins
from . import ns, logger

request_parser = reqparse.RequestParser()
request_parser.add_argument('amount', type=float, location='json', required=True)
request_parser.add_argument('method', type=str,   location='json', required=False)
request_parser.add_argument('note',   type=str,   location='json', required=False)

# A real IFSC is four letters, a literal 0, then six alphanumerics -- exactly
# eleven characters. RBI has used that shape since the scheme began.
IFSC_PATTERN = re.compile(r'^[A-Z]{4}0[A-Z0-9]{6}$')

# A UPI VPA is handle@psp. The psp is always alphabetic (okicici, paytm, ybl),
# and both halves are at least two characters -- deliberately loose, because the
# authoritative check is the payment attempt and this only has to catch a typo.
UPI_PATTERN = re.compile(r'^[\w.-]{2,}@[a-zA-Z]{2,}$')

details_parser = reqparse.RequestParser()
details_parser.add_argument('payout_account_name',   type=str, location='json', required=False)
details_parser.add_argument('payout_account_number', type=str, location='json', required=False)
details_parser.add_argument('payout_ifsc',           type=str, location='json', required=False)
details_parser.add_argument('payout_upi',            type=str, location='json', required=False)


def _payout_dict(p):
    return {
        'id': p['id'],
        'amount': float(p.get('amount') or 0),
        'status': p.get('status'),
        'method': p.get('method'),
        'account_name': p.get('account_name'),
        'account_number': p.get('account_number'),
        'ifsc': p.get('ifsc'),
        'upi': p.get('upi'),
        'utr': p.get('utr'),
        'failure_reason': p.get('failure_reason'),
        'note': p.get('note'),
        'created_at': serialize_datetime(p['created_at']) if p.get('created_at') else None,
        'processed_at': serialize_datetime(p['processed_at']) if p.get('processed_at') else None,
    }


def _complete_destination(row):
    """One complete set: bank (name + number + IFSC) or UPI."""
    bank = bool(row.get('payout_account_name') and row.get('payout_account_number')
                and row.get('payout_ifsc'))
    upi = bool(row.get('payout_upi'))
    return bank, upi


@ns.route('/details')
class AchieverPayoutDetails(Resource):
    @jwt_required()
    def get(self):
        try:
            claims = get_jwt()
            if claims.get('role') != 'mentor':
                return jsonify(response={'message': 'Achiever access only.'}, status=403, bool=False)
            achiever_id = get_jwt_identity()
            # ── SP: sp_achievers_get ─────────────────────────────────────────────
            achiever = call_proc_one('sp_achievers_get', achiever_id)
            if not achiever:
                return jsonify(response={'message': 'Achiever not found.'}, status=404, bool=False)

            # ── SP: sp_achiever_earnings_summary.available_balance — same
            # calculation the payout request itself uses, so this figure and
            # the one enforced at request time never drift apart. Also fixes
            # the course-earnings gap in the old _available_balance() helper.
            summary = call_proc_one('sp_achiever_earnings_summary', achiever_id) or {}
            return jsonify(response={
                'payout_account_name':   achiever.get('payout_account_name'),
                'payout_account_number': achiever.get('payout_account_number'),
                'payout_ifsc':           achiever.get('payout_ifsc'),
                'payout_upi':            achiever.get('payout_upi'),
                'available_balance':     float(summary.get('available_balance') or 0),
                'in_escrow':             float(summary.get('in_escrow') or 0),
                'pending_payouts':       float(summary.get('pending_payouts') or 0),
                'total_paid_out':        float(summary.get('total_paid_out') or 0),
                'payout_min':            0,
                'total_earned':          float(summary.get('total_earned') or 0),
                # available_balance is clamped at zero, so a refund landing
                # after a payout travels as its own figure instead of rendering
                # a negative balance — which reads as a bug, not a debt.
                'clawback_due':          float(summary.get('clawback_due') or 0),
                # Reconciliation only. The ledger credits at pay time and
                # reverses the refunded proportion, so it is deliberately not a
                # second "earned" total to show beside the buckets.
                'ledger_balance':        float(summary.get('ledger_balance') or 0),
            }, status=200, bool=True)
        except Exception as e:
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @jwt_required()
    def put(self):
        try:
            claims = get_jwt()
            if claims.get('role') != 'mentor':
                return jsonify(response={'message': 'Achiever access only.'}, status=403, bool=False)
            achiever_id = get_jwt_identity()
            # ── SP: sp_achievers_get + _update (full replace) ───────────────────
            achiever = call_proc_one('sp_achievers_get', achiever_id)
            if not achiever:
                return jsonify(response={'message': 'Achiever not found.'}, status=404, bool=False)

            args = details_parser.parse_args(strict=False)

            def _incoming(key):
                """The submitted value, trimmed — or the stored one if absent.

                Trimming is not cosmetic here. `FL.too_long` measures the
                *stripped* length while the raw value is what reaches the
                column, so '   ' + 98 chars passed the check at 98 and then hit
                VARCHAR(100) at 101 — MySQL errno 1406, which is exactly the 500
                these checks exist to prevent. Trimming first makes the value
                that is measured and the value that is stored the same string.

                A field trimmed to nothing is stored as NULL rather than '': an
                empty UPI means "no UPI", and '' would satisfy the has_upi test
                in the payout request below and let someone request money with
                no destination.
                """
                if args.get(key) is None:
                    return achiever.get(key)
                return (args[key] or '').strip() or None

            payout_account_name = _incoming('payout_account_name')
            payout_account_number = _incoming('payout_account_number')
            payout_ifsc = _incoming('payout_ifsc')
            payout_upi = _incoming('payout_upi')

            # All four are VARCHAR and none was checked, so anything past the
            # column length was MySQL errno 1406 -- a 500 with an error id, on
            # the screen an achiever uses to get paid. X04-164..170.
            verr = FL.check_all([
                (payout_account_name, 'Account name', FL.ACCOUNT_NAME),
                (payout_account_number, 'Account number', FL.ACCOUNT_NUMBER),
                (payout_ifsc, 'IFSC', FL.IFSC),
                (payout_upi, 'UPI id', FL.UPI),
            ])
            if verr:
                return jsonify(response={'message': verr}, status=400, bool=False)

            # Length was checked; SHAPE was not. A malformed IFSC saved
            # cleanly here and failed at the bank -- after an admin had already
            # approved the payout, which is the worst possible moment to
            # discover it. The column is VARCHAR(20), which is why nothing ever
            # complained: a real IFSC is exactly 11 characters.
            if payout_ifsc and not IFSC_PATTERN.match(payout_ifsc.upper()):
                return jsonify(
                    response={'message': 'Enter a valid 11-character IFSC, e.g. HDFC0001234.'},
                    status=400, bool=False)

            if payout_upi and not UPI_PATTERN.match(payout_upi):
                return jsonify(
                    response={'message': 'Enter a valid UPI ID, e.g. name@bank.'},
                    status=400, bool=False)

            # An account number that is not digits is not an account number.
            # Kept separate from the IFSC message so the achiever is told which
            # of the two fields to look at.
            if payout_account_number and not payout_account_number.isdigit():
                return jsonify(
                    response={'message': 'Account number can contain digits only.'},
                    status=400, bool=False)

            bank_ok, upi_ok = _complete_destination({
                'payout_account_name': payout_account_name,
                'payout_account_number': payout_account_number,
                'payout_ifsc': payout_ifsc,
                'payout_upi': payout_upi,
            })
            if not bank_ok and not upi_ok:
                return jsonify(response={
                    'message': 'Add a complete bank account (name, number, IFSC) or a UPI ID.',
                }, status=400, bool=False)

            live_rate = db.session.execute(text(
                "SELECT session_rate FROM achievers WHERE id = :i"
            ), {'i': achiever_id}).scalar()

            call_proc_one(
                'sp_achievers_update',
                achiever_id, achiever.get('full_name'), achiever.get('achievement_title'), achiever.get('designation'),
                achiever.get('company'), achiever.get('bio'), achiever.get('avatar_url'), achiever.get('skills'),
                achiever.get('domain_id'), achiever.get('linkedin_url'), achiever.get('is_verified'),
                achiever.get('is_featured'), achiever.get('is_active'), achiever.get('email'), achiever.get('password_hash'),
                achiever.get('status'), achiever.get('phone'), achiever.get('profile_image_url'), achiever.get('domains'),
                achiever.get('suitable_for'), live_rate,
                payout_account_name, payout_account_number, payout_ifsc, payout_upi,
                achiever.get('created_by'), achiever_id,
            )
            db.session.commit()
            return jsonify(response={
                'message': 'Payout details saved.',
                'payout_account_name':   payout_account_name,
                'payout_account_number': payout_account_number,
                'payout_ifsc':           payout_ifsc,
                'payout_upi':            payout_upi,
            }, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/request')
class AchieverPayoutRequest(Resource):
    @jwt_required()
    def post(self):
        try:
            claims = get_jwt()
            if claims.get('role') != 'mentor':
                return jsonify(response={'message': 'Achiever access only.'}, status=403, bool=False)
            achiever_id = get_jwt_identity()
            # ── SP: sp_achievers_get ─────────────────────────────────────────────
            achiever = call_proc_one('sp_achievers_get', achiever_id)
            if not achiever:
                return jsonify(response={'message': 'Achiever not found.'}, status=404, bool=False)

            args = request_parser.parse_args()
            amount = float(args['amount'] or 0)
            method = args.get('method')

            has_bank, has_upi = _complete_destination({
                'payout_account_name': achiever.get('payout_account_name'),
                'payout_account_number': achiever.get('payout_account_number'),
                'payout_ifsc': achiever.get('payout_ifsc'),
                'payout_upi': achiever.get('payout_upi'),
            })
            if not has_bank and not has_upi:
                return jsonify(response={'message': 'Please save your payout details — a complete bank account or a UPI ID — before requesting a payout.'}, status=400, bool=False)

            if amount <= 0:
                return jsonify(response={'message': 'Amount must be greater than zero.'}, status=400, bool=False)

            # payout_requests.amount and sp_achiever_payout_request's parameter
            # are both DECIMAL(10,2), so anything past this is out of range
            # before the balance check below can refuse it -- an "Out of range
            # value" 500 rather than the readable refusal the SP would give.
            # X04-162. No real balance can reach this, so nothing legitimate is
            # turned away; it only catches a pasted or fuzzed number.
            MAX_PAYOUT = 99999999.99
            if amount > MAX_PAYOUT:
                return jsonify(response={'message': f'Amount must be {MAX_PAYOUT:,.2f} or less.'},
                               status=400, bool=False)

            if not method:
                method = 'upi' if (has_upi and not has_bank) else 'bank'
            if method == 'upi' and not has_upi:
                return jsonify(response={'message': 'Add a UPI ID before requesting a UPI payout.'}, status=400, bool=False)
            if method == 'bank' and not has_bank:
                return jsonify(response={'message': 'Add complete bank details (name, number, IFSC) before requesting a bank payout.'}, status=400, bool=False)

            # ── SP: sp_achiever_payout_request — recomputes the available
            # balance itself (cohorts + courses + sessions, minus paid/pending
            # payouts) inside one transaction, so it can't race with a
            # concurrent request the way a separate read-then-insert can.
            # It also fixes the same "course earnings missing" gap as
            # /portal/earnings, since it counts course_enrollments too.
            result = call_proc_one('sp_achiever_payout_request', achiever_id, amount, method, args.get('note')) or {}
            if not result.get('ok'):
                message = result.get('message') or 'Amount exceeds available balance.'
                return jsonify(response={'message': message, 'available_balance': float(result.get('available_balance') or 0)}, status=400, bool=False)
            db.session.commit()

            # ── SP: sp_payout_requests_get ───────────────────────────────────────
            payout = call_proc_one('sp_payout_requests_get', result['request_id'])
            try:   # tell the admins; an alert must never fail the request
                from portal.helpers.wallet import alert as _admin_alert
                _admin_alert('payout_request', payout['id'],
                             f"Payout request: {achiever.get('full_name') or 'Achiever'} asked for "
                             f"₹{float(amount):,.2f} by {method.upper()}.")
                db.session.commit()
            except Exception as _al:
                db.session.rollback()
                logger.warning(f"payout request alert failed: {_al}")
            tell_admins('Payout request',
                        f"{achiever.get('full_name') or 'An achiever'} asked for "
                        f"₹{amount:,.2f} by {'UPI' if method == 'upi' else 'bank transfer'}.",
                        reference_type='payout_request', reference_id=payout['id'])
            logger.info(f"Achiever {achiever_id} requested payout {payout['id']} for {amount} (via sp_achiever_payout_request)")
            return jsonify(response=_payout_dict(payout), status=201, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/')
class AchieverPayoutList(Resource):
    @jwt_required()
    def get(self):
        try:
            claims = get_jwt()
            if claims.get('role') != 'mentor':
                return jsonify(response={'message': 'Achiever access only.'}, status=403, bool=False)
            achiever_id = get_jwt_identity()

            # ── SP: sp_payout_requests_list — no by-achiever-id filter on the
            # generic CRUD proc, so pull a bounded batch and filter here. ──────
            all_payouts = call_proc('sp_payout_requests_list', 50000, 0)
            payouts = [p for p in all_payouts if p.get('achiever_id') == achiever_id]
            payouts.sort(key=lambda p: p.get('created_at') or '', reverse=True)

            return jsonify(response={
                'payouts': [_payout_dict(p) for p in payouts],
                'total': len(payouts),
            }, status=200, bool=True)
        except Exception as e:
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/<string:request_id>/lines')
class AchieverPayoutLines(Resource):
    @ns.doc(description='What one payout request was made of, frozen when it was raised.')
    @jwt_required()
    def get(self, request_id):
        """The earning rows behind a payout.

        Without these an achiever gets an amount and no way to check it — the
        classes that produced it may have been months ago, and the balance they
        were computed from has moved on since. The rows are written at request
        time, so they still say what was releasable when the money was asked
        for, not what is releasable today.
        """
        try:
            claims = get_jwt()
            if claims.get('role') != 'mentor':
                return jsonify(response={'message': 'Achiever access only.'}, status=403, bool=False)
            achiever_id = get_jwt_identity()

            # ── SP: sp_achiever_payout_lines — scopes to the achiever inside
            # the query, so a guessed request id from another account returns
            # nothing rather than someone else's earnings. ────────────────────
            own = db.session.execute(text("SELECT 1 FROM payout_requests WHERE id = :i AND achiever_id = :a"),
                                     {'i': request_id, 'a': achiever_id}).scalar()
            from portal.helpers.payout_lines import made_up_of
            rows = (made_up_of(request_id) or []) if own else []

            lines = [{
                'id': r.get('source_id'),
                'source_type': r.get('source_type'),
                'source_id': r.get('source_id'),
                'title': r.get('title'),
                'amount': float(r.get('amount') or 0),
                'earned': float(r.get('earned') or 0),
                'part': bool(r.get('part')),
                'occurred_at': serialize_datetime(r['occurred_at']) if r.get('occurred_at') else None,
            } for r in rows]

            return jsonify(response={
                'lines': lines,
                'total': round(sum(l['amount'] for l in lines), 2),
                'count': len(lines),
            }, status=200, bool=True)
        except Exception as e:
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)
