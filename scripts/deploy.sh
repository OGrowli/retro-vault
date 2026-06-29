#!/usr/bin/env bash
set -euo pipefail

# Initial deploy and update script. Run from the Pi, inside the repo:
#   bash scripts/deploy.sh            # build + restart
#   bash scripts/deploy.sh --import   # also re-import games from EmulationStation gamelists

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_FILE="/etc/systemd/system/retrovault-api.service"

cd "$REPO_DIR"
echo "==> RetroVault deploy ($REPO_DIR)"

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

if [ ! -f "$SERVICE_FILE" ]; then
  echo "==> First-time setup: installing startup service + RetroPie autostart hook..."
  bash scripts/install-startup.sh
else
  echo "==> Restarting API service..."
  sudo systemctl restart retrovault-api
fi

if [ "${1:-}" = "--import" ]; then
  echo "==> Importing games from EmulationStation gamelists..."
  npm run import
fi

echo ""
echo "==> Deploy complete."
sudo systemctl status retrovault-api --no-pager -l || true
echo ""
echo "Note: Chromium kiosk keeps the old frontend in memory until relaunched."
echo "Reboot the Pi to pick up web changes, or: sudo pkill chromium-browser"
