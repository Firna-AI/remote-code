#!/bin/sh
set -eu
if [ -f /run/ascii-secrets/env.sh ]; then
  set -a
  . /run/ascii-secrets/env.sh
  set +a
fi
test "${CONDUCTIVE_DISK_KEEPALIVE:-0}" != 1 || exit 0
if [ -z "${WORKSPACE_TOKEN:-}" ] || [ -z "${CONDUCTIVE_WORKSPACE_ID:-}" ]; then
  exit 0
fi
# Startup writes this marker only after branch preparation and the user script.
test -f /run/conductive/workspace-ready || exit 0
export CONDUCTIVE_WORKSPACE_TOKEN="$WORKSPACE_TOKEN"
export CONDUCTIVE_REPOSITORY="$CONDUCTIVE_REPOSITORY_DIR"
export CONDUCTIVE_RUNNER_URL="${CONDUCTIVE_MACHINE_ORIGIN%/}@RUNNER_PATH@"
cd "$CONDUCTIVE_REPOSITORY"
exec /opt/conductive/current/conductive runner
