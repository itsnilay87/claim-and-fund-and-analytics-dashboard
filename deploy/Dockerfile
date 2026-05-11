# ─────────────────────────────────────────────────────────
#  Claim Analytics Platform — Single-Container Production Build
#  Multi-stage: frontend build → Python + Node + Nginx runtime
# ─────────────────────────────────────────────────────────

# ── Stage 1: Build frontend assets ──────────────────────
FROM node:20-slim AS frontend-build

# Build dashboard first (standalone) — served from /dashboard/ in production
WORKDIR /build/dashboard
COPY dashboard/package*.json ./
RUN npm ci
COPY dashboard/ ./
ENV VITE_BASE_PATH=/dashboard/
RUN npm run build

# Build app (references @dashboard alias → dashboard/src)
WORKDIR /build/app
COPY app/package*.json ./
RUN npm ci
COPY app/ ./
# Ensure dashboard source is available for @dashboard alias
COPY dashboard/src /build/dashboard/src
RUN npm run build


# ── Stage 2: Production runtime ─────────────────────────
FROM python:3.11-slim

# Install Node.js 20, Nginx, Supervisor
RUN apt-get update && apt-get install -y --no-install-recommends \
      curl gnupg nginx supervisor && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python engines
COPY engine/ ./engine/
RUN pip install --no-cache-dir -r engine/requirements.txt

COPY engine_fund/ ./engine_fund/
RUN pip install --no-cache-dir -r engine_fund/requirements.txt

# Node server
COPY server/package*.json ./server/
WORKDIR /app/server
RUN npm ci --omit=dev
WORKDIR /app
COPY server/ ./server/

# Create runs directory (simulation outputs)
RUN mkdir -p /app/server/runs

# Built frontend assets
COPY --from=frontend-build /build/dashboard/dist /app/static/dashboard
COPY --from=frontend-build /build/app/dist /app/static/app

# Nginx config
COPY deploy/nginx.conf /etc/nginx/sites-available/default
RUN rm -f /etc/nginx/sites-enabled/default && \
    ln -s /etc/nginx/sites-available/default /etc/nginx/sites-enabled/default

# Supervisor config
COPY deploy/supervisord.conf /etc/supervisor/conf.d/app.conf

# Environment defaults
ENV NODE_ENV=production \
    PORT=3001 \
    PYTHONIOENCODING=utf-8

EXPOSE 80 3001

CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/app.conf"]
