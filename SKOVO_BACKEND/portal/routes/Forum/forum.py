"""
Community Forum / Q&A (SP-only: sp_forum_*)
Student: full CRUD on own posts/replies, upvote. Admin: pin/delete any post.
"""
from portal.helpers.error_capture import capture_error
from portal.helpers.helpers import serialize_datetime
import uuid
import json
from flask import jsonify, request
from flask_restx import Resource
from flask_jwt_extended import jwt_required, get_jwt_identity
from portal.helpers.sp import call_proc, call_proc_one
from portal.models import db
from . import ns, logger

CATEGORIES = ('general', 'exam_prep', 'college', 'career', 'scholarship', 'abroad', 'placement')


def _as_list(v):
    if isinstance(v, str):
        try:
            return json.loads(v)
        except Exception:
            return []
    return v or []


def _post_dict(p):
    ca = p.get('created_at')
    return {
        'id': p.get('id'), 'title': p.get('title'), 'content': p.get('content'),
        'category': p.get('category'), 'tags': _as_list(p.get('tags')),
        'upvotes': p.get('upvotes'), 'views': p.get('views'), 'replies_count': p.get('replies_count'),
        'is_pinned': bool(p.get('is_pinned')), 'is_solved': bool(p.get('is_solved')),
        'upvoted': bool(p.get('upvoted')),
        'author_name': p.get('author_name') or 'Unknown',
        'author_id': p.get('user_id'),
        'created_at': serialize_datetime(ca) if ca else None,
    }


def _reply_dict(r):
    ca = r.get('created_at')
    return {
        'id': r.get('id'), 'post_id': r.get('post_id'), 'content': r.get('content'),
        'upvotes': r.get('upvotes'), 'is_accepted': bool(r.get('is_accepted')),
        'author_name': r.get('author_name') or 'Unknown',
        'author_id': r.get('user_id'),
        'created_at': serialize_datetime(ca) if ca else None,
    }


@ns.route('/posts')
class ForumPostList(Resource):
    @jwt_required()
    def get(self):
        try:
            user_id = get_jwt_identity()
            posts = call_proc('sp_forum_posts_list', user_id, request.args.get('category'))
            return jsonify(response={'posts': [_post_dict(p) for p in posts], 'total': len(posts)},
                           status=200, bool=True)
        except Exception as e:
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @jwt_required()
    def post(self):
        try:
            user_id = get_jwt_identity()
            data = request.get_json() or {}
            if not data.get('title') or not data.get('content'):
                return jsonify(response={'message': 'title and content required.'}, status=400, bool=False)
            category = data.get('category', 'general')
            if category not in CATEGORIES:
                category = 'general'
            new_id = str(uuid.uuid4())
            call_proc('sp_forum_post_create', new_id, user_id, data['title'].strip(),
                      data['content'].strip(), category, json.dumps(data.get('tags') or []))
            db.session.commit()
            return jsonify(response={'message': 'Posted.', 'id': new_id}, status=201, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/posts/<string:post_id>')
class ForumPostDetail(Resource):
    @jwt_required()
    def get(self, post_id):
        try:
            user_id = get_jwt_identity()
            p = call_proc_one('sp_forum_post_get', post_id, user_id)
            if not p:
                return jsonify(response={'message': 'Post not found.'}, status=404, bool=False)
            replies = call_proc('sp_forum_post_replies', post_id)
            return jsonify(response={
                'post': _post_dict(p),
                'replies': [_reply_dict(r) for r in replies],
            }, status=200, bool=True)
        except Exception as e:
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @jwt_required()
    def put(self, post_id):
        try:
            user_id = get_jwt_identity()
            data = request.get_json() or {}
            if 'category' in data and data['category'] not in CATEGORIES:
                return jsonify(response={'message': 'Invalid category.'}, status=400, bool=False)
            tags = json.dumps(data['tags']) if 'tags' in data else None
            res = call_proc_one('sp_forum_post_update_owner', post_id, user_id,
                                data.get('title'), data.get('content'), data.get('category'), tags)
            if not res or not res.get('updated'):
                db.session.rollback()
                return jsonify(response={'message': 'Post not found.'}, status=404, bool=False)
            db.session.commit()
            return jsonify(response={'message': 'Updated.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @jwt_required()
    def delete(self, post_id):
        try:
            user_id = get_jwt_identity()
            res = call_proc_one('sp_forum_post_delete_owner', post_id, user_id)
            if not res or not res.get('deleted'):
                db.session.rollback()
                return jsonify(response={'message': 'Post not found.'}, status=404, bool=False)
            db.session.commit()
            return jsonify(response={'message': 'Deleted.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/posts/<string:post_id>/upvote')
class ForumPostUpvote(Resource):
    @jwt_required()
    def post(self, post_id):
        """Toggle the caller's upvote on a post (idempotent per user)."""
        try:
            user_id = get_jwt_identity()
            res = call_proc_one('sp_forum_post_upvote_toggle', post_id, user_id)
            if not res or res.get('result') == 'notfound':
                return jsonify(response={'message': 'Post not found.'}, status=404, bool=False)
            return jsonify(response={'upvotes': res.get('upvotes'), 'upvoted': bool(res.get('upvoted'))},
                           status=200, bool=True)
        except Exception as e:
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/posts/<string:post_id>/replies')
class ForumReplyList(Resource):
    @jwt_required()
    def post(self, post_id):
        try:
            user_id = get_jwt_identity()
            data = request.get_json() or {}
            if not data.get('content'):
                return jsonify(response={'message': 'content required.'}, status=400, bool=False)
            res = call_proc_one('sp_forum_reply_create', str(uuid.uuid4()), post_id, user_id, data['content'].strip())
            if not res or res.get('result') == 'notfound':
                return jsonify(response={'message': 'Post not found.'}, status=404, bool=False)
            return jsonify(response={'message': 'Reply added.', 'id': res.get('id')}, status=201, bool=True)
        except Exception as e:
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/replies/<string:reply_id>/accept')
class ForumReplyAccept(Resource):
    @jwt_required()
    def post(self, reply_id):
        try:
            user_id = get_jwt_identity()
            res = call_proc_one('sp_forum_reply_accept', reply_id, user_id)
            result = (res or {}).get('result')
            if result == 'no_reply':
                return jsonify(response={'message': 'Reply not found.'}, status=404, bool=False)
            if result == 'not_owner':
                return jsonify(response={'message': 'Not your post.'}, status=403, bool=False)
            db.session.commit()
            # Accepted answer = Solved (feature-updates.md §6): the same admin
            # rule and daily cap as community doubts; never for your own post.
            from sqlalchemy import text
            author = db.session.execute(text("SELECT user_id FROM forum_replies WHERE id = :r"),
                                        {'r': reply_id}).scalar()
            if author and author != user_id:
                from portal.helpers import score, engagement
                score.award(author, 'answer_solved', ref_id=f'forum-{reply_id}')
                engagement.track(author, 'answer_solved')
                db.session.commit()
            return jsonify(response={'message': 'Marked as accepted.'}, status=200, bool=True)
        except Exception as e:
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)
