#!/bin/bash
# Deploys the already-built static Vite bundle GitHub Actions has scp'd
# to /opt/waslproperty/releases/incoming/frontend.tar.gz. Never builds on
# this host. Uses a releases/current symlink inside the frontend dir
# (not swapping the frontend dir itself) so Nginx's root stays a stable
# path across deploys.
#
# Deployed to /opt/waslproperty/shared/deploy-frontend.sh on the staging
# host via SSM Run Command (see deploy/README.md) — this file is the
# source of truth; the copy on the host is what actually runs.
set -euo pipefail

INCOMING=/opt/waslproperty/releases/incoming/frontend.tar.gz
CURRENT_LINK=/opt/waslproperty/frontend/current

# Bounded polling, same rationale as deploy-backend.sh: nginx reload is
# fast, but give it a little headroom instead of a single fixed probe.
wait_for_health() {
  local attempt
  for attempt in $(seq 1 6); do
    if curl -fsS --max-time 3 http://127.0.0.1/health >/dev/null; then
      return 0
    fi
    sleep 2
  done
  return 1
}

if [ ! -s "$INCOMING" ]; then
  echo "deploy-frontend: no artifact at $INCOMING" >&2
  exit 1
fi

TS=$(date +%Y%m%d%H%M%S)
RELEASE_DIR="/opt/waslproperty/releases/frontend-$TS"
mkdir -p "$RELEASE_DIR"

if ! tar -xzf "$INCOMING" -C "$RELEASE_DIR"; then
  echo "deploy-frontend: failed to extract artifact" >&2
  rm -rf "$RELEASE_DIR"
  exit 1
fi

if [ ! -f "$RELEASE_DIR/index.html" ]; then
  echo "deploy-frontend: invalid artifact, missing index.html" >&2
  rm -rf "$RELEASE_DIR"
  exit 1
fi

chgrp -R waslprop "$RELEASE_DIR"
chmod -R g+rX "$RELEASE_DIR"

PREVIOUS_RELEASE=$(readlink -f "$CURRENT_LINK" 2>/dev/null || true)
ln -sfn "$RELEASE_DIR" "$CURRENT_LINK"

if ! sudo /usr/bin/systemctl reload nginx; then
  echo "deploy-frontend: nginx reload failed, rolling back symlink" >&2
  if [ -n "$PREVIOUS_RELEASE" ]; then
    ln -sfn "$PREVIOUS_RELEASE" "$CURRENT_LINK"
    sudo /usr/bin/systemctl reload nginx || true
  fi
  exit 1
fi

if ! wait_for_health; then
  echo "deploy-frontend: post-reload health check failed, rolling back" >&2
  if [ -n "$PREVIOUS_RELEASE" ]; then
    ln -sfn "$PREVIOUS_RELEASE" "$CURRENT_LINK"
    sudo /usr/bin/systemctl reload nginx || true
  fi
  exit 1
fi

rm -f "$INCOMING"
echo "deploy-frontend: ok ($RELEASE_DIR)"
