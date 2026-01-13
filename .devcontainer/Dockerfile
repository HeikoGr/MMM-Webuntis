# Module-local Dockerfile copied from repo root (minimal adaptation)
FROM node:22-bookworm-slim

WORKDIR /opt/magic_mirror

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    python3 \
    jq \
    ca-certificates \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Clone MagicMirror
RUN git clone --depth=1 https://github.com/MagicMirrorOrg/MagicMirror.git . && \
    npm install --omit=dev && \
    npm cache clean --force && \
    rm -rf /opt/magic_mirror/.git

RUN update-ca-certificates

RUN npm install -g pm2

# Install common dev tooling globally (ESLint plugins must be installed locally per project with ESLint 9.x)
RUN npm install -g \
    prettier \
    cspell

WORKDIR /opt/magic_mirror

COPY ./entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh || true

# Provide a default PM2 ecosystem file so `pm2-runtime` can start MagicMirror.
# This is a minimal file intended for development in the devcontainer.
COPY ./ecosystem.config.js /opt/magic_mirror/ecosystem.config.js

EXPOSE 8080

ENTRYPOINT ["/entrypoint.sh"]
