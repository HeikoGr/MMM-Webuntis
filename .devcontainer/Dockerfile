FROM mcr.microsoft.com/devcontainers/javascript-node:22

WORKDIR /opt/magic_mirror

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    python3 \
    jq \
    ca-certificates \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

RUN update-ca-certificates

RUN npm install -g pm2 prettier cspell

COPY .devcontainer/bootstrap-magicmirror.sh /usr/local/bin/bootstrap-magicmirror.sh

# Copy shell scripts and ensure correct line endings (LF) for cross-platform compatibility (Windows/Linux)
COPY .devcontainer/entrypoint.sh /entrypoint.sh
COPY .devcontainer/postCreate.sh /tmp/postCreate.sh
RUN sed -i 's/\r$//' /entrypoint.sh /tmp/postCreate.sh /usr/local/bin/bootstrap-magicmirror.sh && \
    chmod +x /entrypoint.sh /tmp/postCreate.sh /usr/local/bin/bootstrap-magicmirror.sh

# Ensure compatibility with generated Dockerfiles that expect /entrypoint
RUN ln -sf /entrypoint.sh /entrypoint

# Provide a default PM2 ecosystem file so `pm2-runtime` can start MagicMirror.
# This is a minimal file intended for development in the devcontainer.
COPY .devcontainer/ecosystem.config.js /opt/magic_mirror/ecosystem.config.js

EXPOSE 8080

ENTRYPOINT ["/entrypoint.sh"]
