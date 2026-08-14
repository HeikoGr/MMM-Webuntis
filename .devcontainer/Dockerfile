FROM ghcr.io/heikogr/mmm-devcontainer:node24-trixie-slim

WORKDIR /opt/magic_mirror

RUN command -v ncu >/dev/null 2>&1 || npm install -g npm-check-updates

# GitHub CLI from the official upstream repository (not packaged in Debian).
# Used for PRs, workflow runs, and release inspection. It authenticates itself from the
# GITHUB_TOKEN that Codespaces/devcontainer injects, so no interactive `gh auth login` is needed.
# Note: that token belongs to a GitHub App installation and cannot administer the repository
# (branch protection returns 403) - use a personal access token for those calls.
RUN set -eux; \
    if ! command -v gh >/dev/null 2>&1; then \
        install -d -m 0755 /etc/apt/keyrings; \
        curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
            -o /etc/apt/keyrings/githubcli-archive-keyring.gpg; \
        chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg; \
        printf 'deb [arch=%s signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main\n' \
            "$(dpkg --print-architecture)" > /etc/apt/sources.list.d/github-cli.list; \
        apt-get update; \
        DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends gh; \
        rm -rf /var/lib/apt/lists/*; \
    fi

# Run the container in the timezone the module is actually used in.
#
# The base image defaults to UTC. That silently breaks development in two ways: the mirror marks
# the wrong lesson as current (two hours off in summer), and between 00:00 and 02:00 local time it
# still renders the previous day's timetable. WebUntis is a DACH product, so effectively every
# installation runs in this zone - developing in UTC means testing a configuration nobody uses.
#
# Europe/Berlin, not CEST: only the zone name carries the daylight-saving rules. Override per
# container with "containerEnv": { "TZ": "..." } in devcontainer.json.
ENV TZ=Europe/Berlin
RUN ln -snf "/usr/share/zoneinfo/$TZ" /etc/localtime && echo "$TZ" > /etc/timezone

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
