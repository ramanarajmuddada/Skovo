from portal.helpers.error_capture import capture_error
import os
import uuid
from flask import jsonify, request, current_app
from flask_restx import Resource
from flask_jwt_extended import jwt_required, get_jwt_identity
from werkzeug.utils import secure_filename
from . import ns, logger

IMAGE_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'webp'}
DOC_EXTENSIONS = {'pdf', 'doc', 'docx'}
ALLOWED_EXTENSIONS = IMAGE_EXTENSIONS | DOC_EXTENSIONS
MAX_SIZE_BYTES = 10 * 1024 * 1024  # 10 MB — mirrored in Skovo/src/components/ui/fileRules.js

# Magic numbers, so "what the file is" does not rest on what it was named.
# An extension check alone accepts a .exe renamed to .png; the browser then
# refuses to decode it and the person sees the default avatar with no
# explanation, which is the same dead end as a broken URL.
_IMAGE_SIGNATURES = (
    (b'\x89PNG\r\n\x1a\n', 'png'),
    (b'\xff\xd8\xff', 'jpeg'),
    (b'GIF87a', 'gif'),
    (b'GIF89a', 'gif'),
)


def _allowed(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


def _fail(message, code, **extra):
    """Answer a failed upload with the real HTTP status, not 200-and-a-body-field.

    The rest of this API answers 200 and puts the outcome in `status`/`bool`, and
    the web client reads the body, so it never noticed. For uploads that default
    was actively misleading: a refused or unstored file came back 200 OK, so
    anything that reads the status code instead of the body -- a retry wrapper, an
    uptime monitor, a mobile client, a proxy log -- recorded a file as stored when
    nothing had been written. Storage failures are the one case here where that
    gap is silent and expensive.

    The body keeps its existing shape, so no caller has to change: the web client
    still checks `bool` and shows `response.message` inline.

    A plain dict, not jsonify(): this is a flask_restx Resource, and restx runs
    the first element of a (body, code) tuple through its own JSON serializer --
    handed an already-built Response it raises "Object of type Response is not
    JSON serializable" and the client gets a 500 instead of the real status.
    """
    return {'response': {'message': message, **extra}, 'status': code, 'bool': False}, code


def _sniff_image(head):
    """The image format these first bytes really are, or None."""
    for sig, kind in _IMAGE_SIGNATURES:
        if head.startswith(sig):
            return kind
    # WEBP is a RIFF container: "RIFF" <4-byte size> "WEBP".
    if head[:4] == b'RIFF' and head[8:12] == b'WEBP':
        return 'webp'
    return None


@ns.route('/')
class FileUpload(Resource):
    @jwt_required()
    def post(self):
        """Upload a file and return its URL. Accepts multipart/form-data with key 'file'.

        Optional form field `kind`:
          image  — the file must be a real image, verified by its leading bytes.
                   Used by the avatar pickers, which have no use for a PDF.
          (unset) — any allowed type, as before. The document flows rely on this.
        """
        try:
            if 'file' not in request.files:
                return _fail('No file was attached to the request.', 400)

            file = request.files['file']
            if not file.filename:
                return _fail('That file has no name, so it cannot be saved.', 400)

            kind = (request.form.get('kind') or '').strip().lower()
            images_only = kind == 'image'

            if '.' not in file.filename:
                return _fail('That file has no extension, so we cannot tell what type it is.', 400)

            ext = file.filename.rsplit('.', 1)[1].lower()
            allowed = IMAGE_EXTENSIONS if images_only else ALLOWED_EXTENSIONS
            if ext not in allowed:
                if images_only:
                    return _fail(f'.{ext} is not an image. Use a JPG, PNG, GIF or WEBP.', 400)
                return _fail(
                    f'File type not allowed. Allowed: {", ".join(sorted(ALLOWED_EXTENSIONS))}', 400)

            file.seek(0, 2)
            size = file.tell()
            file.seek(0)
            if size == 0:
                return _fail('That file is empty. It may not have finished syncing yet.', 400)
            if size > MAX_SIZE_BYTES:
                mb = size / 1024 / 1024
                # 413 is the honest code for this one.
                return _fail(f'That file is {mb:.1f} MB. The limit is 10 MB.', 413)

            # Content check for anything that claims to be an image, whether or
            # not `kind` was sent — a bad avatar is silent at display time, so
            # it is worth catching here rather than at the <img> tag.
            if ext in IMAGE_EXTENSIONS:
                head = file.stream.read(32)
                file.seek(0)
                if _sniff_image(head) is None:
                    return _fail(
                        'That file is not a readable image. If it came from an '
                        'iPhone it may be HEIC — open it, tap Share and save it as JPEG.', 400)

            safe_name = f"{uuid.uuid4().hex}.{ext}"

            # S3 in prod (multi-instance safe), local disk in dev — see helpers/storage.py.
            # save_file returns a browser-usable URL via storage.public_url(), so the
            # shape does not change when the S3 branch is unavailable.
            from portal.helpers.storage import save_file, is_s3_enabled, StorageError
            try:
                file_url = save_file(file, safe_name, content_type=file.mimetype)
            except StorageError as e:
                # Storage is the problem, not the file. Answered separately from
                # the generic 500 below so the person is not told to try a
                # different photo when the photo was never the issue.
                logger.error(f"Upload rejected - storage unavailable: {e}")
                return _fail(str(e), 503)

            logger.info(
                f"File uploaded: {safe_name} ({size}B, s3={is_s3_enabled()}) "
                f"-> {file_url} by user {get_jwt_identity()}"
            )

            return jsonify(
                response={
                    'url': file_url,
                    'filename': safe_name,
                    'original_name': secure_filename(file.filename),
                    'size_bytes': size,
                },
                status=200, bool=True
            )
        except Exception as e:
            logger.error(f"File upload error: {e}")
            error_id = capture_error(e)
            return _fail('Upload failed.', 500, error_id=error_id)
