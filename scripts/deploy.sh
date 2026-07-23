#!/usr/bin/env bash
set -euo pipefail

# Initial deploy and update script. Run from the Pi, inside the repo:
#   bash scripts/deploy.sh            # build + restart
#   bash scripts/deploy.sh --import   # also re-import games from EmulationStation gamelists

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$REPO_DIR"
echo "==> RetroVault deploy ($REPO_DIR)"

# The API service triggers this from the Settings "Update" button via a bare,
# non-login shell — so nvm/node and any PATH set up in ~/.bashrc aren't loaded,
# and npm/node fail to resolve. Pull the interactive shell env in so the deploy
# resolves the same toolchain as a normal SSH session. The rc is written for
# interactive use, so relax strict mode around it and never let it abort us.
if [ -f "$HOME/.bashrc" ]; then
  echo "==> Loading shell environment (~/.bashrc)..."
  set +eu
  # shellcheck disable=SC1091
  source "$HOME/.bashrc" || true
  set -eu
fi

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
