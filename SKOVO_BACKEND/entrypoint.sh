#!/bin/sh
# SKOVO Backend — Production entrypoint
# Runs: DB wait → Alembic → procedures/migrations/master data → gunicorn
set -e

export FLASK_APP=app.py

# ── Wait for database ──────────────────────────────────────────────────────────
echo "[entrypoint] Waiting for database to be ready..."
python3 - <<'PYEOF'
import time, sys, os

url = os.environ.get("DATABASE_URL", "")
if not url:
    print("[entrypoint] DATABASE_URL not set — skipping DB wait")
    sys.exit(0)

try:
    from sqlalchemy import create_engine, text
except ImportError:
    print("[entrypoint] SQLAlchemy not available — skipping DB wait")
    sys.exit(0)

engine = create_engine(url, pool_pre_ping=True)

for attempt in range(1, 31):
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        print(f"[entrypoint] Database ready after {attempt} attempt(s)")
        sys.exit(0)
    except Exception as exc:
        print(f"[entrypoint] Attempt {attempt}/30 failed: {exc}")
        time.sleep(3)

print("[entrypoint] Database not ready after 90s — aborting")
sys.exit(1)
PYEOF

# ── Run database migrations ────────────────────────────────────────────────────
# Only when RUN_MIGRATIONS=1 (default). In a multi-instance deploy set
# RUN_MIGRATIONS=0 on the web tasks and run `flask db upgrade` once as a
# dedicated pre-deploy task, so instances don't race on Alembic.
if [ "${RUN_MIGRATIONS:-1}" = "1" ]; then
    echo "[entrypoint] Running Flask-Migrate migrations..."
    flask db upgrade

    # Alembic owns 19 revisions. It does not own the 53 hand-written migrations
    # in database/migrations/ or the 706 stored procedures the SP-only backend
    # calls on every request — without this step the app starts healthy and
    # then fails every request with "PROCEDURE ... does not exist".
    #
    # APPLY_ALL_ARGS lets a first deploy against an already-migrated database
    # pass --baseline, which records the migrations as applied instead of
    # replaying them (only 32 of the 53 are safely re-runnable).
    echo "[entrypoint] Applying stored procedures, migrations and master data..."
    python3 apply_all.py ${APPLY_ALL_ARGS:-}
else
    echo "[entrypoint] RUN_MIGRATIONS=0 — skipping migrations (handled by a separate task)."
fi

# ── A service that names its own command runs it ───────────────────────────────
# The scheduler service is `command: python run_scheduler.py`. Without this the
# script ignored it and started gunicorn, whose 5 workers each started their
# own scheduler (ENABLE_SCHEDULER=1), so every timed job ran 5 times at once.
if [ "$#" -gt 0 ]; then
    echo "[entrypoint] Running: $*"
    exec "$@"
fi

# ── Compute gunicorn workers ───────────────────────────────────────────────────
# Formula: (2 × CPU cores) + 1, capped at 8 to avoid memory pressure
CPU_CORES=$(nproc)
DEFAULT_WORKERS=$(( 2 * CPU_CORES + 1 ))
if [ "$DEFAULT_WORKERS" -gt 8 ]; then
    DEFAULT_WORKERS=8
fi
WORKERS=${GUNICORN_WORKERS:-$DEFAULT_WORKERS}

echo "[entrypoint] Starting gunicorn with ${WORKERS} workers..."

exec gunicorn \
    --workers "${WORKERS}" \
    --worker-class "${GUNICORN_WORKER_CLASS:-sync}" \
    --bind "0.0.0.0:${PORT:-5000}" \
    --timeout "${GUNICORN_TIMEOUT:-120}" \
    --keep-alive "${GUNICORN_KEEPALIVE:-5}" \
    --max-requests "${GUNICORN_MAX_REQUESTS:-1000}" \
    --max-requests-jitter "${GUNICORN_MAX_REQUESTS_JITTER:-100}" \
    --access-logfile - \
    --error-logfile - \
    --log-level "${LOG_LEVEL:-info}" \
    --forwarded-allow-ips "*" \
    app:app
