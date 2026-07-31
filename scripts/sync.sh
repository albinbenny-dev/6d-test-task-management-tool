#!/usr/bin/env bash
# ==============================================================================
# 6D Test & Task Management Tool - sync.sh
#
# Thin, memorable alias for release.sh - run this ON the Linux server (this
# repo's own clone) to pull the latest release and deploy it. All the actual
# logic (git fetch/checkout, rebuild ttmt-api/ttmt-ui, restart, health-check,
# seed) lives in release.sh - see that file for details/one-time setup.
#
# Usage (from the remote, in this directory):
#   ./scripts/sync.sh              # deploy latest main
#   ./scripts/sync.sh v1.1.0       # deploy a specific tag (recommended for prod)
#   ./scripts/sync.sh <commit-sha> # deploy an exact commit
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$SCRIPT_DIR/release.sh" "$@"
