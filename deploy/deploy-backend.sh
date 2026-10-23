#!/bin/bash
# Deploys the already-built backend artifact GitHub Actions has scp'd to
# /opt/waslproperty/releases/incoming/backend.tar.gz (built from whatever
# ref the workflow_dispatch input selected — this script has no opinion
# on git refs at all, it only ever deploys "whatever is in incoming/").
# Never builds/compiles on this host.
#
# Deployed to /opt/waslproperty/shared/deploy-backend.sh on the staging
# host via SSM Run Command (see deploy/README.md) — this file is the
# source of truth; the copy on the host is what actually runs.
set -euo pipefail

INCOMING=/opt/waslproperty/releases/incoming/backend.tar.gz
SHARED_ENV=/opt/waslproperty/shared/backend.env
BACKEND_LINK=/opt/waslproperty/backend

# Post-restart health check: bounded polling, not a single probe. A
# cold Node start plus Prisma engine init on a t4g.micro can take a few
# seconds longer than the fixed `sleep 2` this replaced — that false
# negative was triggering unnecessary rollbacks of otherwise-healthy
# releases. Each attempt still has its own short timeout so a genuinely
# hung/crashed process still fails fast overall (≤ ~12s here) rather
# than hanging the deploy.
wait_for_health() {
  local attempt
  for attempt in $(seq 1 6); do
    if curl -fsS --max-time 3 http://127.0.0.1:4100/health >/dev/null; then
      return 0
    fi
    sleep 2
  done
  return 1
}

if [ ! -s "$INCOMING" ]; then
  echo "deploy-backend: no artifact at $INCOMING" >&2
  exit 1
fi

TS=$(date +%Y%m%d%H%M%S)
RELEASE_DIR="/opt/waslproperty/releases/backend-$TS"
mkdir -p "$RELEASE_DIR"

if ! tar -xzf "$INCOMING" -C "$RELEASE_DIR"; then
  echo "deploy-backend: failed to extract artifact" >&2
  rm -rf "$RELEASE_DIR"
  exit 1
fi

if [ ! -f "$RELEASE_DIR/dist/main.js" ]; then
  echo "deploy-backend: invalid artifact, missing dist/main.js" >&2
  rm -rf "$RELEASE_DIR"
  exit 1
fi

# ci-deploy owns these files (it extracted them) but can't chown to
# another user without root. chgrp to a group it belongs to (waslprop)
# is permitted for a file's own owner, and is all the backend process
# (User=waslprop in the systemd unit) actually needs: group-read+execute.
chgrp -R waslprop "$RELEASE_DIR"
chmod -R g+rX "$RELEASE_DIR"

# Only treat BACKEND_LINK as a real previous release if it's actually a
# symlink. The very first deploy finds it as a plain leftover bootstrap
# directory (empty) instead — rmdir only succeeds if it's empty, so this
# never silently discards a populated directory.
PREVIOUS_RELEASE=""
if [ -L "$BACKEND_LINK" ]; then
  PREVIOUS_RELEASE=$(readlink -f "$BACKEND_LINK")
elif [ -d "$BACKEND_LINK" ]; then
  rmdir "$BACKEND_LINK"
fi
ln -sfn "$RELEASE_DIR" "$BACKEND_LINK"

# Run pending Prisma migrations before restarting, using the release's
# own node_modules — never echoes $SHARED_ENV's contents (DATABASE_URL,
# JWT secrets, etc. stay out of command output and logs).
if [ -f "$RELEASE_DIR/node_modules/.bin/prisma" ] && [ -f "$SHARED_ENV" ]; then
  if ! (cd "$RELEASE_DIR" && set -a && source "$SHARED_ENV" && set +a && \
        node_modules/.bin/prisma migrate deploy); then
    echo "deploy-backend: migration failed, rolling back symlink" >&2
    if [ -n "$PREVIOUS_RELEASE" ]; then
      ln -sfn "$PREVIOUS_RELEASE" "$BACKEND_LINK"
    fi
    rm -rf "$RELEASE_DIR"
    exit 1
  fi
else
  echo "deploy-backend: skipping migration (no prisma CLI or no $SHARED_ENV yet)"
fi

if ! sudo /usr/bin/systemctl restart waslproperty-backend; then
  echo "deploy-backend: service restart failed, rolling back symlink" >&2
  if [ -n "$PREVIOUS_RELEASE" ]; then
    ln -sfn "$PREVIOUS_RELEASE" "$BACKEND_LINK"
    sudo /usr/bin/systemctl restart waslproperty-backend || true
  fi
  exit 1
fi

if ! wait_for_health; then
  echo "deploy-backend: post-restart health check failed, rolling back" >&2
  if [ -n "$PREVIOUS_RELEASE" ]; then
    ln -sfn "$PREVIOUS_RELEASE" "$BACKEND_LINK"
    sudo /usr/bin/systemctl restart waslproperty-backend || true
  fi
  exit 1
fi

rm -f "$INCOMING"
echo "deploy-backend: ok ($RELEASE_DIR)"
