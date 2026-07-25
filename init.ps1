$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

function Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Warn($msg) { Write-Host "!!  $msg" -ForegroundColor Yellow }

$node = (node --version) -replace "^v", ""
if ([int]($node.Split(".")[0]) -lt 20) {
  Write-Host "node >= 20 required, found $node" -ForegroundColor Red
  exit 1
}
Step "node $node"

Step "installing workspace dependencies"
npm install --no-audit --no-fund

if (-not (Test-Path "server/.env.local")) {
  Step "creating server/.env.local from .env.example"
  Copy-Item "server/.env.example" "server/.env.local"
  Warn "server/.env.local holds placeholder R2 credentials. Sharing/upload will fail until you fill them in. Local dubbing does not need them."
}

$docker = Get-Command docker -ErrorAction SilentlyContinue
if ($docker) {
  Step "starting local Postgres (server/docker-compose.yml)"
  Push-Location server
  try {
    docker compose up -d
    npm run db:push
  } finally { Pop-Location }
} else {
  Warn "docker not found: skipped Postgres and db:push. The extension works standalone; only the share server needs a database."
}

Step "typechecking both workspaces"
npm run type:all

Step "running seam and harness checks"
npm run verify

Write-Host ""
Write-Host "Ready." -ForegroundColor Green
Write-Host "  extension:  npm run dev:ext     then load extension/dist at chrome://extensions (Developer mode -> Load unpacked)"
Write-Host "  server:     npm run dev:server  then http://localhost:3000/api/health"
Write-Host "  bearings:   docs/PROGRESS.md, feature_list.json, AGENTS.md"
