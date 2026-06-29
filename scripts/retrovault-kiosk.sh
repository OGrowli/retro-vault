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

# Hide cursor and disable screen blanking
xset s off
xset s noblank
xset -dpms
unclutter -idle 0 -root &

exec chromium-browser \
  --kiosk \
  --disable-extensions \
  --disable-gpu \
  --js-flags="--max-old-space-size=256" \
  --no-sandbox \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --disable-translate \
  --noerrdialogs \
  --check-for-update-interval=31536000 \
  http://localhost:3000
