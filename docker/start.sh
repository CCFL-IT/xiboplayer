#!/bin/sh
# Container start: fix ownership of mounted volumes (bind mounts are often
# root-owned on the host), then drop to the unprivileged node user.
set -e

export APP_VERSION="${APP_VERSION:-$(cat /app/VERSION)}"
ENTRY=/app/proxy/bin/docker-entrypoint.js

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$(dirname "${CONFIG_FILE:-/config/config.json}")" "${DATA_DIR:-/data}"
  chown -R node:node "$(dirname "${CONFIG_FILE:-/config/config.json}")" "${DATA_DIR:-/data}"
  exec setpriv --reuid=node --regid=node --init-groups node "$ENTRY"
fi

exec node "$ENTRY"
