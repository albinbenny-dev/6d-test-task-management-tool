#!/usr/bin/env bash
# ==============================================================================
# 6D Test & Task Management Tool - git-sync release script
#
# Runs ON the remote server (this repo's own clone), not from Windows. Pulls
# the given git ref, rebuilds ttmt-api/ttmt-ui FROM SOURCE on this box (the
# remote has internet access, so there's no need to build locally and ship
# tar files anymore - see deploy.ps1's history for the old approach), and
# restarts them. Postgres/Redis and their data volumes are never touched.
#
# One-time setup (turning the existing deploy directory into a git clone) -
# run this once, before the first `release.sh`:
#   cd /data/6d-test-task-management-tool
#   git init
#   git remote add origin https://github.com/albinbenny-dev/6d-test-task-management-tool.git
#   git fetch origin
#   git checkout -f -B main origin/main
#   rm -f ttmt-api.tar ttmt-ui.tar   # leftovers from the old scp-based deploy
#
# Usage (from the remote, in this directory):
#   ./scripts/release.sh              # deploy latest main
#   ./scripts/release.sh v1.1.0       # deploy a specific tag (recommended for prod)
#   ./scripts/release.sh <commit-sha> # deploy an exact commit
#
# Or trigger it remotely without logging in:
#   ssh qa-infinity "cd /data/6d-test-task-management-tool && ./scripts/release.sh v1.1.0"
#
# Rolling back is the same command with an older ref:
#   ./scripts/release.sh v1.0.0
# ==============================================================================

set -euo pipefail

REF="${1:-main}"
PROJECT_NAME="6d-ttmt"
SERVICES="ttmt-postgres ttmt-redis ttmt-api ttmt-ui"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

log()  { echo -e "\n==> $*"; }
ok()   { echo "    [OK] $*"; }
warn() { echo "    [!!] $*"; }
err()  { echo "    [ERR] $*" >&2; exit 1; }

[[ -d .git ]] || err "Not a git repo yet - see the one-time setup instructions at the top of this script."
[[ -f .env ]] || err ".env not found in $ROOT_DIR - it's gitignored on purpose (real secrets), so it isn't recreated by git checkout. Copy it over once from the old deploy or from .env.example."

log "Fetching latest refs from origin"
git fetch --all --tags --prune
ok "Fetched"

log "Checking out $REF"
git checkout "$REF"
# Only meaningful for a branch (e.g. 'main') - fast-forwards to origin's tip.
# A no-op (and harmless failure, swallowed) when $REF is a tag or a detached commit.
git merge --ff-only "origin/$REF" 2>/dev/null || true
ok "Now at $(git rev-parse --short HEAD) ($(git log -1 --format=%s))"

# Same auto-detection deploy.ps1 uses (root's compose plugin availability can
# differ from the login user's under sudo).
if sudo docker compose version >/dev/null 2>&1; then
  COMPOSE="sudo docker compose"
elif sudo docker-compose version >/dev/null 2>&1; then
  COMPOSE="sudo docker-compose"
else
  err "Neither 'sudo docker compose' nor 'sudo docker-compose' works on this host."
fi
ok "Using '$COMPOSE'"

log "Building ttmt-api + ttmt-ui from source"
$COMPOSE -p "$PROJECT_NAME" build ttmt-api ttmt-ui
ok "Images built"

log "Starting services (Postgres/Redis untouched if already running)"
$COMPOSE -p "$PROJECT_NAME" up -d $SERVICES
ok "Services (re)started"

log "Waiting for API health check"
healthy=false
for i in $(seq 1 20); do
  sleep 5
  if curl -sf http://localhost:4200/health >/dev/null 2>&1; then healthy=true; break; fi
  echo "    waiting... (${i}x5s)"
done
if $healthy; then
  ok "API is healthy"
else
  warn "Health check timed out - check logs with: sudo docker logs ttmt-api --tail 50"
fi

if $healthy; then
  log "Seeding bootstrap admin (skips silently if already seeded / unset)"
  $COMPOSE -p "$PROJECT_NAME" exec -T ttmt-api sh -c 'cd packages/api && pnpm db:seed' || warn "Seed step reported a non-zero exit (continuing)"
fi

echo ""
echo "  Release complete."
echo "  Ref    : $REF ($(git rev-parse --short HEAD))"
echo "  URL    : http://<server>:3200"
echo ""
