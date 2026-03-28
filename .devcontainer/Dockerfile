FROM ghcr.io/heikogr/mmm-devcontainer-base:node24-trixie-slim

WORKDIR /opt/magic_mirror

# Copy shell scripts and ensure correct line endings (LF) for cross-platform compatibility (Windows/Linux)
COPY --chmod=755 ./entrypoint.sh /entrypoint.sh
RUN sed -i 's/\r$//' /entrypoint.sh && \
    chmod +x /entrypoint.sh

# Ensure compatibility with generated Dockerfiles that expect /entrypoint
RUN ln -sf /entrypoint.sh /entrypoint

# Provide a default PM2 ecosystem file so `pm2-runtime` can start MagicMirror.
# This is a minimal file intended for development in the devcontainer.
COPY ./ecosystem.config.js /opt/magic_mirror/ecosystem.config.js

EXPOSE 8080

ENTRYPOINT ["/entrypoint.sh"]
