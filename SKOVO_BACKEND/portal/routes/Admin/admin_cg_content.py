from portal.helpers.error_capture import capture_error
from portal.helpers.helpers import serialize_datetime
import json, uuid, re, datetime
from flask import jsonify, request
from flask_restx import Resource
from flask_jwt_extended import jwt_required, get_jwt, get_jwt_identity
from portal.models import db
from portal.helpers.sp import call_proc, call_proc_one
from . import ns, logger
from portal.helpers.admin_auth import can, AREA_CONTENT


def _require_admin():
    """This module lives in the 'content' area — see portal/helpers/admin_auth."""
    return can(AREA_CONTENT)


def _slugify(text):
    return re.sub(r'[^a-z0-9]+', '-', text.lower()).strip('-')


def _as_list(v):
    if isinstance(v, str):
        try:
            return json.loads(v)
        except Exception:
            return None
    return v


def _dict(c):
    if not c:
        return None
    published_at, created_at, updated_at = c.get('published_at'), c.get('created_at'), c.get('updated_at')
    return {
        'id': c.get('id'), 'content_type': c.get('content_type'), 'title': c.get('title'), 'slug': c.get('slug'),
        'body': c.get('body'), 'summary': c.get('summary'), 'tags': _as_list(c.get('tags')),
        'target_audience': _as_list(c.get('target_audience')), 'thumbnail_url': c.get('thumbnail_url'),
        'is_published': bool(c.get('is_published')),
        'published_at': serialize_datetime(published_at) if published_at else None,
        'author_name': c.get('author_name'), 'author_email': c.get('author_email'),
        'view_count': c.get('view_count'),
        'created_at': serialize_datetime(created_at) if created_at else None,
        'updated_at': serialize_datetime(updated_at) if updated_at else None,
    }


@ns.route('/cg/content')
class AdminCGContentList(Resource):
    @jwt_required()
    def get(self):
        if not _require_admin():
            return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
        try:
            ctype  = request.args.get('type', '')
            search = request.args.get('search', '')
            page   = request.args.get('page', 1, type=int)
            per_page = 20

            # ── SP: sp_cg_content_list — no type/search filters on the generic
            # CRUD proc, so pull a bounded batch and filter/paginate here. ────
            rows = call_proc('sp_cg_content_list', 5000, 0)
            if ctype:
                rows = [c for c in rows if c.get('content_type') == ctype]
            if search:
                s = search.lower()
                rows = [c for c in rows if s in (c.get('title') or '').lower()]

            total = len(rows)
            pages = (total + per_page - 1) // per_page if per_page else 1
            start = (page - 1) * per_page
            page_rows = rows[start:start + per_page]

            return jsonify(
                response={'items': [_dict(c) for c in page_rows]},
                pagination={'total': total, 'pages': pages, 'page': page},
                status=200, bool=True
            )
        except Exception as e:
            logger.error(f"CG GET /content: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @jwt_required()
    def post(self):
        if not _require_admin():
            return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
        try:
            d = request.get_json() or {}
            if not d.get('title'):
                return jsonify(response={'message': 'Title is required.'}, status=400, bool=False)
            email = get_jwt_identity()
            slug = _slugify(d['title']) + '-' + str(uuid.uuid4())[:8]
            now  = datetime.datetime.utcnow() if d.get('is_published') else None

            # ── SP: sp_cg_content_create ──────────────────────────────────────
            cid = str(uuid.uuid4())
            c = call_proc_one(
                'sp_cg_content_create',
                cid, d.get('content_type', 'article'), d['title'], slug, d.get('body'), d.get('summary'),
                json.dumps(d['tags']) if d.get('tags') is not None else None,
                json.dumps(d['target_audience']) if d.get('target_audience') is not None else None,
                d.get('thumbnail_url'), 1 if d.get('is_published') else 0, now,
                d.get('author_name'), d.get('author_email', email), 0,
                email, email, None,
            )
            db.session.commit()
            return jsonify(response={'message': 'Created.', 'item': _dict(c)}, status=201, bool=True)
        except Exception as e:
            db.session.rollback(); logger.error(f"CG POST /content: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/cg/content/<string:cid>')
class AdminCGContentDetail(Resource):
    @jwt_required()
    def put(self, cid):
        if not _require_admin():
            return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
        try:
            # ── SP: sp_cg_content_get + _update (full replace) ────────────────
            existing = call_proc_one('sp_cg_content_get', cid)
            if not existing or existing.get('deleted_at'):
                return jsonify(response={'message': 'Not found.'}, status=404, bool=False)
            d = request.get_json() or {}

            def val(key):
                return d[key] if key in d else existing.get(key)

            published_at = existing.get('published_at')
            is_published = d['is_published'] if 'is_published' in d else existing.get('is_published')
            if 'is_published' in d and d['is_published'] and not published_at:
                published_at = datetime.datetime.utcnow()

            admin_id = get_jwt_identity()
            c = call_proc_one(
                'sp_cg_content_update',
                cid, val('content_type'), val('title'), existing['slug'], val('body'), val('summary'),
                json.dumps(d['tags']) if 'tags' in d else existing.get('tags'),
                json.dumps(d['target_audience']) if 'target_audience' in d else existing.get('target_audience'),
                val('thumbnail_url'), 1 if is_published else 0, published_at,
                val('author_name'), existing.get('author_email'), existing.get('view_count'),
                existing.get('created_by'), admin_id, None,
            )
            db.session.commit()
            return jsonify(response={'message': 'Updated.', 'item': _dict(c)}, status=200, bool=True)
        except Exception as e:
            db.session.rollback(); logger.error(f"CG PUT /content/{cid}: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @jwt_required()
    def delete(self, cid):
        if not _require_admin():
            return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
        try:
            # ── SP: sp_cg_content_get + _delete (soft delete) ─────────────────
            existing = call_proc_one('sp_cg_content_get', cid)
            if not existing or existing.get('deleted_at'):
                return jsonify(response={'message': 'Not found.'}, status=404, bool=False)
            call_proc('sp_cg_content_delete', cid)
            db.session.commit()
            return jsonify(response={'message': 'Deleted.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback(); logger.error(f"CG DELETE /content/{cid}: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)
