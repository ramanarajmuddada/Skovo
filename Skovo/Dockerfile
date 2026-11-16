# ═══════════════════════════════════════════════════════════════════
# SKOVO Frontend — Multi-stage Dockerfile
# React 19 + Vite | Nginx production server
# ═══════════════════════════════════════════════════════════════════

# ── Stage 1: Builder — install deps and build the React app ──────────────────
# Node 20: Vite 8 (see package.json) requires Node 20.19+ / 22.12+ — Node 18 fails.
FROM node:20-alpine AS builder

WORKDIR /app

# Install deps first (layer cached until package.json changes)
COPY package*.json ./
RUN npm ci --legacy-peer-deps

COPY . .

# Build-time env: bare API host (e.g. "api.skovo.in"), NOT a full URL.
# api.js builds `https://${VITE_API_HOST}/v1`, so a scheme here would double up.
# Empty default → app uses the relative `/v1` path served by nginx's proxy below.
ARG VITE_API_HOST=""
ENV VITE_API_HOST=$VITE_API_HOST

# Build-time env: the two site hostnames, bare (no scheme). One bundle serves
# both, so src/utils/portalHost.js decides at runtime which landing page the
# root path renders — the student one on VITE_WEB_HOST, the admin one on
# VITE_ADMIN_HOST. Unset, it falls back to matching an `admin.` subdomain,
# which means a custom admin domain like skovoai.info would show the STUDENT
# landing page at its root.
ARG VITE_ADMIN_HOST=""
ENV VITE_ADMIN_HOST=$VITE_ADMIN_HOST
ARG VITE_WEB_HOST=""
ENV VITE_WEB_HOST=$VITE_WEB_HOST

RUN npm run build


# ── Stage 2: Production — nginx serving the built static files ────────────────
FROM nginx:1.25-alpine AS production

# Remove default nginx page
RUN rm -rf /usr/share/nginx/html/*

# Copy built assets from builder
COPY --from=builder /app/dist /usr/share/nginx/html

# Custom nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Non-root nginx: use port 8080 internally
# (nginx:alpine already runs as root but serves files safely)

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    # 127.0.0.1, not localhost: nginx.conf has `listen 80` (IPv4 only) while
    # localhost resolves to ::1 first inside the container, so the check
    # failed with "connection refused" and marked a perfectly healthy
    # container unhealthy on every deploy.
    CMD wget -qO- http://127.0.0.1/health > /dev/null || exit 1

CMD ["nginx", "-g", "daemon off;"]
