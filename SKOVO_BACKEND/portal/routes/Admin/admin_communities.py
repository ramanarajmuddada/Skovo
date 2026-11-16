"""
Admin — Communities (groups) management (SP-only: sp_groups_*).
Admins can view all communities, create new ones, toggle active, and delete.
Communities created here surface in the student Assemble page.
"""
from portal.helpers.error_capture import capture_error
from portal.helpers.helpers import serialize_datetime
import uuid
import datetime
from flask import jsonify, request
from flask_restx import Resource, reqparse
from flask_jwt_extended import jwt_required, get_jwt_identity, get_jwt
from portal.models import db
from portal.helpers.sp import call_proc, call_proc_one
from portal.helpers.message_crypto import decrypt_message
from . import ns, logger


def _capacity(raw):
    """Member cap, where 'no cap' is NULL rather than 0.

    A blank field used to be stored as 0, and the join procedure reads
    `max_members IS NOT NULL AND member_count >= max_members` — so 0 meant
    "capacity zero" and the group was full from the moment it was created.
    Every community made without an explicit cap was impossible to join.
    Blank, 0 and junk all mean unlimited.
    """
    if raw in (None, '', 'null'):
        return None
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return None
    return value if value > 0 else None


list_parser = reqparse.RequestParser()
list_parser.add_argument('search',     type=str, location='args', required=False)
list_parser.add_argument('group_type', type=str, location='args', required=False)
list_parser.add_argument('page',       type=int, location='args', default=1)
list_parser.add_argument('per_page',   type=int, location='args', default=20)


def _is_admin(claims):
    return claims.get('role') in ('admin', 'super_admin')


def _paginate(rows, page, per_page):
    total = len(rows)
    pages = max(1, (total + per_page - 1) // per_page)
    start = (page - 1) * per_page
    return rows[start:start + per_page], total, pages


def _days(raw):
    """A retention window the admin typed. 1 day through 10 years."""
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return None
    return value if 1 <= value <= 3650 else None


def _dict(g):
    ca = g.get('created_at')
    removed = bool(g.get('deleted_at'))
    owner_id = g.get('owner_user_id')
    owner = (g.get('owner_name') or '').strip()
    # A student who is still the owner runs the community, even when their
    # profile has no name yet. Skovo Admin runs it when there is no owner.
    if owner_id or owner:
        run_by = owner or 'Student'
        run_by_kind = 'student'
    else:
        run_by = 'Skovo Admin'
        run_by_kind = 'platform'
    return {
        'id':           g.get('id'),
        'name':         g.get('name'),
        'description':  g.get('description'),
        'category':     g.get('category'),
        'group_type':   g.get('group_type'),
        'member_count': g.get('member_count'),
        'join_type':    g.get('join_type'),
        'is_active':    bool(g.get('is_active')) and not removed,
        'removed':      removed,
        'created_by':   g.get('created_by'),
        'creator_name': g.get('creator_name'),
        'owner_name':   owner,
        'run_by':       run_by,
        'run_by_kind':  run_by_kind,
        'created_at':   serialize_datetime(ca) if ca else None,
    }


@ns.route('/communities')
class AdminCommunityList(Resource):
    @jwt_required()
    def get(self):
        try:
            if not _is_admin(get_jwt()):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
            args = list_parser.parse_args()
            # Includes communities already closed, so a removed group can still
            # be opened and tracked until its chat expires.
            rows = call_proc('sp_community_admin_list')
            if args.get('search'):
                s = args['search'].lower()
                rows = [g for g in rows if s in (g.get('name') or '').lower()]
            if args.get('group_type'):
                rows = [g for g in rows if g.get('group_type') == args['group_type']]
            rows.sort(key=lambda g: g.get('created_at') or datetime.datetime.min, reverse=True)
            items, total, pages = _paginate(rows, args['page'], args['per_page'])
            return jsonify(
                response={'communities': [_dict(g) for g in items]},
                pagination={'total': total, 'pages': pages, 'page': args['page'], 'per_page': args['per_page']},
                status=200, bool=True
            )
        except Exception as e:
            logger.error(f"GET /admin/communities error: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @jwt_required()
    def post(self):
        try:
            if not _is_admin(get_jwt()):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
            data = request.get_json() or {}
            name = (data.get('name') or '').strip()
            if not name:
                return jsonify(response={'message': 'Community name is required.'}, status=400, bool=False)
            if len(name) > 200:
                return jsonify(response={'message': 'Name too long (max 200 chars).'}, status=400, bool=False)

            new_id = str(uuid.uuid4())
            # created_by/updated_by have a FK to users.id; admins live in the
            # `admins` table, not `users`, so leave the creator NULL here.
            # ── SP: sp_groups_create ─────────────────────────────────────────
            call_proc_one(
                'sp_groups_create',
                new_id, name, (data.get('description') or '').strip() or None,
                data.get('category') or 'general', data.get('group_type') or 'public',
                data.get('icon_url'), data.get('icon_color'),
                int(data.get('min_members') or 0), _capacity(data.get('max_members')),
                data.get('join_type') or 'open', 0, None, 1, None, None,
            )
            db.session.commit()
            return jsonify(response={'message': 'Community created.', 'id': new_id}, status=201, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"POST /admin/communities error: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/communities/<string:group_id>')
class AdminCommunityDetail(Resource):
    @jwt_required()
    def patch(self, group_id):
        """Toggle active / edit basic fields."""
        try:
            if not _is_admin(get_jwt()):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
            g = call_proc_one('sp_groups_get', group_id)
            if not g or g.get('deleted_at'):
                return jsonify(response={'message': 'Community not found.'}, status=404, bool=False)
            data = request.get_json() or {}

            def keep(key):
                v = data.get(key)
                if isinstance(v, str):
                    v = v.strip()
                return v if v not in (None, '') else g.get(key)

            is_active = int(bool(data['is_active'])) if 'is_active' in data else g.get('is_active')
            actor = get_jwt_identity()
            # ── SP: sp_groups_update (full replace) ──────────────────────────
            call_proc_one(
                'sp_groups_update',
                group_id, keep('name'), keep('description'), keep('category'), keep('group_type'),
                g.get('icon_url'), g.get('icon_color'), g.get('min_members'),
                # Accept an edit to the cap, and normalise a legacy 0 to NULL so
                # saving an existing community also un-sticks it from "full".
                _capacity(data['max_members']) if 'max_members' in data
                else _capacity(g.get('max_members')),
                keep('join_type'), g.get('member_count'), g.get('created_by'), is_active, actor,
                g.get('deleted_at'),
            )
            db.session.commit()
            return jsonify(response={'message': 'Community updated.', 'id': group_id}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"PATCH /admin/communities/{group_id} error: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @jwt_required()
    def delete(self, group_id):
        try:
            if not _is_admin(get_jwt()):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
            g = call_proc_one('sp_groups_get', group_id)
            if not g or g.get('deleted_at'):
                return jsonify(response={'message': 'Community not found.'}, status=404, bool=False)
            # Closes the community and frees every member's slot. Chat rows stay
            # until the retention sweep deletes them.
            call_proc_one('sp_community_close', group_id)
            db.session.commit()
            return jsonify(response={'message': 'Community deleted.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"DELETE /admin/communities/{group_id} error: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


def _retention_dict(row):
    updated = row.get('updated_at') if row else None
    return {
        'chat_days': int(row['chat_days']),
        'file_days': int(row['file_days']),
        'updated_at': serialize_datetime(updated) if updated else None,
    }


def _when(value):
    return serialize_datetime(value) if value else None


@ns.route('/community-retention')
class AdminCommunityRetention(Resource):
    @jwt_required()
    def get(self):
        try:
            if not _is_admin(get_jwt()):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
            row = call_proc_one('sp_community_retention_get') or {}
            db.session.commit()
            return jsonify(response={'retention': _retention_dict(row)}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"GET /admin/community-retention error: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @jwt_required()
    def put(self):
        try:
            if not _is_admin(get_jwt()):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
            data = request.get_json() or {}
            chat_days = _days(data.get('chat_days'))
            file_days = _days(data.get('file_days'))
            if chat_days is None or file_days is None:
                return jsonify(response={'message': 'Chat days and document days must be between 1 and 3650.'},
                               status=400, bool=False)
            actor = get_jwt_identity()
            row = call_proc_one('sp_community_retention_set', chat_days, file_days, actor) or {}
            db.session.commit()
            return jsonify(response={'message': 'Retention updated.', 'retention': _retention_dict(row)},
                           status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"PUT /admin/community-retention error: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/communities/<string:group_id>/track')
class AdminCommunityTrack(Resource):
    @jwt_required()
    def get(self, group_id):
        try:
            if not _is_admin(get_jwt()):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
            rows = call_proc('sp_community_admin_list')
            group = next((g for g in rows if g.get('id') == group_id), None)
            if not group:
                return jsonify(response={'message': 'Community not found.'}, status=404, bool=False)
            members = call_proc('sp_community_track_members', group_id)
            posts = call_proc('sp_community_track_posts', group_id)
            messages = call_proc('sp_community_track_messages', group_id)
            return jsonify(response={
                'community': _dict(group),
                'members': [{
                    'user_id': m.get('user_id'),
                    'full_name': m.get('full_name') or 'Student',
                    'role': m.get('role'),
                    'status': m.get('status'),
                    'joined_at': _when(m.get('joined_at')),
                } for m in members],
                'posts': [{
                    'id': p.get('id'),
                    'user_id': p.get('user_id'),
                    'author_name': p.get('author_name') or 'Student',
                    'content': decrypt_message(p.get('content')),
                    'media_url': p.get('media_url'),
                    'created_at': _when(p.get('created_at')),
                    'removed': bool(p.get('deleted_at')),
                } for p in posts],
                'messages': [{
                    'id': m.get('id'),
                    'sender_id': m.get('sender_id'),
                    'sender_name': m.get('sender_name') or 'Student',
                    'recipient_id': m.get('recipient_id'),
                    'recipient_name': m.get('recipient_name') or 'Student',
                    'body': decrypt_message(m.get('body')),
                    'created_at': _when(m.get('created_at')),
                } for m in messages],
            }, status=200, bool=True)
        except Exception as e:
            logger.error(f"GET /admin/communities/{group_id}/track error: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/communities/<string:group_id>/members/<string:member_id>')
class AdminCommunityMember(Resource):
    @jwt_required()
    def delete(self, group_id, member_id):
        """Remove any member, including the student who runs the community."""
        try:
            if not _is_admin(get_jwt()):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
            g = call_proc_one('sp_groups_get', group_id)
            if not g:
                return jsonify(response={'message': 'Community not found.'}, status=404, bool=False)
            res = call_proc_one('sp_community_admin_remove_member', group_id, member_id) or {}
            if res.get('result') != 'removed':
                db.session.rollback()
                return jsonify(response={'message': 'That person is not an active member.'}, status=404, bool=False)
            db.session.commit()
            from portal.helpers.audit import log_audit
            log_audit('community_member_removed', 'group', group_id,
                      actor_id=get_jwt_identity(), meta={'user_id': member_id})
            return jsonify(response={'message': 'Member removed.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"DELETE /admin/communities/{group_id}/members/{member_id} error: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/communities/<string:group_id>/score')
class AdminCommunityScore(Resource):
    @jwt_required()
    def post(self, group_id):
        """Reduce one member's readiness score. Reason is required."""
        try:
            if not _is_admin(get_jwt()):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
            g = call_proc_one('sp_groups_get', group_id)
            if not g:
                return jsonify(response={'message': 'Community not found.'}, status=404, bool=False)
            data = request.get_json() or {}
            user_id = (data.get('user_id') or '').strip()
            reason = (data.get('reason') or '').strip()
            try:
                points = int(data.get('points'))
            except (TypeError, ValueError):
                points = None
            if not user_id or points is None or points < 1 or points > 100:
                return jsonify(response={'message': 'Choose a member and a score reduction from 1 to 100.'},
                               status=400, bool=False)
            if len(reason) < 3:
                return jsonify(response={'message': 'A reason is required.'}, status=400, bool=False)
            member = call_proc_one('sp_community_member_exists', group_id, user_id)
            if not member:
                return jsonify(response={'message': 'That person is not in this community.'}, status=404, bool=False)
            admin_id = get_jwt().get('sub') or get_jwt_identity()
            call_proc_one('sp_score_adjust', str(uuid.uuid4()), user_id, admin_id, -points, reason)
            row = call_proc_one('sp_score_recalc', user_id) or {}
            db.session.commit()
            from portal.helpers.notifications import notify_user
            from portal.helpers.audit import log_audit
            notify_user(user_id, 'Readiness score updated',
                        f'Your readiness score was reduced by {points}. {reason}',
                        type='score', reference_type='group', reference_id=group_id)
            log_audit('community_score_reduced', 'group', group_id, actor_id=admin_id,
                      meta={'user_id': user_id, 'points': points})
            return jsonify(response={
                'message': f'Readiness score reduced by {points}.',
                'score': row.get('score'),
            }, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"POST /admin/communities/{group_id}/score error: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)
