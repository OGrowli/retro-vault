#!/usr/bin/env bash
set -euo pipefail

# Initial deploy and update script. Run from the Pi, inside the repo:
#   bash scripts/deploy.sh            # build + restart
#   bash scripts/deploy.sh --import   # also re-import games from EmulationStation gamelists

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$REPO_DIR"
echo "==> RetroVault deploy ($REPO_DIR)"

# The API service triggers this from the Settings "Update" button via a bare,
# non-login shell — so nvm/node aren't on PATH and npm/node fail to resolve.
# Sourcing ~/.bashrc isn't enough: its interactive guard returns early in a
# non-interactive shell, before the nvm lines run. Load nvm directly instead.
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  echo "==> Loading nvm ($NVM_DIR)..."
  set +eu
  # shellcheck disable=SC1091
  source "$NVM_DIR/nvm.sh"
  set -eu
fi

# Fallback: if npm still isn't resolvable, put the newest nvm-installed node
# bin on PATH directly (mirrors the node lookup in install-startup.sh).
if ! command -v npm >/dev/null 2>&1; then
  NODE_BIN_DIR="$(find "$NVM_DIR/versions/node" -maxdepth 2 -type d -name bin 2>/dev/null | sort -V | tail -1 || true)"
  if [ -n "$NODE_BIN_DIR" ]; then
    echo "==> Adding node to PATH ($NODE_BIN_DIR)..."
    export PATH="$NODE_BIN_DIR:$PATH"
  fi
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "ERROR: npm not found (looked in $NVM_DIR). Cannot build — aborting." >&2
  exit 1
fi
echo "==> Using node $(node --version 2>/dev/null || echo '?') / npm $(npm --version 2>/dev/null || echo '?')"

if [ -d .git ]; then
  if [ -n "$(git status --porcelain)" ]; then
    echo "==> Uncommitted changes present — skipping git pull. Commit or stash to pull latest." >&2
  else
    echo "==> Pulling latest..."
    git pull --ff-only
  fi
fi

echo "==> Installing dependencies..."
npm install

echo "==> Building shared + api + web..."
npm run build

echo "==> Updating startup service + autostart..."
bash scripts/install-startup.sh

if [ "${1:-}" = "--import" ]; then
  echo "==> Importing games from EmulationStation gamelists..."
  npm run import
fi

echo ""
echo "==> Deploy complete."
sudo systemctl status retrovault-api --no-pager -l || true
echo ""
sudo reboot
