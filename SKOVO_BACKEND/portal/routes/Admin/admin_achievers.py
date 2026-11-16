from portal.helpers.error_capture import capture_error
from portal.helpers.helpers import serialize_datetime
import datetime
import json
import uuid
from flask import jsonify, request
from flask_restx import Resource, reqparse
from flask_jwt_extended import jwt_required, get_jwt, get_jwt_identity
from werkzeug.security import generate_password_hash
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from portal.models import db
from portal.helpers.sp import call_proc, call_proc_one
from . import ns, logger
from portal.helpers.admin_auth import can, AREA_USERS, AREA_FINANCE

verify_parser = reqparse.RequestParser()
verify_parser.add_argument('is_verified', type=bool, location='json', required=True)

feature_parser = reqparse.RequestParser()
feature_parser.add_argument('is_featured', type=bool, location='json', required=True)

create_parser = reqparse.RequestParser()
create_parser.add_argument('full_name',         type=str,  location='json', required=True)
create_parser.add_argument('achievement_title', type=str,  location='json', required=False)
create_parser.add_argument('designation',       type=str,  location='json', required=False)
create_parser.add_argument('company',           type=str,  location='json', required=False)
create_parser.add_argument('bio',               type=str,  location='json', required=False)
create_parser.add_argument('avatar_url',        type=str,  location='json', required=False)
create_parser.add_argument('domain_id',         type=str,  location='json', required=False)
create_parser.add_argument('linkedin_url',      type=str,  location='json', required=False)
create_parser.add_argument('skills',            type=list, location='json', required=False)
create_parser.add_argument('is_verified',       type=bool, location='json', required=False)
create_parser.add_argument('is_featured',       type=bool, location='json', required=False)
# Optional mentor login fields
create_parser.add_argument('email',             type=str,  location='json', required=False)
create_parser.add_argument('password',          type=str,  location='json', required=False)
create_parser.add_argument('phone',             type=str,  location='json', required=False)
create_parser.add_argument('profile_image_url', type=str,  location='json', required=False)
create_parser.add_argument('domains',           type=list, location='json', required=False)

update_parser = reqparse.RequestParser()
update_parser.add_argument('full_name',         type=str,  location='json', required=False)
update_parser.add_argument('achievement_title', type=str,  location='json', required=False)
update_parser.add_argument('designation',       type=str,  location='json', required=False)
update_parser.add_argument('company',           type=str,  location='json', required=False)
update_parser.add_argument('bio',               type=str,  location='json', required=False)
update_parser.add_argument('avatar_url',        type=str,  location='json', required=False)
update_parser.add_argument('domain_id',         type=str,  location='json', required=False)
update_parser.add_argument('linkedin_url',      type=str,  location='json', required=False)
update_parser.add_argument('skills',            type=list, location='json', required=False)
update_parser.add_argument('is_verified',       type=bool, location='json', required=False)
update_parser.add_argument('is_featured',       type=bool, location='json', required=False)
# Optional mentor login fields
update_parser.add_argument('email',             type=str,  location='json', required=False)
update_parser.add_argument('password',          type=str,  location='json', required=False)
update_parser.add_argument('phone',             type=str,  location='json', required=False)
update_parser.add_argument('profile_image_url', type=str,  location='json', required=False)
update_parser.add_argument('domains',           type=list, location='json', required=False)
update_parser.add_argument('status',            type=str,  location='json', required=False)


def _as_list(v):
    if isinstance(v, str):
        try:
            return json.loads(v)
        except Exception:
            return []
    return v or []


def _achiever_row_dict(m, domains_by_id=None):
    """Serialize a dict row (as returned by call_proc_one/call_proc)."""
    if not m:
        return None
    domain_id = m.get('domain_id')
    if domains_by_id is not None:
        domain = domains_by_id.get(domain_id)
    else:
        # ── SP: sp_domains_get ──────────────────────────────────────────────
        domain = call_proc_one('sp_domains_get', domain_id) if domain_id else None
    created_at = m.get('created_at')
    return {
        'id':                m.get('id'),
        'full_name':         m.get('full_name'),
        'achievement_title': m.get('achievement_title'),
        'designation':       m.get('designation'),
        'company':           m.get('company'),
        'bio':               m.get('bio'),
        'avatar_url':        m.get('avatar_url'),
        'domain_id':         domain_id,
        'domain_name':       domain.get('name') if domain else None,
        'linkedin_url':      m.get('linkedin_url'),
        'skills':            _as_list(m.get('skills')),
        'is_verified':       bool(m.get('is_verified')),
        'is_featured':       bool(m.get('is_featured')),
        'is_active':         bool(m.get('is_active')),
        'email':             m.get('email'),
        'phone':             m.get('phone'),
        'profile_image_url': m.get('profile_image_url'),
        'domains':           _as_list(m.get('domains')),
        'status':            m.get('status'),
        'has_mentor_login':  bool(m.get('email')),
        'created_at':        serialize_datetime(created_at) if created_at else None,
        # Needed by the Manage tab, which refuses to render the seats control
        # unless the current value is known -- showing "Unlimited" for someone
        # capped at 2 and then saving that guess would quietly remove their cap.
        # So the key must be present even when it is None (None = uncapped).
        'cohort_seat_allocation': m.get('cohort_seat_allocation'),
        # Where this achiever stands in the lifecycle, and why.
        #
        # `status` above is the account flag; `state` is pending / probation /
        # active / suspended / banned. The Achievers screen listed designation,
        # company and domain but had no way to show which achievers were
        # suspended or banned -- on the screen whose whole job is managing them.
        # The Manage tab knew, because it fetches the record again; the list did
        # not, because this dict never carried it.
        'state':             m.get('state'),
        'state_reason':      m.get('state_reason'),
        # How they are DOING, not what they claim to be.
        #
        # The directory listed designation, company and domain -- three things
        # the achiever typed about themselves -- and nothing about their
        # standing. An admin scanning 200 achievers for the ones needing
        # attention (stuck on demos, suspended, on a negotiated rate) had to
        # open every record to find out. These all sit on the same row the list
        # already reads, so none of it costs a query.
        'demos_done':        int(m.get('demo_sessions_done') or 0),
        'demos_required':    int(m.get('demo_sessions_required') or 0) or None,
        'session_rate':      m.get('session_rate'),
        'standing':          m.get('standing'),
    }


# order matches sp_achievers_create/_update after (id, full_name)
_ACHIEVER_FIELDS = [
    ('achievement_title', None), ('designation', None), ('company', None), ('bio', None),
    ('avatar_url', None), ('skills', 'json'), ('domain_id', None), ('linkedin_url', None),
    ('is_verified', 'bool'), ('is_featured', 'bool'), ('is_active', 'bool'), ('email', None),
    ('password_hash', None), ('status', None), ('phone', None), ('profile_image_url', None),
    ('domains', 'json'), ('suitable_for', 'json'), ('session_rate', None),
    ('payout_account_name', None), ('payout_account_number', None), ('payout_ifsc', None), ('payout_upi', None),
]


def _achiever_sp_args(aid, full_name, d, existing=None):
    existing = existing or {}
    args = [aid, full_name]
    for field, caster in _ACHIEVER_FIELDS:
        if field in d:
            v = d[field]
            if caster == 'json':
                v = json.dumps(v) if v is not None else None
            elif caster == 'bool':
                v = 1 if v else 0
            args.append(v)
        else:
            args.append(existing.get(field))
    return args


@ns.route('/achievers')
class AdminAchieverList(Resource):
    @jwt_required()
    def get(self):
        try:
            claims = get_jwt()
            if not can(AREA_USERS):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)

            # ── SP: sp_achievers_list + sp_domains_list (batch domain lookup) ──
            rows = call_proc('sp_achievers_list', 5000, 0, 0)
            achievers = [a for a in rows if a.get('is_active')]
            achievers.sort(key=lambda a: a.get('created_at') or '', reverse=True)

            all_domains = call_proc('sp_domains_list', 1000, 0, 0)
            domains_by_id = {d['id']: d for d in all_domains}

            # Commission for every achiever on the page, in two queries rather
            # than one per row. sp_commission_for_achiever answers for a single
            # achiever and the list needs all of them, so calling it per row
            # would be N round trips to render one table.
            #
            # Same rule it applies: an achiever-scoped active rule wins,
            # otherwise the global default. A rate of None on the row therefore
            # means "on the platform default", which is what the column prints.
            overrides = {
                r[0]: float(r[1])
                for r in db.session.execute(text(
                    "SELECT scope_id, rate FROM commission_rules "
                    " WHERE is_active = 1 AND scope = 'achiever' AND scope_id IS NOT NULL"
                )).fetchall() if r[1] is not None
            }
            out = []
            for a in achievers:
                row = _achiever_row_dict(a, domains_by_id)
                own = overrides.get(row['id'])
                # This achiever's OWN rate, or nothing.
                #
                # It used to fall back to the global default, so every achiever
                # without a negotiated rate displayed "10% (default)" -- a number
                # that reads as a decision someone made about that person when
                # nobody had. Commission is agreed per achiever, at approval out
                # of probation, so "not set yet" is the honest answer and the one
                # an admin can act on.
                #
                # Stored 0-1, shown as a percentage.
                row['commission_percent'] = round(own * 100, 2) if own is not None else None
                out.append(row)

            return jsonify(response={'achievers': out}, status=200, bool=True)
        except Exception as e:
            logger.error(f"Error in GET /admin/achievers: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    # ─────────────────────────────────────────────────────────────────────────
    # Removed on purpose: POST /achievers.
    #
    # It created a full achiever account with a password the admin chose, which
    # is the one thing the access model forbids — an account made this way has
    # credentials its owner never picked, and every action under it is deniable.
    # It also skipped the entire pipeline: an admin-created achiever had no
    # documents reviewed, no demo sessions and no student reviews, yet could be
    # marked verified on the way in.
    #
    # Achievers self-register and are approved through
    # /achiever-lifecycle/<id>/approve-application. No screen called this.
    # ─────────────────────────────────────────────────────────────────────────



@ns.route('/achievers/<string:achiever_id>')
class AdminAchieverDetail(Resource):
    @jwt_required()
    def put(self, achiever_id):
        try:
            claims = get_jwt()
            if not can(AREA_USERS):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)

            # ── SP: sp_achievers_get + _update (full replace) ──────────────────
            achiever = call_proc_one('sp_achievers_get', achiever_id)
            if not achiever or not achiever.get('is_active'):
                return jsonify(response={'message': 'Achiever not found.'}, status=404, bool=False)

            args = update_parser.parse_args()
            data = {k: v for k, v in args.items() if v is not None}

            # Email: check uniqueness before updating
            new_email = (args.get('email') or '').strip().lower() or None
            if new_email is not None and new_email != achiever.get('email'):
                all_achievers = call_proc('sp_achievers_list', 5000, 0, 0)
                if any(a.get('email') == new_email and a.get('id') != achiever_id for a in all_achievers):
                    return jsonify(response={'message': 'Email already in use.'}, status=409, bool=False)
                data['email'] = new_email
                if not achiever.get('status'):
                    data['status'] = 'active'

            # Password: only update if a new one was provided
            new_pw = (args.get('password') or '').strip() or None
            if new_pw:
                if len(new_pw) < 6:
                    return jsonify(response={'message': 'Password must be at least 6 characters.'}, status=400, bool=False)
                data['password_hash'] = generate_password_hash(new_pw)
            data.pop('password', None)

            admin_id = get_jwt_identity()
            sp_args = _achiever_sp_args(achiever_id, data.get('full_name', achiever['full_name']), data, achiever) + [achiever.get('created_by'), admin_id]
            updated = call_proc_one('sp_achievers_update', *sp_args)
            db.session.commit()

            # `is_verified` no longer grants anything. It was mirrored into a
            # trust tier here because every guard read the tier; guards now read
            # `state`, which moves only through the lifecycle procedures — an
            # admin ticking a box must not skip document review and demos.

            logger.info(f"Admin updated achiever {achiever_id} (via sp_achievers_update)")
            return jsonify(response={'message': 'Achiever updated.', 'achiever': _achiever_row_dict(updated)}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in PUT /admin/achievers/{achiever_id}: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @jwt_required()
    def delete(self, achiever_id):
        try:
            claims = get_jwt()
            if not can(AREA_USERS):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)

            # ── SP: sp_achievers_get + _update (deactivate) ────────────────────
            achiever = call_proc_one('sp_achievers_get', achiever_id)
            if not achiever or not achiever.get('is_active'):
                return jsonify(response={'message': 'Achiever not found.'}, status=404, bool=False)

            data = {'is_active': False}
            if achiever.get('status') == 'active':
                data['status'] = 'inactive'

            admin_id = get_jwt_identity()
            sp_args = _achiever_sp_args(achiever_id, achiever['full_name'], data, achiever) + [achiever.get('created_by'), admin_id]
            call_proc_one('sp_achievers_update', *sp_args)
            db.session.commit()

            logger.info(f"Admin soft-deleted achiever {achiever_id} (via sp_achievers_update)")
            return jsonify(response={'message': 'Achiever deleted.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in DELETE /admin/achievers/{achiever_id}: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


# ─────────────────────────────────────────────────────────────────────────────
# Removed on purpose: PATCH /achievers/<id>/verify.
#
# A single "verified" toggle is not what verification is any more. An achiever
# becomes trusted by a sequence — documents accepted, application approved,
# three demo sessions run, real student reviews read — and each step is a
# separate decision with its own audit row.
#
# The endpoint delegated to the trust ladder, which no longer decides anything,
# and no screen called it. Verification now runs through
# /achiever-lifecycle/<id>/approve-application and /achiever-lifecycle/<id>/probation.
# ─────────────────────────────────────────────────────────────────────────────



@ns.route('/achievers/<string:achiever_id>/feature')
class AdminAchieverFeature(Resource):
    @ns.doc(description="Admin: feature/unfeature an achiever on the student-facing browse screen.")
    @jwt_required()
    def patch(self, achiever_id):
        try:
            claims = get_jwt()
            if not can(AREA_USERS):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)

            args = feature_parser.parse_args()

            # ── SP: sp_admin_achiever_feature ────────────────────────────────
            achiever = call_proc_one(
                'sp_admin_achiever_feature',
                achiever_id, 1 if args['is_featured'] else 0, get_jwt_identity(),
            )
            db.session.commit()
            if not achiever:
                return jsonify(response={'message': 'Achiever not found.'}, status=404, bool=False)

            logger.info(f"Admin {'featured' if args['is_featured'] else 'unfeatured'} achiever {achiever_id} (via sp_admin_achiever_feature)")
            return jsonify(response={'message': 'Achiever featured status updated.', 'achiever': _achiever_row_dict(achiever)}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in PATCH /admin/achievers/{achiever_id}/feature: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/achievers/<string:achiever_id>/commission')
class AdminAchieverCommission(Resource):
    """What SKOVO keeps from this achiever's sales, and how to change it.

    Commission is never a constant in code. It resolves from commission_rules,
    where a rule naming one achiever beats the platform default — so a
    negotiated rate is data, not a deploy.
    """

    @jwt_required()
    def get(self, achiever_id):
        try:
            if not can(AREA_FINANCE) and not can(AREA_USERS):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)

            # ── SP: sp_commission_for_achiever ────────────────────────────────
            row = call_proc_one('sp_commission_for_achiever', achiever_id) or {}
            own = row.get('rate')
            global_rate = row.get('global_rate')

            return jsonify(response={
                'effective_rate': float(own if own is not None else (global_rate or 0)),
                'global_rate': float(global_rate or 0),
                # Which of the two is actually being applied. "30%" alone does
                # not tell an admin whether changing the platform default would
                # move this achiever.
                'source': 'achiever' if own is not None else 'platform_default',
                'own_rate': float(own) if own is not None else None,
                'note': row.get('note'),
                'since': serialize_datetime(row['effective_from']) if row.get('effective_from') else None,
            }, status=200, bool=True)
        except Exception as e:
            logger.error(f"GET commission for {achiever_id}: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id},
                           status=500, bool=False)

    @jwt_required()
    def put(self, achiever_id):
        """Set this achiever's own rate. Sent as a percentage, stored as a ratio."""
        try:
            if not can(AREA_FINANCE):
                return jsonify(response={'message': 'Finance access required'}, status=403, bool=False)

            data = request.get_json() or {}
            raw = data.get('percent')
            if raw is None or str(raw).strip() == '':
                return jsonify(response={'message': 'A commission percentage is required.'},
                               status=400, bool=False)
            try:
                percent = float(raw)
            except (TypeError, ValueError):
                return jsonify(response={'message': 'Commission must be a number.'},
                               status=400, bool=False)
            if percent < 0 or percent > 100:
                return jsonify(response={'message': 'Commission must be between 0 and 100 percent.'},
                               status=400, bool=False)

            note = (data.get('note') or '').strip() or None

            try:
                # ── SP: sp_commission_set_for_achiever — closes the old rule and
                # opens a new one, so an order priced last month can still be
                # explained by the rule that was live then. ───────────────────
                call_proc_one('sp_commission_set_for_achiever', achiever_id,
                              round(percent / 100.0, 4), note, get_jwt_identity())
            except Exception as sp_err:
                db.session.rollback()
                msg = str(sp_err)
                if 'ACHIEVER_NOT_FOUND' in msg:
                    return jsonify(response={'message': 'Achiever not found.'}, status=404, bool=False)
                if 'RATE_OUT_OF_RANGE' in msg:
                    return jsonify(response={'message': 'Commission must be between 0 and 100 percent.'},
                                   status=400, bool=False)
                raise

            db.session.commit()
            return jsonify(response={
                'message': f'Commission set to {percent:g}% for this achiever.',
                'effective_rate': round(percent / 100.0, 4),
                'source': 'achiever',
            }, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"PUT commission for {achiever_id}: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id},
                           status=500, bool=False)

    @jwt_required()
    def delete(self, achiever_id):
        """Drop the achiever's own rate; they fall back to the platform default."""
        try:
            if not can(AREA_FINANCE):
                return jsonify(response={'message': 'Finance access required'}, status=403, bool=False)
            call_proc_one('sp_commission_clear_for_achiever', achiever_id)
            db.session.commit()
            return jsonify(response={'message': 'This achiever now uses the platform default.'},
                           status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"DELETE commission for {achiever_id}: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id},
                           status=500, bool=False)

