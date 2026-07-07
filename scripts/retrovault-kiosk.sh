#!/usr/bin/env bash
set -e

# Wait for the API to be ready
echo "Waiting for RetroVault API..."
for i in $(seq 1 30); do
  if curl -sf http://localhost:3000/meta/systems > /dev/null 2>&1; then
    echo "API ready."
    break
  fi
  sleep 1
done

# Start X and launch Chromium inside it
exec startx /home/pi/retro-vault/scripts/launch-chromium.sh -- -nocursor
