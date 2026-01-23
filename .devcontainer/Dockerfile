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
# Install Playwright browsers for testing
RUN npx playwright install chrome --with-deps
WORKDIR /opt/magic_mirror

# Copy shell scripts and ensure correct line endings (LF) for cross-platform compatibility (Windows/Linux)
COPY .devcontainer/entrypoint.sh /entrypoint.sh
COPY .devcontainer/postCreate.sh /tmp/postCreate.sh
RUN sed -i 's/\r$//' /entrypoint.sh /tmp/postCreate.sh && \
    chmod +x /entrypoint.sh /tmp/postCreate.sh

# Ensure compatibility with generated Dockerfiles that expect /entrypoint
RUN ln -sf /entrypoint.sh /entrypoint

# Provide a default PM2 ecosystem file so `pm2-runtime` can start MagicMirror.
# This is a minimal file intended for development in the devcontainer.
COPY .devcontainer/ecosystem.config.js /opt/magic_mirror/ecosystem.config.js

EXPOSE 8080

ENTRYPOINT ["/entrypoint.sh"]
