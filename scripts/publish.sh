#!/usr/bin/env bash
set -euo pipefail

OWNER="${1:-maycuatroi1}"
REPO="${2:-evo-dubbing}"
DESC="AI dubbing Chrome extension + share server for online videos, starting with YouTube"

echo "==> Checking gh auth"
gh auth status

echo "==> Creating public repo ${OWNER}/${REPO} (skips if it exists)"
if ! gh repo view "${OWNER}/${REPO}" >/dev/null 2>&1; then
  gh repo create "${OWNER}/${REPO}" --public --description "${DESC}"
fi

echo "==> Ensuring origin remote"
if git remote get-url origin >/dev/null 2>&1; then
  git remote set-url origin "https://github.com/${OWNER}/${REPO}.git"
else
  git remote add origin "https://github.com/${OWNER}/${REPO}.git"
fi

echo "==> Pushing main"
git push -u origin main

echo "==> Enabling GitHub Pages (source: GitHub Actions)"
gh api -X POST "repos/${OWNER}/${REPO}/pages" -f build_type=workflow >/dev/null 2>&1 \
  || gh api -X PUT "repos/${OWNER}/${REPO}/pages" -f build_type=workflow >/dev/null 2>&1 \
  || echo "Pages may already be configured; check repo settings."

echo "==> Tagging v0.1.0 to trigger the first release (skips if it exists)"
if ! git rev-parse v0.1.0 >/dev/null 2>&1; then
  git tag v0.1.0
  git push origin v0.1.0
fi

echo "==> Done"
echo "Repo:    https://github.com/${OWNER}/${REPO}"
echo "Pages:   https://${OWNER}.github.io/${REPO}/"
echo "Actions: https://github.com/${OWNER}/${REPO}/actions"
