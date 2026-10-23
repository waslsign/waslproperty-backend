#!/bin/bash
# Forced command for the ci-deploy SSH key. $SSH_ORIGINAL_COMMAND is
# whatever the SSH/SCP client asked to run; this script is the ONLY
# thing that ever actually executes. Every branch below is an EXACT
# literal string match (no globbing, no substitution into a shell
# string) and execs a hardcoded path — the client-supplied string is
# never interpreted, only compared, so there is no injection surface.
#
# The two "scp -t ..." branches exist because OpenSSH's forced command
# intercepts ALL exec requests on this key, including scp's own internal
# "scp -t <path>" invocation — without these, artifact upload would
# silently break. Each only unlocks writing to the one fixed destination
# named in its case label, nothing else.
#
# Deployed to /opt/waslproperty/shared/deploy-dispatch.sh on the staging
# host via SSM Run Command (see deploy/README.md) — this file is the
# source of truth; the copy on the host is what actually runs.
set -euo pipefail
case "${SSH_ORIGINAL_COMMAND:-}" in
  "scp -t /opt/waslproperty/releases/incoming/backend.tar.gz")
    exec /usr/bin/scp -t /opt/waslproperty/releases/incoming/backend.tar.gz
    ;;
  "scp -t /opt/waslproperty/releases/incoming/frontend.tar.gz")
    exec /usr/bin/scp -t /opt/waslproperty/releases/incoming/frontend.tar.gz
    ;;
  deploy-backend)
    exec /opt/waslproperty/shared/deploy-backend.sh
    ;;
  deploy-frontend)
    exec /opt/waslproperty/shared/deploy-frontend.sh
    ;;
  *)
    echo "deploy-dispatch: rejected command" >&2
    exit 1
    ;;
esac
