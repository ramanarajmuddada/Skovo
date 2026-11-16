# ═══════════════════════════════════════════════════════════════════
# SKOVO Backend — Multi-stage Dockerfile
# Python 3.11 | Flask | Gunicorn | MySQL (dev) | PostgreSQL (prod)
# ═══════════════════════════════════════════════════════════════════

# ── Stage 1: Base — shared dependency layer ──────────────────────────────────
FROM python:3.11-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    FLASK_APP=app.py

WORKDIR /app

# System packages needed to compile Python extensions
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    default-libmysqlclient-dev \
    pkg-config \
    curl \
    netcat-openbsd \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt


# ── Stage 2: Development — hot-reload Flask dev server ───────────────────────
FROM base AS development

ENV FLASK_ENV=development \
    FLASK_DEBUG=1

# Copy code — volumes will override in docker-compose
COPY . .

RUN mkdir -p portal/uploads flask_session

EXPOSE 5000

CMD ["flask", "run", "--host=0.0.0.0", "--port=5000", "--reload"]


# ── Stage 3: Production — hardened, non-root, gunicorn ───────────────────────
FROM base AS production

ENV FLASK_ENV=production \
    FLASK_DEBUG=0

# Tini: proper PID-1 signal handling + zombie reaping
RUN apt-get update && apt-get install -y --no-install-recommends tini \
    && rm -rf /var/lib/apt/lists/*

# Non-root user for security
RUN groupadd -r skovo && useradd -r -g skovo -d /app -s /sbin/nologin skovo

COPY --chown=skovo:skovo . .

# Persistent data directories (mount as volumes in production)
RUN mkdir -p portal/uploads flask_session && \
    chown -R skovo:skovo portal/uploads flask_session && \
    sed -i 's/\r//' entrypoint.sh && \
    chmod +x entrypoint.sh

USER skovo

EXPOSE 5000

# TCP healthcheck — works regardless of API route availability
HEALTHCHECK --interval=30s --timeout=10s --start-period=90s --retries=3 \
    CMD python3 -c \
    "import socket; s=socket.socket(); s.settimeout(5); s.connect(('localhost',5000)); s.close()" \
    || exit 1

ENTRYPOINT ["/usr/bin/tini", "--", "./entrypoint.sh"]
