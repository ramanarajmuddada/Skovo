from portal.helpers.error_capture import capture_error
from portal.helpers.helpers import serialize_datetime
import json
import uuid
from flask import jsonify
from flask_restx import Resource, reqparse
from flask_jwt_extended import get_jwt_identity
from werkzeug.security import generate_password_hash
from sqlalchemy.exc import IntegrityError
from portal.models import db
from portal.helpers.sp import call_proc, call_proc_one
from portal.helpers.audit import log_audit
from portal.helpers.decorators import require_role
from . import ns, logger

profile_parser = reqparse.RequestParser()
profile_parser.add_argument('bio',               type=str,  location='json', required=False)
profile_parser.add_argument('designation',       type=str,  location='json', required=False)
profile_parser.add_argument('company',           type=str,  location='json', required=False)
profile_parser.add_argument('linkedin_url',      type=str,  location='json', required=False)
profile_parser.add_argument('domains',           type=list, location='json', required=False)
profile_parser.add_argument('skills',            type=list, location='json', required=False)
profile_parser.add_argument('profile_image_url', type=str,  location='json', required=False)
profile_parser.add_argument('is_verified',       type=bool, location='json', required=False)
profile_parser.add_argument('is_active',         type=bool, location='json', required=False)


def _as_list(v):
    if isinstance(v, str):
        try:
            return json.loads(v)
        except Exception:
            return []
    return v or []


def _mentor_dict(a, mentee_counts):
    created_at = a.get('created_at')
    return {
        'mentor_id':         a.get('id'),
        'full_name':         a.get('full_name'),
        'email':             a.get('email'),
        'bio':               a.get('bio'),
        'designation':       a.get('designation'),
        'company':           a.get('company'),
        'phone':             a.get('phone'),
        'linkedin_url':      a.get('linkedin_url'),
        'domains':           _as_list(a.get('domains')),
        'skills':            _as_list(a.get('skills')),
        'profile_image_url': a.get('profile_image_url'),
        'is_active':         bool(a.get('is_active')),
        'is_verified':       bool(a.get('is_verified')),
        'mentee_count':      mentee_counts.get(a.get('id'), 0),
        'created_at':        serialize_datetime(created_at) if created_at else None,
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


@ns.route('/achiever-accounts')
class AdminMentorList(Resource):
    @require_role('admin', 'super_admin')
    def get(self):
        try:
            # ── SP: sp_achievers_list + sp_achiever_mentees_list ──────────────
            rows = call_proc('sp_achievers_list', 5000, 0, 0)
            mentors = [a for a in rows if a.get('email')]
            mentors.sort(key=lambda a: a.get('created_at') or '', reverse=True)

            all_mentees = call_proc('sp_achiever_mentees_list', 100000, 0)
            mentee_counts = {}
            for m in all_mentees:
                if m.get('status') == 'active':
                    mentee_counts[m.get('mentor_id')] = mentee_counts.get(m.get('mentor_id'), 0) + 1

            return jsonify(response={'mentors': [_mentor_dict(a, mentee_counts) for a in mentors]}, status=200, bool=True)
        except Exception as e:
            logger.error(f"Error in GET /admin/mentors: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @require_role('admin', 'super_admin')
    def post(self):
        try:
            parser = reqparse.RequestParser()
            parser.add_argument('full_name',         type=str,  location='json', required=True)
            parser.add_argument('email',             type=str,  location='json', required=True)
            parser.add_argument('phone',             type=str,  location='json', required=False)
            parser.add_argument('password',          type=str,  location='json', required=True)
            parser.add_argument('bio',               type=str,  location='json', required=False)
            parser.add_argument('designation',       type=str,  location='json', required=False)
            parser.add_argument('company',           type=str,  location='json', required=False)
            parser.add_argument('linkedin_url',      type=str,  location='json', required=False)
            parser.add_argument('domains',           type=list, location='json', required=False)
            parser.add_argument('skills',            type=list, location='json', required=False)
            parser.add_argument('profile_image_url', type=str,  location='json', required=False)
            args = parser.parse_args(strict=False)

            email = args['email'].strip().lower()

            admin_id = get_jwt_identity()
            data = dict(args)
            data['email'] = email
            data['password_hash'] = generate_password_hash(args['password'])
            data['status'] = 'active'
            data['is_active'] = True
            data['is_verified'] = False

            # ── SP: sp_achievers_create — uq_achievers_email enforces the
            # duplicate check via IntegrityError. ─────────────────────────────
            try:
                achiever_id = str(uuid.uuid4())
                sp_args = _achiever_sp_args(achiever_id, args['full_name'].strip(), data) + [admin_id, admin_id]
                call_proc_one('sp_achievers_create', *sp_args)
                db.session.commit()
            except IntegrityError:
                db.session.rollback()
                return jsonify(response={'message': 'Email already registered.'}, status=409, bool=False)

            log_audit('mentor.created', 'mentor', achiever_id, actor_id=admin_id, meta={'email': email})

            return jsonify(response={'message': 'Mentor account created.', 'mentor_id': achiever_id}, status=201, bool=True)

        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in POST /admin/mentors: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/achiever-accounts/<string:mentor_id>')
class AdminMentorDetail(Resource):
    @require_role('admin', 'super_admin')
    def put(self, mentor_id):
        try:
            # ── SP: sp_achievers_get + _update (full replace) ──────────────────
            achiever = call_proc_one('sp_achievers_get', mentor_id)
            if not achiever or not achiever.get('email'):
                return jsonify(response={'message': 'Mentor not found.'}, status=404, bool=False)

            args = profile_parser.parse_args(strict=False)
            data = {k: v for k, v in args.items() if v is not None}
            if 'is_active' in data:
                data['status'] = 'active' if data['is_active'] else 'inactive'

            admin_id = get_jwt_identity()
            sp_args = _achiever_sp_args(mentor_id, achiever['full_name'], data, achiever) + [achiever.get('created_by'), admin_id]
            call_proc_one('sp_achievers_update', *sp_args)
            db.session.commit()
            return jsonify(response={'message': 'Mentor updated.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in PUT /admin/achiever-accounts/{mentor_id}: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @require_role('admin', 'super_admin')
    def delete(self, mentor_id):
        try:
            # ── SP: sp_achievers_get + _update (deactivate) ────────────────────
            achiever = call_proc_one('sp_achievers_get', mentor_id)
            if not achiever or not achiever.get('email'):
                return jsonify(response={'message': 'Mentor not found.'}, status=404, bool=False)

            admin_id = get_jwt_identity()
            sp_args = _achiever_sp_args(
                mentor_id, achiever['full_name'], {'is_active': False, 'status': 'inactive'}, achiever
            ) + [achiever.get('created_by'), admin_id]
            call_proc_one('sp_achievers_update', *sp_args)
            db.session.commit()
            return jsonify(response={'message': 'Mentor deactivated.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in DELETE /admin/achiever-accounts/{mentor_id}: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/achiever-accounts/<string:mentor_id>/mentees')
class AdminAchieverMentees(Resource):
    @require_role('admin', 'super_admin')
    def post(self, mentor_id):
        try:
            # ── SP: sp_achievers_get, sp_users_get, sp_achiever_mentees_list/_create ─
            achiever = call_proc_one('sp_achievers_get', mentor_id)
            if not achiever or not achiever.get('email'):
                return jsonify(response={'message': 'Mentor not found.'}, status=404, bool=False)

            parser = reqparse.RequestParser()
            parser.add_argument('user_id', type=str, location='json', required=True)
            args = parser.parse_args(strict=False)

            mentee = call_proc_one('sp_users_get', args['user_id'])
            if not mentee or mentee.get('deleted_at'):
                return jsonify(response={'message': 'Student not found.'}, status=404, bool=False)

            existing_links = call_proc('sp_achiever_mentees_list', 100000, 0)
            if any(m.get('mentor_id') == mentor_id and m.get('mentee_id') == mentee['id'] and m.get('status') == 'active' for m in existing_links):
                return jsonify(response={'message': 'Already assigned.'}, status=409, bool=False)

            admin_id = get_jwt_identity()
            call_proc(
                'sp_achiever_mentees_create',
                str(uuid.uuid4()), mentor_id, mentee['id'], 'active', admin_id, admin_id,
            )
            db.session.commit()
            return jsonify(response={'message': 'Mentee assigned.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in POST /admin/achiever-accounts/{mentor_id}/mentees: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/achiever-accounts/<string:mentor_id>/mentees/<string:mentee_id>')
class AdminMentorMenteeDetail(Resource):
    @require_role('admin', 'super_admin')
    def delete(self, mentor_id, mentee_id):
        try:
            # ── SP: sp_achiever_mentees_list + _update (deactivate link) ──────
            links = call_proc('sp_achiever_mentees_list', 100000, 0)
            link = next((m for m in links if m.get('mentor_id') == mentor_id and m.get('mentee_id') == mentee_id and m.get('status') == 'active'), None)
            if not link:
                return jsonify(response={'message': 'Assignment not found.'}, status=404, bool=False)

            admin_id = get_jwt_identity()
            call_proc_one(
                'sp_achiever_mentees_update',
                link['id'], mentor_id, mentee_id, 'inactive', link.get('created_by'), admin_id,
            )
            db.session.commit()
            return jsonify(response={'message': 'Mentee unassigned.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in DELETE /admin/achiever-accounts/{mentor_id}/mentees/{mentee_id}: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)
