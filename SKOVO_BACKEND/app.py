import sys as _sys

# eventlet's non-blocking I/O patching is unsupported on Windows pipes/console
# handles (breaks local `python app.py` dev runs there) — only monkey-patch on
# platforms where it works. Production (Linux via gunicorn's eventlet worker
# class) always gets this; local Windows dev falls back to Flask-SocketIO's
# plain-threading async mode instead (see portal/whiteboard_socket.py).
if _sys.platform != 'win32':
    import eventlet
    eventlet.monkey_patch()

import os
import sys
from portal import InitApp

app = InitApp().app()


# Whether the dev server runs Werkzeug's auto-reloader. Read by
# _should_run_scheduler() below and passed to socketio.run() at the bottom, so
# the two can never disagree about how many processes exist.
USE_RELOADER = False


def _should_run_scheduler() -> bool:
    """Run the in-process scheduler only when actually serving — never during
    `flask db ...` migrations/CLI (which also import this module via FLASK_APP)."""
    if os.environ.get('ENABLE_SCHEDULER', '1') != '1':
        return False
    argv = ' '.join(sys.argv)
    if 'flask' in argv and ' db' in f' {argv}':   # flask db upgrade/migrate/etc.
        return False
    # Werkzeug's reloader spawns a parent and a child, both of which import this
    # module; without a guard both start a scheduler and every 60s job runs
    # twice. WERKZEUG_RUN_MAIN='true' is set only in the child, so it tells the
    # two apart.
    #
    # But it only tells them apart when the reloader is actually running. This
    # server passes use_reloader=False (see below — the reloader's fd handoff
    # does not work on Windows), so there is no child, the variable is never
    # set, and the guard was refusing to start the scheduler on every local dev
    # run. Score decay, auto-pause and the 60s session sweep silently never ran
    # outside production. Hence the USE_RELOADER term: the guard applies only
    # when there is a second process to guard against.
    if app.debug and USE_RELOADER and os.environ.get('WERKZEUG_RUN_MAIN') != 'true':
        return False
    return True


def _check_storage_deps() -> None:
    """Refuse to start with S3 configured but unusable.

    boto3 is in requirements.txt, so this only fires when the process was
    started with an interpreter that never installed them -- on Windows, bare
    `python app.py` instead of `venv\\Scripts\\python.exe app.py`.

    It used to surface one upload at a time: every /v1/upload/ returned "File
    storage is unavailable", the achiever saw it as the site refusing their
    photo, and nothing in the startup log said why. Uploads are not an optional
    subsystem here -- no achiever can be verified without them -- so a server
    that cannot store a file should not come up pretending it can.
    """
    from portal.helpers.storage import _bucket, is_s3_enabled
    if _bucket() and not is_s3_enabled():
        raise SystemExit(
            "\nRefusing to start: S3_BUCKET is set but boto3 is not importable.\n"
            "Every file upload would fail with a 503 at the moment someone tried it.\n"
            f"This interpreter: {sys.executable}\n"
            "Start with the venv interpreter, or install the requirements into this one:\n"
            "    venv\\Scripts\\python.exe app.py\n"
            "    venv\\Scripts\\pip.exe install -r requirements.txt\n"
            "To run without file storage at all, unset S3_BUCKET.\n"
        )


_check_storage_deps()


if _should_run_scheduler():
    try:
        from portal.scheduler import start_scheduler
        start_scheduler(app)
    except Exception as _e:   # never let scheduler startup break the web process
        app.logger.warning(f"scheduler not started: {_e}")


if __name__ == "__main__":
    # use_reloader=False: Werkzeug's reloader re-execs itself and hands off a
    # socket fd between parent/child processes — a fork-based mechanism that
    # doesn't work on Windows (KeyError: 'WERKZEUG_SERVER_FD'). Auto-reload
    # isn't needed for the whiteboard's dev/test runs; restart manually.
    # host='0.0.0.0': the default binds 127.0.0.1, which the web app reaches
    # but a phone on the same Wi-Fi cannot — the mobile app talks to this
    # machine's LAN address. Dev only; production runs behind a real WSGI server.
    # PORT is honoured so this can run beside anything already on 5000; 5000
    # stays the default the Vite proxy and E2E suite expect, so nothing changes
    # unless you set it.
    app.socketio.run(app, host='0.0.0.0', port=int(os.environ.get('PORT', 5000)),
                     debug=True, use_reloader=USE_RELOADER, allow_unsafe_werkzeug=True)
