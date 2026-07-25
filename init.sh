#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

step() { printf '\033[36m==> %s\033[0m\n' "$1"; }
warn() { printf '\033[33m!!  %s\033[0m\n' "$1"; }

node_major=$(node --version | sed 's/^v//' | cut -d. -f1)
if [ "$node_major" -lt 20 ]; then
  printf '\033[31mnode >= 20 required, found %s\033[0m\n' "$(node --version)"
  exit 1
fi
step "node $(node --version)"

step "installing workspace dependencies"
npm install --no-audit --no-fund

if [ ! -f server/.env.local ]; then
  step "creating server/.env.local from .env.example"
  cp server/.env.example server/.env.local
  warn "server/.env.local holds placeholder R2 credentials. Sharing/upload will fail until you fill them in. Local dubbing does not need them."
fi

if command -v docker >/dev/null 2>&1; then
  step "starting local Postgres (server/docker-compose.yml)"
  (cd server && docker compose up -d && npm run db:push)
else
  warn "docker not found: skipped Postgres and db:push. The extension works standalone; only the share server needs a database."
fi

step "typechecking both workspaces"
npm run type:all

step "running seam and harness checks"
npm run verify

echo
printf '\033[32mReady.\033[0m\n'
echo "  extension:  npm run dev:ext     then load extension/dist at chrome://extensions (Developer mode -> Load unpacked)"
echo "  server:     npm run dev:server  then http://localhost:3000/api/health"
echo "  bearings:   docs/PROGRESS.md, feature_list.json, AGENTS.md"
