import os
import uuid
from flask import Flask, send_file, request, g, jsonify
from config.config import Development, Production, UAT
from flask_cors import CORS
from flask_session import Session
from dotenv import load_dotenv

APP = None


def init_cors(app):
    # CORS_ORIGINS: comma-separated allowlist in prod (e.g. "https://skovo.in").
    # Defaults to "*" so local dev keeps working; lock it down in production.
    origins_env = os.environ.get('CORS_ORIGINS', '*').strip()
    origins = '*' if origins_env == '*' else [o.strip() for o in origins_env.split(',') if o.strip()]
    CORS(app, resources={r"/*": {"origins": origins}})
    APP.logger.info(f'Initialized CORS — origins={origins}')


class InitApp:
    def app(self):
        global APP
        if APP:
            return APP

        load_dotenv()

        APP = Flask(__name__)

        environment = os.getenv('Backend', 'DEV')

        if environment == 'DEV':
            configfile = Development
        elif environment == 'PROD':
            configfile = Production
        elif environment == 'UAT':
            configfile = UAT
        else:
            raise ValueError(f"Invalid environment: {environment}")

        import logging
        logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
        logger = logging.getLogger('skovo')
        APP.logger = logger

        APP.debug = environment == 'DEV'

        app_secret = os.environ.get('APP_SECRET_KEY')
        if not app_secret:
            raise RuntimeError(
                "APP_SECRET_KEY environment variable is not set. "
                "Add it to your .env file before starting the server."
            )
        APP.secret_key = app_secret

        db_url = (
            os.environ.get('DATABASE_URL') or
            configfile.config.get('server', 'sqlalchemy_database_uri', fallback='')
        )
        if not db_url:
            raise RuntimeError("DATABASE_URL is not set. Add it to your .env file.")
        APP.config['SQLALCHEMY_DATABASE_URI'] = db_url

        APP.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
        APP.config['SQLALCHEMY_ECHO'] = environment == 'DEV'

        # ── Server-side session store ─────────────────────────────────────────
        # 'filesystem' (default) is per-instance local disk — NOT shared across
        # instances. Set SESSION_TYPE=redis behind a load balancer so sessions
        # are shared. (Auth is JWT/Bearer, so impact is small, but be explicit.)
        session_type = os.environ.get('SESSION_TYPE', 'filesystem').strip().lower()
        APP.config['SESSION_TYPE'] = session_type
        if session_type == 'redis':
            import redis as _redis
            session_redis_url = (
                os.environ.get('SESSION_REDIS')
                or os.environ.get('REDIS_URL', 'redis://localhost:6379/1')
            )
            APP.config['SESSION_REDIS'] = _redis.from_url(session_redis_url)

        # ── Flask-Caching (SimpleCache locally, RedisCache in prod) ─────────────
        cache_type = os.environ.get('CACHE_TYPE', 'SimpleCache')
        APP.config['CACHE_TYPE'] = cache_type
        APP.config['CACHE_DEFAULT_TIMEOUT'] = int(os.environ.get('CACHE_DEFAULT_TIMEOUT', 300))
        if cache_type in ('RedisCache', 'redis'):
            APP.config['CACHE_REDIS_URL'] = os.environ.get('REDIS_URL', 'redis://localhost:6379/0')
        if 'sqlite' not in db_url:
            APP.config['SQLALCHEMY_ENGINE_OPTIONS'] = getattr(
                configfile, 'SQLALCHEMY_ENGINE_OPTIONS',
                {'pool_pre_ping': True, 'pool_recycle': 280}
            )

        upload_folder = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'uploads')
        os.makedirs(upload_folder, exist_ok=True)
        APP.config['upload_folder'] = upload_folder

        Session(APP)
        APP.tempconfig = configfile.config

        logger.info(f"Logger initialized — environment: {environment}")

        try:
            from . import api, routes, models
            from portal.helpers.jwt import Token

            models.init_app(APP)
            api.init_app(APP)
            routes.init_app()
            Token(APP)
            init_cors(APP)

            # ── Rate limiting (login / register / OTP brute-force + abuse) ──────
            try:
                from portal.helpers.rate_limit import limiter
                limiter.init_app(APP)
                APP.limiter = limiter
                APP.logger.info("Rate limiter initialized (flask-limiter)")
            except Exception as _rl_err:
                APP.logger.warning(f"rate limiter not initialized: {_rl_err}")

            # ── Realtime whiteboard (Socket.IO) ─────────────────────────────────
            from portal.whiteboard_socket import socketio
            from portal import community_socket  # noqa: F401  (registers community chat events)
            socketio.init_app(APP)
            APP.socketio = socketio
            APP.logger.info("Socket.IO initialized (whiteboard, community chat)")

            # ── Cache ─────────────────────────────────────────────────────────────
            try:
                from flask_caching import Cache
                cache = Cache(APP)
                APP.cache = cache
                APP.logger.info(f"Flask-Caching initialized: type={APP.config['CACHE_TYPE']}")
            except ImportError:
                APP.logger.warning("flask-caching not installed — caching disabled. Run: pip install flask-caching")

            @APP.route('/uploads/<path:filename>')
            def serve_uploaded_file(filename):
                """Serve a stored file, from wherever it actually is.

                Deliberately unauthenticated: the names are unguessable UUIDs and
                the URL goes into <img src> and window.open(), neither of which
                can carry a bearer token.

                The route tries both backends rather than trusting the current
                config, because where a file lives is decided at *upload* time
                and the config can differ by then. A file uploaded while boto3
                was missing sits on local disk forever, yet this instance now has
                S3 enabled and would sign a key that was never written — the
                browser follows the 302 into S3's NoSuchKey XML and the person
                sees a raw 404 the app never got to explain. That is the Document
                Vault bug: the bytes were on disk the whole time.

                `?download=1` forces a download instead of an inline render, on
                both branches — via Content-Disposition on the presigned S3
                response, since a header set here would be lost across the 302.
                """
                from flask import redirect
                from portal.helpers.storage import (
                    is_s3_enabled, presigned_url, object_exists, local_path, object_name,
                )

                # Reject anything that is not one of our generated names before
                # it reaches the filesystem or a bucket key.
                name = object_name(filename)
                if not name:
                    return jsonify(bool=False, status=404,
                                   response={'message': 'That file reference is not valid.'}), 404

                as_attachment = request.args.get('download') in ('1', 'true', 'yes')
                # Optional, cosmetic: what the browser should call the saved file.
                # The stored name is a UUID, which is a poor thing to land in
                # someone's Downloads folder. secure_filename, not object_name:
                # a real title ("10th memo.jpeg") has spaces and must survive as
                # "10th_memo.jpeg" rather than being rejected back to the UUID.
                from werkzeug.utils import secure_filename
                nice_name = secure_filename(request.args.get('filename') or '') or name

                if is_s3_enabled() and object_exists(name):
                    url = presigned_url(name, download_name=nice_name if as_attachment else None)
                    if url:
                        return redirect(url, code=302)

                # Served from the path local_path() actually resolved, which is
                # app.config['upload_folder'] -- the same value save_file() writes
                # to. Serving from a second, module-level UPLOAD_FOLDER meant the
                # route could confirm a file in one directory and then look for it
                # in another, 404ing on a file it had just found.
                disk = local_path(name)
                if disk:
                    return send_file(
                        disk,
                        as_attachment=as_attachment,
                        download_name=nice_name if as_attachment else None,
                    )

                # Genuinely gone — say so in the app's own envelope, so a client
                # can show a sentence instead of a browser error page.
                APP.logger.warning(f"upload not found: {name} (s3={is_s3_enabled()})")
                return jsonify(bool=False, status=404, response={
                    'message': 'This file is no longer available. Upload it again to restore it.',
                }), 404

            # ── Health check ────────────────────────────────────────────────────
            @APP.route('/v1/health')
            def health_check():
                from portal.models import db
                from sqlalchemy import text
                db_ok = False
                try:
                    db.session.execute(text('SELECT 1'))
                    db_ok = True
                except Exception:
                    pass
                status = 'ok' if db_ok else 'degraded'
                return jsonify({
                    'status': status,
                    'database': 'ok' if db_ok else 'error',
                    'version': '1.0.0',
                    'environment': environment,
                }), 200 if db_ok else 503

            # ── Request ID middleware ────────────────────────────────────────────
            @APP.before_request
            def attach_request_id():
                g.request_id = request.headers.get('X-Request-ID') or str(uuid.uuid4())

            @APP.after_request
            def add_request_id_header(response):
                response.headers['X-Request-ID'] = getattr(g, 'request_id', '')

                # ── Security headers (X01-010, X01-018) ──────────────────────
                # Skovo/nginx.conf sets these for the SPA, but that is the
                # frontend container -- api.skovoai.com is this app, and it was
                # answering with none of them. The API is a separate origin, so
                # the SPA's headers do nothing for it.
                #
                # setdefault, not assignment: a proxy in front may already have
                # set these, and overwriting a stricter upstream value with a
                # looser one is worse than adding nothing.
                response.headers.setdefault('X-Content-Type-Options', 'nosniff')
                # DENY, not SAMEORIGIN: nothing should ever frame an API
                # response. The SPA legitimately wants SAMEORIGIN; this does not.
                response.headers.setdefault('X-Frame-Options', 'DENY')
                response.headers.setdefault('Referrer-Policy',
                                            'strict-origin-when-cross-origin')
                # frame-ancestors is the header X-Frame-Options is the legacy of;
                # both are sent because some scanners still check the old one.
                response.headers.setdefault('Content-Security-Policy',
                                            "frame-ancestors 'none'")

                # HSTS only over TLS. A browser ignores it on a plain-HTTP
                # response anyway, but sending it there is noise that reads like
                # the site is protected when it is not. X-Forwarded-Proto is what
                # the ALB/nginx in front sets.
                proto = request.headers.get('X-Forwarded-Proto', '')
                if proto == 'https' or request.is_secure:
                    # Six months, no `preload`, no `includeSubDomains`.
                    # Deliberately conservative: HSTS pins a browser to HTTPS for
                    # the whole max-age, and skovoinfo.com currently has no
                    # working certificate. Preloading or covering subdomains
                    # while a cert is broken makes the site unreachable with no
                    # way for a visitor to bypass it. Widen it once every domain
                    # has a valid certificate.
                    response.headers.setdefault('Strict-Transport-Security',
                                                'max-age=15768000')
                return response

            # ── Global error handler — saves actual error to DB, returns safe message ──
            @APP.errorhandler(Exception)
            def handle_unhandled_exception(e):
                import traceback as tb
                from werkzeug.exceptions import HTTPException
                from portal.helpers.error_capture import capture_error

                # Let real HTTP errors (404, 401, 403, 405, 415, …) pass through as
                # themselves instead of being relabelled 500 and logged as fake
                # server errors. Only genuine unhandled exceptions get captured.
                if isinstance(e, HTTPException):
                    code = e.code or 500
                    return jsonify({
                        'bool': False,
                        'response': {'message': e.description or e.name},
                        'status': code,
                    }), code

                error_id = capture_error(e)

                APP.logger.error(f"Unhandled exception [{error_id}] on {request.method} {request.path}: {e}\n{tb.format_exc()}")

                return jsonify({
                    'bool': False,
                    'response': {'message': 'Internal Server Error', 'error_id': error_id},
                    'status': 500,
                }), 500

        except Exception as e:
            APP.logger.error('An error occurred while initializing app components: %s', e)
            raise

        APP.logger.info('SKOVO app initialization completed successfully')
        return APP
