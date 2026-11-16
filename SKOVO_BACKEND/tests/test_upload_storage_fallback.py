"""The S3 -> local-disk fallback in `save_file`, and the bug it used to have.

`error_logs` carried 13 `/v1/upload/` rows dated 3 September — 8 of
"I/O operation on closed file" and 5 of "seek of closed file". They were not a
second bug on top of the S3 failure. They WERE the recovery path: boto3's
`upload_fileobj` consumes the object it is handed and, on some failure paths,
closes it, so the disk fallback then called `seek(0)` on a closed stream and
raised. The fallback written to keep uploads working was itself answering 500
to every upload that reached it.

The fix is to keep the BYTES rather than a handle to them, and wrap a fresh
BytesIO for each attempt — whatever boto3 does to the stream it was given
cannot then reach the copy the fallback needs.

These tests drive `save_file` directly with a client that reproduces boto3's
behaviour. Nothing is uploaded and nothing touches the database.

Deliberately untagged. There is no workbook case for the storage fallback —
X01-024 is "HTTPException not logged", a different thing entirely — and
attaching a passing test to an unrelated case id turns the traceability report
into fiction. What these do serve is X01-021: they are the evidence that the 13
`/v1/upload/` rows in `error_logs` describe a bug that is now fixed, and can
therefore be deleted rather than left to send the next person chasing it.
"""
import io
import os
import tempfile

import pytest
from flask import Flask
from werkzeug.datastructures import FileStorage

from portal.helpers import storage as st

PNG = b'\x89PNG\r\n\x1a\n' + b'x' * 200


@pytest.fixture()
def disk_app():
    """A Flask app whose upload_folder is a throwaway directory."""
    app = Flask(__name__)
    app.config['upload_folder'] = tempfile.mkdtemp(prefix='skovo-upload-test-')
    return app


@pytest.fixture()
def upload():
    return lambda: FileStorage(stream=io.BytesIO(PNG), filename='p.png',
                               content_type='image/png')


class _ClosingClient:
    """boto3's behaviour on the path that caused the bug: read it, close it, fail."""

    def upload_fileobj(self, fileobj, bucket, key, ExtraArgs=None):
        fileobj.read()
        fileobj.close()
        raise RuntimeError('simulated S3 failure after the stream was consumed')


class _OkClient:
    def __init__(self):
        self.calls = []

    def upload_fileobj(self, fileobj, bucket, key, ExtraArgs=None):
        self.calls.append((bucket, key, len(fileobj.read())))


@pytest.fixture()
def s3(monkeypatch):
    """Force the S3 branch with a swappable client."""
    def _use(client):
        monkeypatch.setattr(st, 'is_s3_enabled', lambda: True)
        monkeypatch.setattr(st, '_client', lambda: client)
        monkeypatch.setattr(st, '_bucket', lambda: 'test-bucket')
        return client
    return _use


def test_fallback_writes_the_file_when_s3_fails(disk_app, upload, s3):
    """The regression itself: a failed S3 put must still land the file on disk.

    Before the fix this raised ValueError instead of returning a URL, so the
    upload answered 500 and the file was lost.
    """
    s3(_ClosingClient())
    with disk_app.app_context():
        url = st.save_file(upload(), 'probe.png', content_type='image/png')

    path = os.path.join(disk_app.config['upload_folder'], 'probe.png')
    assert os.path.isfile(path), 'the fallback did not write anything'
    assert os.path.getsize(path) == len(PNG), 'the fallback wrote a truncated file'
    assert url.endswith('/uploads/probe.png'), url


def test_fallback_url_matches_the_s3_url_shape(disk_app, upload, s3):
    """The fallback is only safe because the URL is identical either way.

    If the two branches returned different shapes, a file that quietly landed on
    disk would render as a broken image — which is exactly the bug the storage
    module was rewritten to remove.
    """
    ok = s3(_OkClient())
    with disk_app.app_context():
        good = st.save_file(upload(), 'same.png', content_type='image/png')
    assert ok.calls, 'the S3 branch was not exercised'

    s3(_ClosingClient())
    with disk_app.app_context():
        fell_back = st.save_file(upload(), 'same.png', content_type='image/png')

    assert good == fell_back, (
        f'S3 returned {good} but the disk fallback returned {fell_back} — '
        'a caller cannot tell which backend answered, and must not have to')


def test_successful_upload_sends_the_whole_file(disk_app, upload, s3):
    """Buffering must not truncate: boto3 has to receive every byte."""
    ok = s3(_OkClient())
    with disk_app.app_context():
        st.save_file(upload(), 'whole.png', content_type='image/png')
    assert ok.calls[0][2] == len(PNG), f'boto3 received {ok.calls[0][2]} of {len(PNG)} bytes'


def test_local_branch_still_accepts_a_filestorage(disk_app, upload, monkeypatch):
    """The dev path — no S3 at all — must keep working unchanged."""
    monkeypatch.setattr(st, 'is_s3_enabled', lambda: False)
    with disk_app.app_context():
        url = st.save_file(upload(), 'local.png', content_type='image/png')
    path = os.path.join(disk_app.config['upload_folder'], 'local.png')
    assert os.path.isfile(path) and os.path.getsize(path) == len(PNG)
    assert url.endswith('/uploads/local.png'), url
