#!/usr/bin/env bash
# ==============================================================================
# 6D Test & Task Management Tool - dev.sh
#
# One command for local development on macOS/Linux:
#   1. starts a dev Postgres + Redis (docker-compose.dev.yml, ports 5499/6399)
#   2. applies the Prisma schema (prisma db push) and seeds the admin
#   3. runs the API (tsx watch, :4000) and the UI (vite, :3000) together
#
# Never touches the ttmt-* containers or their database. Dev data lives in the
# ttmt-dev-pgdata volume and survives restarts.
#
# Usage:   ./scripts/dev.sh          # start everything (Ctrl+C stops API + UI)
#          ./scripts/dev.sh --reset  # wipe the dev DB first
#          ./scripts/dev.sh --down   # stop the dev Postgres/Redis containers
#
# Needs the root .env (gitignored): JWT_SECRET, SEED_ADMIN_EMAIL/PASSWORD, ...
# ==============================================================================

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Prefer Homebrew's keg-only Node 20 and corepack-installed pnpm when present.
for d in /opt/homebrew/opt/node@20/bin "$HOME/.local/bin"; do
  [ -d "$d" ] && PATH="$d:$PATH"
done
export PATH

DEV_COMPOSE=(docker compose -f docker-compose.dev.yml)

case "${1:-}" in
  --down)  "${DEV_COMPOSE[@]}" down; exit 0 ;;
  --reset) "${DEV_COMPOSE[@]}" down -v ;;
  "")      ;;
  *)       echo "Unknown option: $1 (use --reset or --down)" >&2; exit 1 ;;
esac

[ -f .env ] || { echo "Missing .env in $ROOT - copy it from .env.example first." >&2; exit 1; }
command -v pnpm >/dev/null || { echo "pnpm not found - see CLAUDE.md (Node 20 + pnpm 9.15.9)." >&2; exit 1; }
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -le 22 ] || echo "Warning: Node $NODE_MAJOR detected; the project targets Node 20." >&2
[ -d node_modules ] || pnpm install

echo "==> Starting dev Postgres + Redis"
"${DEV_COMPOSE[@]}" up -d --wait

# Dev overrides (the Docker stack sets its own values in docker-compose.yml).
export DATABASE_URL="postgresql://ttmt_dev:ttmt_dev@127.0.0.1:5499/ttmt_dev"
export REDIS_URL="redis://127.0.0.1:6399"
export REDIS_PASSWORD=""
export CORS_ORIGIN="http://localhost:3000"
export APP_URL="http://localhost:3000"

# --env-file loads the root .env for the API (it only looks in packages/api/);
# values exported above win over the file.
API_DIR="$ROOT/packages/api"

echo "==> Applying schema and seeding admin"
(cd "$API_DIR" && ./node_modules/.bin/prisma db push --accept-data-loss --skip-generate >/dev/null \
  && ./node_modules/.bin/prisma generate >/dev/null \
  && ./node_modules/.bin/tsx --env-file=../../.env prisma/seed.ts)

echo "==> API http://localhost:4000   UI http://localhost:3000"
exec pnpm exec concurrently -k -n api,ui -c cyan,magenta \
  "cd packages/api && PORT=4000 ./node_modules/.bin/tsx watch --env-file=../../.env src/index.ts" \
  "cd packages/frontend && PORT=3000 API_PROXY_TARGET=http://localhost:4000 ./node_modules/.bin/vite"
