from portal.helpers.error_capture import capture_error
import uuid
from flask import jsonify, request
from flask_restx import Resource, reqparse
from flask_jwt_extended import jwt_required, get_jwt_identity
from portal.helpers.helpers import serialize_datetime
from portal.helpers.sp import call_proc, call_proc_one
from portal.helpers import score as score_module
from portal.models import db
from . import ns, logger

# Default if Admin → Subscriptions has not set a number yet. Live gates read
# free_limit('communities') so every student shares the same cap.
from portal.helpers.pro_limits import free_limit, upgrade_payload
FREE_GROUP_LIMIT = 3

groups_parser = reqparse.RequestParser()
groups_parser.add_argument('category', type=str, location='args', required=False)
groups_parser.add_argument('type', type=str, location='args', required=False,
                           help='regular | thoughts | knowledge_booster')
groups_parser.add_argument('search', type=str, location='args', required=False)
groups_parser.add_argument('page', type=int, location='args', default=1)
groups_parser.add_argument('per_page', type=int, location='args', default=20)

posts_parser = reqparse.RequestParser()
posts_parser.add_argument('page', type=int, location='args', default=1)
posts_parser.add_argument('per_page', type=int, location='args', default=20)

post_create_parser = reqparse.RequestParser()
post_create_parser.add_argument('content', type=str, location='json', required=False)
post_create_parser.add_argument('post_type', type=str, location='json', default='general')
post_create_parser.add_argument('link_url', type=str, location='json', required=False)
post_create_parser.add_argument('link_title', type=str, location='json', required=False)
post_create_parser.add_argument('media_url', type=str, location='json', required=False)


def _pages(total, per_page):
    return (total + per_page - 1) // per_page if per_page else 1


def _membership_quota(user_id):
    """How many communities this student may still be in.

    One counter covers both joining and creating, because creating a community
    makes you a member of it. "Be in at most 3" is a single rule a student can
    hold in their head; two separate budgets would let someone sit in six.
    """
    from portal.routes.Subscription.subscription import is_pro
    pro = is_pro(user_id)
    used = int((call_proc_one('sp_assemble_my_group_count', user_id) or {}).get('total', 0) or 0)
    cap = free_limit('communities')
    # cap is None when Admin set this allowance to Unlimited. `used < None`
    # is a TypeError in Python 3, so every comparison here is guarded -- an
    # unlimited free tier behaves exactly like Pro for this perk.
    unlimited = cap is None
    return {
        'is_pro': pro,
        'used': used,
        'limit': None if (pro or unlimited) else cap,
        'remaining': None if (pro or unlimited) else max(0, cap - used),
        'can_add': True if (pro or unlimited) else used < cap,
    }


def _upgrade_payload(used):
    return upgrade_payload('communities', used=used, limit=free_limit('communities'))


def _my_membership(user_id, group_id):
    """{'status', 'role'} for this user in this group — empty dict if none."""
    return call_proc_one('sp_assemble_membership_status', user_id, group_id) or {}


def _require_owner(user_id, group_id):
    """None when the caller owns the group, otherwise the response to return.

    Ownership lives in `group_memberships.role`, set when the group is created.
    Returning 404 rather than 403 for non-members is deliberate: whether a
    private community exists is not something a stranger needs confirmed.
    """
    me = _my_membership(user_id, group_id)
    if not me:
        return jsonify(response={'message': 'Community not found.'}, status=404, bool=False)
    if me.get('role') != 'owner' or me.get('status') != 'active':
        return jsonify(response={'message': 'Only the community owner can do that.'},
                       status=403, bool=False)
    return None


def _member_dict(m):
    return {
        'user_id': m.get('user_id'),
        'full_name': m.get('full_name') or 'Student',
        'avatar_url': m.get('avatar_url'),
        'role': m.get('role'),
        'joined_at': serialize_datetime(m.get('joined_at')) if m.get('joined_at') else None,
        'requested_at': serialize_datetime(m.get('requested_at')) if m.get('requested_at') else None,
    }


def _group_dict(g):
    ms = g.get('membership_status')
    return {
        'id': g.get('id'), 'name': g.get('name'), 'description': g.get('description'),
        'category': g.get('category'), 'group_type': g.get('group_type'),
        'icon_url': g.get('icon_url'), 'icon_color': g.get('icon_color'),
        'min_members': g.get('min_members'), 'max_members': g.get('max_members'),
        'member_count': g.get('member_count'), 'join_type': g.get('join_type'),
        'is_member': ms == 'active',
        'membership_status': ms,
        'my_role': g.get('my_role'),
    }


def _post_dict(p):
    from portal.helpers.message_crypto import decrypt_message
    return {
        'id': p.get('id'), 'post_type': p.get('post_type'), 'content': decrypt_message(p.get('content')),
        'link_url': p.get('link_url'), 'link_title': p.get('link_title'), 'media_url': p.get('media_url'),
        'likes_count': p.get('likes_count'), 'comments_count': p.get('comments_count'),
        'is_pinned': bool(p.get('is_pinned')), 'is_liked': bool(p.get('is_liked')),
        'author': {
            'id': p.get('user_id'),
            'full_name': p.get('author_name') or 'Unknown',
            'avatar_url': p.get('author_avatar'),
        },
        'created_at': serialize_datetime(p.get('created_at')),
    }


@ns.route('/groups')
class GroupList(Resource):
    @ns.doc(description='Discover all groups. Filter by category or group_type.')
    @jwt_required()
    def get(self):
        try:
            user_id = get_jwt_identity()
            args = groups_parser.parse_args()
            page, per = max(1, args['page']), max(1, args['per_page'])
            cat, typ, search = args.get('category'), args.get('type'), args.get('search')

            total = (call_proc_one('sp_assemble_groups_count', cat, typ, search) or {}).get('total', 0)
            rows = call_proc('sp_assemble_groups_list', user_id, cat, typ, search, per, (page - 1) * per)
            # Ship the quota with the list so the screen can say "1 of 3 left"
            # up front, instead of letting the student pick a community and only
            # then telling them they are out of slots.
            return jsonify(
                response={'groups': [_group_dict(g) for g in rows],
                          'quota': _membership_quota(user_id)},
                pagination={'total': total, 'page': page, 'pages': _pages(total, per), 'per_page': per},
                status=200, bool=True
            )
        except Exception as e:
            logger.error(f"Error in GET /assemble/groups: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @ns.doc(description='Create a community. Free members may be in 3; Pro is unlimited.')
    @jwt_required()
    def post(self):
        try:
            user_id = get_jwt_identity()

            quota = _membership_quota(user_id)
            if not quota['can_add']:
                return jsonify(response=_upgrade_payload(quota['used']), status=403, bool=False)

            d = request.get_json(silent=True) or {}
            name = (d.get('name') or '').strip()
            if len(name) < 3:
                return jsonify(response={'message': 'Give your community a name of at least 3 characters.'},
                               status=400, bool=False)
            if len(name) > 200:
                return jsonify(response={'message': 'Name is too long (max 200 characters).'},
                               status=400, bool=False)

            join_type = d.get('join_type') if d.get('join_type') in ('open', 'approval') else 'open'
            group_type = d.get('group_type') or 'regular'

            # A cap is optional, but if given it has to leave room for the owner
            # plus someone else — a group of one is not a community.
            max_members = d.get('max_members')
            try:
                max_members = int(max_members) if max_members not in (None, '') else None
            except (TypeError, ValueError):
                max_members = None
            if max_members is not None and max_members < 2:
                return jsonify(response={'message': 'A member limit must be at least 2.'},
                               status=400, bool=False)

            new_id = str(uuid.uuid4())
            row = call_proc_one(
                'sp_assemble_group_create',
                new_id, user_id, name,
                (d.get('description') or '').strip() or None,
                d.get('category') or 'general',
                group_type, join_type,
                d.get('icon_color'), max_members,
            ) or {}

            # Creating is its own signal, worth +2 against a lifetime cap of 5
            # (Scope §6.2) — not the +1 that joining someone else's earns.
            from portal.helpers import score
            score.award(user_id, score.COMMUNITY_CREATED, ref_id=new_id)
            db.session.commit()

            return jsonify(response={'message': 'Community created.',
                                     'group': _group_dict({**row, 'membership_status': 'active',
                                                           'my_role': 'owner'}),
                                     'quota': _membership_quota(user_id)},
                           status=201, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in POST /assemble/groups: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id},
                           status=500, bool=False)


@ns.route('/groups/<string:group_id>/join')
class GroupJoin(Resource):
    @ns.doc(description='Join or request to join a group.')
    @jwt_required()
    def post(self, group_id):
        try:
            user_id = get_jwt_identity()

            # ── Free tier: cap on how many communities you can be in ─────────
            # Same counter the create endpoint uses, so joining and creating
            # draw on one budget rather than two that can drift apart.
            quota = _membership_quota(user_id)
            if not quota['can_add']:
                return jsonify(response=_upgrade_payload(quota['used']), status=403, bool=False)

            res = call_proc_one('sp_assemble_group_join', user_id, group_id) or {}
            result, status = res.get('result'), res.get('status')
            if result == 'notfound':
                return jsonify(response={'message': 'Group not found.'}, status=404, bool=False)
            if result == 'already_member':
                return jsonify(response={'message': 'You are already a member of this group.'}, status=409, bool=False)
            if result == 'already_pending':
                return jsonify(response={'message': 'Your join request is already pending.'}, status=409, bool=False)
            if result == 'full':
                return jsonify(response={'message': 'This group is full.'}, status=400, bool=False)
            if result == 'rejoined':
                msg = 'Rejoined group.' if status == 'active' else 'Join request re-sent.'
            else:  # joined
                msg = 'Joined group successfully.' if status == 'active' else 'Join request submitted. Awaiting approval.'

            # Score signal: joining a new community (+1, 5 lifetime). Only a
            # live membership counts — a pending request has not joined yet.
            if status == 'active':
                from portal.helpers import score
                score.award(user_id, score.COMMUNITY_JOIN, ref_id=group_id)
                db.session.commit()

            return jsonify(response={'message': msg, 'status': status}, status=200, bool=True)
        except Exception as e:
            logger.error(f"Error in POST /assemble/groups/{group_id}/join: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @ns.doc(description='Leave a community you joined. The owner cannot leave their own.')
    @jwt_required()
    def delete(self, group_id):
        """Leave a group — the inverse of POST, on the same path.

        Without this there was no way out of a community at all: the only
        removal endpoint is owner-only, so a member could not remove themselves
        and an owner could not remove themselves either. That mattered because
        joining and creating share ONE free-tier budget of three
        (see _membership_quota): three joins permanently exhausted a free
        student's quota with no way to recover it, and buying Pro was the only
        exit. Membership is meant to be reversible, so the counter has to be
        able to go down.

        Reuses sp_assemble_member_remove — the same procedure the owner-side
        removal calls. It already refuses an owner, already ignores a
        non-member, and already flips the row to 'left' and decrements
        member_count in one transaction. Leaving sets 'left' rather than
        deleting the row, which is what lets sp_assemble_group_join return
        'rejoined' if they come back.
        """
        try:
            user_id = get_jwt_identity()
            res = call_proc_one('sp_assemble_member_remove', group_id, user_id) or {}
            db.session.commit()
            result = res.get('result')
            if result == 'notfound':
                return jsonify(response={'message': 'You are not a member of this community.'},
                               status=404, bool=False)
            if result == 'not_member':
                return jsonify(response={'message': 'You are not an active member of this community.'},
                               status=400, bool=False)
            if result == 'is_owner':
                # Leaving would orphan the community, so say what to do instead
                # rather than refusing without a route forward.
                return jsonify(response={'message': 'You own this community, so you cannot leave it. '
                                                    'Hand it over or ask an admin to close it.'},
                               status=400, bool=False)
            return jsonify(response={'message': 'You have left this community.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in DELETE /assemble/groups/{group_id}/join: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/groups/<string:group_id>/posts')
class GroupPostsAPI(Resource):
    @ns.doc(description='Get paginated posts in a group. Pinned posts appear first.')
    @jwt_required()
    def get(self, group_id):
        try:
            user_id = get_jwt_identity()
            args = posts_parser.parse_args()
            page, per = max(1, args['page']), max(1, args['per_page'])

            if not call_proc_one('sp_assemble_group_get', group_id):
                return jsonify(response={'message': 'Group not found.'}, status=404, bool=False)

            total = (call_proc_one('sp_assemble_group_posts_count', group_id) or {}).get('total', 0)
            rows = call_proc('sp_assemble_group_posts_list', user_id, group_id, per, (page - 1) * per)
            return jsonify(
                response={'posts': [_post_dict(p) for p in rows]},
                pagination={'total': total, 'page': page, 'pages': _pages(total, per), 'per_page': per},
                status=200, bool=True
            )
        except Exception as e:
            logger.error(f"Error in GET /assemble/groups/{group_id}/posts: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @ns.doc(description='Create a post in a group. Must be an active member.')
    @jwt_required()
    def post(self, group_id):
        try:
            user_id = get_jwt_identity()
            args = post_create_parser.parse_args()

            if not call_proc_one('sp_assemble_group_get', group_id):
                return jsonify(response={'message': 'Group not found.'}, status=404, bool=False)

            m = call_proc_one('sp_assemble_membership_status', user_id, group_id)
            if not m or m.get('status') != 'active':
                return jsonify(response={'message': 'You must be an active member to post.'}, status=403, bool=False)

            content = (args.get('content') or '').strip()
            if not content and not args.get('link_url') and not args.get('media_url'):
                return jsonify(response={'message': 'Post must have content, a link, or media.'}, status=400, bool=False)
            from portal.helpers.message_crypto import encrypt_message
            content = encrypt_message(content) if content else None

            post_type = args.get('post_type', 'general')
            if post_type not in ('thought', 'resource', 'general'):
                post_type = 'general'

            post = call_proc_one(
                'sp_assemble_post_create',
                str(uuid.uuid4()), group_id, user_id, post_type,
                content or None, args.get('link_url'), args.get('link_title'), args.get('media_url'),
            )
            db.session.commit()

            # Score signal: posting in a community (+0.5, capped 3/day).
            from portal.helpers import score
            score.award(user_id, score.COMMUNITY_POST, ref_id=(post or {}).get('id'))
            db.session.commit()

            return jsonify(response={'message': 'Post created.', 'post': _post_dict(post or {})}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in POST /assemble/groups/{group_id}/posts: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/posts/<string:post_id>/like')
class PostLike(Resource):
    @ns.doc(description='Toggle like on a post. Calling again removes the like.')
    @jwt_required()
    def post(self, post_id):
        try:
            user_id = get_jwt_identity()
            res = call_proc_one('sp_assemble_post_like_toggle', post_id, user_id) or {}
            if res.get('result') == 'notfound':
                return jsonify(response={'message': 'Post not found.'}, status=404, bool=False)

            # Score signal: the AUTHOR earns +0.5 each time their post crosses a
            # 5-reaction milestone (capped daily). The liker earns nothing.
            likes = int(res.get('likes_count') or 0)
            if res.get('result') == 'liked' and likes and likes % score_module.REACTION_MILESTONE == 0:
                post = call_proc_one('sp_group_posts_get', post_id) or {}
                author = post.get('user_id')
                if author and author != user_id:
                    score_module.award(author, score_module.COMMUNITY_REACTIONS,
                                       ref_id=f'{post_id}:{likes}')
                    db.session.commit()

            return jsonify(response={'action': res.get('result'), 'likes_count': res.get('likes_count')},
                           status=200, bool=True)
        except Exception as e:
            logger.error(f"Error in POST /assemble/posts/{post_id}/like: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


# ══════════════════════════════════════════════════════════════════════════
# Direct messages between community members (Skovo Pro)
# ══════════════════════════════════════════════════════════════════════════

def _peer(user_id):
    """Minimal public identity for a DM counterpart."""
    u = call_proc_one('sp_users_get', user_id) or {}
    return {
        'id': user_id,
        'name': u.get('full_name') or u.get('name') or 'Skovo member',
        'avatar_url': u.get('avatar_url'),
    }


def _dm_guard(me, other_id):
    """Shared checks for every DM write. Returns an error response or None."""
    if other_id == me:
        return jsonify(response={'message': 'You cannot message yourself.'}, status=400, bool=False)

    from portal.routes.Subscription.subscription import is_pro
    if not is_pro(me):
        from portal.helpers.pro_limits import upgrade_payload
        return jsonify(response=upgrade_payload('dms'), status=403, bool=False)

    # You may only DM someone you actually share a community with.
    shared = (call_proc_one('sp_dm_shared_group', me, other_id) or {}).get('shared', 0) or 0
    if int(shared) == 0:
        return jsonify(response={
            'message': 'You can only message members of a community you have both joined.',
        }, status=403, bool=False)
    return None


@ns.route('/posts/<string:post_id>/pin')
class PostPin(Resource):
    @ns.doc(description='Pin or unpin your own post in a community (Skovo Pro).')
    @jwt_required()
    def post(self, post_id):
        try:
            user_id = get_jwt_identity()
            from portal.routes.Subscription.subscription import is_pro
            if not is_pro(user_id):
                return jsonify(response={
                    'message': 'Pinning your posts is a Skovo Pro feature.',
                    'requires_pro': True,
                }, status=403, bool=False)

            # ── SP: sp_assemble_post_pin_toggle (owner-scoped) ───────────────
            res = call_proc_one('sp_assemble_post_pin_toggle', post_id, user_id) or {}
            db.session.commit()
            if res.get('result') == 'notfound':
                return jsonify(response={'message': 'Post not found.'}, status=404, bool=False)
            if res.get('result') == 'not_owner':
                return jsonify(response={'message': 'You can only pin your own posts.'},
                               status=403, bool=False)
            return jsonify(response={
                'message': 'Post pinned.' if res.get('is_pinned') else 'Post unpinned.',
                'is_pinned': bool(res.get('is_pinned')),
            }, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in POST /assemble/posts/{post_id}/pin: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/posts/<string:post_id>')
class PostDelete(Resource):
    @ns.doc(description="Delete a post. Its author, or the owner of the community it's in.")
    @jwt_required()
    def delete(self, post_id):
        try:
            user_id = get_jwt_identity()
            # Authorship / ownership is decided inside the SP, which has both the
            # post and the membership row in front of it.
            res = call_proc_one('sp_assemble_post_delete', post_id, user_id) or {}
            db.session.commit()
            result = res.get('result')
            if result == 'notfound':
                return jsonify(response={'message': 'Post not found.'}, status=404, bool=False)
            if result == 'not_allowed':
                return jsonify(response={'message': 'Only the author or the community owner can delete this post.'},
                               status=403, bool=False)
            return jsonify(response={'message': 'Post deleted.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in DELETE /assemble/posts/{post_id}: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/groups/<string:group_id>/members')
class GroupMembers(Resource):
    @ns.doc(description='Members of a community. Any active member may see the list.')
    @jwt_required()
    def get(self, group_id):
        try:
            user_id = get_jwt_identity()
            me = _my_membership(user_id, group_id)
            if me.get('status') != 'active':
                return jsonify(response={'message': 'Join this community to see its members.'},
                               status=403, bool=False)
            args = posts_parser.parse_args()
            page, per = max(1, args['page']), max(1, args['per_page'])
            rows = call_proc('sp_assemble_members_list', group_id, per, (page - 1) * per)
            return jsonify(response={'members': [_member_dict(m) for m in rows],
                                     'my_role': me.get('role')},
                           status=200, bool=True)
        except Exception as e:
            logger.error(f"Error in GET /assemble/groups/{group_id}/members: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/groups/<string:group_id>/members/<string:member_id>')
class GroupMemberRemove(Resource):
    @ns.doc(description='Remove a member from your community. Owner only.')
    @jwt_required()
    def delete(self, group_id, member_id):
        try:
            user_id = get_jwt_identity()
            denied = _require_owner(user_id, group_id)
            if denied:
                return denied
            if member_id == user_id:
                return jsonify(response={'message': "You can't remove yourself — you own this community."},
                               status=400, bool=False)

            res = call_proc_one('sp_assemble_member_remove', group_id, member_id) or {}
            db.session.commit()
            result = res.get('result')
            if result in ('notfound', 'not_member'):
                return jsonify(response={'message': 'That person is not a member.'}, status=404, bool=False)
            if result == 'is_owner':
                return jsonify(response={'message': 'The community owner cannot be removed.'},
                               status=400, bool=False)
            return jsonify(response={'message': 'Member removed.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in DELETE /assemble/groups/{group_id}/members/{member_id}: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/groups/<string:group_id>')
class GroupDelete(Resource):
    @ns.doc(description='Delete a community you created. Only the student who owns it.')
    @jwt_required()
    def delete(self, group_id):
        try:
            user_id = get_jwt_identity()
            denied = _require_owner(user_id, group_id)
            if denied:
                return denied
            group = call_proc_one('sp_groups_get', group_id)
            if not group or group.get('deleted_at'):
                return jsonify(response={'message': 'Community not found.'}, status=404, bool=False)
            res = call_proc_one('sp_community_close', group_id) or {}
            db.session.commit()
            if res.get('result') == 'notfound':
                return jsonify(response={'message': 'Community not found.'}, status=404, bool=False)
            return jsonify(response={'message': 'Community deleted.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in DELETE /assemble/groups/{group_id}: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/groups/<string:group_id>/requests')
class GroupRequests(Resource):
    @ns.doc(description='Pending join requests for your community. Owner only.')
    @jwt_required()
    def get(self, group_id):
        try:
            user_id = get_jwt_identity()
            denied = _require_owner(user_id, group_id)
            if denied:
                return denied
            args = posts_parser.parse_args()
            page, per = max(1, args['page']), max(1, args['per_page'])
            total = (call_proc_one('sp_assemble_group_requests_count', group_id) or {}).get('total', 0)
            rows = call_proc('sp_assemble_group_requests_list', group_id, per, (page - 1) * per)
            return jsonify(response={'requests': [_member_dict(r) for r in rows]},
                           pagination={'total': total, 'page': page,
                                       'pages': _pages(total, per), 'per_page': per},
                           status=200, bool=True)
        except Exception as e:
            logger.error(f"Error in GET /assemble/groups/{group_id}/requests: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/groups/<string:group_id>/requests/<string:member_id>')
class GroupRequestDecide(Resource):
    @ns.doc(description="Approve or reject a join request. Body: {\"approve\": true|false}. Owner only.")
    @jwt_required()
    def post(self, group_id, member_id):
        try:
            user_id = get_jwt_identity()
            denied = _require_owner(user_id, group_id)
            if denied:
                return denied

            approve = bool((request.get_json(silent=True) or {}).get('approve', True))

            # A pending request does not count towards the applicant's three
            # free communities — only live memberships do. So someone can queue
            # up more requests than they can hold, and the check has to happen
            # here, at the moment it would become real, against *their* plan.
            if approve:
                applicant = _membership_quota(member_id)
                if not applicant['can_add']:
                    return jsonify(response={
                        'message': 'They are already in the maximum number of communities for a free account.',
                        'applicant_at_limit': True,
                    }, status=409, bool=False)

            res = call_proc_one('sp_assemble_request_decide', group_id, member_id, 1 if approve else 0) or {}
            db.session.commit()
            result = res.get('result')
            if result == 'notfound':
                return jsonify(response={'message': 'No such request.'}, status=404, bool=False)
            if result == 'not_pending':
                return jsonify(response={'message': 'That request has already been handled.'},
                               status=409, bool=False)
            if result == 'full':
                return jsonify(response={'message': 'This community is already full.'}, status=400, bool=False)

            if result == 'approved':
                from portal.helpers import score
                score.award(member_id, score.COMMUNITY_JOIN, ref_id=group_id)
                db.session.commit()

            return jsonify(response={'message': 'Request approved.' if approve else 'Request declined.',
                                     'result': result}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in POST /assemble/groups/{group_id}/requests/{member_id}: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/dm/conversations')
class DMConversations(Resource):
    @ns.doc(description='List DM conversations (most recent first) with unread counts.')
    @jwt_required()
    def get(self):
        try:
            me = get_jwt_identity()
            from portal.routes.Subscription.subscription import is_pro
            rows = call_proc('sp_dm_conversations', me) or []
            out = []
            from portal.helpers.message_crypto import decrypt_message
            for r in rows:
                out.append({
                    'peer': _peer(r.get('other_id')),
                    'last_body': decrypt_message(r.get('last_body')),
                    'last_at': serialize_datetime(r.get('last_at')),
                    'unread': int(r.get('unread') or 0),
                })
            return jsonify(response={
                'conversations': out,
                'total_unread': sum(c['unread'] for c in out),
                'is_pro': is_pro(me),
            }, status=200, bool=True)
        except Exception as e:
            logger.error(f"Error in GET /assemble/dm/conversations: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/dm/<string:other_id>')
class DMThread(Resource):
    @ns.doc(description='Read a DM thread with one member. Marks their messages read.')
    @jwt_required()
    def get(self, other_id):
        try:
            me = get_jwt_identity()
            # Reading an existing thread stays open even if Pro lapses — only
            # sending is gated — but you still must share a community.
            shared = (call_proc_one('sp_dm_shared_group', me, other_id) or {}).get('shared', 0) or 0
            if int(shared) == 0:
                return jsonify(response={'message': 'You do not share a community with this member.'},
                               status=403, bool=False)
            from portal.helpers.message_crypto import decrypt_message
            rows = call_proc('sp_dm_thread', me, other_id, 200) or []
            db.session.commit()  # sp_dm_thread marks incoming messages read
            msgs = [{
                'id': m.get('id'),
                'body': decrypt_message(m.get('body')),
                'mine': m.get('sender_id') == me,
                'is_read': bool(m.get('is_read')),
                'created_at': serialize_datetime(m.get('created_at')),
            } for m in rows]
            return jsonify(response={'peer': _peer(other_id), 'messages': msgs},
                           status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in GET /assemble/dm/{other_id}: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @ns.doc(description='Send a direct message to a community member (Skovo Pro).')
    @jwt_required()
    def post(self, other_id):
        try:
            me = get_jwt_identity()
            body = ((request.get_json() or {}).get('body') or '').strip()
            if not body:
                return jsonify(response={'message': 'Message cannot be empty.'}, status=400, bool=False)
            if len(body) > 2000:
                return jsonify(response={'message': 'Message is too long (2000 characters max).'},
                               status=400, bool=False)

            blocked = _dm_guard(me, other_id)
            if blocked is not None:
                return blocked

            # Under-18 safety (feature-updates.md §6, §16): numbers are masked,
            # outside links refused, blocked words masked -- same as community chat.
            from portal.helpers import chat_safety
            body, _flags, refuse = chat_safety.clean(body, allow_links=False)
            if refuse:
                return jsonify(response={'message': refuse}, status=400, bool=False)

            from portal.helpers.message_crypto import encrypt_message
            msg_id = str(uuid.uuid4())
            res = call_proc_one('sp_dm_send', msg_id, me, other_id, encrypt_message(body)) or {}
            db.session.commit()
            if not res.get('ok'):
                return jsonify(response={'message': res.get('message') or 'Could not send message.'},
                               status=403, bool=False)
            return jsonify(response={'message': 'Sent.', 'id': msg_id}, status=201, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in POST /assemble/dm/{other_id}: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/dm/<string:other_id>/block')
class DMBlock(Resource):
    @ns.doc(description='Block a member — neither side can message the other.')
    @jwt_required()
    def post(self, other_id):
        try:
            me = get_jwt_identity()
            if other_id == me:
                return jsonify(response={'message': 'You cannot block yourself.'}, status=400, bool=False)
            res = call_proc_one('sp_dm_block', str(uuid.uuid4()), me, other_id) or {}
            db.session.commit()
            return jsonify(response={'message': res.get('message') or 'Member blocked.'},
                           status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in POST /assemble/dm/{other_id}/block: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @ns.doc(description='Unblock a previously blocked member.')
    @jwt_required()
    def delete(self, other_id):
        try:
            me = get_jwt_identity()
            res = call_proc_one('sp_dm_unblock', me, other_id) or {}
            db.session.commit()
            return jsonify(response={'message': res.get('message') or 'Member unblocked.'},
                           status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in DELETE /assemble/dm/{other_id}/block: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/dm/<string:other_id>/report')
class DMReport(Resource):
    @ns.doc(description='Report a member for abuse. Goes to the moderation queue.')
    @jwt_required()
    def post(self, other_id):
        try:
            me = get_jwt_identity()
            data = request.get_json() or {}
            res = call_proc_one('sp_dm_report', str(uuid.uuid4()), me, other_id,
                                data.get('message_id'), (data.get('reason') or '').strip() or None) or {}
            db.session.commit()
            return jsonify(response={'message': res.get('message') or 'Report submitted.'},
                           status=201, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in POST /assemble/dm/{other_id}/report: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)
