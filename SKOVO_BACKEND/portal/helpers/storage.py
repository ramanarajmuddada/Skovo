"""
File storage abstraction — S3 in production, local disk in development.

S3 is used when S3_BUCKET is set AND boto3 is importable; otherwise files are
written to the local `upload_folder` (fine for a single dev box, NOT for a
multi-instance AWS deploy). Object key layout: uploads/<name>.

Env:
  S3_BUCKET             Bucket name. Presence enables S3.
  AWS_REGION            e.g. ap-south-1 (Mumbai).
  PUBLIC_MEDIA_BASE_URL The origin that serves /uploads/<name> to a browser.
  S3_PUBLIC_BASE_URL    The older name for the same thing; still read as a
                        fallback, so existing .env files keep working.
                          -> upload returns "<base>/uploads/<name>".
                        With neither set, upload returns "/uploads/<name>",
                        which is correct only when the SPA and the API share an
                        origin (the Vite dev proxy, or nginx in front of both).
  S3_ENDPOINT_URL       Optional (S3-compatible services / local testing).
  AWS credentials       From the standard chain — use an IAM role in prod, never keys.

── Why the base URL matters, and why the local branch honours it too ──────────
The URL this module returns is written into the database and later handed to a
browser as `<img src>` / `<a href>`. A browser resolves a root-relative
"/uploads/x.png" against **the page origin**, which is the SPA, not the API. On
a split-host deploy (skovoai.com + api.skovoai.com) that lands on the SPA
catch-all and returns index.html — the image fails to decode and falls back to
the default avatar, while the upload itself reported success.

That is exactly what happened to the achiever profile photo: boto3 was missing
from the venv, `is_s3_enabled()` quietly returned False, and the local-disk
branch returned a bare "/uploads/<name>" while ignoring S3_PUBLIC_BASE_URL
altogether. One deployment therefore wrote two different URL shapes into
`achievers.profile_image_url` depending on whether a single import happened to
succeed. Both branches now go through `public_url()`, so the shape of the URL no
longer depends on which storage backend answered.
"""
import io
import os
import logging
import re
import threading

logger = logging.getLogger("skovo.storage")

class StorageError(RuntimeError):
    """Raised when a file could not be stored in S3.

    Deliberately NOT a fallback. Identity documents and achievement proofs must
    live in one place that every instance can read and that can be audited; a
    copy on whichever box happened to answer the request is not that. An upload
    that cannot reach S3 has failed, and the person uploading is told so rather
    than being shown a success they cannot rely on.
    """


_KEY_PREFIX = "uploads"

# The bucket-is-set-but-boto3-is-missing message is worth shouting once, not on
# every request — is_s3_enabled() is called per upload *and* per file GET.
_warned_no_boto3 = False

# Built once — see _client(). Never reset; a config change needs a restart,
# which is already true of everything else read from the environment here.
_s3_client = None
_client_lock = threading.Lock()


def _bucket():
    return os.environ.get("S3_BUCKET", "").strip()


def is_s3_enabled():
    global _warned_no_boto3
    if not _bucket():
        return False
    try:
        import boto3  # noqa: F401
        return True
    except Exception:
        if not _warned_no_boto3:
            _warned_no_boto3 = True
            # error, not warning: with no boto3 there is nowhere to put a file,
            # so every upload is refused. The message used to say uploads were
            # "falling back to LOCAL DISK", which stopped being true when the
            # disk fallback was removed (see save_file) -- it sent anyone
            # debugging a failed upload looking for files that were never
            # written anywhere.
            logger.error(
                "S3_BUCKET=%s is set but boto3 is not importable — every upload "
                "will be REFUSED with a 503; nothing is written anywhere. Install "
                "boto3 (it is already in requirements.txt) or unset S3_BUCKET to "
                "make this deliberate.",
                _bucket(),
            )
        return False


def _build_client():
    """Construct the S3 client, surviving an AWS_PROFILE that is not on this box.

    boto3 resolves AWS_PROFILE at client construction and raises ProfileNotFound
    when the named profile has no section in ~/.aws — which takes down *every*
    upload and every presign, from inside a route that has no idea it is an AWS
    problem. `.env` ships AWS_PROFILE=skovo, so any machine whose ~/.aws was set
    up under a different name (or with only [default], as CI and a fresh laptop
    both are) breaks the moment boto3 becomes importable: before that
    is_s3_enabled() was False and nothing called this at all, which is why
    installing boto3 turned a working local flow into a 500 on upload.

    So a missing profile falls back to the standard credential chain — env keys,
    then ~/.aws [default], then the instance role — rather than failing. Logged
    at error level, once: the credentials in use are not the ones asked for, and
    that is worth knowing even though the request succeeds.
    """
    import boto3
    from botocore.exceptions import ProfileNotFound

    kwargs = {}
    region = os.environ.get("AWS_REGION")
    if region:
        kwargs["region_name"] = region
    endpoint = os.environ.get("S3_ENDPOINT_URL")
    if endpoint:
        kwargs["endpoint_url"] = endpoint

    try:
        return boto3.client("s3", **kwargs)
    except ProfileNotFound:
        pass

    profile = os.environ.get("AWS_PROFILE", "")
    logger.error(
        "AWS_PROFILE=%s is not configured on this machine — falling back to the "
        "default credential chain. Uploads still work, but under whichever "
        "identity that chain resolves to. Create the profile in ~/.aws/config or "
        "drop AWS_PROFILE from .env to make the choice deliberate.",
        profile,
    )
    # boto3 reads AWS_PROFILE from the environment whenever a session does not
    # name one, so the variable has to be out of the picture for this one
    # construction. Safe to mutate here: it runs once, under the lock in
    # _client(), and is restored before anything else can observe it.
    saved = os.environ.pop("AWS_PROFILE", None)
    try:
        return boto3.Session().client("s3", **kwargs)
    finally:
        if saved is not None:
            os.environ["AWS_PROFILE"] = saved


def _client():
    """The shared S3 client.

    Cached because botocore builds one by parsing its bundled service JSON, which
    costs ~100ms — noticeable on upload, and paid on *every* image GET, since the
    /uploads/ route presigns through here. boto3 clients are thread-safe to use;
    only the construction is serialised.
    """
    global _s3_client
    if _s3_client is None:
        with _client_lock:
            if _s3_client is None:
                _s3_client = _build_client()
    return _s3_client


def public_base():
    """Origin that serves /uploads/<name> to a browser, or '' when same-origin."""
    return (
        os.environ.get("PUBLIC_MEDIA_BASE_URL", "").strip()
        or os.environ.get("S3_PUBLIC_BASE_URL", "").strip()
    ).rstrip("/")


def public_url(safe_name):
    """The URL a browser should use for a stored object.

    One function for both storage backends, so a URL never depends on which one
    saved the bytes. Absolute when a base is configured; root-relative
    otherwise, which works because the Vite dev proxy and the nginx config both
    forward /uploads/ to the backend.
    """
    base = public_base()
    return f"{base}/{_KEY_PREFIX}/{safe_name}" if base else f"/{_KEY_PREFIX}/{safe_name}"


def object_name(url_or_name):
    """The stored filename, from any URL shape this codebase has produced.

    Handles the root-relative "/uploads/x.png", the absolute
    "https://api.skovoai.com/uploads/x.png" and a presigned URL carrying a query
    string. Returns None for anything that is not ours — an external avatar URL
    an admin pasted in, say — so a caller never acts on a path it did not create.
    """
    if not url_or_name or not isinstance(url_or_name, str):
        return None
    name = url_or_name.strip().split("?", 1)[0].split("#", 1)[0]
    if "/" in name:
        head, _, tail = name.rpartition("/")
        # Only accept it when it really sat under an /uploads/ path. A bare
        # filename lifted out of an arbitrary URL is not ours to touch.
        if not head.endswith(f"/{_KEY_PREFIX}") and head.rstrip("/") != _KEY_PREFIX:
            return None
        name = tail
    if not name or not re.fullmatch(r"[A-Za-z0-9_.-]{1,120}\.[A-Za-z0-9]{1,10}", name):
        return None
    if ".." in name:
        return None
    return name


# _save_local was removed with the disk fallback. Nothing writes to local disk
# any more. The READ path in portal/__init__.py still serves from local_path(),
# because files written by older builds may still be sitting on a dev box.


def save_file(file_storage, safe_name, content_type=None):
    """Persist an uploaded Werkzeug FileStorage to S3. Returns the client URL.

    Raises StorageError if S3 is not configured or the put fails. There is no
    local-disk fallback by design -- see StorageError.

    The previous version fell back to disk so an upload never 500'd. That kept
    the feature alive during an outage but made the storage location silently
    dependent on whether one network call succeeded: the URL shape is identical
    either way, so nothing downstream could tell a file in the bucket from a
    file on one instance's disk. The bucket is the system of record, so a write
    that misses it is a failure, not a degraded success.
    """
    if not is_s3_enabled():
        # Distinguish the two reasons, because the fix is different: set the
        # variable, or install the dependency.
        if not _bucket():
            raise StorageError(
                "File storage is not configured: S3_BUCKET is empty. "
                "Uploads are not written to local disk."
            )
        raise StorageError(
            "File storage is unavailable: S3_BUCKET is set but boto3 is not "
            "importable. Install boto3 in this environment."
        )

    key = f"{_KEY_PREFIX}/{safe_name}"
    # AES256 is the bucket's own encryption. The object is scrambled on disk
    # and S3 decrypts it for a normal download, so the link still opens.
    extra = {"ServerSideEncryption": "AES256"}
    if content_type:
        extra["ContentType"] = content_type

    # Keep the BYTES, not a handle to them. `upload_fileobj` consumes the object
    # it is given and, on some failure paths, closes it -- including a BytesIO
    # we hand it ourselves. Reading first means a retry or an error path can
    # never be handed a closed stream. Uploads are capped at 10 MB by the route,
    # so holding them is bounded.
    try:
        file_storage.seek(0)
        raw = file_storage.read()
    except Exception as e:
        raise StorageError(f"Could not read the uploaded file: {e}") from e

    try:
        _client().upload_fileobj(io.BytesIO(raw), _bucket(), key, ExtraArgs=extra)
    except Exception as e:
        # Credentials missing or wrong (AWS_PROFILE naming a profile that is not
        # on this machine is the common one), bucket unreachable, region wrong.
        logger.error(
            "S3 upload failed for %s (%s: %s) -- upload rejected, nothing written.",
            key, type(e).__name__, e,
        )
        raise StorageError(
            f"Could not store the file in S3 ({type(e).__name__}). "
            "Nothing was saved - please try again."
        ) from e

    return public_url(safe_name)


def delete_file(url_or_name):
    """Best-effort removal of a stored object. Never raises.

    Returns True only when something was actually deleted, so a caller can log
    honestly. Used when an avatar is replaced: the row pointer moves to the new
    file and the old one would otherwise sit in the bucket forever.
    """
    name = object_name(url_or_name)
    if not name:
        return False
    try:
        if is_s3_enabled():
            _client().delete_object(Bucket=_bucket(), Key=f"{_KEY_PREFIX}/{name}")
            return True
        from flask import current_app
        folder = current_app.config.get("upload_folder", "/tmp/uploads")
        real_folder = os.path.realpath(folder)
        path = os.path.realpath(os.path.join(folder, name))
        # A crafted name must not escape the folder, even though object_name()
        # has already rejected separators and "..".
        if os.path.commonpath([real_folder, path]) != real_folder:
            return False
        if os.path.isfile(path):
            os.remove(path)
            return True
        return False
    except Exception as e:
        logger.warning(f"delete failed for {name}: {e}")
        return False


def presigned_url(safe_name, expires=3600, download_name=None):
    """Short-lived GET URL for a stored object, or None when S3 is disabled.

    `download_name` sets Content-Disposition on the S3 response, so a Download
    button still downloads after the 302 hands the browser off to S3. Without
    it S3 replies with the stored ContentType and the browser renders the image
    inline instead — the redirect is where a disposition set by Flask would
    otherwise be lost.
    """
    if not is_s3_enabled():
        return None
    key = f"{_KEY_PREFIX}/{safe_name}"
    params = {"Bucket": _bucket(), "Key": key}
    if download_name:
        # Quoted, and with quotes stripped out of the name itself, so a filename
        # cannot break out of the header value.
        clean = str(download_name).replace('"', "").replace("\\", "")
        params["ResponseContentDisposition"] = f'attachment; filename="{clean}"'
    try:
        return _client().generate_presigned_url(
            "get_object", Params=params, ExpiresIn=expires,
        )
    except Exception as e:
        logger.error(f"presign failed for {key}: {e}")
        return None


def object_exists(safe_name):
    """Is this object actually in the bucket? False when S3 is off or on error.

    presigned_url() signs a key without looking, so a key that was never
    uploaded still yields a perfectly valid URL — and the browser follows the
    302 into S3's `NoSuchKey` XML, a 404 the app never sees and cannot explain.
    Checking first is what lets the caller fall back to local disk, or answer
    with its own error.
    """
    if not is_s3_enabled():
        return False
    try:
        _client().head_object(Bucket=_bucket(), Key=f"{_KEY_PREFIX}/{safe_name}")
        return True
    except Exception:
        return False


def local_path(safe_name):
    """Absolute path of a stored object on local disk, or None if not there.

    Files written before S3 was switched on — or by any instance whose boto3
    import failed — live here and nowhere else, so the serving route checks it
    rather than 404ing on a file that is present.
    """
    try:
        from flask import current_app
        folder = current_app.config.get("upload_folder", "/tmp/uploads")
    except Exception:
        return None
    real_folder = os.path.realpath(folder)
    path = os.path.realpath(os.path.join(folder, safe_name))
    # object_name() already rejects separators and "..", but this is the call
    # that touches the filesystem, so it re-checks rather than trusting that.
    try:
        if os.path.commonpath([real_folder, path]) != real_folder:
            return None
    except ValueError:
        return None
    return path if os.path.isfile(path) else None


def browser_url(stored_value):
    """Normalise a file reference held in the database into a loadable URL.

    Read-path counterpart to save_file(). Rows have been written in three shapes
    over time — "/uploads/x.png", "https://api.skovoai.com/uploads/x.png" and a
    bare "x.png" — and only the absolute one works from the SPA's origin. This
    collapses all three onto whatever public_url() currently produces, so a fix
    to the base URL applies to old rows without a migration.

    Anything that is not ours is returned untouched: the Document Vault
    deliberately accepts a pasted Google Drive link, and rewriting that would
    turn a working link into a 404.
    """
    if not stored_value or not isinstance(stored_value, str):
        return stored_value
    name = object_name(stored_value)
    return public_url(name) if name else stored_value
