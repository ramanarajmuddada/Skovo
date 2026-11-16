"""
Document Vault — student stores their important docs (SP-only: sp_docvault_*)
"""
from portal.helpers.error_capture import capture_error
from portal.helpers.helpers import serialize_datetime
import uuid
import json
from flask import jsonify, request
from flask_restx import Resource
from flask_jwt_extended import jwt_required, get_jwt_identity
from urllib.parse import quote
from portal.helpers.sp import call_proc, call_proc_one
from portal.helpers.storage import browser_url, object_name
from portal.models import db
from . import ns, logger

CATEGORIES = ('general', 'resume', 'certificate', 'marksheet', 'id_proof', 'sop', 'lor', 'other')

# Default only. Live gates read free_limit('vault_docs').
from portal.helpers.pro_limits import free_limit, upgrade_payload
FREE_DOC_LIMIT = 5


def _to_stored(file_url):
    """What actually goes in the `file_url` column.

    Our own files are stored as "/uploads/<name>" — one shape, independent of
    the host. The absolute URL the client is holding came from browser_url() and
    is only correct for the origin the API answered on; writing it back would
    freeze today's hostname into the row, and re-saving an unchanged document
    would quietly rewrite it. Anything not ours (a pasted Drive link) is kept
    verbatim.
    """
    if not file_url or not isinstance(file_url, str):
        return file_url
    name = object_name(file_url)
    return f'/uploads/{name}' if name else file_url.strip()


def _as_list(v):
    if isinstance(v, str):
        try:
            return json.loads(v)
        except Exception:
            return []
    return v or []


@ns.route('/')
class DocumentList(Resource):
    @jwt_required()
    def get(self):
        try:
            user_id = get_jwt_identity()
            from portal.routes.Subscription.subscription import is_pro
            cat = request.args.get('category')
            rows = call_proc('sp_docvault_by_user', user_id, cat) or []
            docs = [_dict(d) for d in rows]
            pro = is_pro(user_id)
            cap = free_limit('vault_docs')
            used = len(rows) if not cat else len(call_proc('sp_docvault_by_user', user_id, None) or [])
            return jsonify(response={
                'documents': docs,
                'total': len(docs),
                'is_pro': pro,
                'used': used,
                'limit': None if pro else cap,
                'remaining': None if pro else max(0, cap - used),
            }, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @jwt_required()
    def post(self):
        try:
            user_id = get_jwt_identity()
            data = request.get_json() or {}
            if not data.get('name') or not data.get('file_url'):
                return jsonify(response={'message': 'name and file_url required.'}, status=400, bool=False)

            # ── Free tier: 5-document cap (Pro = unlimited) ──────────────────
            from portal.routes.Subscription.subscription import is_pro
            if not is_pro(user_id):
                cap = free_limit('vault_docs')
                existing = call_proc('sp_docvault_by_user', user_id, None) or []
                # cap None = Unlimited; skip the gate rather than compare to it.
                if cap is not None and len(existing) >= cap:
                    body = upgrade_payload('vault', used=len(existing), limit=cap)
                    body['limit_reached'] = True
                    return jsonify(response=body, status=403, bool=False)

            # ── Integrity: refuse junk here rather than review it later ──────
            # A document can be worth points, and points invite a 3 KB blank
            # page called marksheet.pdf. Checking at upload means no queue and
            # no admin -- see migrate_docvault_integrity for what is and is not
            # provable from metadata the browser supplies.
            check = call_proc_one(
                'sp_docvault_check', user_id,
                int(data['file_size']) if data.get('file_size') else None,
                data.get('file_type'), (data.get('file_hash') or '').strip() or None) or {}
            verdict = check.get('result') or 'ok'
            if verdict != 'ok':
                mb = lambda b: f"{int(b) / 1048576:.0f} MB" if b else ''
                kb = lambda b: f"{int(b) / 1024:.0f} KB" if b else ''
                message = {
                    'duplicate_self':  'You have already uploaded this exact file.',
                    'duplicate_other': 'This file has already been uploaded by another '
                                       'student. Please upload your own document.',
                    'too_small':       f"That file is too small to be a real document "
                                       f"(minimum {kb(check.get('min_bytes'))}).",
                    'too_large':       f"That file is too large "
                                       f"(maximum {mb(check.get('max_bytes'))}).",
                    'bad_type':        f"That file type is not accepted. Allowed: "
                                       f"{check.get('allowed_types') or 'pdf, jpg, png'}.",
                }.get(verdict, 'That file could not be accepted.')
                return jsonify(response={'message': message, 'reason': verdict},
                               status=400, bool=False)

            new_id = str(uuid.uuid4())
            call_proc(
                'sp_docvault_create',
                new_id, user_id, data['name'].strip(), _to_stored(data['file_url']),
                data.get('file_type'),
                int(data['file_size']) if data.get('file_size') else None,
                data.get('category', 'general'),
                json.dumps(data.get('tags') or []),
            )
            # Stored separately: adding a parameter to sp_docvault_create would
            # break every caller still running the previous deploy.
            if (data.get('file_hash') or '').strip():
                call_proc('sp_docvault_set_hash', new_id, data['file_hash'].strip())
            db.session.commit()

            # Score signals: the upload itself (+2, 5 lifetime), plus the
            # one-time +5 once all four spec folders hold something.
            from portal.helpers import score
            score.award(user_id, score.DOCUMENT_UPLOADED, ref_id=new_id)
            score.award_vault_complete(user_id)
            db.session.commit()

            return jsonify(response={'message': 'Uploaded.', 'id': new_id}, status=201, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/<string:doc_id>')
class DocumentDetail(Resource):
    @jwt_required()
    def put(self, doc_id):
        try:
            user_id = get_jwt_identity()
            data = request.get_json() or {}

            # Replacing the file runs first, and in a separate procedure.
            #
            # Separate procedure, because procedures reload straight into the
            # shared RDS: widening sp_docvault_update_owner's signature would
            # break every checkout still making the old five-argument call.
            # sp_docvault_update_file is purely additive.
            #
            # First, because if it fails the metadata update has not run yet, so
            # the rollback leaves the row exactly as it was rather than saving
            # half an edit.
            #
            # It needed fixing at all because the edit form has always shown a
            # File URL field and an upload box that the update ignored outright:
            # someone whose document would not open could re-upload it, be told
            # "Saved", and still have the same broken row.
            if 'file_url' in data:
                new_url = _to_stored(data.get('file_url'))
                if not new_url:
                    return jsonify(response={'message': 'A file or link is required.'},
                                   status=400, bool=False)
                try:
                    call_proc('sp_docvault_update_file', doc_id, user_id,
                              new_url, data.get('file_type'))
                except Exception as e:
                    # A database that has not loaded the new procedure yet.
                    # Worth naming, because the alternative is a bare 500 that
                    # looks like the file itself is the problem. Nothing has
                    # been written at this point, so the rollback is clean and
                    # the rest of the edit is simply not attempted.
                    db.session.rollback()
                    if 'sp_docvault_update_file' in str(e):
                        logger.error('sp_docvault_update_file is missing - run '
                                     'apply_all.py --procs-only to load it.')
                        return jsonify(response={
                            'message': 'Replacing a file is not available on this server yet. '
                                       'The document itself is unchanged.',
                        }, status=503, bool=False)
                    raise

            tags = json.dumps(data['tags']) if 'tags' in data else None
            res = call_proc_one('sp_docvault_update_owner', doc_id, user_id,
                                data.get('name'), data.get('category'), tags)

            db.session.commit()
            if not res or not res.get('updated'):
                return jsonify(response={'message': 'Not found.'}, status=404, bool=False)
            return jsonify(response={'message': 'Updated.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @jwt_required()
    def delete(self, doc_id):
        try:
            user_id = get_jwt_identity()
            res = call_proc_one('sp_docvault_delete_owner', doc_id, user_id)
            db.session.commit()
            if not res or not res.get('deleted'):
                return jsonify(response={'message': 'Not found.'}, status=404, bool=False)
            return jsonify(response={'message': 'Deleted.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


def _urls(stored, name=None, file_type=None):
    """(view_url, download_url) for a stored file reference.

    `file_url` is normalised through storage.browser_url() on every read rather
    than being fixed up in the database. Rows were written in three shapes as
    the storage config changed — "/uploads/x.jpeg", an absolute API URL, and a
    pasted Google Drive link — and only the last two work from the SPA's own
    origin. A root-relative URL in window.open() resolves against the *page*,
    which is the SPA, so it hit the SPA's catch-all and 404'd; that is the bug
    students reported. Normalising on read fixes rows already written, with no
    migration and nothing to keep in step.

    A link we did not store (Drive, Dropbox) comes back untouched and gets no
    download URL — we cannot set a disposition on someone else's server.
    """
    view = browser_url(stored)
    obj = object_name(stored)
    if not obj:
        return view, None
    # A UUID is a poor filename to land in a Downloads folder; send the
    # document's own name, keeping the stored extension so it still opens.
    ext = obj.rsplit('.', 1)[-1] if '.' in obj else (file_type or '')
    label = (name or 'document').strip()[:80]
    if ext and not label.lower().endswith(f'.{ext.lower()}'):
        label = f'{label}.{ext}'
    sep = '&' if '?' in view else '?'
    return view, f'{view}{sep}download=1&filename={quote(label)}'


def _dict(d):
    ca = d.get('created_at')
    view, download = _urls(d.get('file_url'), d.get('name'), d.get('file_type'))
    return {
        'id': d.get('id'), 'name': d.get('name'),
        'file_url': view,
        'download_url': download,
        # The row as stored, so the edit form round-trips what is in the
        # database instead of writing the resolved absolute URL back over it.
        'stored_file_url': d.get('file_url'),
        'file_type': d.get('file_type'), 'file_size': d.get('file_size'),
        'category': d.get('category'), 'tags': _as_list(d.get('tags')),
        'is_public': bool(d.get('is_public')),
        'created_at': serialize_datetime(ca) if ca else None,
    }


# ══════════════════════════════════════════════════════════════════════════
# Shareable public profile — a mini-resume site (Skovo Pro, §4.6)
# ══════════════════════════════════════════════════════════════════════════

import re


def _slugify(s):
    s = re.sub(r'[^a-z0-9]+', '-', (s or '').lower()).strip('-')
    return s[:60] or None


@ns.route('/public-profile')
class PublicProfileSettings(Resource):
    @jwt_required()
    def get(self):
        try:
            user_id = get_jwt_identity()
            from portal.routes.Subscription.subscription import is_pro
            row = call_proc_one('sp_public_profile_get', user_id) or {}
            return jsonify(response={
                'slug': row.get('slug'),
                'headline': row.get('headline'),
                'is_enabled': bool(row.get('is_enabled')) if row else False,
                'is_pro': is_pro(user_id),
            }, status=200, bool=True)
        except Exception as e:
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @jwt_required()
    def put(self):
        try:
            user_id = get_jwt_identity()
            from portal.routes.Subscription.subscription import is_pro
            if not is_pro(user_id):
                from portal.helpers.pro_limits import upgrade_payload
                body = upgrade_payload('vault')
                body['message'] = 'A shareable profile link is a Skovo Pro feature. Take Skovo Pro.'
                return jsonify(response=body, status=403, bool=False)

            data = request.get_json() or {}
            slug = _slugify(data.get('slug'))
            if not slug:
                return jsonify(response={'message': 'Choose a link name (letters and numbers).'},
                               status=400, bool=False)

            # Slugs are public URLs, so collisions must fail loudly, not silently
            # hand someone else's link to this user.
            taken = call_proc_one('sp_public_profile_by_slug', slug)
            if taken and taken.get('user_id') != user_id:
                return jsonify(response={'message': 'That link name is already taken.'},
                               status=409, bool=False)

            row = call_proc_one('sp_public_profile_upsert', user_id, slug,
                                (data.get('headline') or None),
                                (1 if data.get('is_enabled', True) else 0))
            db.session.commit()
            return jsonify(response={'message': 'Profile link saved.', 'slug': (row or {}).get('slug')},
                           status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/<string:doc_id>/visibility')
class DocumentVisibility(Resource):
    @jwt_required()
    def put(self, doc_id):
        try:
            user_id = get_jwt_identity()
            make_public = bool((request.get_json() or {}).get('is_public'))
            res = call_proc_one('sp_docvault_set_public', doc_id, user_id, 1 if make_public else 0) or {}
            db.session.commit()
            if not res.get('updated'):
                return jsonify(response={'message': 'Not found.'}, status=404, bool=False)
            return jsonify(response={'message': 'Visibility updated.', 'is_public': make_public},
                           status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


def _public_doc(d):
    view, download = _urls(d.get('file_url'), d.get('name'), d.get('file_type'))
    return {
        'id': d.get('id'), 'name': d.get('name'), 'category': d.get('category'),
        'file_url': view, 'download_url': download,
    }


@ns.route('/p/<string:slug>')
class PublicProfileView(Resource):
    @ns.doc(description='Public mini-resume. No auth — only explicitly shared documents appear.')
    def get(self, slug):
        try:
            p = call_proc_one('sp_public_profile_by_slug', slug)
            if not p:
                return jsonify(response={'message': 'Profile not found.'}, status=404, bool=False)
            docs = call_proc('sp_public_profile_documents', p.get('user_id')) or []
            return jsonify(response={
                'name': p.get('full_name'),
                'headline': p.get('headline'),
                'avatar_url': p.get('avatar_url'),
                'score': p.get('score'),
                'level': p.get('level'),
                # Same normalisation as the vault list: this page is opened by
                # people with no session, on whatever origin the link was
                # pasted into, so a root-relative /uploads/ path is guaranteed
                # to resolve against the wrong host.
                'documents': [_public_doc(d) for d in docs],
            }, status=200, bool=True)
        except Exception as e:
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)
